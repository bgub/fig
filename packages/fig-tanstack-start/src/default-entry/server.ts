import type { Register } from "@tanstack/router-core";
import {
  createServerEntry,
  createStartHandler,
  type RequestHandler,
} from "@tanstack/start-server-core";
import { renderRouterToStream } from "../server-renderer.tsx";

const fetch = createStartHandler({ handler: renderRouterToStream });

const entry: { fetch: RequestHandler<Register> } = createServerEntry<Register>({
  fetch,
});

export default entry;
