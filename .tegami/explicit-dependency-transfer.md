---
packages:
  "@bgub/fig":
    type: patch
  "@bgub/fig-server":
    type: patch
---

## Stream only opted-in data dependencies

Stream ensured data dependencies only when their resource declares a `transfer` function. Continue traversing plain intermediary dependencies to discover opted-in sources. Direct reads and explicit snapshots retain their existing transfer behavior; use `transfer: false` to exclude an entry from all transfer paths.

Payload data rows now carry only the entries a payload read, plus the opted-in dependencies those reads ensured. Previously every entry that settled during a payload render was sent, including entries only ensured through `data` for computation; those no longer cross unless read directly or opted in. This keeps entries out of the stream, not on the server: use `transfer: false` for values that must never leave it.
