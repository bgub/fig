---
packages:
  npm:@bgub/fig:
    replay:
      - exit-prerelease(npm:@bgub/fig)
  npm:@bgub/fig-dom:
    replay:
      - exit-prerelease(npm:@bgub/fig-dom)
  npm:@bgub/fig-reconciler:
    replay:
      - exit-prerelease(npm:@bgub/fig-reconciler)
  npm:@bgub/fig-server:
    replay:
      - exit-prerelease(npm:@bgub/fig-server)
---

## Asset descriptors use native names and preserve native ordering

Client-inserted and host-rendered stylesheets now form precedence buckets in
the order each distinct precedence value is first discovered. A stylesheet
discovered later for an existing bucket is inserted before the following
bucket, keeping lazy and payload-delivered CSS in its intended cascade order.

Raw `<script>` elements now enter the asset registry only when explicitly
marked `async`. Non-async scripts retain their native document position and
execution semantics; explicit `script()` descriptors continue to support all
asset-delivery modes.

Asset descriptor options and serialized payload asset rows now use native HTML
attribute names: `crossorigin`, `fetchpriority`, and `http-equiv`. The previous
React-style `crossOrigin`, `fetchPriority`, and `httpEquiv` spellings are
removed.

Host resource resolution now receives the actual host parent and fixes
out-of-band placement once per fiber. SVG and MathML titles consequently stay
in their native namespace, while HTML titles carrying `itemprop` stay in-tree;
ordinary document titles continue to use the shared head registry.
