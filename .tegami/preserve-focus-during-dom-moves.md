---
packages:
  "@bgub/fig-dom":
    type: patch
  "@bgub/fig-reconciler":
    type: minor
---

## Preserve focus across DOM commits

Add an optional synchronous `HostConfig.commitMutation` scope. Fig DOM captures focus before host mutations and restores surviving focus afterward, before component `useBeforePaint` callbacks choose their final focus policy. Native event, custom-element, and bind callbacks may be overridden before restoration finishes; native events continue to dispatch normally. Restoration is bounded to one selection repair followed by one explicit focus attempt, including when selection repair itself fires a listener that redirects focus.

Use atomic native moves when nodes share a shadow-including root to preserve browser-managed state, including native dialog/popover membership. Ordinary insertion remains the fallback. Removed or hidden elements are not restored, and focus restoration does not request scrolling.
