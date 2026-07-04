import type { FigNode } from "@bgub/fig";

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
      description="Loading server component stream..."
      title="Server Components"
    />
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
