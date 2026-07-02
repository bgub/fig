import {
  SUSPENSE_CLIENT_MARKER,
  SUSPENSE_COMPLETED_MARKER,
  SUSPENSE_END_MARKER,
  SUSPENSE_MARKER_PREFIX,
} from "@bgub/fig/internal";
import { escapeAttribute } from "./html.ts";

interface ProtocolRequest {
  identifierPrefix: string;
  nonce?: string;
  runtimeName: string;
  runtimeWritten: boolean;
}

type WriteChunk = (chunk: string) => void;
type IdentifierRequest = Pick<ProtocolRequest, "identifierPrefix">;

// Runtime ops, in order: r=resource gate, s=fill partial segment, c=reveal
// boundary, x=client-render boundary, ac/ax=the Activity-aware variants. The
// boundary markers sit in the activity's inert <template>, whose `.content`
// DocumentFragment is unreachable by getElementById, so Activity-aware ops first
// search that fragment and then fall back to the light DOM if the activity has
// already revealed and unpacked.
export const serverRuntimeCode = serverRuntimeCodeFor("__figSSR");

export function serverRuntimeCodeFor(runtimeName: string): string {
  return `globalThis[${jsString(runtimeName)}]??={r(a,f){let n=0,d=()=>{--n||f()};for(let i of a){let e=document.getElementById(i);if(e&&e.tagName==='LINK'&&e.rel==='stylesheet'&&!e.sheet){n++;e.addEventListener('load',d,{once:true});e.addEventListener('error',d,{once:true})}}n||f()},s(p,s){p=document.getElementById(p);s=document.getElementById(s);if(!p||!s)return;while(s.firstChild)p.parentNode.insertBefore(s.firstChild,p);p.remove();s.remove()},f(r,i){if(!r)return null;if(r.id===i)return r;for(let e of r.querySelectorAll?r.querySelectorAll('[id]'):[])if(e.id===i)return e;return null},b(t,b){let e=document.getElementById(t),r=e&&(e.content||e);return this.f(r,b)||document.getElementById(b)},c(b,s){this.o(document.getElementById(b),document.getElementById(s))},o(b,s){if(!b||!s)return;let a=b.previousSibling||b,p=a.parentNode,c=s.content||s;if(!p)return;while(c.firstChild)p.insertBefore(c.firstChild,b);for(let e=b,d=0;e;){if(e.nodeType===8){if(e.data.indexOf('${SUSPENSE_MARKER_PREFIX}')===0)d++;else if(e.data==='${SUSPENSE_END_MARKER}'){if(d===0)break;d--}}let x=e.nextSibling;e.remove();e=x}s.remove();if(a.nodeType===8){a.data='${SUSPENSE_COMPLETED_MARKER}';a.__figRetry&&a.__figRetry()}},x(b,d,m){this.y(document.getElementById(b),d,m)},y(b,d,m){if(!b)return;let s=b.previousSibling;if(s&&s.nodeType===8){s.data='${SUSPENSE_CLIENT_MARKER}';if(d)b.dataset.dgst=d;if(m)b.dataset.msg=m;s.__figRetry&&s.__figRetry()}},ac(t,b,s){this.o(this.b(t,b),document.getElementById(s))},ax(t,b,d,m){this.y(this.b(t,b),d,m)}}`;
}

export function writeRuntime(
  request: ProtocolRequest,
  write: WriteChunk,
): void {
  if (request.runtimeWritten) return;
  request.runtimeWritten = true;
  writeScript(request, serverRuntimeCodeFor(request.runtimeName), write);
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

export function activityId(request: IdentifierRequest, id: number): string {
  return prefixedId(request, "a", id);
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

function prefixedId(
  request: IdentifierRequest,
  kind: string,
  id: number,
): string {
  return request.identifierPrefix === ""
    ? `${kind}-${id}`
    : `${request.identifierPrefix}-${kind}-${id}`;
}
