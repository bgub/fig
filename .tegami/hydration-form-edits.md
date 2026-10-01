---
packages:
  "@bgub/fig-dom": patch
  "@bgub/fig-reconciler": patch
---

### Preserve form edits made before hydration

Hydration now preserves edited input, textarea, checkbox, radio, and select state by default. Changed fields receive input/change notifications after hydration commits and before synchronous follow-up renders, allowing controlled state to adopt the user's edits. Uncontrolled fields keep their existing preservation behavior. Replay handlers can use flushSync without erasing other pending form edits.

Checkbox and radio activation events coalesce even when adoption rejects the edit. Event-handler errors report globally without clearing the hydrated tree or interrupting other listeners.
