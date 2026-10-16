import type { Register } from "@tanstack/router-core";
import {
  createServerEntry,
  createStartHandler,
} from "@tanstack/start-server-core";
import { renderRouterToStream } from "../server-renderer.tsx";

const fetch = createStartHandler({ handler: renderRouterToStream });

export default createServerEntry<Register>({ fetch });
