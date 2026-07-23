# Payload Component API Proposal

## Summary

Make Payload trees first-class components while retaining Fig data resources as their internal cache machinery.

```tsx
import { createPayloadComponent } from "@bgub/fig-dom";
import { serverPayload } from "@bgub/fig-tanstack-start/payload";
import { Profile } from "./Profile.server.tsx";

interface ProfileProps {
  id: string;
}

export const ProfilePage = createPayloadComponent<ProfileProps>({
  key: ["profile"],
  load: serverPayload(Profile),
});
```

Consumers render and refresh it directly:

```tsx
<ProfilePage id="42" />;
refreshData(ProfilePage, { id: "42" });
invalidateData(ProfilePage, { id: "42" });
```

## `createPayloadComponent`

`createPayloadComponent` lives in `@bgub/fig-dom`. It returns one callable object that is both the props-typed component and its backing data resource. It decodes Payload with DOM asset handling and uses the existing root data store rather than a separate Payload cache.

`load` is transport-neutral and may return a `Response` or `{ stream, contentType }`. Raw users can obtain that source through HTTP, a worker, embedded data, or an in-process renderer. The data-resource decoder adapter remains private to fig-dom.

Payload component props must be transport-serializable. Initially, `children` are rejected at runtime.

## Cache Identity

`key` is a stable component namespace. Fig appends the complete props through a canonical encoding of Payload-compatible values by default:

```tsx
key: ["profile"];
// Internal key for <ProfilePage id="42" />:
["profile", { id: "42" }];
```

An advanced `cacheKey(props)` option may replace the props portion. This explicitly opts into sharing one entry across unequal props. Development should report the same resulting key being loaded with unequal props.

Refreshing always reruns `load` with the supplied complete props. With a custom `cacheKey`, refreshing one prop set updates every mounted instance sharing that key.

## Store And Router Integration

A Payload component is accepted anywhere its private backing resource must be read explicitly:

```tsx
loader: ({ context, params }) =>
  ensureRouteData(context, ProfilePage, { id: params.id });

await root.data.ensureData(ProfilePage, { id: "42" });
await root.data.refreshData(ProfilePage, { id: "42" });
root.data.invalidateData(ProfilePage, { id: "42" });
```

This preserves route loaders' awaitable, eviction-retaining semantics and starts SSR Payload work early enough for companion-stream registration and carrier hydration. Payload component loaders receive the resolved `key` with the generation-lifetime `signal`, allowing the TanStack adapter to register the stream without an ambient store lookup or a broader change to ordinary data loaders.

## `serverPayload`

`serverPayload` lives in `@bgub/fig-tanstack-start/payload`. TanStack Start does not re-export `createPayloadComponent`; each export keeps one home.

The helper adapts a server render callback at the `load` seam:

```tsx
load: serverPayload(Profile);
// or
load: serverPayload((props) => <Profile {...props} />);
```

The compiler replaces it with a generated `createServerFn` that runs `renderToPayloadStream`. Browser output retains only the callable server-function proxy; the callback and its `.server.tsx` imports are removed. The helper throws if used without the compiler. Validation and middleware can later live here because it owns the server boundary.

## Migration

Replace TanStack Start's current `payloadResource({ key, render })` with `createPayloadComponent({ key, load: serverPayload(render) })`. Keep ordinary data resources as the lower-level cache API; Payload decoding itself is exposed either as a component or through the renderer-neutral `decodePayloadStream` primitive.
