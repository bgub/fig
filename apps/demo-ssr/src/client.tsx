import "./dev-env.ts";
import { hydrateRoot } from "@bgub/fig-dom";
import {
  App,
  type ClientData,
  createClientRequest,
  demoDataScriptId,
  demoRootId,
} from "./app.tsx";

const data = readClientData();
const root = document.getElementById(demoRootId);
if (root === null) {
  throw new Error("Missing streaming demo root.");
}

hydrateRoot(root, <App request={createClientRequest(data)} />, {
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
