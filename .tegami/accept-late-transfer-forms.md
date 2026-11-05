---
packages:
  "@bgub/fig":
    type: minor
  "@bgub/fig-server":
    type: patch
---

## Accept transfer forms late

Add `accept(form, value)` to data resources for live values that transfer forms merge into. An accepting resource's load no longer receives `transferred`; the store applies each form to the loaded value whenever it arrives, before, during, or after the load. Streamed server renders send accepting dependencies in their own `d` operation after the reveal that read them, so their size never delays it.
