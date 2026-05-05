interface ProtocolRequest {
  identifierPrefix: string;
  nonce?: string;
  runtimeWritten: boolean;
}

type WriteChunk = (chunk: string) => void;
type IdentifierRequest = Pick<ProtocolRequest, "identifierPrefix">;

export const serverRuntimeCode =
  "globalThis.__figSSR??={s(p,s){p=document.getElementById(p);s=document.getElementById(s);if(!p||!s)return;while(s.firstChild)p.parentNode.insertBefore(s.firstChild,p);p.remove();s.remove()},c(b,s){b=document.getElementById(b);s=document.getElementById(s);if(!b||!s)return;let a=b.previousSibling||b,p=a.parentNode;if(!p)return;while(s.firstChild)p.insertBefore(s.firstChild,b);for(let e=b,d=0;e;){if(e.nodeType===8){if(e.data.indexOf('fig:suspense:')===0)d++;else if(e.data==='/fig:suspense'){if(d===0)break;d--}}let x=e.nextSibling;e.remove();e=x}s.remove();if(a.nodeType===8){a.data='fig:suspense:completed';a.__figRetry&&a.__figRetry()}},x(b,d,m){b=document.getElementById(b);if(!b)return;let s=b.previousSibling;if(s&&s.nodeType===8){s.data='fig:suspense:client';if(d)b.dataset.dgst=d;if(m)b.dataset.msg=m;s.__figRetry&&s.__figRetry()}}}";

export function writeRuntime(
  request: ProtocolRequest,
  write: WriteChunk,
): void {
  if (request.runtimeWritten) return;
  request.runtimeWritten = true;
  writeScript(request, serverRuntimeCode, write);
}

export function writeScript(
  request: Pick<ProtocolRequest, "nonce">,
  code: string,
  write: WriteChunk,
): void {
  write(
    `<script${request.nonce === undefined ? "" : ` nonce="${escapeAttribute(request.nonce)}"`}>${code}</script>`,
  );
}

export function placeholderMarkup(
  request: IdentifierRequest,
  id: number,
): string {
  const escapedId = escapeAttribute(placeholderId(request, id));
  return `<template id="${escapedId}"></template>`;
}

export function boundaryPlaceholderMarkup(
  request: IdentifierRequest,
  id: number,
): string {
  const escapedId = escapeAttribute(boundaryId(request, id));
  return `<template id="${escapedId}"></template>`;
}

export function segmentContainerStartMarkup(
  request: IdentifierRequest,
  id: number,
): string {
  const escapedId = escapeAttribute(segmentId(request, id));
  return `<div hidden id="${escapedId}">`;
}

export function placeholderId(request: IdentifierRequest, id: number): string {
  return prefixedId(request, "p", id);
}

export function segmentId(request: IdentifierRequest, id: number): string {
  return prefixedId(request, "s", id);
}

export function boundaryId(request: IdentifierRequest, id: number): string {
  return prefixedId(request, "b", id);
}

export function jsString(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003C");
}

function escapeAttribute(value: string): string {
  return value.replace(/[&"<>]/g, (character) => {
    if (character === "&") return "&amp;";
    if (character === '"') return "&quot;";
    if (character === "<") return "&lt;";
    return "&gt;";
  });
}

function prefixedId(
  request: IdentifierRequest,
  kind: string,
  id: number,
): string {
  return request.identifierPrefix === ""
    ? `${kind}-${id}`
    : `${request.identifierPrefix}-${kind}-${id}`;
}
