interface ProtocolRequest {
  identifierPrefix: string;
  nonce?: string;
  runtimeWritten: boolean;
}

type WriteChunk = (chunk: string) => void;

export const serverRuntimeCode =
  "globalThis.__figSSR??={s(p,s){p=document.getElementById(p);s=document.getElementById(s);if(!p||!s)return;while(s.firstChild)p.parentNode.insertBefore(s.firstChild,p);p.remove();s.remove()},c(b,s){b=document.getElementById(b);s=document.getElementById(s);if(!b||!s)return;let a=b.previousSibling||b,p=a.parentNode;if(!p)return;let n=Array.from(s.childNodes);for(const c of n)p.insertBefore(c,a);for(let e=a;e;){let x=e.nextSibling,e2=e;e=x;e2.remove();if(e2.nodeType===8&&e2.data==='/fig:suspense')break}s.remove()},x(b,d,m){b=document.getElementById(b);if(!b)return;let s=b.previousSibling;if(s&&s.nodeType===8)s.data='fig:suspense:client';if(d)b.dataset.dgst=d;if(m)b.dataset.msg=m}}";

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
  request: Pick<ProtocolRequest, "identifierPrefix">,
  id: number,
): string {
  return `<template id="${placeholderId(request, id)}"></template>`;
}

export function placeholderId(
  request: Pick<ProtocolRequest, "identifierPrefix">,
  id: number,
): string {
  return `${request.identifierPrefix}-p-${id}`;
}

export function segmentId(
  request: Pick<ProtocolRequest, "identifierPrefix">,
  id: number,
): string {
  return `${request.identifierPrefix}-s-${id}`;
}

export function boundaryId(
  request: Pick<ProtocolRequest, "identifierPrefix">,
  id: number,
): string {
  return `${request.identifierPrefix}-b-${id}`;
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
