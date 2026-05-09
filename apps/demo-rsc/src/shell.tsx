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
    <div className="app">
      <Topbar />
      <main className="content">
        <div className="content-inner">
          <header className="header">
            <div>
              <h2>{title}</h2>
              <p className="muted">{description}</p>
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
      description="RSC request failed"
      title={error instanceof Error ? error.message : String(error)}
    />
  );
}

function Topbar() {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <h1 className="brand">RSC Demo</h1>
        <nav className="nav" aria-label="RSC demo">
          <a className="active" href="/">
            Server model
          </a>
          <a href="/rsc">Raw stream</a>
        </nav>
      </div>
    </header>
  );
}
