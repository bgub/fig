import { mountResourceApp } from "./resource-client.tsx";
import { resourceRootId } from "./resource-shared.ts";

const rootElement = document.getElementById(resourceRootId);
if (rootElement === null) {
  throw new Error("Missing serialized-components demo root.");
}

mountResourceApp(rootElement);
