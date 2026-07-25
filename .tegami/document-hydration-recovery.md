---
packages:
  npm:@bgub/fig-dom:
    replay:
      - exit-prerelease(npm:@bgub/fig-dom)
  npm:@bgub/fig-reconciler:
    replay:
      - exit-prerelease(npm:@bgub/fig-reconciler)
---

## Keep styles active during document hydration recovery

Full-document hydration recovery now reuses the existing `html`, `head`, and
`body` singletons and clears their contents sparingly. Loaded stylesheet links,
style elements, and scripts stay connected while mismatched content is rebuilt,
preventing a flash of unstyled content.

Recoverable errors now report to the console when a root does not provide an
`onRecoverableError` handler, so hydration mismatches are no longer silent.
