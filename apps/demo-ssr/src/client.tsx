import { createRoot, hydrateRoot } from "@bgub/fig-dom";
import type { FigDataHydrationEntry } from "@bgub/fig";
import { ensureFigDevtoolsGlobalHook, FigDevtools } from "@bgub/fig-devtools";
import {
  App,
  type ClientData,
  createClientRequest,
  demoDataResourceScriptId,
  demoDataScriptId,
  demoDevtoolsOpenCookie,
  demoDevtoolsPaneId,
  demoRootId,
} from "./app.tsx";

const data = readClientData();
const initialData = readInitialData();
const root = document.getElementById(demoRootId);
if (root === null) {
  throw new Error("Missing streaming demo root.");
}
const devtoolsContainer = document.getElementById(demoDevtoolsPaneId);
if (devtoolsContainer === null) {
  throw new Error("Missing streaming demo devtools pane.");
}

const devtoolsHook = ensureFigDevtoolsGlobalHook();
mountDevtoolsPanel(devtoolsContainer, devtoolsHook);

hydrateRoot(root, <App request={createClientRequest(data)} />, {
  initialData,
  onRecoverableError(error) {
    document.body.dataset.recoverableHydrationError =
      error instanceof Error ? error.message : String(error);
  },
});

document.body.dataset.figHydrated = "true";

function readClientData(): ClientData {
  const script = document.getElementById(demoDataScriptId);
  if (script === null) {
    throw new Error("Missing streaming demo hydration data.");
  }

  return JSON.parse(script.textContent ?? "{}") as ClientData;
}

function readInitialData(): FigDataHydrationEntry[] {
  const script = document.getElementById(demoDataResourceScriptId);
  if (script === null) return [];

  return JSON.parse(script.textContent ?? "[]") as FigDataHydrationEntry[];
}

function mountDevtoolsPanel(
  container: HTMLElement,
  hook: ReturnType<typeof ensureFigDevtoolsGlobalHook>,
): void {
  const panel = (
    <FigDevtools
      defaultOpen={readDevtoolsOpenCookie()}
      hook={hook}
      onOpenChange={storeDevtoolsOpenCookie}
      placement="sidebar"
    />
  );

  // The shell streams the panel rendered from the same cookie state, so the
  // client can always hydrate it in place.
  if (container.firstChild !== null) {
    hydrateRoot(container, panel, { devtools: false });
    return;
  }

  createRoot(container, { devtools: false }).render(panel);
}

function readDevtoolsOpenCookie(): boolean {
  return !document.cookie
    .split(";")
    .some((entry) => entry.trim() === `${demoDevtoolsOpenCookie}=false`);
}

function storeDevtoolsOpenCookie(open: boolean): void {
  document.cookie = `${demoDevtoolsOpenCookie}=${String(open)};path=/;max-age=31536000;samesite=lax`;
}
