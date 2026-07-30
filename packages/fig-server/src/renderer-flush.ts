import {
  SUSPENSE_CLIENT_MARKER,
  SUSPENSE_COMPLETED_MARKER,
  SUSPENSE_END_MARKER,
  SUSPENSE_PENDING_PREFIX,
} from "@bgub/fig/internal";
import { escapeAttribute, escapeScriptJson } from "./escaping.ts";
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
  if (request.prerender && request.abortableTasks.size > 0) return;
  if (request.flushing) return;

  request.flushing = true;
  try {
    sealHead(request);

    // The shell flushes ungated: the queue is empty before the first enqueue,
    // and shell latency outranks flow control.
    if (request.rootSegment.status !== "flushed") {
      flushSegment(request, request.rootSegment);
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
    request.abortableTasks.size === 0 &&
    request.completedBoundaries.size === 0 &&
    request.clientRenderedBoundaries.size === 0 &&
    request.partialBoundaries.size === 0
  ) {
    request.status = "closed";
    request.dispose();
    request.controller.close();
  }
}

export function sealHead(request: Request): void {
  if (request.headSnapshot !== null) return;

  activateVisibleMetadata(request, request.rootSegment);
  const metadata = request.assetRegistry.headMetadataHtml(
    request.nonce,
    !request.prerender && request.abortableTasks.size > 0,
  );
  request.headSnapshot = {
    ...metadata,
    preloadHeaderEntries: null,
    preloadHeaderResources: request.assetRegistry.preloadHeaderResources(),
  };
  request.headReady.resolve(metadata.preamble + metadata.metadata);
}

function flushSegment(request: Request, segment: Segment): void {
  if (segment.status === "flushed") return;
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
  if (request.documentHasHead === null || segment !== request.rootSegment) {
    collectSegmentAssets(request, segment, null);
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

  // A flushed segment never needs its serialized fragments again. Releasing
  // them here keeps a completed render from retaining a second copy of the
  // response while the encoded stream chunk is consumed.
  segment.chunks.length = 0;
}

function flushSuspenseBoundary(
  request: Request,
  segment: Segment,
  boundary: SuspenseBoundary,
): void {
  boundary.parentFlushed = true;

  if (boundary.status === "completed") {
    request.write(`<!--${SUSPENSE_COMPLETED_MARKER}-->`);
    for (const completedSegment of boundary.completedSegments) {
      flushSegment(request, completedSegment);
    }
    boundary.completedSegments.length = 0;
    request.write(`<!--${SUSPENSE_END_MARKER}-->`);
    segment.status = "flushed";
    segment.chunks.length = 0;
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
  collectSegmentAssets(request, boundary.contentSegment, null);
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
  boundary.completedSegments.length = 0;
}

function flushBoundarySegment(
  request: Request,
  boundary: SuspenseBoundary,
  segment: Segment,
): void {
  ensureBoundaryId(request, boundary);
  let blockingIds = "";
  if (segment.status !== "flushed") {
    blockingIds = flushSegmentAssets(request, segment);
    request.write(
      segmentContainerStartMarkup(request, ensureSegmentId(request, segment)),
    );
    flushSegment(request, segment);
    request.write("</div>");
  }

  if (segment !== boundary.contentSegment) {
    writeSegmentRevealScript(request, segment, blockingIds);
  }
}

function writeSegmentRevealScript(
  request: Request,
  segment: Segment,
  blockingIds: string,
): void {
  const id = ensureSegmentId(request, segment);
  writeProtocolRuntime(request);
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
  const metadata = switchBoundaryMetadata(request, boundary);
  const metadataArgument = metadata === null ? "" : `,${metadata}`;
  writeProtocolRuntime(request);
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
      ? `${RUNTIME_REF}.c(${boundaryRef},${contentRef}${metadataArgument})`
      : `${RUNTIME_REF}.ac(${jsString(boundary.activityId)},${boundaryRef},${contentRef}${metadataArgument})`;
  writeScript(request, withAssetGate(blockingIds, call));
}

function switchBoundaryMetadata(
  request: Request,
  boundary: SuspenseBoundary,
): string | null {
  // A nested boundary may complete while an ancestor's primary content is
  // still staged. Its segment fill is useful, but its metadata is not visible;
  // the ancestor reveal traversal will activate the settled branch later.
  if (!boundary.metadataVisible) return null;

  const before = escapeScriptJson(request.assetRegistry.metadataSnapshot());
  const fallback = boundary.fallbackSegment;
  if (fallback !== null) {
    request.assetRegistry.releaseMetadata(fallback);
    for (const child of fallback.children) {
      deactivateMetadataTree(request, child);
    }
  }
  activateVisibleMetadata(request, boundary.contentSegment);
  const after = escapeScriptJson(request.assetRegistry.metadataSnapshot());
  return before === after ? null : after;
}

function activateVisibleMetadata(request: Request, segment: Segment): void {
  if (segment.status === "pending" || segment.status === "rendering") return;

  const boundary = segment.boundary;
  if (boundary !== null) {
    boundary.metadataVisible = true;
    if (boundary.status === "completed") {
      activateVisibleMetadata(request, boundary.contentSegment);
      return;
    }
  }

  request.assetRegistry.activateMetadata(segment, segment.assetResources);
  for (const child of segment.children) {
    activateVisibleMetadata(request, child);
  }
}

function deactivateMetadataTree(request: Request, segment: Segment): void {
  request.assetRegistry.releaseMetadata(segment);
  for (const child of segment.children) deactivateMetadataTree(request, child);

  const boundary = segment.boundary;
  if (boundary === null) return;
  boundary.metadataVisible = false;
  deactivateMetadataTree(request, boundary.contentSegment);
}

function flushSegmentAssets(request: Request, segment: Segment): string {
  const blockingIds = new Set<string>();
  collectSegmentAssets(request, segment, blockingIds);
  let serialized = "";
  for (const id of blockingIds) {
    if (serialized !== "") serialized += ",";
    serialized += jsString(id);
  }
  return serialized;
}

function collectSegmentAssets(
  request: Request,
  segment: Segment,
  blockingIds: Set<string> | null,
): void {
  if (segment.status !== "pending" && segment.status !== "rendering") {
    for (const resource of segment.assetResources) {
      const id = request.assetRegistry.write(resource, request);
      if (id !== null) blockingIds?.add(id);
    }
  }

  for (const child of segment.children) {
    collectSegmentAssets(request, child, blockingIds);
  }
}

function withAssetGate(blockingIds: string, call: string): string {
  if (blockingIds === "") return call;
  return `${RUNTIME_REF}.r([${blockingIds}],()=>{${call}})`;
}

function flushClientRenderedBoundary(
  request: Request,
  boundary: SuspenseBoundary,
): void {
  if (boundary.id === null) return;
  writeProtocolRuntime(request);
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

// Classic <script> elements share the page's global lexical environment, so a
// top-level `let` would redeclare across op scripts and throw; the IIFE keeps
// a per-script binding that async op callbacks (the stylesheet gate) close
// over even if a later stream rebinds the runtime name.
function writeScript(request: Request, code: string): void {
  writeProtocolScript(
    request,
    `(__figSSR=>{${code}})(globalThis[${jsString(request.runtimeName)}])`,
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

  if (request.documentHasHead === null) return;

  const metadata =
    request.headSnapshot ??
    request.assetRegistry.headMetadataHtml(request.nonce);
  request.assetRegistry.writeDocumentHead(
    segment.assetResources,
    metadata,
    request,
  );
}

function flushWriteBuffer(request: Request): void {
  if (request.writeBuffer === "" || request.controller === null) return;
  request.controller.enqueue(textEncoder.encode(request.writeBuffer));
  request.writeBuffer = "";
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
