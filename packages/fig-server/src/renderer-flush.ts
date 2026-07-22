import {
  SUSPENSE_CLIENT_MARKER,
  SUSPENSE_COMPLETED_MARKER,
  SUSPENSE_END_MARKER,
  SUSPENSE_PENDING_PREFIX,
} from "@bgub/fig/internal";
import { escapeAttribute } from "./escaping.ts";
import {
  boundaryId,
  boundaryPlaceholderMarkup,
  jsString,
  placeholderId,
  placeholderMarkup,
  segmentContainerStartMarkup,
  segmentId,
  writeRuntime as writeProtocolRuntime,
  writeScript as writeProtocolScript,
} from "./protocol.ts";
import type { Request, Segment, SuspenseBoundary } from "./renderer.ts";
import { streamFlowBlocked } from "./shared.ts";

export const documentHeadMarker = Symbol("fig.document-head");
export const leadingNewlineStartMarker = Symbol("fig.leading-newline-start");
export const leadingNewlineEndMarker = Symbol("fig.leading-newline-end");

export type SegmentChunk =
  | string
  | typeof documentHeadMarker
  | typeof leadingNewlineStartMarker
  | typeof leadingNewlineEndMarker
  | { value: string };

const RUNTIME_REF = "__figSSR";
const textEncoder = new TextEncoder();

export function flushCompletedQueues(request: Request): void {
  if (request.controller === null || request.status === "closed") return;
  if (request.pendingRootTasks > 0) return;
  if (request.prerender && request.pendingTasks > 0) return;
  if (request.flushing) return;

  request.flushing = true;
  try {
    sealHead(request);

    // The shell flushes ungated: the queue is empty before the first enqueue,
    // and shell latency outranks flow control.
    if (request.completedRootSegment !== null) {
      flushSegment(request, request.completedRootSegment);
      request.completedRootSegment = null;
      flushWriteBuffer(request);
    }

    // Stop at the first blocked drain; the stream's pull handler re-enters
    // here when the consumer makes room.
    if (
      !drainBoundaryQueue(
        request,
        request.clientRenderedBoundaries,
        flushClientRenderedBoundary,
      ) &&
      !drainBoundaryQueue(
        request,
        request.completedBoundaries,
        flushCompletedBoundary,
      )
    ) {
      drainBoundaryQueue(
        request,
        request.partialBoundaries,
        flushPartialBoundary,
      );
    }

    flushWriteBuffer(request);
  } finally {
    request.flushing = false;
  }

  // Deliberately not conditioned on flow: close() only marks the end of the
  // queue, so a full queue with nothing left to write still closes here.
  if (
    request.pendingTasks === 0 &&
    request.completedBoundaries.size === 0 &&
    request.clientRenderedBoundaries.size === 0 &&
    request.partialBoundaries.size === 0
  ) {
    request.cleanupAbortListener();
    request.status = "closed";
    request.dataStore.dispose();
    request.controller.close();
  }
}

export function sealHead(request: Request): void {
  if (request.headSnapshot !== null) return;

  const head = request.assetRegistry.headHtml(request.nonce);
  request.headSnapshot = head;
  request.headReady.resolve(head);
}

function flushSegment(request: Request, segment: Segment): void {
  if (segment.boundary !== null) {
    flushSuspenseBoundary(request, segment, segment.boundary);
    return;
  }

  flushSubtree(request, segment);
}

function flushSubtree(request: Request, segment: Segment): void {
  segment.parentFlushed = true;

  if (segment.status === "pending" || segment.status === "rendering") {
    request.write(
      placeholderMarkup(request, ensureSegmentId(request, segment)),
    );
    return;
  }

  if (segment.status === "flushed") return;

  segment.status = "flushed";
  if (request.document === null || segment !== request.rootSegment) {
    flushSegmentAssets(request, segment);
  }
  let chunkIndex = 0;

  for (const child of segment.children) {
    for (; chunkIndex < child.index; chunkIndex += 1) {
      writeChunk(request, segment.chunks[chunkIndex], segment);
    }
    flushSegment(request, child);
  }

  for (; chunkIndex < segment.chunks.length; chunkIndex += 1) {
    writeChunk(request, segment.chunks[chunkIndex], segment);
  }
}

function flushSuspenseBoundary(
  request: Request,
  segment: Segment,
  boundary: SuspenseBoundary,
): void {
  segment.boundary = null;
  boundary.parentFlushed = true;

  if (boundary.status === "completed") {
    request.write(`<!--${SUSPENSE_COMPLETED_MARKER}-->`);
    flushBoundaryContent(request, boundary);
    request.write(`<!--${SUSPENSE_END_MARKER}-->`);
    return;
  }

  if (request.prerender && boundary.status === "client-rendered") {
    // Static prerender does not hoist assets discovered only in failed content:
    // the retry path loads them on demand, and pure-static consumers see only
    // the fallback.
    request.write(`<!--${SUSPENSE_CLIENT_MARKER}-->`);
    request.write(clientRenderedBoundaryPlaceholderMarkup(request, boundary));
    flushSubtree(request, segment);
    request.write(`<!--${SUSPENSE_END_MARKER}-->`);
    return;
  }

  const boundaryIdValue = ensureBoundaryId(request, boundary);
  flushSegmentAssets(request, boundary.contentSegment);
  request.write(`<!--${SUSPENSE_PENDING_PREFIX}${boundaryIdValue}-->`);
  request.write(boundaryPlaceholderMarkup(request, boundaryIdValue));
  flushSubtree(request, segment);
  request.write(`<!--${SUSPENSE_END_MARKER}-->`);

  if (boundary.status === "client-rendered") {
    request.clientRenderedBoundaries.add(boundary);
  } else if (boundary.completedSegments.length > 0) {
    request.partialBoundaries.add(boundary);
  }
}

function flushBoundaryContent(
  request: Request,
  boundary: SuspenseBoundary,
): void {
  for (const segment of boundary.completedSegments) {
    flushSegment(request, segment);
  }
  boundary.completedSegments = [];
}

function clientRenderedBoundaryPlaceholderMarkup(
  request: Request,
  boundary: SuspenseBoundary,
): string {
  const id = escapeAttribute(
    boundaryId(request, ensureBoundaryId(request, boundary)),
  );
  const digest = boundary.error?.digest;
  const message = boundary.error?.message;
  const digestAttr =
    digest === undefined || digest === ""
      ? ""
      : ` data-dgst="${escapeAttribute(digest)}"`;
  const messageAttr =
    message === undefined || message === ""
      ? ""
      : ` data-msg="${escapeAttribute(message)}"`;

  return `<template id="${id}"${digestAttr}${messageAttr}></template>`;
}

function flushCompletedBoundary(
  request: Request,
  boundary: SuspenseBoundary,
): void {
  flushPartialBoundary(request, boundary);
  writeBoundaryRevealScript(request, boundary);
}

function flushPartialBoundary(
  request: Request,
  boundary: SuspenseBoundary,
): void {
  for (const segment of boundary.completedSegments) {
    flushBoundarySegment(request, boundary, segment);
  }
  boundary.completedSegments = [];
}

function flushBoundarySegment(
  request: Request,
  boundary: SuspenseBoundary,
  segment: Segment,
): void {
  ensureBoundaryId(request, boundary);
  const blockingIds = flushSegmentContainer(request, segment);

  if (segment !== boundary.contentSegment) {
    writeSegmentRevealScript(request, segment, blockingIds);
  }
}

function writeSegmentRevealScript(
  request: Request,
  segment: Segment,
  blockingIds: string[],
): void {
  const id = ensureSegmentId(request, segment);
  writeRuntime(request);
  // Partial segments — including those of a hidden-Activity boundary — stage and
  // fill in light-DOM hidden divs; only the boundary's final reveal (`ac`) moves
  // the assembled content into the inert activity template.
  writeScript(
    request,
    withAssetGate(
      blockingIds,
      `${RUNTIME_REF}.s(${jsString(placeholderId(request, id))},${jsString(
        segmentId(request, id),
      )})`,
    ),
  );
}

function writeBoundaryRevealScript(
  request: Request,
  boundary: SuspenseBoundary,
): void {
  const blockingIds = flushSegmentAssets(request, boundary.contentSegment);
  writeRuntime(request);
  const boundaryRef = jsString(
    boundaryId(request, ensureBoundaryId(request, boundary)),
  );
  const contentRef = jsString(
    segmentId(request, ensureSegmentId(request, boundary.contentSegment)),
  );
  // Inside a hidden Activity the boundary markers live in the activity
  // template's inert content; reveal the completion there with `ac`.
  const call =
    boundary.activityId === null
      ? `${RUNTIME_REF}.c(${boundaryRef},${contentRef})`
      : `${RUNTIME_REF}.ac(${jsString(boundary.activityId)},${boundaryRef},${contentRef})`;
  writeScript(request, withAssetGate(blockingIds, call));
}

function flushSegmentContainer(request: Request, segment: Segment): string[] {
  if (segment.status === "flushed") return [];
  const blockingIds = flushSegmentAssets(request, segment);

  request.write(
    segmentContainerStartMarkup(request, ensureSegmentId(request, segment)),
  );
  flushSegment(request, segment);
  request.write("</div>");
  return blockingIds;
}

function flushSegmentAssets(request: Request, segment: Segment): string[] {
  const blockingIds = new Set<string>();
  collectSegmentAssets(request, segment, blockingIds);
  return [...blockingIds];
}

function collectSegmentAssets(
  request: Request,
  segment: Segment,
  blockingIds: Set<string>,
): void {
  if (segment.status !== "pending" && segment.status !== "rendering") {
    flushAssetList(request, segment.assetResources, blockingIds);
  }

  for (const child of segment.children) {
    collectSegmentAssets(request, child, blockingIds);
  }
}

function flushAssetList(
  request: Request,
  resources: Segment["assetResources"],
  blockingIds: Set<string>,
): void {
  for (const resource of resources) {
    const id = request.assetRegistry.write(resource, request);
    if (id !== null) blockingIds.add(id);
  }
}

function withAssetGate(blockingIds: string[], call: string): string {
  if (blockingIds.length === 0) return call;
  return `${RUNTIME_REF}.r([${blockingIds.map(jsString).join(",")}],()=>{${call}})`;
}

function flushClientRenderedBoundary(
  request: Request,
  boundary: SuspenseBoundary,
): void {
  if (boundary.id === null) return;
  writeRuntime(request);
  const boundaryRef = jsString(boundaryId(request, boundary.id));
  const digest = jsString(boundary.error?.digest ?? "");
  const message = jsString(boundary.error?.message ?? "");
  const call =
    boundary.activityId === null
      ? `${RUNTIME_REF}.x(${boundaryRef},${digest},${message})`
      : `${RUNTIME_REF}.ax(${jsString(boundary.activityId)},${boundaryRef},${digest},${message})`;
  writeScript(request, call);
}

// A boundary deliberately stays in the queue while it flushes so a re-add
// during its own flush is a no-op (Set semantics), then leaves afterwards.
// Returns true when the drain stopped because the flow is blocked; blocked
// boundaries stay queued for the next pull-driven pass. Gating sits between
// boundaries — never mid-buffer — so every chunk still ends on complete
// markup.
function drainBoundaryQueue(
  request: Request,
  queue: Set<SuspenseBoundary>,
  flush: (request: Request, boundary: SuspenseBoundary) => void,
): boolean {
  for (;;) {
    if (streamFlowBlocked(request.controller)) return true;
    const first = queue.values().next();
    if (first.done === true) return false;
    flush(request, first.value);
    queue.delete(first.value);
    // One encoded enqueue per drained boundary: keeps chunk boundaries at
    // meaningful stream points (consumers interleave companion content per
    // chunk) while still coalescing the per-attribute writes within.
    flushWriteBuffer(request);
  }
}

function writeRuntime(request: Request): void {
  writeProtocolRuntime(request, (chunk) => request.write(chunk));
}

// Classic <script> elements share the page's global lexical environment, so a
// top-level `let` would redeclare across op scripts and throw; the IIFE keeps
// a per-script binding that async op callbacks (the stylesheet gate) close
// over even if a later stream rebinds the runtime name.
function writeScript(request: Request, code: string): void {
  writeProtocolScript(
    request,
    `(__figSSR=>{${code}})(globalThis[${jsString(request.runtimeName)}])`,
    (chunk) => request.write(chunk),
  );
}

function writeChunk(
  request: Request,
  chunk: SegmentChunk,
  segment: Segment,
): void {
  if (chunk === leadingNewlineStartMarker) {
    request.leadingNewlineStack.push(false);
    return;
  }
  if (chunk === leadingNewlineEndMarker) {
    request.leadingNewlineStack.pop();
    return;
  }
  if (typeof chunk === "object") {
    request.write(
      request.leadingNewlineStack.at(-1) === false &&
        chunk.value.startsWith("\n")
        ? `\n${chunk.value}`
        : chunk.value,
    );
    return;
  }
  if (chunk !== documentHeadMarker) {
    request.write(chunk);
    return;
  }

  if (request.document === null) return;

  request.write(request.assetRegistry.headHtml(request.nonce));
  flushAssetList(request, segment.assetResources, new Set());
}

function flushWriteBuffer(request: Request): void {
  if (request.writeBuffer.length === 0 || request.controller === null) return;
  request.controller.enqueue(textEncoder.encode(request.writeBuffer.join("")));
  request.writeBuffer = [];
}

function ensureSegmentId(request: Request, segment: Segment): number {
  segment.id ??= request.nextSegmentId++;
  return segment.id;
}

function ensureBoundaryId(
  request: Request,
  boundary: SuspenseBoundary,
): number {
  boundary.id ??= request.nextBoundaryId++;
  return boundary.id;
}
