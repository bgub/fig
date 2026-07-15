---
packages:
  npm:@bgub/fig-dom: patch
---

## Trim DOM renderer hot-path work

The DOM renderer now avoids transient collections while diffing host props,
updating event descriptors, and scanning document assets. Event routing keeps
root state in one container record, stores less per-listener metadata, and
builds dispatch paths in place. Host configuration callbacks whose signatures
already match now connect directly instead of paying forwarding closures.

Controlled single-select elements also keep their scalar value without
allocating a one-entry `Set`; multi-select values retain set lookup behavior.
These changes preserve the public API while reducing the production entry
bundle and allocation pressure during mount, update, dispatch, and teardown.
