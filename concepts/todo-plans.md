# Fig Concepts Todo Plans

This file collects concept-level plans that should become real docs, APIs, or
implementation work. The point is to make the design choice explicit before the
surface freezes.

## Hydration-Stable Environment

### Problem

Hydration wants the server render and the first client render to produce the
same tree. That is easy for deterministic UI, but awkward for values that are
legitimately environment-dependent:

- current time and relative timestamps
- locale-sensitive formatting
- time zone formatting
- light or dark color scheme
- viewport or media-query-dependent UI
- user preferences that are available to the browser before the app runtime

The common escape hatch is a per-element hydration mismatch suppression flag.
That solves the warning, but not the underlying semantic problem: the app still
has two different first renders. It also makes correctness local and easy to
overuse.

### Prior Art

React treats hydration mismatches as bugs in the general case. The common
workarounds are to render a stable placeholder until mount, disable server
rendering for the divergent part, or use `suppressHydrationWarning` for known
one-off differences.

Next.js exposes those same patterns at the framework layer: mount-gated client
content, client-only dynamic imports, and `suppressHydrationWarning`. Theme
libraries often use a pre-hydration script that mutates `<html>` before React
hydrates, then suppress the expected mismatch at that root attribute.

Vue 3.5 added `data-allow-mismatch`, which is the direct escape-hatch model.
It can be scoped to text, children, class, style, or attributes. That is useful
and explicit, but it is still a permission to diverge.

Nuxt mostly steers users toward server/client-stable data sources:
`useAsyncData`, `useFetch`, `useState`, `ClientOnly`, and mount-only browser
reads. The shape is closer to "make the first client render match" than "ignore
the mismatch."

Another interesting pattern is `useSyncExternalStore` with different server and
client snapshots. During hydration, the client can read the same snapshot the
server used; after hydration, it can switch to the live browser snapshot through
normal subscription flow.

Resumability frameworks avoid parts of this class by not replaying a full
client render before attaching behavior, but Fig is intentionally following the
render/hydrate model, so the useful lesson is narrower: serialize the decisions
that must survive the server-to-client handoff.

### Proposed Fig Direction

Prefer a hydration-stable environment primitive over a broad mismatch opt-out.

The framework should let an app capture the environment values that affect the
HTML, serialize them with the document, and make the client read that same
snapshot for its hydration render. After hydration, normal stores or state can
move from the serialized snapshot to the live browser value.

Sketch:

```ts
createRequestHandler({
  hydrationEnv(request) {
    return {
      locale: request.headers.get("accept-language") ?? "en-US",
      timeZone: user.timeZone ?? "UTC",
      colorScheme: themeFromCookie(request) ?? "light",
      now: Date.now(),
    };
  },
});
```

Server render would make that value available through a Fig/fig-start read API
and serialize it into the bootstrap payload. Hydration would read the serialized
value for the first client render. After hydration completes, browser-backed
stores can publish fresher values.

This keeps the rule simple: if a value affects SSR HTML, it should come from a
server-chosen hydration snapshot, not from an uncoordinated browser read during
the first client render.

### API Shape To Explore

Possible lower-level primitive:

```ts
const EnvironmentContext = createContext<HydrationEnvironment | null>(null);

export function readHydrationEnvironment() {
  const value = readContext(EnvironmentContext);
  if (value === null) throw new Error("Missing hydration environment.");
  return value;
}
```

Possible store-oriented primitive:

```ts
const colorScheme = createHydrationStore({
  getServerSnapshot: (env) => env.colorScheme,
  getClientSnapshot: () =>
    window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light",
  subscribe: (notify) => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    query.addEventListener("change", notify);
    return () => query.removeEventListener("change", notify);
  },
});
```

The store shape may fit Fig better than a raw context because it models the
second phase explicitly: hydration reads the stable snapshot, then the browser
can update.

### Design Questions

- Ownership: should this live in `@bgub/fig-start`, `@bgub/fig-dom`, or a small
  package-neutral primitive in `@bgub/fig`?
- Scope: is there one app-wide hydration environment, or can nested server
  boundaries provide narrower snapshots?
- Timing: how does the client know hydration has finished so browser stores can
  switch from the serialized snapshot to the live snapshot?
- Serialization: should the environment share the existing fig-start bootstrap
  data path, or should it have a DOM renderer-level script slot?
- Theme scripts: should color scheme be solved by the same environment snapshot,
  or does it need a pre-hydration `<html>` mutation helper to avoid first-paint
  flashes?
- Pure Fig DOM: should `hydrateRoot` accept a snapshot option for apps that do
  not use fig-start?
- Failure mode: if the client has no serialized snapshot but a component tries
  to read one during hydration, should Fig throw, warn, or fall back to the live
  client value?

### Provisional Stance

Do not add a `suppressHydrationWarning` clone yet. It is easy to add later and
hard to remove once docs and app code depend on it.

Instead, prototype the environment snapshot path in fig-start first. That
directly improves the cases Fig cares about most: SSG, server rendering,
locales, time, and color scheme. If a remaining class of legitimate divergence
cannot be modeled as a stable snapshot plus a post-hydration update, then add a
smaller, named escape hatch for that class rather than a universal mismatch
silencer.
