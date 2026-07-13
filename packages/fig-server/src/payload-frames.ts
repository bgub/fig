import { escapeScriptJson, nonceAttribute } from "./shared.ts";

// The inline payload-frame transport: how a document render carries payload
// rows to the client as inline scripts interleaved between HTML chunks (the
// complete-markup chunk contract makes between-chunk injection parse-safe —
// see docs/concepts/server-rendering.md). The bootstrap installs a queue
// global before any frame executes; each frame is a JSON carrier script plus
// a push script; the client drains the queue into a payload consumer.

export interface PayloadFrameTransportOptions {
  /**
   * Attribute marking the JSON carrier scripts in the document. The client
   * getter re-reads carriers by this attribute when the queue global is
   * missing (a bundle that ran without the bootstrap) or behind.
   */
  attribute?: string;
  /** Name of the queue global the bootstrap installs. */
  globalName?: string;
  nonce?: string;
}

/**
 * The wire shape of the queue global: `q` holds every pushed frame, `p`
 * pushes and notifies, `s` subscribes (replaying queued frames first) and
 * returns an unsubscribe. Inline push scripts call `p`; clients call `s`.
 */
export interface PayloadFrameStream<TFrame = unknown> {
  q: TFrame[];
  p(frame: TFrame): void;
  s(listener: (frame: TFrame) => void): () => void;
}

const DEFAULT_GLOBAL_NAME = "__figPayloadFrames";
const DEFAULT_FRAME_ATTRIBUTE = "data-fig-payload-frame";

// globalName is interpolated into emitted JS as a property expression and
// attribute into raw markup and a CSS selector; both must be validated, not
// escaped, or a hostile/typo'd option becomes script or selector injection.
const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const ATTRIBUTE_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9-]*$/;

function resolveGlobalName(
  options: Pick<PayloadFrameTransportOptions, "globalName">,
): string {
  const name = options.globalName ?? DEFAULT_GLOBAL_NAME;
  if (!IDENTIFIER_PATTERN.test(name)) {
    throw new Error(
      `Payload frame globalName must be a JavaScript identifier; got ${JSON.stringify(name)}.`,
    );
  }
  return name;
}

function resolveFrameAttribute(
  options: Pick<PayloadFrameTransportOptions, "attribute">,
): string {
  const attribute = options.attribute ?? DEFAULT_FRAME_ATTRIBUTE;
  if (!ATTRIBUTE_NAME_PATTERN.test(attribute)) {
    throw new Error(
      `Payload frame attribute must be a letter followed by letters, digits, or hyphens; got ${JSON.stringify(attribute)}.`,
    );
  }
  return attribute;
}

/**
 * Raw JS for the queue-global bootstrap, for callers that author the script
 * element themselves (e.g. `<script unsafeHTML={...} />` in a JSX head).
 * Idempotent: a second execution leaves the existing global in place.
 */
export function payloadFrameBootstrapCode(
  options: Pick<PayloadFrameTransportOptions, "globalName"> = {},
): string {
  const name = resolveGlobalName(options);
  return `(function(){var g=globalThis;if(g.${name})return;var q=[],l=[];g.${name}={q:q,p:function(f){q.push(f);for(var i=0;i<l.length;i++)l[i](f)},s:function(fn){l.push(fn);for(var i=0;i<q.length;i++)fn(q[i]);return function(){var n=[];for(var j=0;j<l.length;j++)if(l[j]!==fn)n.push(l[j]);l=n}}};})();`;
}

/**
 * The bootstrap as complete `<script>` markup. Must be emitted before any
 * frame script executes — typically in `<head>` or right after `<body>`.
 */
export function payloadFrameBootstrapScript(
  options: PayloadFrameTransportOptions = {},
): string {
  return `<script${nonceAttribute(options.nonce)}>${payloadFrameBootstrapCode(options)}</script>`;
}

/**
 * One frame as complete markup: a JSON carrier script (marked with the frame
 * attribute) followed by a push script. `frame` may be any JSON-encodable
 * value — a raw row-chunk string or a caller-defined envelope object.
 */
export function payloadFrameScript(
  frame: unknown,
  options: PayloadFrameTransportOptions = {},
): string {
  const name = resolveGlobalName(options);
  const attribute = resolveFrameAttribute(options);
  const nonce = nonceAttribute(options.nonce);
  return (
    `<script type="application/json" ${attribute}=""${nonce}>${escapeScriptJson(frame)}</script>` +
    `<script${nonce}>globalThis.${name}.p(JSON.parse(document.currentScript.previousElementSibling.textContent));</script>`
  );
}

/**
 * Client side: the queue global, created if the bootstrap never ran. Frames
 * already in the document but missing from the queue (a bundle that executed
 * mid-stream, or before the bootstrap) are replayed in document order, so
 * subscribing afterwards always observes every delivered frame exactly once.
 */
export function getPayloadFrameStream<TFrame = unknown>(
  options: PayloadFrameTransportOptions = {},
): PayloadFrameStream<TFrame> {
  const name = resolveGlobalName(options);
  const scope = globalThis as Record<string, unknown>;
  const current = scope[name];

  if (isPayloadFrameStream<TFrame>(current)) {
    appendMissingFrames(current, readFramesFromDocument<TFrame>(options));
    return current;
  }

  const stream = createPayloadFrameStream<TFrame>(
    readFramesFromDocument<TFrame>(options),
  );
  scope[name] = stream;
  return stream;
}

function createPayloadFrameStream<TFrame>(
  initialFrames: readonly TFrame[],
): PayloadFrameStream<TFrame> {
  let listeners: Array<(frame: TFrame) => void> = [];
  const stream: PayloadFrameStream<TFrame> = {
    q: [...initialFrames],
    p(frame) {
      stream.q.push(frame);
      for (const listener of listeners) listener(frame);
    },
    s(listener) {
      listeners.push(listener);
      for (const frame of stream.q) listener(frame);
      return () => {
        listeners = listeners.filter((item) => item !== listener);
      };
    },
  };
  return stream;
}

function appendMissingFrames<TFrame>(
  stream: PayloadFrameStream<TFrame>,
  frames: readonly TFrame[],
): void {
  if (frames.length === 0) return;
  const seen = new Set(stream.q.map((frame) => JSON.stringify(frame)));
  for (const frame of frames) {
    const key = JSON.stringify(frame);
    if (seen.has(key)) continue;
    seen.add(key);
    stream.p(frame);
  }
}

function isPayloadFrameStream<TFrame>(
  value: unknown,
): value is PayloadFrameStream<TFrame> {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { q?: unknown }).q) &&
    typeof (value as { p?: unknown }).p === "function" &&
    typeof (value as { s?: unknown }).s === "function"
  );
}

function readFramesFromDocument<TFrame>(
  options: PayloadFrameTransportOptions,
): TFrame[] {
  if (typeof document === "undefined") return [];
  const attribute = resolveFrameAttribute(options);
  return Array.from(
    document.querySelectorAll(`script[${attribute}]`),
    (element) => JSON.parse(element.textContent ?? "") as TFrame,
  );
}
