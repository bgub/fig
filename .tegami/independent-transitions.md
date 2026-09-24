---
packages:
  "@bgub/fig-reconciler": minor
---

## Independent transition scheduling

Ready transitions can commit while unrelated transitions in the same root are suspended. Transitions sharing a state queue stay coordinated, preserving related updates and View Transition coalescing. Async continuation attribution is unchanged.
