# Browser tests

Framework-level browser tests live here. They bundle source fixtures and run in
Chromium without starting a demo server. Keep application/framework integration
tests with their respective demos under `apps/*/e2e`.

Run `pnpm test:browser` from the repository root. Install Chromium first with
`pnpm exec playwright install chromium` if needed. `pnpm test:popup` remains an
alias, and `pnpm test:e2e` runs this suite before the demo integration tests.

Fixtures belong in `fixtures/`. The shared `browser-errors.ts` helper is also
used by demo integration tests.
