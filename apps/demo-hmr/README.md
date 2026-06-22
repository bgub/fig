# @bgub/fig-demo-hmr

A minimal SPA that exercises Fig's true (state-preserving) Hot Module
Replacement via `@bgub/fig-vite`.

## Run it

```sh
pnpm --filter @bgub/fig-demo-hmr dev   # vp dev on http://localhost:4300
```

No build step needed — the dev server resolves `@bgub/fig*` to source via
`resolve.alias` (so Fig itself is debuggable/HMR-able too).

## Try HMR

1. Open http://localhost:4300 and click **increment** a few times.
2. Edit `src/Counter.tsx` — e.g. change the `<h1>` text or the button label —
   and save.
3. The text updates **without** the count resetting (state preserved).
4. Now add or remove a hook (e.g. add `useState` again) and save: the component
   remounts and the count resets — that's the intended "stale signature" path.

The transform injects `register`/`setSignature` + an `import.meta.hot.accept()`
boundary per component module; the runtime (`@bgub/fig-refresh`) decides
re-render-in-place vs remount and drives the reconciler's `scheduleRefresh`.
