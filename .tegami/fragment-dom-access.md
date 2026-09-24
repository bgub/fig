---
packages:
  "@bgub/fig": minor
  "@bgub/fig-dom": minor
  "@bgub/fig-reconciler": minor
---

## Bind DOM groups without wrapper elements

Use an explicit Fragment with a bind callback to focus, measure, observe, or attach native listeners to its committed DOM children. The handle follows child updates and keyed moves, and its signal and subscriptions stop when the group hides or unmounts.

Fragment is now a branded callable boundary, like Activity and Suspense, so explicit JSX can type its bind callback. Its DOM output remains wrapper-free.
