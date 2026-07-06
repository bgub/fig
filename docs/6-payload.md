# Payload (server components)

Docs 4 and 5 kept pointing here. Payload is Fig's server-component wire layer — how a tree rendered on the server becomes rows, crosses the wire through a codec, and becomes a live Fig tree in the browser. It lives at `@bgub/fig-server/payload`, and the terminology rule from doc 1 applies: it's _payload_, never "RSC" or "Flight". Those are React brands; the format is Fig's own.

Like docs 3 and 4, this one follows a single scenario end to end.

## The scenario

A profile page renders on the server. It reads data (doc 5) and includes one interactive island:

```tsx
// profile-page.tsx — runs only on the server
import { readData } from "@bgub/fig-data";
import { userResource } from "./user-data.server.ts";
import { LikeButton } from "./like-button-ref.ts";

export function ProfilePage({ id }: { id: string }) {
  const user = readData(userResource, id);
  return (
    <main>
      <h1>{user.name}</h1>
      <LikeButton userId={id} />
    </main>
  );
}
```

`LikeButton` is a client reference — a component that serializes as a pointer instead of rendering on the server:

```ts
// like-button-ref.ts
import { clientReference } from "@bgub/fig";

export const LikeButton = clientReference({
  id: "src/like-button.tsx#LikeButton",
  load: () => import("./like-button.tsx"),
});
```

(In an app, bundler tooling authors these ids and references for you, using the `"<module>#<export>"` convention. Only the server ever splits that convention — it derives `exportName` once at serialization, so loaders and the client never string-parse ids.)

The server renders it to a payload stream:

```ts
import { renderToPayloadStream } from "@bgub/fig-server/payload";

const { stream, allReady, contentType } = renderToPayloadStream(
  <ProfilePage id="42" />,
  { dataContext: { users } },
);
```

## What's on the wire

Payload is a semantic row model plus a pluggable byte codec. The default codec is `jsonPayloadCodec`, identified by `codec=json` in the content type (`text/x-fig-payload; codec=json; charset=utf-8`), and it encodes rows as newline-delimited JSON. For our scenario, three JSON-codec rows look like this (each is one line on the wire; wrapped here for readability):

```
{"id":1,"tag":"client","value":{"id":"src/like-button.tsx#LikeButton","exportName":"LikeButton"}}

{"id":0,"tag":"model","value":{"$fig":"element","key":null,"props":{"children":[
  {"$fig":"element","key":null,"props":{"children":"Ada Lovelace"},"type":"h1"},
  {"$fig":"element","key":null,"props":{"userId":"42"},"type":{"$fig":"client","id":1}}
]},"type":"main"}}

{"tag":"data","value":[{"key":["user","42"],"value":{"name":"Ada Lovelace"}}]}
```

Reading them in order:

- The `client` row declares the reference. `LikeButton` never rendered on the server; it exists on the wire only as this row.
- The `model` row is the tree. Id 0 is the root. Elements are `$fig`-tagged nodes: host elements keep their tag name and props, and the `LikeButton` position holds `{"$fig":"client","id":1}` — a pointer at row 1.
- The `data` row is doc 5's SSR handoff riding the same response: the fulfilled `["user","42"]` entry, ready to hydrate into the client store. This is why payload navigation never needs a second data request.

The full row vocabulary:

| Tag       | Carries                                                             |
| --------- | ------------------------------------------------------------------- |
| `model`   | a serialized tree chunk; id 0 is the root                           |
| `client`  | a client reference: `{ id, exportName?, assets?, ssr? }`            |
| `data`    | settled data-resource entries (doc 5's map rows)                    |
| `assets`  | stream-safe asset descriptors (doc 7)                               |
| `error`   | `{ digest?, message? }` under the server `onError` contract (doc 4) |
| `refresh` | a boundary refresh: replaces one `PayloadBoundary`'s content by id  |

Some things are deliberately absent from the row model: server actions and temporary references. The byte encoding is deliberately pluggable: JSON is the readable default for development, and a binary production codec can be added without changing the row semantics. Codec ids identify implementations, not stable public formats. (Ids minted by `useId` during a payload render get a `fig-pl-` prefix so they can't collide with client-generated ones.)

## Serialization fidelity

Payload data is not just `JSON.stringify` with crossed fingers. The shared value codec round-trips JSON scalars/arrays, plain objects (including a user-authored `$fig` key), `undefined`, `Date`, `Map`, `Set`, `BigInt`, non-finite numbers, `-0`, and global `Symbol.for` symbols. It rejects functions, cycles, class instances/non-plain objects, and non-global symbols.

Server component values can additionally contain Fig elements, client references, and promises. The payload renderer turns those into `$fig` row references first; ordinary data then goes through the shared value codec. Fig Start uses the same helpers for data hydration and remote data resource args/results, so data values don't silently degrade to JSON.

## Suspense holes fill by row id

Suppose `userResource` isn't loaded when `ProfilePage` renders. Same trick as everywhere else (doc 4): the read throws, and the payload renderer outlines the not-ready subtree — the model ships with `{"$fig":"lazy","id":2}` in that position and rendering moves on. When the load settles, row 2 arrives with the missing chunk and the hole fills. Suspense boundaries serialize as their own `$fig` nodes, so the client knows where fallbacks belong while holes are outstanding. `allReady` resolves once every outstanding row has been written — the same contract as doc 4's HTML entry points.

## The client side

```ts
import { createPayloadResponse } from "@bgub/fig-server/payload";
import { createRoot } from "@bgub/fig-dom";

const response = createPayloadResponse({
  loadClientReference: (metadata) => manifest[metadata.id](),
});

response.processStream(payloadStream);
await response.rootReady;
response.bindRoot(createRoot(container));
```

- `processStream(stream)` is the blessed ingestion seam (`processStringChunk` is the low-level escape hatch).
- `renderToPayloadStream(node, { codec })` and `createPayloadResponse({ codec })` must agree on the codec implementation. `fetchPayload` sends the response codec in `Accept` and checks the response `codec=` content-type parameter before decoding.
- Module loads start as `client` rows arrive, so fetching `like-button.tsx` overlaps the rest of the stream instead of waiting for it. `preloadClientReferences()` awaits whatever is in flight.
- `rootReady` resolves when the root row decodes. It never rejects — race it against your own timeout or error UI.
- `bindRoot(root)` renders the decoded tree into a Fig root and replays streamed `data` rows into `root.data` — the doc 5 handoff, completed.
- Decoded chunks are memoized, so unchanged subtrees bail out of re-renders exactly like doc 3's adopted subtrees.

## Refreshing one boundary

The `refresh` row is the part with no React equivalent — React refetches whole trees; Fig replaces one subtree in place. Mark the refreshable region on the server:

```tsx
import { PayloadBoundary } from "@bgub/fig-server/payload";

<PayloadBoundary id="profile">
  <ProfilePage id="42" />
</PayloadBoundary>;
```

(Dev throws on duplicate boundary ids.) The client asks for just that boundary:

```ts
import { fetchPayload } from "@bgub/fig-server/payload";

await fetchPayload(response, "/profile/42", { refreshBoundary: "profile" });
```

`fetchPayload` sends the boundary id in the `x-fig-payload-boundary` request header; the server passes it to `renderToPayloadStream` as `refreshBoundary` and emits a `refresh` row:

```
{"boundary":"profile","tag":"refresh","value":{...new content...}}
```

Ingesting it replaces that `PayloadBoundary`'s content by id without touching the app shell — no remount of everything around it. Two details make this safe: refresh row ids are namespaced past every id the response has already seen, so outlined rows can't collide with mounted chunks, and the refresh drops the decode caches for that boundary so refreshed content gets fresh identities instead of bailing out as "unchanged".

## Errors

An `error` row carries `{ digest?, message? }` under the same `onError` contract as doc 4: production defaults to empty, dev includes the message. The decoded chunk rejects with a digest-carrying error, so the read site throws on the client and the nearest `ErrorBoundary` handles it — the same routing as any render error. Cancelled payload fetches are distinguishable with `isPayloadRequestCancelled(error)`, because cancellation is not an error in Fig.

## Payload vs the HTML stream

Doc 4 drew this line from the other side, so briefly: the HTML+ops protocol carries rendered UI and its consumer is the browser's HTML parser plus the inline runtime. Payload carries element trees and its consumer is Fig's client runtime. Both stream, both handle suspense, different layers.

---

The full contract lives in `concepts/payload.md`. Next: doc 7 — asset resources, including the `assets` rows this doc skipped over.
