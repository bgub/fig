---
packages:
  npm:@bgub/fig-reconciler: patch
---

## Mark host subtrees committed when a re-placed wrapper inserts them

Re-placing a reused non-host fiber (for example a component moved during the
same commit that reveals a captured Suspense primary) inserts its host
subtree in one pass. Those host fibers were never individually placed, so
they kept claiming they had never committed; the next re-render then
re-assembled their live instances during the render phase, detaching
committed children and crashing the commit's recorded deletions with
`NotFoundError: removeChild`. Subtree insertion now marks never-committed
host fibers committed (acquiring uncommitted hoisted instances), exactly
like a direct host placement, and a dev-mode parity assert fails the commit
that inserts a placed host fiber without marking it — catching the whole
class at its source instead of at the next navigation's crash.
