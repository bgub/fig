# Payload (server components)

Docs 4 and 5 kept pointing here. Payload is Fig's server-component wire layer — how a tree rendered on the server becomes rows, crosses the wire, and becomes a live Fig tree in the browser. The server half (`renderToPayloadStream`) lives at `@bgub/fig-server/payload`; the client half (`decodePayloadStream`) lives at the browser-safe `@bgub/fig/payload`; and fig-dom's `payloadDataLoader` turns the whole thing into an ordinary data resource. Rows and encoding stay internal. The terminology rule from doc 1 applies: it's _payload_, never "RSC" or "Flight". Those are React brands; the format is Fig's own.

Like docs 3 and 4, this one follows a single scenario end to end.

## The scenario

A profile page renders on the server. It reads data (doc 5) and includes one interactive island:

```tsx
// profile-page.tsx — runs only on the server
import { readData } from "@bgub/fig";
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
});
```

(In an app, bundler tooling authors these ids and references for you, using the `"<module>#<export>"` convention. Only the server ever splits that convention — it derives `exportName` once at serialization, so loaders and the client never string-parse ids.)

The server renders it to a payload stream:

```ts
import { renderToPayloadStream } from "@bgub/fig-server/payload";

const { stream, allReady, contentType } = renderToPayloadStream(
  <ProfilePage id="42" />,
  { onError: () => ({ digest: "profile-page" }) },
);
```

## What's on the wire

Payload currently uses newline-delimited JSON rows, identified by `text/x-fig-payload; codec=json; charset=utf-8`. The encoding and row types are internal so applications only need to pass the byte stream between `renderToPayloadStream` and `decodePayloadStream`. For our scenario, three rows look like this (each is one line on the wire; wrapped here for readability):

```
{"id":1,"tag":"client","value":{"id":"src/like-button.tsx#LikeButton","exportName":"LikeButton"}}

{"id":0,"tag":"model","value":{"$fig":"element","key":null,"props":{"$fig":"object","value":{"children":[
  {"$fig":"element","key":null,"props":{"$fig":"object","value":{"children":"Ada Lovelace"}},"type":"h1"},
  {"$fig":"element","key":null,"props":{"$fig":"object","value":{"userId":"42"}},"type":{"$fig":"client","id":1}}
]}},"type":"main"}}

{"tag":"data","value":[{"key":["user","42"],"value":{"$fig":"object","id":1,"value":{"name":"Ada Lovelace"}}}]}
```

Reading them in order:

- The `client` row declares the reference. `LikeButton` never rendered on the server; it exists on the wire only as this row.
- The `model` row is the tree. Id 0 is the root. Elements are `$fig`-tagged nodes: host elements keep their tag name and props, and the `LikeButton` position holds `{"$fig":"client","id":1}` — a pointer at row 1.
- The `data` row is doc 5's SSR handoff riding the same response: the fulfilled `["user","42"]` entry, ready to hydrate into the client store. This is why payload navigation never needs a second data request.

The full row vocabulary:

| Tag | Carries |
| --- | --- |
| `model` | a serialized tree chunk; id 0 is the root |
| `client` | a client reference: `{ id, exportName?, assets?, ssr? }` |
| `data` | settled data-resource entries (doc 5's map rows) |
| `assets` | asset descriptors, including title/meta document state (doc 7) |
| `error` | `{ digest?, message? }` under the server `onError` contract (doc 4) |

There is deliberately no refresh row. The refresh unit is the data-resource key that delivers the payload — refreshing is just requesting the same stream again, and the store's ordinary freshness semantics do the rest.

Some things are deliberately absent from the row model: server actions and temporary references. The byte encoding is deliberately private, so Fig can replace it without exposing codec machinery to applications. (Ids minted by `useId` during a payload render get a `fig-pl-` prefix so they can't collide with client-generated ones.)

## Serialization fidelity

Payload data is not just `JSON.stringify` with crossed fingers. The shared value codec round-trips JSON scalars/arrays, plain objects (including a user-authored `$fig` key), shared references and cyclic graphs, `undefined`, `Date`, `Map`, `Set`, `BigInt`, non-finite numbers, `-0`, and global `Symbol.for` symbols. It rejects functions, class instances/non-plain objects, and non-global symbols.

Server component values can additionally contain Fig elements, client references, and promises. The payload renderer turns those into `$fig` row references first; ordinary data then goes through the shared value codec. A promise used as a child becomes a lazy rendered-node row, while a promise-valued prop remains a promise for the receiving component. Fig Start uses the same helpers for data hydration and remote data resource args/results, so data values don't silently degrade to JSON.

## Suspense holes fill by row id

Suppose `userResource` isn't loaded when `ProfilePage` renders. Same trick as everywhere else (doc 4): the read throws, and the payload renderer outlines the not-ready subtree — the model ships with `{"$fig":"lazy","id":2}` in that position and rendering moves on. When the load settles, row 2 arrives with the missing chunk and the hole fills. Suspense boundaries serialize as their own `$fig` nodes, so the client knows where fallbacks belong while holes are outstanding. `allReady` resolves once every outstanding row has been written — the same contract as doc 4's HTML entry points.

## The client side: a serialized tree is a data resource

The decoded page travels like any other keyed async value (doc 5). fig-dom's `payloadDataLoader` adapts the endpoint into an ordinary loader, and `readData` returns renderable elements:

```tsx
import { dataResource, readData, refreshData, transition } from "@bgub/fig";
import { payloadDataLoader } from "@bgub/fig-dom";

const profileResource = dataResource({
  key: (id: string) => ["profile", id],
  load: payloadDataLoader({
    request: (id, { signal }) => fetch(`/profile/${id}`, { signal }),
    resolveClientReference: (reference) => manifest[reference.id]?.(),
  }),
});

function Profile({ id }: { id: string }) {
  const page = readData(profileResource, id); // suspends until the root row decodes
  return <main>{page}</main>;
}
```

- The loader validates the response (status, body, payload content type; unusable bodies are cancelled) and resolves with the decoded root as soon as the root row arrives — outlined holes keep streaming in afterwards, for the whole life of the entry (the loader's `signal` is generation-lifetime; doc 5).
- Module loads start as `client` rows arrive, so fetching `like-button.tsx` overlaps the rest of the stream instead of waiting for it.
- Streamed `data` rows hydrate the same store through a generation-guarded capability — the doc 5 handoff, completed, with no second request.
- `assets` rows insert into the document head as they arrive; stylesheet gates delay only the content that declared them.

Underneath sits the renderer-neutral primitive, for callers that own their own transport: `decodePayloadStream(stream, options)` from `@bgub/fig/payload` returns the root-value promise directly — it resolves at the root row while background ingestion continues. An `onStreamDone` option reports how ingestion ended (post-root failures reject the holes they strand), and aborting the options `signal` retires unresolved holes with an internal cancellation reason.

## Refreshing

There is no refresh protocol, because there doesn't need to be one: **the resource key is the refresh boundary.**

```ts
transition(() => refreshData(profileResource, "42"));
```

The store re-requests the stream; the previous tree stays visible while the refresh is pending; the new root publishes and the reconciler diffs it in. Want finer granularity? Define finer resources — a comments section with its own key refreshes without re-shipping the page around it.

## Errors

An `error` row carries `{ digest?, message? }` under the same `onError` contract as doc 4: production defaults to empty, dev includes the message. A failing root rejects the resource read — the nearest `ErrorBoundary` handles it with ordinary failed-refresh semantics. A failing _hole_ rejects just that slot while the surrounding fulfilled tree stays published. Aborted decodes retire their holes with a cancellation reason rather than a user error, because cancellation is not an error in Fig.

## Payload vs the HTML stream

Doc 4 drew this line from the other side, so briefly: the HTML+ops protocol carries rendered UI and its consumer is the browser's HTML parser plus the inline runtime. Payload carries element trees and its consumer is Fig's client runtime. Both stream, both handle suspense, different layers.

---

The full contract lives in `docs/concepts/payload.md`. Next: doc 7 — asset resources, including the `assets` rows this doc skipped over.
