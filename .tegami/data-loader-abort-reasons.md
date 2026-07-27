---
packages:
  npm:@bgub/fig:
    replay:
      - exit-prerelease(npm:@bgub/fig)
---

## Identify why data-loader signals abort

Data-resource loader signals now expose whether their generation was
superseded, evicted, or disposed. Rejected generations and values invalidated
through an attributed error receive the originating error as their abort
reason; reasonless rejections receive the platform's default `AbortError`.
