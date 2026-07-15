export const styles = `
:root {
  color-scheme: light;
  --bg: #fafaf7;
  --ink: #1c1c1f;
  --muted: #77777e;
  --line: #dcdcd4;
  --grid: rgba(28, 28, 31, 0.04);
  /* One color per delivery layer, so the template reads at a glance. */
  --shell: #9a9aa2;
  --payload: #2f6fed;
  --streamed: #d97706;
  --island: #059669;
  --danger: #b42318;
  --shell-tint: #ffffff;
  --payload-tint: #f3f6fe;
  --streamed-tint: #fcf7ef;
  --island-tint: #f1f9f5;
  --danger-tint: #fcf4f3;
  /* The one designed slot height: post content plus headroom. The weather
     column stretches to match it, and the dashboard pin derives from it,
     so slots fill in without layout shift by construction. The e2e suite
     asserts the shell height stays constant through every phase. */
  --slot-height: 360px;
}

* {
  box-sizing: border-box;
}

html {
  background: var(--bg);
}

body {
  margin: 0;
  min-height: 100vh;
  background-color: var(--bg);
  /* Graph paper: the wireframe under the wireframe. */
  background-image:
    linear-gradient(var(--grid) 1px, transparent 1px),
    linear-gradient(90deg, var(--grid) 1px, transparent 1px);
  background-size: 24px 24px;
  color: var(--ink);
  font: 15px/1.65 ui-sans-serif, system-ui, sans-serif;
}

.fig-demo-devtools-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  min-height: 100vh;
}

.fig-demo-app-pane {
  min-width: 0;
  padding: 48px 20px 80px;
}

.fig-demo-devtools-pane {
  background: #171923;
  border-left: 1px solid var(--line);
  height: 100vh;
  min-height: 0;
  min-width: 360px;
  overflow: hidden;
  position: sticky;
  top: 0;
  width: min(420px, 34vw);
}

.fig-demo-devtools-pane:has(.fig-devtools.is-closed) {
  border-left: 0;
  min-width: 0;
  overflow: visible;
  width: 0;
}

.app {
  margin: 0 auto;
  max-width: 960px;
}

/* --- Layer frames -------------------------------------------------------
   Every delivery layer renders inside a labeled frame. Solid border = the
   slot has content; dashed = the slot is still streaming. A variant class
   names its layer via --layer/--layer-tint; the shared rules consume them. */

.frame {
  background: var(--layer-tint);
  border: 1.5px solid var(--layer);
  border-radius: 8px;
  padding: 22px 22px 18px;
  position: relative;
}

.frame > .tag {
  background: var(--bg);
  border-radius: 3px;
  color: var(--layer);
  font: 600 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  left: 14px;
  letter-spacing: 0.14em;
  padding: 2px 7px 3px;
  position: absolute;
  text-transform: uppercase;
  top: -9px;
  white-space: nowrap;
}

.frame-shell {
  --layer: var(--shell);
  --layer-tint: var(--shell-tint);
}

.frame-payload {
  --layer: var(--payload);
  --layer-tint: var(--payload-tint);
}

.frame-streamed {
  --layer: var(--streamed);
  --layer-tint: var(--streamed-tint);
  margin-top: 22px;
  min-height: 128px;
}

.frame-island {
  --layer: var(--island);
  --layer-tint: var(--island-tint);
  display: inline-block;
  margin-top: 18px;
  padding: 14px 16px 12px;
}

.frame-danger {
  --layer: var(--danger);
  --layer-tint: var(--danger-tint);
}

/* A slot whose content has not arrived yet: dashed outline + pulsing
   skeleton lines, so streaming is visible as "the template filling in". */
.slot-pending {
  border-style: dashed;
}

.slot-pending .slot-note {
  color: var(--muted);
  font: 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  margin: 0 0 12px;
}

.skeleton {
  animation: slot-pulse 1.1s ease-in-out infinite alternate;
  display: grid;
  gap: 10px;
}

.skeleton > i {
  background: currentColor;
  border-radius: 3px;
  display: block;
  height: 10px;
  opacity: 0.16;
}

.skeleton > i:nth-child(2) {
  width: 82%;
}
.skeleton > i:nth-child(3) {
  width: 58%;
}

@keyframes slot-pulse {
  from {
    opacity: 0.55;
  }
  to {
    opacity: 1;
  }
}

/* --- Shell chrome ------------------------------------------------------- */

h1 {
  font-size: 21px;
  font-weight: 650;
  letter-spacing: -0.01em;
  margin: 0 0 4px;
}

h2 {
  font-size: 17px;
  font-weight: 650;
  margin: 0 0 2px;
}

.muted {
  color: var(--muted);
  font-size: 13.5px;
  margin: 0;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin: 16px 0 0;
}

.legend span {
  align-items: center;
  color: var(--muted);
  display: inline-flex;
  font: 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  gap: 6px;
  letter-spacing: 0.06em;
}

.legend i {
  border-radius: 2px;
  display: inline-block;
  height: 9px;
  width: 9px;
}

.swatch-shell {
  background: var(--shell);
}
.swatch-payload {
  background: var(--payload);
}
.swatch-streamed {
  background: var(--streamed);
}
.swatch-island {
  background: var(--island);
}

.controls {
  border-top: 1px solid var(--line);
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 18px;
  padding-top: 16px;
}

:where(.fig-demo-app-pane) button {
  background: transparent;
  border: 1.5px solid var(--line);
  border-radius: 6px;
  color: var(--ink);
  cursor: pointer;
  font: 500 13px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  padding: 8px 13px;
  transition: border-color 120ms ease, background-color 120ms ease;
}

:where(.fig-demo-app-pane) button:hover {
  border-color: var(--ink);
}

:where(.fig-demo-app-pane) button[data-refresh-state="pending"] {
  border-style: dashed;
  color: var(--muted);
  cursor: progress;
}

.resource-shell {
  position: relative;
}

.resource-shell > .frame > h2 {
  padding-right: 36px;
}

:where(.fig-demo-app-pane) button.refresh-button {
  align-items: center;
  background: var(--payload-tint);
  border-color: var(--payload);
  color: var(--payload);
  display: inline-flex;
  height: 28px;
  justify-content: center;
  padding: 0;
  position: absolute;
  right: 12px;
  top: 12px;
  width: 28px;
  z-index: 1;
}

:where(.fig-demo-app-pane) button.refresh-button:hover {
  background: var(--bg);
  border-color: var(--payload);
}

.refresh-button svg {
  fill: none;
  height: 15px;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
  width: 15px;
}

.refresh-button[data-refresh-state="pending"] svg {
  animation: refresh-spin 0.8s linear infinite;
}

@keyframes refresh-spin {
  to {
    transform: rotate(360deg);
  }
}

/* --- Layer content ------------------------------------------------------ */

/* The two inner slots sit side by side inside the dashboard, post-heavy.
   The post slot pins the row to --slot-height; the weather column and both
   frames stretch to fill it, which leaves wrap headroom inside the boxes. */
.dashboard-grid {
  column-gap: 20px;
  display: grid;
  grid-template-columns: 3fr 1fr;
  margin-top: 24px;
}

.payload-slot {
  min-height: var(--slot-height);
}

.payload-slot > .frame,
.weather-slot > .frame {
  height: 100%;
}

.dashboard-slot {
  margin-top: 24px;
  /* Slot row plus the dashboard frame's own chrome (padding, heading, note,
     grid margin), rounded up so the chrome copy has headroom too. */
  min-height: calc(var(--slot-height) + 145px);
}

ul.comments {
  list-style: none;
  margin: 0;
  padding: 0;
}

ul.comments li {
  border-top: 1px solid var(--line);
  font-size: 14px;
  padding: 9px 2px;
}

ul.comments li:first-child {
  border-top: 0;
  padding-top: 2px;
}

/* The island's frame is its outline; the button inside stays borderless so
   the layer doesn't read as a double box. */
.island-button {
  background: transparent;
  border: 0;
  border-radius: 5px;
  color: var(--island);
  font-weight: 650;
  padding: 6px 10px;
}

.island-button:hover {
  background: rgba(5, 150, 105, 0.1);
}

@media (max-width: 780px) {
  .fig-demo-devtools-layout {
    grid-template-columns: 1fr;
  }

  .fig-demo-devtools-pane,
  .fig-demo-devtools-pane:has(.fig-devtools.is-closed) {
    border-left: 0;
    border-top: 0;
    height: 0;
    min-width: 0;
    overflow: visible;
    position: static;
    width: 0;
  }

  .fig-demo-devtools-pane:not(:has(.fig-devtools.is-closed)) {
    border-top: 1px solid var(--line);
    height: min(620px, 70vh);
    overflow: hidden;
    width: auto;
  }
}
`;
