import { clientReference } from "@bgub/fig";

export const appRootId = "fig-payload-root";
export const devtoolsPaneId = "fig-payload-devtools";
// The panel state lives in a cookie so the server renders the true state
// directly — no pre-paint scripts, no post-load correction, no layout shift.
export const devtoolsOpenCookie = "fig-demo-devtools-open";
// The document streams payload rows as inline frame scripts; this head
// bootstrap installs the queue they push into before any frame executes,
// and the client subscribes to drain it.
export const payloadFramesGlobal = "__figPayloadDemoFrames";
export const payloadFramesBootstrap = `(function(){var g=globalThis;if(g.${payloadFramesGlobal})return;var q=[],l=[];g.${payloadFramesGlobal}={p:function(f){q.push(f);for(var i=0;i<l.length;i++)l[i](f)},s:function(fn){l.push(fn);for(var i=0;i<q.length;i++)fn(q[i])}};})();`;

export interface PayloadFramesGlobal {
  p(frame: string): void;
  s(listener: (frame: string) => void): void;
}
export const feedBoundaryId = "demo-payload-feed";
export const noteBoundaryId = "demo-payload-note";
export const appRefreshButtonReferenceId =
  "apps/demo-payload/src/client-components.tsx#AppRefreshButton";
export const refreshButtonReferenceId =
  "apps/demo-payload/src/client-components.tsx#RefreshButton";

export interface AppRefreshButtonProps {
  seed: number;
}

export interface RefreshButtonProps {
  boundary: string;
  label: string;
  seed: number;
}

export const AppRefreshButtonRef = clientReference<AppRefreshButtonProps>({
  id: appRefreshButtonReferenceId,
  load: () => Promise.resolve({}),
});

export const RefreshButtonRef = clientReference<RefreshButtonProps>({
  id: refreshButtonReferenceId,
  load: () => Promise.resolve({}),
});
