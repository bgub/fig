---
packages:
  npm:@bgub/fig-tanstack-start:
    replay:
      - exit-prerelease(npm:@bgub/fig-tanstack-start)
---

## TanStack Start preserves one router module identity

The TanStack Start adapter now keeps both the compiler-facing Solid aliases and
their Fig package targets out of Vite dependency prebundling. Router providers,
outlets, and hooks therefore share the same context during development, while
the framework-independent Router Core dependencies remain prebundled.
