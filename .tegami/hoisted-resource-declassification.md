---
packages:
  npm:@bgub/fig-dom: patch
---

## Diagnose hoisted resource declassification

Development now throws when an update would turn a permanently hoisted host
fiber into an ordinary in-tree element, naming the affected asset and
explaining that changing placement requires a different Fig element key.
Production ignores the update instead of mutating a shared delivery asset or
overwriting the owner's last valid title or metadata claim.
