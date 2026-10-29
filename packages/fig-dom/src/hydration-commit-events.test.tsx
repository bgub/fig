// @vitest-environment happy-dom
import {
  readPromise,
  Suspense,
  useBeforeLayout,
  useBeforePaint,
} from "@bgub/fig";
import { renderToHtml } from "@bgub/fig-server";
import { afterEach, expect, it } from "vitest";
import { flushSync, hydrateRoot, on, type FigRoot } from "./index.ts";
import { waitForHostTurns } from "./test-utils.ts";

const roots: FigRoot[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) root.unmount();
  document.body.replaceChildren();
});

for (const phase of ["bind", "before-layout", "before-paint"] as const) {
  it.each(["focus", "click"] as const)(
    `defers boundary hydration requested by %s during ${phase} until the commit finishes`,
    async (event) => {
      const host = document.createElement("div");
      document.body.append(host);
      let ready = true;
      const pending = new Promise<void>(() => {});
      const calls: string[] = [];
      const errors: unknown[] = [];
      function Deferred() {
        if (!ready) readPromise(pending);
        return (
          <button
            id="lazy"
            mix={on("click", () => {
              calls.push("click");
            })}
          >
            Lazy
          </button>
        );
      }
      const boundary = (
        <Suspense fallback="waiting">
          <Deferred />
        </Suspense>
      );
      let fired = false;
      function fire(): undefined {
        if (fired) return;
        fired = true;
        host.querySelector<HTMLButtonElement>("#lazy")![event]();
        calls.push("after-event");
      }
      function App({ activate = false }: { activate?: boolean }) {
        useBeforeLayout(() => {
          if (activate && phase === "before-layout") fire();
        }, [activate]);
        useBeforePaint(() => {
          if (activate && phase === "before-paint") fire();
          if (activate) calls.push("effect");
        }, [activate]);
        return (
          <>
            <input bind={activate && phase === "bind" ? fire : undefined} />
            {boundary}
            <output>{activate ? "new" : "old"}</output>
          </>
        );
      }
      host.innerHTML = await renderToHtml(<App />);
      const button = host.querySelector("button");
      ready = false;
      const root = flushSync(() =>
        hydrateRoot(host, <App />, {
          onRecoverableError: (error) => errors.push(error),
          onUncaughtError: (error) => errors.push(error),
        }),
      );
      roots.push(root);
      await waitForHostTurns();
      expect(host.innerHTML).toContain("fig:suspense:completed");
      calls.length = 0;
      ready = true;
      flushSync(() => root.render(<App activate />));
      expect(host.querySelector("output")?.textContent).toBe("new");
      expect(host.innerHTML).not.toContain("fig:suspense:");
      await waitForHostTurns();
      expect(errors).toEqual([]);
      expect(calls).toEqual(
        event === "click"
          ? ["after-event", "effect", "click"]
          : ["after-event", "effect"],
      );
      expect(host.querySelector("button")).toBe(button);
      if (event === "focus") expect(document.activeElement).toBe(button);
    },
  );
}

it("queues an event fired before the initial hydration shell is published", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const calls: string[] = [];
  const errors: unknown[] = [];
  let fired = false;
  function App() {
    useBeforeLayout(() => {
      if (fired) return;
      fired = true;
      host.querySelector("button")!.click();
      calls.push("after-event");
    }, []);
    return (
      <button
        mix={on("click", () => {
          calls.push("click");
        })}
      >
        Ready
      </button>
    );
  }
  host.innerHTML = await renderToHtml(<App />);
  const button = host.firstElementChild;
  roots.push(
    flushSync(() =>
      hydrateRoot(host, <App />, {
        onRecoverableError: (error) => errors.push(error),
        onUncaughtError: (error) => errors.push(error),
      }),
    ),
  );
  await waitForHostTurns();
  expect(errors).toEqual([]);
  expect(calls).toEqual(["after-event", "click"]);
  expect(host.firstElementChild).toBe(button);
});
