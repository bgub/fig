import {
  createElement,
  readPromise,
  Suspense,
  transition,
  type StateSetter,
  useBeforePaint,
  useMemo,
  useState,
} from "@bgub/fig";
import { afterEach, expect, it, vi } from "vitest";
import * as scheduler from "../../fig-reconciler/src/scheduler.ts";
import { createRoot, type FigRoot, flushSync } from "./index.ts";
import {
  deferred,
  FakeElement,
  installFakeDocument,
  waitForHostTurns,
} from "./test-utils.ts";

installFakeDocument();
const roots: FigRoot[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) flushSync(() => root.unmount());
});

// Fixed seeds make failures reproducible. Read upper bits: consecutive low
// bits of an LCG otherwise correlate target, priority, and operation choices.
function randomFor(seed: number) {
  let state = seed;
  return (limit: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state >>> 8) % limit;
  };
}

function nextUpdate(random: (limit: number) => number) {
  const multiplier = random(3);
  const increment = random(17) + 1;
  // Include replacements and noncommuting updates; addition alone cannot
  // distinguish a reordered queue. Bound values to avoid floating-point loss.
  return (previous: number) => (previous * multiplier + increment) % 100003;
}

function createTestRoot() {
  const container = new FakeElement("root");
  const root = createRoot(container as unknown as Element);
  roots.push(root);
  return { root, container };
}

const seeds = Array.from({ length: 32 }, (_, index) => index + 1);

it.each(seeds)(
  "preserves urgent snapshots and final dispatch order (seed %i)",
  async (seed) => {
    const random = randomFor(seed);
    let setFirst!: StateSetter<number>;
    let setLast!: StateSetter<number>;
    function Counter({ revision }: { revision: number }) {
      const [first, updateFirst] = useState(1);
      setFirst = updateFirst;
      const label = useMemo(() => `r${revision}`, [revision]);
      const [last, updateLast] = useState(2);
      setLast = updateLast;
      return createElement("span", null, `${label}:${first}:${last}`);
    }
    const { root, container } = createTestRoot();
    flushSync(() => root.render(createElement(Counter, { revision: 0 })));
    const history: {
      target: number;
      apply: (previous: number) => number;
      ready: boolean;
    }[] = [];
    const snapshot = () => {
      const values = [1, 2, 0];
      for (const update of history) {
        if (update.ready)
          values[update.target] = update.apply(values[update.target]);
      }
      return `r${values[2]}:${values[0]}:${values[1]}`;
    };

    for (let round = 0; round < 4; round++) {
      await scheduler.act(() => {
        for (let step = 0; step < 18; step++) {
          const target = random(3);
          const priority = random(3);
          const revision = round * 18 + step + 1;
          const apply = target === 2 ? () => revision : nextUpdate(random);
          history.push({ target, apply, ready: priority === 0 });
          const dispatch = () => {
            if (target === 2) root.render(createElement(Counter, { revision }));
            else (target === 0 ? setFirst : setLast)(apply);
          };
          if (priority === 0) {
            flushSync(dispatch);
            expect(container.textContent, `round ${round}, step ${step}`).toBe(
              snapshot(),
            );
          } else if (priority === 1) transition(dispatch);
          else dispatch();
        }
      });
      for (const update of history) update.ready = true;
      expect(container.textContent, `drained round ${round}`).toBe(snapshot());
    }
  },
);

it.each(seeds)(
  "preserves queues across yields and partial Suspense reads (seed %i)",
  async (seed) => {
    const random = randomFor(seed);
    const gate = deferred<void>();
    let setFirst!: StateSetter<number>;
    let setLast!: StateSetter<number>;
    let blocked = true;
    function Counter() {
      const [first, updateFirst] = useState(0);
      setFirst = updateFirst;
      const label = useMemo(() => String(first), [first]);
      if (first % 3 === 1 && blocked) readPromise(gate.promise);
      const [last, updateLast] = useState(0);
      setLast = updateLast;
      if (last % 3 === 2 && blocked) readPromise(gate.promise);
      return createElement("span", null, `${label}:${last}`);
    }
    const { root, container } = createTestRoot();
    const tree = () =>
      createElement(
        Suspense,
        {
          fallback: createElement("i", null, "loading"),
        },
        createElement(Counter),
      );
    flushSync(() => root.render(tree()));
    const expected = [0, 0];
    const dispatch = () => {
      const target = random(2);
      const apply = nextUpdate(random);
      expected[target] = apply(expected[target]);
      const update = () => (target === 0 ? setFirst : setLast)(apply);
      const priority = random(3);
      if (priority === 0) flushSync(update);
      else if (priority === 1) transition(update);
      else update();
    };
    let checks = 0;
    let yielded = false;
    let lateUpdate = false;
    const yieldAfter = seed % 5;
    const shouldYield = scheduler.shouldYieldToHost;
    vi.spyOn(scheduler, "shouldYieldToHost").mockImplementation(() => {
      if (checks++ !== yieldAfter) return shouldYield();
      yielded = true;
      scheduler.requestPaint();
      queueMicrotask(() => {
        lateUpdate = true;
        dispatch();
        root.render(tree());
      });
      return true;
    });

    // Guarantee enough concurrent units to reach every selected yield point.
    root.render(tree());
    await waitForHostTurns(10);
    expect(yielded).toBe(true);
    expect(lateUpdate).toBe(true);
    for (let round = 0; round < 4; round++) {
      await scheduler.act(() => {
        for (let step = 0; step < 12; step++) dispatch();
        flushSync(() => root.render(tree()));
      });
    }
    await scheduler.act(() => {
      blocked = false;
      gate.resolve(undefined);
      flushSync(() => root.render(tree()));
    });
    expect(container.textContent).toBe(expected.join(":"));
  },
);

it.each(seeds)(
  "reveals rebased queues without stale effect snapshots (seed %i)",
  async (seed) => {
    const random = randomFor(seed);
    const gate = deferred<void>();
    let setCount!: StateSetter<number>;
    let suspendedValue = -1;
    const commits: number[] = [];
    function Counter() {
      const [count, set] = useState(1);
      setCount = set;
      if (count === suspendedValue) readPromise(gate.promise);
      useBeforePaint(() => {
        commits.push(count);
      });
      return createElement("span", null, count);
    }
    const { root, container } = createTestRoot();
    flushSync(() =>
      root.render(
        createElement(
          Suspense,
          {
            fallback: createElement("i", null, "loading"),
          },
          createElement(Counter),
        ),
      ),
    );
    let expected = 1;
    await scheduler.act(() => {
      // Positive, noncommuting updates ensure the suspended total differs from
      // every urgent snapshot, while leaving a substantial committed rebase log.
      for (let step = 0; step < 8; step++) {
        const add = random(9) + 1;
        const deferredUpdate = (value: number) => value + add;
        setCount(deferredUpdate);
        expected = deferredUpdate(expected);
        const urgentUpdate = (value: number) => value * 2;
        flushSync(() => setCount(urgentUpdate));
        expected = urgentUpdate(expected);
      }
      suspendedValue = expected;
    });
    expect(container.textContent).toContain("loading");
    commits.length = 0;
    await scheduler.act(() => gate.resolve(undefined));
    expect(container.textContent).toBe(String(expected));
    expect(commits).toEqual([expected]);
  },
);
