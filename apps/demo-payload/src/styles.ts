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
  padding: 48px 20px 80px;
  background-color: var(--bg);
  /* Graph paper: the wireframe under the wireframe. */
  background-image:
    linear-gradient(var(--grid) 1px, transparent 1px),
    linear-gradient(90deg, var(--grid) 1px, transparent 1px);
  background-size: 24px 24px;
  color: var(--ink);
  font: 15px/1.65 ui-sans-serif, system-ui, sans-serif;
}

.app {
  margin: 0 auto;
  max-width: 720px;
}

/* --- Layer frames -------------------------------------------------------
   Every delivery layer renders inside a labeled frame. Solid border = the
   slot has content; dashed = the slot is still streaming. */

.frame {
  background: rgba(255, 255, 255, 0.82);
  border: 1.5px solid var(--line);
  border-radius: 8px;
  padding: 22px 22px 18px;
  position: relative;
}

.frame + .frame {
  margin-top: 24px;
}

.frame > .tag {
  background: var(--bg);
  border-radius: 3px;
  color: var(--muted);
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
  background: var(--shell-tint);
  border-color: var(--shell);
}
.frame-shell > .tag {
  color: var(--shell);
}

.frame-payload {
  background: var(--payload-tint);
  border-color: var(--payload);
}
.frame-payload > .tag {
  color: var(--payload);
}

.frame-streamed {
  background: var(--streamed-tint);
  border-color: var(--streamed);
  margin-top: 22px;
  min-height: 128px;
}
.frame-streamed > .tag {
  color: var(--streamed);
}

.frame-island {
  background: var(--island-tint);
  border-color: var(--island);
  display: inline-block;
  margin-top: 18px;
  padding: 14px 16px 12px;
}
.frame-island > .tag {
  color: var(--island);
}

.frame-danger {
  background: var(--danger-tint);
  border-color: var(--danger);
}
.frame-danger > .tag {
  color: var(--danger);
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

button {
  background: transparent;
  border: 1.5px solid var(--line);
  border-radius: 6px;
  color: var(--ink);
  cursor: pointer;
  font: 500 13px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  padding: 8px 13px;
  transition: border-color 120ms ease, background-color 120ms ease;
}

button:hover {
  border-color: var(--ink);
}

button[data-resource-refresh] {
  min-width: 138px;
}

button[data-refresh-state="pending"] {
  animation: slot-pulse 0.9s ease-in-out infinite alternate;
  border-style: dashed;
  color: var(--muted);
  cursor: progress;
}

/* --- Layer content ------------------------------------------------------ */

.payload-slot {
  margin-top: 24px;
  /* Matches the filled post's height so slots fill without layout shift. */
  min-height: 344px;
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

.island-button {
  background: transparent;
  border: 1.5px solid var(--island);
  border-radius: 6px;
  color: var(--island);
  font-weight: 600;
}

.island-button:hover {
  background: rgba(5, 150, 105, 0.08);
  border-color: var(--island);
}
`;
