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
  --accent-strong: #0b5f59;
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

.app {
  display: grid;
  grid-template-columns: minmax(180px, 220px) minmax(0, 1fr);
  min-height: 100vh;
}

.sidebar {
  border-right: 1px solid var(--line);
  background: #e8eef1;
  padding: 16px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 18px;
}

.brand-mark {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--accent);
  color: white;
  font-size: 20px;
  font-weight: 700;
}

h1,
h2,
h3,
p {
  margin: 0;
}

h1 {
  font-size: 16px;
  line-height: 1.2;
}

.sidebar p,
.muted {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.45;
}

.nav {
  display: grid;
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

button[data-demo-control="shell"] {
  min-width: 126px;
}

button[data-demo-control="server-error"],
button[data-demo-control="server-error-fallback"],
button[data-demo-control="suspense"] {
  min-width: 144px;
}

.nav a.active,
.button.primary {
  border-color: var(--accent);
  background: var(--accent);
  color: white;
}

.content {
  display: grid;
  gap: 12px;
  align-content: start;
  padding: 18px;
}

.header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--line);
  padding-bottom: 12px;
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

.suspense-panel,
.server-error-panel {
  display: flex;
  flex-direction: column;
}

.suspense-panel {
  min-height: 150px;
}

.server-error-panel {
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

.server-log {
  display: grid;
  gap: 8px;
}

.code {
  overflow-wrap: anywhere;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: #101820;
  color: #dff7f4;
  padding: 7px 9px;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 11px;
  line-height: 1.4;
}

@media (max-width: 780px) {
  .app,
  .grid {
    grid-template-columns: 1fr;
  }

  .sidebar {
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }

  .content {
    padding: 18px;
  }
}
`;
