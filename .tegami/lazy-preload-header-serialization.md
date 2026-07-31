---
packages:
  "@bgub/fig-server":
    replay:
      - exit-prerelease(npm:@bgub/fig-server)
---

## Serialize preload headers on demand

Server rendering now retains a lightweight value snapshot of shell preload
resources and serializes their HTTP `Link` values only when
`getPreloadHeader()` is used.
