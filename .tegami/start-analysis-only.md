---
packages:
  "@bgub/fig-tanstack-start":
    type: patch
---

Skip Babel code generation when collecting Isomorphic boundaries and stylesheet
imports. Analysis keeps the existing source filters and lazy compiler loading.
