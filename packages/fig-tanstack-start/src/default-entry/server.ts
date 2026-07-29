import { createStartHandler } from "@tanstack/start-server-core";
import { renderRouterDocument } from "../server-renderer.tsx";

const fetch = createStartHandler({ handler: renderRouterDocument });

export default { fetch };
