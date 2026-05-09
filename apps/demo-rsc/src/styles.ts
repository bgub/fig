export const styles = `
:root {
  color-scheme: light;
  --bg: #f5f7f8;
  --ink: #182025;
  --muted: #60707a;
  --line: #d8e0e4;
  --panel: #ffffff;
  --panel-soft: #eef3f5;
  --accent: #0f766e;
  --warn: #b45309;
  --danger: #b42318;
  --ok: #157347;
}

* {
  box-sizing: border-box;
}

html {
  scrollbar-gutter: stable;
}

body {
  min-width: 320px;
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
    sans-serif;
}

a {
  color: inherit;
}

button {
  font: inherit;
}

h1, h2, h3, p {
  margin: 0;
}

.muted {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.45;
}

.app {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.topbar {
  border-bottom: 1px solid var(--line);
  background: #e8eef1;
  padding: 0 18px;
}

.topbar-inner {
  display: flex;
  align-items: center;
  gap: 18px;
  max-width: 960px;
  height: 52px;
  margin: 0 auto;
}

.brand {
  margin: 0;
  font-size: 16px;
  line-height: 1.2;
}

.nav {
  display: flex;
  gap: 6px;
}

.nav a,
.button,
.action-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: white;
  padding: 6px 10px;
  text-decoration: none;
  font: inherit;
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
}

.nav a.active,
.action-button {
  border-color: var(--accent);
  background: var(--accent);
  color: white;
}

.action-button {
  min-width: 132px;
}

.action-button[data-refresh-state="pending"] {
  border-color: #2563eb;
  background: #2563eb;
}

.action-button[data-refresh-state="failed"] {
  border-color: var(--danger);
  background: var(--danger);
}

.content {
  flex: 1;
  padding: 18px;
}

.content-inner {
  display: grid;
  align-content: start;
  gap: 12px;
  max-width: 960px;
  margin: 0 auto;
}

.header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #eef1f3;
  padding: 12px;
}

.header h2,
.dashboard-panel h2 {
  font-size: 20px;
  line-height: 1.2;
}

.actions,
.panel-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.grid {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(260px, 0.75fr);
  gap: 12px;
  align-items: start;
}

.panel {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  padding: 12px;
}

.panel.tone-ok {
  border-color: #b6dfc8;
  background: #edf8f1;
}

.panel.tone-warn {
  border-color: #e8c98a;
  background: #fef7ea;
}

.dashboard-panel {
  display: grid;
  gap: 12px;
}

.async-panel {
  min-height: 120px;
}

.panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.panel h3 {
  font-size: 15px;
  line-height: 1.3;
}

.metric-grid,
.detail-grid {
  display: grid;
  gap: 8px;
}

.metric-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.detail-grid {
  grid-template-columns: 0.85fr 1.15fr;
}

.metric {
  display: grid;
  gap: 5px;
  min-height: 76px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: white;
  padding: 10px;
}

.metric span {
  color: var(--muted);
  font-size: 12px;
}

.metric strong {
  font-size: 20px;
  line-height: 1.1;
}

.tag {
  display: inline-flex;
  align-items: center;
  min-height: 20px;
  border-radius: 999px;
  background: var(--panel-soft);
  color: var(--muted);
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 650;
  white-space: nowrap;
}

.tag.ok {
  background: #dff3e8;
  color: var(--ok);
}

.tag.warn {
  background: #fff0d8;
  color: var(--warn);
}

@media (max-width: 780px) {
  .grid,
  .metric-grid,
  .detail-grid {
    grid-template-columns: 1fr;
  }

  .topbar-inner {
    flex-wrap: wrap;
    height: auto;
    padding: 10px 0;
    gap: 8px;
  }
}
`;
