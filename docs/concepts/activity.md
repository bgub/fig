# Activity

Status: stable

`<Activity mode="visible" | "hidden">` hides a subtree without throwing away its fibers, hooks, or state. Think of it as putting an existing UI to sleep and waking it later.

```tsx
<Activity mode={tab === "settings" ? "visible" : "hidden"}>
  <Settings />
</Activity>
```

Switching away preserves the Settings state, but its effects and subscriptions stop until the tab becomes visible again.

## Hiding A Tree

When an Activity becomes hidden, Fig:

- hides its host nodes through the renderer's `hideInstance` hooks;
- aborts effects, binds, stable events, transitions, and actions;
- pauses external-store subscriptions; and
- moves future updates onto the offscreen lane.

The aborted signals are the visibility notification. There is no separate visibility API.

Portals are included because Activity follows the logical Fig tree. A nested hidden Activity is its own boundary, so an outer hide does not walk through it.

## Revealing A Tree

Revealing makes the existing nodes visible again and re-arms deferred effects in their normal phase order. External-store subscriptions also start at reveal. A tree that first mounts while hidden does not run effects until it becomes visible.

Hidden updates can prerender at idle priority. Fig keeps the committed visibility in an `ActivityState` shared by both fiber generations, so even an old setter knows that its tree is hidden. Newly placed or updated host nodes are hidden as they commit.

On reveal, Fig includes pending offscreen work in the render and commits it with the visibility change. The user never sees a half-updated hidden tree. Pending transition and action slots are retired when the tree hides, so `isPending` cannot remain stuck after reveal.

## Server Rendering And Hydration

The server places hidden Activity content inside an inert `<template data-fig-activity>`. Its elements and text do not appear on screen before hydration.

The client leaves that template dehydrated: no fibers, hooks, or hydration work are created until the Activity reveals. At reveal, Fig hydrates against the template contents and moves the same nodes into the live DOM. Node identity is preserved.

If Activity hydration throws, Fig abandons the attempt and leaves the template untouched so a later reveal can retry cleanly. A hydration mismatch falls back to root client rendering.

Suspense may continue streaming inside a hidden Activity. Its segments stage in hidden light-DOM containers because normal id lookup cannot reach a template's content fragment.

The final `ac` operation moves completed content into the template, or into the live DOM if the Activity revealed early. Server errors use the matching `ax` operation. Either way, the completed boundary hydrates normally when the Activity becomes visible.
