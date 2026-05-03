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
  grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
  min-height: 100vh;
}

.sidebar {
  border-right: 1px solid var(--line);
  background: #e8eef1;
  padding: 24px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 28px;
}

.brand-mark {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 8px;
  background: var(--accent);
  color: white;
  font-size: 24px;
  font-weight: 700;
}

h1,
h2,
h3,
p {
  margin: 0;
}

h1 {
  font-size: 18px;
  line-height: 1.2;
}

.sidebar p,
.muted {
  color: var(--muted);
  font-size: 13px;
  line-height: 1.45;
}

.nav {
  display: grid;
  gap: 8px;
}

.nav a,
.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 36px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: white;
  padding: 8px 11px;
  text-decoration: none;
  font-size: 13px;
  font-weight: 650;
}

.nav a.active,
.button.primary {
  border-color: var(--accent);
  background: var(--accent);
  color: white;
}

.content {
  display: grid;
  gap: 18px;
  align-content: start;
  padding: 28px;
}

.header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 1px solid var(--line);
  padding-bottom: 18px;
}

.header h2 {
  font-size: 24px;
  line-height: 1.2;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.grid {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(260px, 0.75fr);
  gap: 16px;
}

.panel {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  padding: 16px;
}

.panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.panel h3 {
  font-size: 16px;
  line-height: 1.3;
}

.tag {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  border-radius: 999px;
  background: var(--panel-soft);
  color: var(--muted);
  padding: 3px 9px;
  font-size: 12px;
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

.metric-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.metric {
  border: 1px solid var(--line);
  border-radius: 7px;
  background: #fbfcfd;
  padding: 12px;
}

.metric span {
  display: block;
  color: var(--muted);
  font-size: 12px;
  font-weight: 650;
}

.metric strong {
  display: block;
  margin-top: 6px;
  font-size: 22px;
  line-height: 1.1;
}

.list {
  display: grid;
  gap: 8px;
  margin: 14px 0 0;
  padding: 0;
  list-style: none;
}

.item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: #fbfcfd;
  padding: 10px 12px;
}

.bars {
  display: grid;
  gap: 8px;
  margin-top: 14px;
}

.bar {
  display: grid;
  grid-template-columns: 82px minmax(0, 1fr) 44px;
  gap: 10px;
  align-items: center;
  font-size: 13px;
}

.track {
  height: 10px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--panel-soft);
}

.fill {
  width: var(--value);
  height: 100%;
  background: var(--accent);
}

.placeholder {
  position: relative;
  overflow: hidden;
  min-height: 148px;
}

.placeholder::after {
  position: absolute;
  inset: 0;
  content: "";
  transform: translateX(-100%);
  background: linear-gradient(90deg, transparent, rgb(255 255 255 / 0.72), transparent);
  animation: sweep 1.15s infinite;
}

.placeholder-line {
  height: 12px;
  border-radius: 999px;
  background: var(--panel-soft);
  margin-top: 12px;
}

.placeholder-line.short {
  width: 62%;
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
  padding: 10px 12px;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
}

@keyframes sweep {
  to {
    transform: translateX(100%);
  }
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

  .metric-grid {
    grid-template-columns: 1fr;
  }
}
`;
