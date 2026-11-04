---
packages:
  "@bgub/fig":
    type: patch
---

Keep unconsumed custom transfer forms out of watched data resources' live-value equality callbacks. A new watch publication replaces the form without loading it; ordinary hydrated values still use equality to suppress unchanged publications.
