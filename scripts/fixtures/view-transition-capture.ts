import {
  createElement,
  readPromise,
  Suspense,
  transition,
  useState,
  ViewTransition,
  type StateSetter,
} from "@bgub/fig";
import {
  SUSPENSE_COMPLETED_MARKER,
  SUSPENSE_END_MARKER,
} from "@bgub/fig/internal";
import { flushSync, hydrateRoot, on } from "@bgub/fig-dom";
import { enableViewTransitions } from "@bgub/fig-dom/view-transitions";

// Run against native capture scheduling; the wrapper observes the browser's
// promises and forces work on either side of its actual mutation callback.
export async function probeCaptureInterruption(
  mode: "flush" | "hydrate",
  phase: "before-update" | "before-ready",
) {
  enableViewTransitions();
  const container = document.createElement("div");
  container.innerHTML = `<section style="view-transition-name: author-old">old</section><!--${SUSPENSE_COMPLETED_MARKER}--><button>Server button</button><!--${SUSPENSE_END_MARKER}-->`;
  document.body.append(container);
  const button = container.querySelector("button")!;
  const start = document.startViewTransition.bind(document);
  let select: StateSetter<string> = () => {};
  let canHydrate = false;
  let clicks = 0;
  let skips = 0;
  let starts = 0;
  let callbacks = 0;
  let mutations = 0;
  const errors: string[] = [];
  const content = deferred<void>();
  const completed = deferred<{
    text: string | null;
    authorName: string;
    clicks: number;
    sameButton: boolean;
    dehydrated: boolean;
    readyRejected: boolean;
  }>();
  function Button() {
    if (!canHydrate) readPromise(content.promise);
    return createElement(
      "button",
      {
        mix: on("click", () => {
          clicks += 1;
        }),
      },
      "Server button",
    );
  }
  function App() {
    const [label, setLabel] = useState("old");
    select = setLabel;
    return [
      createElement(
        ViewTransition,
        {
          name: "card",
          onTransition() {
            callbacks += 1;
          },
        },
        createElement(
          "section",
          {
            style: { viewTransitionName: `author-${label}` },
          },
          label,
        ),
      ),
      createElement(Suspense, { fallback: "Loading" }, createElement(Button)),
    ];
  }
  const root = flushSync(() =>
    hydrateRoot(container, createElement(App), {
      onRecoverableError(error) {
        errors.push(String(error));
      },
      onUncaughtError(error) {
        errors.push(String(error));
      },
    }),
  );
  let native: ViewTransition | undefined;
  try {
    document.startViewTransition = (input) => {
      starts += 1;
      const update = typeof input === "function" ? input : input?.update;
      const force = () => {
        try {
          if (mode === "hydrate") {
            canHydrate = true;
            button.click();
          } else flushSync(() => select("urgent"));
          // Capture the synchronous result before native promises settle.
          const immediate = {
            text: container.querySelector("section")!.textContent,
            authorName:
              container.querySelector("section")!.style.viewTransitionName,
            clicks,
            sameButton: container.querySelector("button") === button,
            dehydrated: container.innerHTML.includes(SUSPENSE_COMPLETED_MARKER),
          };
          void Promise.all([
            native!.ready.then(
              () => false,
              () => true,
            ),
            native!.finished,
          ]).then(
            ([readyRejected]) =>
              completed.resolve({ ...immediate, readyRejected }),
            completed.reject,
          );
        } catch (error) {
          completed.reject(error);
        }
      };
      native = start({
        ...(typeof input === "object" ? input : {}),
        update() {
          mutations += 1;
          const result = update?.();
          if (phase === "before-ready") force();
          return result;
        },
      });
      const skip = native.skipTransition.bind(native);
      native.skipTransition = () => {
        skips += 1;
        skip();
      };
      if (phase === "before-update") queueMicrotask(force);
      return native;
    };
    transition(() => select("next"));
    const result = await completed.promise;
    // finished also waits for the native update callback after a skip. Any
    // delayed callback must leave the forced tree and event count unchanged.
    return {
      ...result,
      finalText: container.querySelector("section")!.textContent,
      finalClicks: clicks,
      starts,
      skips,
      callbacks,
      mutations,
      errors,
    };
  } finally {
    root.unmount();
    content.resolve();
    document.startViewTransition = start;
    container.remove();
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
