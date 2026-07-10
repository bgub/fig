import type { FigNode } from "@bgub/fig";

// Shared between the loading shell and the loaded app so the header chrome
// is byte-identical and the stream swap causes no layout shift.
export const appDescription =
  "Initial render is fetched as a payload stream; the dashboard and note cards can refresh as independent server-rendered boundaries.";

interface AppFrameProps {
  actions?: FigNode;
  children?: FigNode;
  description: FigNode;
  title: string;
}

export function AppFrame({
  actions,
  children,
  description,
  title,
}: AppFrameProps) {
  return (
    <div class="app">
      <Topbar />
      <main class="content">
        <div class="content-inner">
          <header class="header">
            <div>
              <h2>{title}</h2>
              <p class="muted">{description}</p>
            </div>
            {actions}
          </header>
          {children}
        </div>
      </main>
    </div>
  );
}

export function LoadingShell() {
  return (
    <AppFrame
      actions={
        <div class="actions">
          <a class="button" href="/payload">
            Raw stream
          </a>
          <button class="button" disabled type="button">
            Refresh app (0)
          </button>
          <a class="button" href="/">
            Reload page
          </a>
        </div>
      }
      description={appDescription}
      title="Server Components"
    >
      <p class="muted">Loading server component stream...</p>
    </AppFrame>
  );
}

export function ErrorShell({ error }: { error: unknown }) {
  return (
    <AppFrame
      description="payload request failed"
      title={error instanceof Error ? error.message : String(error)}
    />
  );
}

function Topbar() {
  return (
    <header class="topbar">
      <div class="topbar-inner">
        <h1 class="brand">payload Demo</h1>
        <nav class="nav" aria-label="payload demo">
          <a class="active" href="/">
            Server model
          </a>
          <a href="/payload">Raw stream</a>
        </nav>
      </div>
    </header>
  );
}
