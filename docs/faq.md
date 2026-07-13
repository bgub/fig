# FAQ

### How do I get the DOM node inside a custom hook, like `useRef` in React?

Return a `bind` from the hook and let the caller attach it. In React the hook returns a ref object and reads `.current` from an effect; in Fig the hook returns the attachment point directly, and gets notified on attach, detach, and node identity change for free (the case where React's `ref.current`-in-`useEffect` silently goes stale):

```tsx
function useSize() {
  const [size, setSize] = useState<DOMRect | null>(null);
  const bind = useMemo(
    () => (node: Element, signal: AbortSignal) => {
      const observer = new ResizeObserver(([entry]) =>
        setSize(entry.contentRect),
      );
      observer.observe(node);
      signal.addEventListener("abort", () => observer.disconnect());
    },
    [],
  );
  return [size, bind] as const;
}

const [size, sizeBind] = useSize();
<div bind={sizeBind}>...</div>;
```

This covers observers, focus management, click-outside, measurement, and mounting third-party widgets. The caller merges several binds with `composeBind(...)`, so hooks compose without ref-merging helpers.

### How do I call DOM methods later — from an event handler or a timer?

When you need the node at an arbitrary later time (`node.focus()` from a handler, measuring on window resize), hold it in a box that a bind fills:

```tsx
const box = useMemo(() => ({ current: null as HTMLDivElement | null }), []);
const holdBind = useMemo(
  () => (node: HTMLDivElement, signal: AbortSignal) => {
    box.current = node;
    signal.addEventListener("abort", () => {
      box.current = null;
    });
  },
  [],
);

<div bind={holdBind}>...</div>;
```

Binds attach during commit, before `useBeforePaint` effects run, so the box is filled by the time before-paint effects read it — the same guarantee React gives for `ref.current` in `useLayoutEffect`. The abort listener empties the box on identity change, unmount, and Activity suspend, so `box.current === null` always means "not attached right now".

### Why hooks instead of signals?

Fig keeps React's hooks model. Fine-grained signal reactivity is a different architecture; Fig's core is fibers, lanes, and scheduled re-renders, and hooks are the API that model exposes. Dependency arrays are the honest choice without a compiler — the `AbortSignal` every callback receives is for cleanup, not tracking (see `concepts/hooks.md`).
