# Hydration Root Options + Diagnostics Plan

## Context

Fig now has root-level hydration recovery that is closer to React: hydration mismatches abandon hydration, clear server DOM, and retry as a client render. The next cleanup is to make that behavior observable and make root lifecycle mistakes easier to diagnose.

## Approach

Add a small root options API with `onRecoverableError`, queue hydration mismatch diagnostics during render recovery, report them after successful commit, and add duplicate-root diagnostics so users do not accidentally mix `createRoot` and `hydrateRoot` on the same container.

This should be **React-aligned but not React-cloned**. React is a useful reference for root-level client-render recovery, but Fig should keep the implementation runtime/renderer-first and avoid assumptions that only make sense in React DOM or in bundler-managed apps.

## Design considerations: where Fig may differ from React

- **Bundler-agnostic diagnostics.** The Remix 3 beta preview emphasizes that the runtime should be the source of truth and that framework semantics should not depend on pre-runtime bundler analysis or special `import` behavior. Fig should follow that: `onRecoverableError` should report plain runtime errors first, not depend on component source maps, module IDs, import graphs, or bundler-injected hydration metadata.
- **Renderer-first recovery.** Keep recovery in the reconciler, but require host capabilities such as `clearContainer`. Do not bake DOM-specific assumptions into the core reconciler. This keeps custom renderers able to opt into hydration without adopting DOM concepts.
- **Explicit duplicate-root failure.** React warns in development when a container already has a root. Fig does not currently have a dev/prod warning split, so the safer behavior is to throw a clear error for duplicate public root creation.
- **Simple recoverable error shape.** React provides rich error info and component stacks. Fig should start with `onRecoverableError(error)` only. Component stacks or richer metadata can be added later without coupling the core implementation to a bundler.
- **Root-level recovery for now.** React can recover at finer boundaries. Fig should keep this pass root-level only; adding boundary-level recovery should wait until Suspense hydration semantics are designed.
- **Default policy remains client-render recovery.** Do not add a public mismatch policy option in this pass. A strict/throwing hydration mode may be useful for tests or non-DOM renderers later, but adding it now would expand API surface before the default behavior is settled.

## Files to modify

- `packages/fig-reconciler/src/index.ts`
- `packages/fig-dom/src/index.ts`
- `packages/fig-dom/src/index.test.ts`
- Potentially `packages/fig-reconciler/src/index.test.ts` if renderer-level tests are useful

## Reuse

- Existing hydration mismatch path in `packages/fig-reconciler/src/index.ts`:
  - `HydrationMismatchError`
  - `hydrationMismatch(...)`
  - `recoverFromHydrationMismatch(...)`
  - `commitRoot(...)`
- Existing root creation storage via the reconciler `roots` `WeakMap`.
- Existing DOM fake test infrastructure in `packages/fig-dom/src/index.test.ts`.

## Steps

- [x] Add `FigRootOptions` to the reconciler with `onRecoverableError?: (error: unknown) => void`.
- [x] Thread options through `createRoot(container, options?)` and `hydrateRoot(container, children, options?)` in the reconciler without introducing DOM-only assumptions.
- [x] Mirror those options through `packages/fig-dom/src/index.ts`.
- [x] Add `onRecoverableError` and `recoverableErrors` fields to `FiberRoot`.
- [x] Change hydration mismatch creation to queue a normal runtime `Error` for later reporting, while still throwing the internal `HydrationMismatchError` sentinel for control flow.
- [x] Keep the recoverable error payload bundler-agnostic: message-only/runtime error for this pass, no source-map, module-id, or import-graph metadata.
- [x] After successful commit, flush queued recoverable errors to `root.onRecoverableError`.
- [x] Make recoverable-error reporting defensive so a throwing callback does not break a successful render.
- [x] Add duplicate-root diagnostics for repeated `createRoot` / `hydrateRoot` calls on the same container, using a clear thrown error rather than React-style dev-only warning.
- [x] Decide and preserve intended `render(children, container)` behavior. If `render` is meant to be a convenience update API, handle it explicitly rather than accidentally breaking repeated calls.
- [x] Add tests for hydration mismatch reporting via `onRecoverableError`.
- [x] Add tests that `onRecoverableError` callback failures do not prevent client-render recovery.
- [x] Add tests for duplicate-root diagnostics.
- [x] Add or preserve tests around repeated `render(...)` behavior based on the selected semantics.
- [x] Add a test or assertion that custom renderers without `clearContainer` still get the existing “Hydration is not supported by this renderer” diagnostic.

## Verification

Run:

```bash
pnpm lint
pnpm test
```

Target expectations:

- Hydration mismatch still recovers by clearing server DOM and client rendering.
- Mismatch is reported to `onRecoverableError` exactly once per recovery.
- Callback errors from `onRecoverableError` do not break commit.
- Duplicate root creation produces a clear diagnostic.
- Existing hydration, event, bind, Suspense, and scheduling tests continue to pass.

## Notes / risks

- Duplicate-root diagnostics may conflict with current `render(children, container)` convenience behavior. Check existing tests before finalizing semantics.
- React warns in dev for duplicate roots; Fig should likely throw because it does not currently have a dev/prod warning split.
- Fine-grained Suspense-boundary hydration recovery remains out of scope for this pass; recovery stays root-level.
- Avoid copying React internals that assume React DOM, React-specific component stacks, or bundler/source-map integration. The implementation should stay small, host-config-driven, and usable by non-DOM renderers.
- The Remix 3 “unbundling” direction reinforces that hydration semantics should be runtime concepts, not build-pipeline concepts. If richer diagnostics are added later, they should be optional and layered on top of this runtime API.
