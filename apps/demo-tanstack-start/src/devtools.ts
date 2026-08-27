import type {
  FigDevtoolsController,
  FigDevtoolsTheme,
} from "@bgub/fig-devtools";

interface FigCommitSource {
  roots: ReadonlyMap<number, unknown>;
  subscribe(listener: () => void): () => void;
}

export const figDevtoolsPaneId = "fig-devtools-pane";

export function waitForFirstFigCommit(hook: FigCommitSource): Promise<void> {
  if (hook.roots.size > 0) return Promise.resolve();

  return new Promise((resolve) => {
    const unsubscribe = hook.subscribe(() => {
      if (hook.roots.size === 0) return;
      unsubscribe();
      resolve();
    });
  });
}

export function followDocumentTheme(
  controller: FigDevtoolsController,
): () => void {
  const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
  let currentTheme: FigDevtoolsTheme | undefined;

  const sync = () => {
    const theme = documentTheme(colorScheme);
    if (theme === currentTheme) return;
    currentTheme = theme;
    controller.update({ theme });
  };

  const observer = new MutationObserver(sync);
  observer.observe(document.documentElement, {
    attributeFilter: ["class"],
    attributes: true,
  });
  colorScheme.addEventListener("change", sync);
  sync();

  return () => {
    observer.disconnect();
    colorScheme.removeEventListener("change", sync);
  };
}

function documentTheme(colorScheme: MediaQueryList): FigDevtoolsTheme {
  const root = document.documentElement;
  if (root.classList.contains("dark")) return "dark";
  if (root.classList.contains("light")) return "light";
  return colorScheme.matches ? "dark" : "light";
}
