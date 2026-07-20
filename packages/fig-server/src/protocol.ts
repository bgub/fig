import {
  EARLY_EVENT_HANDLER_PROPERTY,
  EARLY_EVENT_QUEUE_PROPERTY,
  HYDRATION_SKIP_ATTRIBUTE,
  REPLAYABLE_EVENT_TYPES,
  SUSPENSE_CLIENT_MARKER,
  SUSPENSE_COMPLETED_MARKER,
  SUSPENSE_END_MARKER,
  SUSPENSE_MARKER_PREFIX,
  VIEW_TRANSITION_CLASS_ATTRIBUTE,
  VIEW_TRANSITION_NAME_ATTRIBUTE,
  VIEW_TRANSITION_PENDING_PROPERTY,
} from "@bgub/fig/internal";
import { escapeAttribute } from "./html.ts";
import { escapeScriptJson, nonceAttribute } from "./shared.ts";

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
export function serverRuntimeCodeFor(runtimeName: string): string {
  return `globalThis[${jsString(runtimeName)}]??={r(a,f){let n=0,d=()=>{--n||f()};for(let i of a){let e=document.getElementById(i);if(e&&e.tagName==='LINK'&&e.rel==='stylesheet'&&!e.sheet){n++;e.addEventListener('load',d,{once:true});e.addEventListener('error',d,{once:true})}}n||f()},q(e,a){if(e&&e.nodeType===1){if(e.hasAttribute&&e.hasAttribute('${VIEW_TRANSITION_NAME_ATTRIBUTE}'))a.push([e,e.getAttribute('${VIEW_TRANSITION_NAME_ATTRIBUTE}'),e.getAttribute('${VIEW_TRANSITION_CLASS_ATTRIBUTE}')]);if(e.querySelectorAll)for(let x of e.querySelectorAll('[${VIEW_TRANSITION_NAME_ATTRIBUTE}]'))a.push([x,x.getAttribute('${VIEW_TRANSITION_NAME_ATTRIBUTE}'),x.getAttribute('${VIEW_TRANSITION_CLASS_ATTRIBUTE}')])}},g(r){let a=[];this.q(r,a);return a},h(b){let a=[],d=0;for(let e=b;e;){if(e.nodeType===8){if(e.data.indexOf('${SUSPENSE_MARKER_PREFIX}')===0)d++;else if(e.data==='${SUSPENSE_END_MARKER}'){if(d===0)break;d--}}else this.q(e,a);e=e.nextSibling}return a},a(l){for(let x of l){let e=x[0],s=e.style;x[3]=s.viewTransitionName;x[4]=s.viewTransitionClass;s.viewTransitionName=x[1];if(x[2])s.viewTransitionClass=x[2]}},u(l){for(let x of l){let e=x[0],s=e.style;s.viewTransitionName=x[3]||'';s.viewTransitionClass=x[4]||'';!(e.getAttribute&&e.getAttribute('style'))&&e.removeAttribute&&e.removeAttribute('style')}},z(l){for(let f of l)f()},j(t,r){let p=t&&(t.ready||t.finished);p&&p.then?p.then(r,()=>{let f=t&&t.finished;f&&f.then?f.then(r,r):r()}):r()},v(b,s,f){let o=this.h(b),n=this.g(s);if(!o.length&&!n.length){f();return}let d=document,w=d.startViewTransition;if(typeof w!='function'){f();return}let p=d.${VIEW_TRANSITION_PENDING_PROPERTY},pw=p&&(p.finished||p.ready);if(pw&&pw.then){let g=()=>this.v(b,s,f);pw.then(g,g);return}this.a(o);let m=0,l=[],r=()=>{this.u(o);this.u(n);this.z(l)};try{let t=w.call(d,()=>{m=1;f(l);this.a(n)});if(t){d.${VIEW_TRANSITION_PENDING_PROPERTY}=t;let c=()=>{d.${VIEW_TRANSITION_PENDING_PROPERTY}===t&&(d.${VIEW_TRANSITION_PENDING_PROPERTY}=null)},cw=t.finished||t.ready;cw&&cw.then?cw.then(c,c):c()}this.j(t,r)}catch(e){r();if(m)throw e;f()}},s(p,s){p=document.getElementById(p);s=document.getElementById(s);if(!p||!s)return;this.v(p,s,()=>{while(s.firstChild)p.parentNode.insertBefore(s.firstChild,p);p.remove();s.remove()})},f(r,i){if(!r)return null;if(r.id===i)return r;for(let e of r.querySelectorAll?r.querySelectorAll('[id]'):[])if(e.id===i)return e;return null},b(t,b){let e=document.getElementById(t),r=e&&(e.content||e);return this.f(r,b)||document.getElementById(b)},c(b,s){let x=document.getElementById(b),y=document.getElementById(s);this.v(x,y,r=>this.o(x,y,r))},o(b,s,l){if(!b||!s)return;let a=b.previousSibling||b,p=a.parentNode,c=s.content||s;if(!p)return;while(c.firstChild)p.insertBefore(c.firstChild,b);for(let e=b,d=0;e;){if(e.nodeType===8){if(e.data.indexOf('${SUSPENSE_MARKER_PREFIX}')===0)d++;else if(e.data==='${SUSPENSE_END_MARKER}'){if(d===0)break;d--}}let x=e.nextSibling;e.remove();e=x}s.remove();if(a.nodeType===8){a.data='${SUSPENSE_COMPLETED_MARKER}';let r=a.__figRetry;if(r){if(l)l.push(r);else r()}}},x(b,d,m){this.y(document.getElementById(b),d,m)},y(b,d,m){if(!b)return;let s=b.previousSibling;if(s&&s.nodeType===8){s.data='${SUSPENSE_CLIENT_MARKER}';if(d)b.dataset.dgst=d;if(m)b.dataset.msg=m;s.__figRetry&&s.__figRetry()}},ac(t,b,s){let x=this.b(t,b),y=document.getElementById(s);this.v(x,y,r=>this.o(x,y,r))},ax(t,b,d,m){this.y(this.b(t,b),d,m)}}`;
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
    `<script ${HYDRATION_SKIP_ATTRIBUTE}=""${nonceAttribute(request.nonce)}>${code}</script>`,
  );
}

// Queues replayable events that fire before the client bundle executes so
// hydration can honor a user's first interaction instead of losing it. Sits
// first in <head> — capture must be live before any content paints. The
// first hydration root drains the queue and removes these listeners
// (fig-dom's adoptEarlyEvents); a document without a client bundle just
// carries a small inert array.
export function earlyEventCaptureCode(): string {
  const types = REPLAYABLE_EVENT_TYPES.map((type) => `'${type}'`).join(",");
  return `(d=>{if(d.${EARLY_EVENT_QUEUE_PROPERTY})return;let q=d.${EARLY_EVENT_QUEUE_PROPERTY}=[],h=d.${EARLY_EVENT_HANDLER_PROPERTY}=e=>{q.push(e)};for(let t of [${types}])d.addEventListener(t,h,!0)})(document)`;
}

export function earlyEventCaptureMarkup(
  request: Pick<ProtocolRequest, "nonce">,
): string {
  return `<script ${HYDRATION_SKIP_ATTRIBUTE}=""${nonceAttribute(request.nonce)}>${earlyEventCaptureCode()}</script>`;
}

export function placeholderMarkup(
  request: IdentifierRequest,
  id: number,
): string {
  return templateMarkup(placeholderId(request, id));
}

export function boundaryPlaceholderMarkup(
  request: IdentifierRequest,
  id: number,
): string {
  return templateMarkup(boundaryId(request, id));
}

function templateMarkup(id: string): string {
  return `<template id="${escapeAttribute(id)}"></template>`;
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
  return escapeScriptJson(value);
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
