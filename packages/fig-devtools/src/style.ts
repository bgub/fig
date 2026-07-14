export const DevtoolsStyle = `
.fig-devtools {
  --fig-devtools-panel: #f7f8fb;
  --fig-devtools-surface: #ffffff;
  --fig-devtools-ink: #18181b;
  --fig-devtools-muted: #71717a;
  --fig-devtools-line: #d9dee8;
  --fig-devtools-accent: #2563eb;
  --fig-devtools-good: #059669;
  position: fixed;
  right: 14px;
  bottom: 14px;
  z-index: 2147483647;
  width: min(920px, calc(100vw - 28px));
  height: min(620px, calc(100vh - 28px));
  display: grid;
  grid-template-rows: auto 1fr;
  overflow: hidden;
  border: 1px solid #252936;
  border-radius: 8px;
  background: var(--fig-devtools-panel);
  color: var(--fig-devtools-ink);
  box-shadow: 0 22px 54px rgba(22, 24, 33, 0.28);
  font: 12px/1.4 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  letter-spacing: 0;
}
.fig-devtools[data-position="BottomLeft"] {
  right: auto;
  left: 14px;
}
.fig-devtools[data-position="TopRight"] {
  top: 14px;
  bottom: auto;
}
.fig-devtools[data-position="TopLeft"] {
  top: 14px;
  right: auto;
  bottom: auto;
  left: 14px;
}
.fig-devtools.is-panel {
  position: static;
  width: 100%;
  height: 100%;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
.fig-devtools.is-sidebar {
  position: static;
  width: 100%;
  height: 100%;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
.fig-devtools.is-sidebar.is-closed {
  position: fixed;
  right: 0;
  bottom: 28px;
  width: 44px;
  height: 112px;
  overflow: visible;
  border: 0;
  background: transparent;
  box-shadow: none;
}
.fig-devtools.is-closed:not(.is-sidebar) {
  width: auto;
  height: auto;
  grid-template-rows: auto;
}
.fig-devtools button,
.fig-devtools select {
  font: inherit;
}
.fig-devtools__header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 8px;
  border-bottom: 1px solid #252936;
  background: #171923;
  color: #f8fafc;
}
.fig-devtools__collapsed-tab {
  width: 44px;
  height: 112px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 2px;
  border: 1px solid #3f475a;
  border-right: 0;
  border-radius: 10px 0 0 10px;
  background: #252b3a;
  color: #d8def4;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.28);
  cursor: pointer;
  font-size: 16px;
  font-weight: 800;
  line-height: 1;
  padding: 0;
}
.fig-devtools__collapsed-tab:hover {
  background: #1d2534;
}
.fig-devtools__heading {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
.fig-devtools__title {
  min-width: 0;
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fig-devtools__actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}
.fig-devtools__dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #64748b;
  box-shadow: 0 0 0 3px rgba(100, 116, 139, 0.18);
  transition:
    background 0.2s ease,
    box-shadow 0.2s ease;
}
.fig-devtools__dot.is-live {
  background: #10b981;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.25);
}
.fig-devtools__button {
  border: 1px solid #c9d1df;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2937;
  cursor: pointer;
  padding: 4px 8px;
}
.fig-devtools__button.is-active {
  border-color: var(--fig-devtools-accent);
  background: #dbeafe;
  color: #1d4ed8;
}
.fig-devtools__header .fig-devtools__button {
  border-color: #475569;
  background: #252b3a;
  color: #ffffff;
}
.fig-devtools__header .fig-devtools__button.is-active {
  border-color: #93c5fd;
  background: #1d4ed8;
  color: #ffffff;
}
.fig-devtools__hide {
  display: grid;
  place-items: center;
  width: 28px;
  padding: 4px 0;
  font-size: 14px;
  line-height: 1;
}
.fig-devtools__body {
  min-height: 0;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  overflow: hidden;
}
.fig-devtools__tree-pane,
.fig-devtools__details-pane {
  min-width: 0;
  overflow: auto;
}
.fig-devtools__footer {
  min-width: 0;
  overflow: hidden;
  border-top: 1px solid var(--fig-devtools-line);
  background: #eef1f6;
  padding: 0;
}
.fig-devtools__banner {
  margin: 10px 10px 0;
  border: 1px solid #b8c2d2;
  border-radius: 6px;
  background: #ffffff;
  color: #334155;
  padding: 8px;
}
.fig-devtools__banner.is-selecting {
  border-color: #93c5fd;
  background: #eff6ff;
  color: #1e3a8a;
}
.fig-devtools__root-select {
  flex: none;
  min-height: 28px;
  max-width: 120px;
}
.fig-devtools__timetravel {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 6px 8px;
}
.fig-devtools__tt-arrow {
  flex: none;
  display: grid;
  place-items: center;
  width: 30px;
  padding: 4px 0;
  font-size: 16px;
  line-height: 1;
}
.fig-devtools__button:disabled {
  opacity: 0.4;
  cursor: default;
}
.fig-devtools__tt-status {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
}
.fig-devtools__tt-position {
  font-weight: 650;
  color: #334155;
  font-variant-numeric: tabular-nums;
}
.fig-devtools__tt-time {
  color: var(--fig-devtools-muted);
  font-variant-numeric: tabular-nums;
}
.fig-devtools__tt-empty {
  color: var(--fig-devtools-muted);
}
.fig-devtools__tt-state {
  border: 1px solid #cbd5e1;
  border-radius: 999px;
  color: #64748b;
  font-size: 11px;
  padding: 1px 8px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.fig-devtools__tt-state.is-live {
  border-color: rgba(16, 185, 129, 0.45);
  background: rgba(16, 185, 129, 0.12);
  color: #047857;
}
.fig-devtools__tt-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.fig-devtools__tt-badge {
  border: 1px solid var(--fig-devtools-line);
  border-radius: 4px;
  background: #ffffff;
  color: #475569;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  padding: 1px 6px;
}
.fig-devtools__tt-badge.is-sync,
.fig-devtools__tt-badge.is-input {
  border-color: rgba(220, 38, 38, 0.4);
  color: #b91c1c;
}
.fig-devtools__tt-badge.is-transition,
.fig-devtools__tt-badge.is-gesture {
  border-color: rgba(124, 58, 237, 0.4);
  color: #6d28d9;
}
.fig-devtools__tt-badge.is-retry {
  border-color: rgba(180, 83, 9, 0.4);
  color: #b45309;
}
.fig-devtools__main {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(260px, 0.85fr) minmax(320px, 1.15fr);
}
.fig-devtools.is-sidebar .fig-devtools__main {
  grid-template-columns: 1fr;
  grid-template-rows: minmax(180px, 0.8fr) minmax(240px, 1fr);
}
.fig-devtools__tree-pane {
  border-right: 1px solid var(--fig-devtools-line);
  background: var(--fig-devtools-surface);
}
.fig-devtools.is-sidebar .fig-devtools__tree-pane {
  border-right: 0;
  border-bottom: 1px solid var(--fig-devtools-line);
}
.fig-devtools__details-pane {
  background: var(--fig-devtools-panel);
  padding: 14px;
}
.fig-devtools__tree {
  padding: 8px 0;
}
.fig-devtools__tree-button {
  width: 100%;
  min-height: 28px;
  display: flex;
  align-items: stretch;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: #17202a;
  cursor: pointer;
  padding: 0;
  text-align: left;
}
.fig-devtools__tree-rails {
  flex: none;
  margin-left: 8px;
  width: calc(var(--fig-devtools-depth, 0) * 14px);
  background-image: repeating-linear-gradient(
    to right,
    var(--fig-devtools-line) 0,
    var(--fig-devtools-line) 1px,
    transparent 1px,
    transparent 14px
  );
}
.fig-devtools__tree-row {
  flex: 1 1 auto;
  min-width: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 7px;
  padding: 5px 8px 5px 0;
}
.fig-devtools__tree-button:hover {
  background: #eef2f7;
}
.fig-devtools__tree-button.is-selected {
  background: #dbeafe;
  color: #1d4ed8;
}
.fig-devtools__kind {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #64748b;
}
.fig-devtools__kind.is-function {
  background: #2563eb;
}
.fig-devtools__kind.is-host,
.fig-devtools__kind.is-text {
  background: #059669;
}
.fig-devtools__kind.is-suspense,
.fig-devtools__kind.is-error-boundary,
.fig-devtools__kind.is-activity {
  background: #b45309;
}
.fig-devtools__tree-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fig-devtools__hook-count {
  min-width: 22px;
  border-radius: 999px;
  background: #eef2ff;
  color: #3730a3;
  font-size: 11px;
  padding: 1px 6px;
  text-align: center;
}
.fig-devtools__data-count {
  min-width: 22px;
  border-radius: 999px;
  background: #ecfdf5;
  color: #047857;
  font-size: 11px;
  padding: 1px 6px;
  text-align: center;
}
.fig-devtools__details {
  display: grid;
  gap: 12px;
}
.fig-devtools__details-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.fig-devtools__name {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 16px;
}
.fig-devtools__chip {
  border: 1px solid #cbd5e1;
  border-radius: 999px;
  color: #475569;
  padding: 2px 8px;
}
.fig-devtools__tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--fig-devtools-line);
}
.fig-devtools__tab-button {
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: #475569;
  cursor: pointer;
  padding: 6px 8px;
}
.fig-devtools__tab-button.is-selected {
  border-bottom-color: var(--fig-devtools-accent);
  color: #1d4ed8;
}
.fig-devtools__section {
  margin-top: 12px;
}
.fig-devtools__section-title {
  margin: 0 0 8px;
  color: #64748b;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.fig-devtools__row {
  display: grid;
  grid-template-columns: minmax(76px, 0.32fr) minmax(0, 1fr);
  align-items: baseline;
  gap: 8px;
  padding: 3px 0;
}
.fig-devtools__row-label {
  min-width: 0;
  color: var(--fig-devtools-muted);
  overflow-wrap: anywhere;
}
.fig-devtools__row-value {
  min-width: 0;
  border-radius: 5px;
  background: rgba(2, 6, 23, 0.04);
  color: #334155;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  padding: 2px 6px;
}
.fig-devtools__row-value.is-string {
  color: #047857;
}
.fig-devtools__row-value.is-number {
  color: #b45309;
}
.fig-devtools__row-value.is-boolean {
  color: #7c3aed;
}
.fig-devtools__row-value.is-function {
  color: #db2777;
}
.fig-devtools__row-value.is-nullish {
  color: #94a3b8;
}
.fig-devtools__hook + .fig-devtools__hook,
.fig-devtools__data + .fig-devtools__data {
  margin-top: 6px;
}
.fig-devtools__hook,
.fig-devtools__data {
  display: grid;
  gap: 6px;
  border: 1px solid var(--fig-devtools-line);
  border-radius: 7px;
  background: #ffffff;
  padding: 8px;
}
.fig-devtools__hook-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
}
.fig-devtools__hook-index {
  flex: none;
  display: grid;
  place-items: center;
  min-width: 18px;
  height: 18px;
  border-radius: 999px;
  background: #eef2f7;
  color: #64748b;
  font-size: 11px;
  padding: 0 5px;
}
.fig-devtools__hook-kind {
  font-weight: 650;
  color: #1d4ed8;
}
.fig-devtools__hook-tag {
  border: 1px solid var(--fig-devtools-line);
  border-radius: 999px;
  color: #64748b;
  font-size: 11px;
  padding: 1px 7px;
}
.fig-devtools__hook-tag.is-active {
  border-color: rgba(16, 185, 129, 0.4);
  color: #047857;
}
.fig-devtools__hook-deps {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.fig-devtools__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.fig-devtools__value-chip {
  border: 1px solid var(--fig-devtools-line);
  border-radius: 999px;
  background: #ffffff;
  color: #334155;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  padding: 2px 9px;
}
.fig-devtools__html {
  margin: 0;
  overflow: auto;
  border: 1px solid #d7deea;
  border-radius: 6px;
  background: #ffffff;
  color: #0f172a;
  padding: 8px;
  white-space: pre-wrap;
}
.fig-devtools__empty {
  margin: 0;
  color: var(--fig-devtools-muted);
}
.fig-devtools__inspect-overlay {
  position: fixed;
  z-index: 2147483646;
  pointer-events: none;
  border: 2px solid var(--fig-devtools-accent);
  background: rgba(37, 99, 235, 0.08);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.82);
}
.fig-devtools__inspect-label {
  position: absolute;
  max-width: min(360px, calc(100vw - 20px));
  overflow: hidden;
  border-radius: 5px;
  background: #1d4ed8;
  color: #ffffff;
  font-weight: 650;
  padding: 4px 7px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (max-width: 760px) {
  .fig-devtools {
    left: 8px;
    right: 8px;
    bottom: 8px;
    width: auto;
  }
  .fig-devtools__main {
    grid-template-columns: 1fr;
  }
  .fig-devtools__tree-pane {
    max-height: 180px;
    border-right: 0;
    border-bottom: 1px solid var(--fig-devtools-line);
  }
}
`;
