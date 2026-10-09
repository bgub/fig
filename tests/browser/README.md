# Browser tests

Framework-level browser tests live here. They bundle source fixtures and run in
Chromium without starting a demo server. Submenu interaction and popup positioning
tests also run in Firefox and WebKit. Keep application/framework integration
tests with their respective demos under `apps/*/e2e`.

Focus and selection preservation tests run against development and production
builds in Chromium, Firefox, and WebKit. Cases requiring native atomic moves skip
when the browser does not implement `moveBefore()`.

Run `pnpm test:browser` from the repository root. Install the browsers first with
`pnpm exec playwright install chromium firefox webkit` if needed. `pnpm test:popup` remains an
alias, and `pnpm test:e2e` runs this suite before the demo integration tests.

Fixtures belong in `fixtures/`. The shared `browser-errors.ts` helper is also
used by demo integration tests.

The TanStack Start demo also runs its actual popup-positioning stylesheet and
optional positioning helper against Chromium, Firefox, and WebKit in
`apps/demo-tanstack-start/e2e/submenu-position.spec.ts`. Those tests cover viewport
edges, RTL, page/ancestor scrolling, resizing, and content changes.

`popup-position.spec.ts` exercises every side/alignment in LTR and RTL, offsets,
viewport padding, placement metadata, authored size constraints, layout shifts,
clipped and animated anchors, and observer cleanup through the optional helper.

`apps/demo-tanstack-start/e2e/floating-widgets.spec.ts` covers the actual Popover,
Tooltip, Select, and Combobox examples with optional positioning in all three
engines: RTL, viewport edges/resizing, constrained keyboard scrolling, hover,
focus ownership, Escape and outside dismissal. It also verifies native Dialog
focus containment and restoration. Interactive Popover uses authored autofocus;
it does not trap focus or override intentional focus moves outside.
