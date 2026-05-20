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
  margin: 0;
  min-width: 320px;
  background: var(--bg);
  color: var(--ink);
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
    sans-serif;
}

a {
  color: inherit;
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
  margin: 0 auto;
  height: 52px;
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
button.button {
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
.button.primary {
  border-color: var(--accent);
  background: var(--accent);
  color: white;
}

button[data-demo-control="shell"] {
  min-width: 126px;
}

button[data-demo-control="server-error"],
button[data-demo-control="suspense"] {
  min-width: 144px;
}

.content {
  flex: 1;
  padding: 18px;
}

.content-inner {
  display: grid;
  gap: 12px;
  align-content: start;
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

.header h2 {
  font-size: 20px;
  line-height: 1.2;
}

.actions {
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

.panel.tone-danger {
  border-color: #e8aba5;
  background: #fdf0ef;
}

.suspense-panel {
  display: flex;
  flex-direction: column;
  min-height: 150px;
}

.error-panel {
  display: flex;
  flex-direction: column;
  min-height: 120px;
}

.lazy-panel {
  display: flex;
  flex-direction: column;
  min-height: 120px;
}

.panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.panel h3 {
  font-size: 15px;
  line-height: 1.3;
}

.panel-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: auto;
  padding-top: 10px;
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

.tag.danger {
  background: #fde2df;
  color: var(--danger);
}

@media (max-width: 780px) {
  .grid {
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
