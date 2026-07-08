# Fig pre-release review — 2026-07-07

Multi-agent review of `fig`, `fig-dom`, `fig-reconciler`, `fig-refresh`, and `fig-server` ahead of the planned release (`fig-start`, `fig-devtools`, `fig-vite` excluded as experimental, though a few findings landed in `fig-vite` where it implements fig-refresh's contract).

**Method.** 16 reviewer agents (each package × correctness / performance / API design, plus one release-readiness pass over packaging and exports) produced 80 raw findings. Every finding was then handed to an independent adversarial verifier instructed to refute it against the code on disk — several verifiers wrote and executed repro tests. The workflow was terminated before the last 7 verifiers finished; four findings remain unverified.

**Tally: 0 critical, 0 major, 4 minor confirmed · 4 unverified · 3 refuted.**

Severity scale: **critical** = corrupts state / crashes / silently breaks a headline feature in normal use; **major** = wrong behavior or serious cost in realistic use, or painful to fix post-release; **minor** = real but low-impact.

## Contents

- [Confirmed critical (0)](#confirmed-critical)
- [Confirmed major (0)](#confirmed-major)
- [Confirmed minor (4)](#confirmed-minor)
- [Unverified (4)](#unverified)
- [Refuted (3)](#refuted)

## Confirmed critical

No open confirmed critical findings remain.

## Confirmed major

No open confirmed major findings remain.

## Confirmed minor

### 28. AssetsOptions breaks the \*Props naming convention used by every other element-props type in the package

- **Location:** `packages/fig/src/resource.ts:102`
- **Severity:** minor
- **Reviewer:** fig:api-design

The props type of the assets() element is exported as `AssetsOptions` while its siblings on the same index.ts surface are `SuspenseProps`, `ActivityProps`, and `ErrorBoundaryProps` (element.ts). It is the same concept — the prop shape of a built-in element — with a different naming shape, and `Options` collides semantically with genuine options-bag types like `DataResourceOptions` and `ClientReferenceOptions` that configure factories rather than describe element props. Renaming after release requires a deprecation alias; renaming now is free.

<details><summary>Verification</summary>

Confirmed against packages/fig/src/resource.ts:102 and element.ts. AssetsOptions is the props type parameter of the built-in Assets element (assets() returns FigElement<AssetsOptions>), identical in role to SuspenseProps/ActivityProps/ErrorBoundaryProps, yet named with the Options suffix. No function takes AssetsOptions as an argument, so it is not an options bag, while ClientReferenceOptions and DataResourceOptions on the same public surface (index.ts) genuinely are — the semantic collision is real. AssetsOptions is publicly exported (src/index.ts:83, dist/index.d.ts). No naming rationale exists in concepts/ or docs/ (concepts/assets.md only documents the assets() factory), so this is not an intentional documented divergence. Mitigating nuance: the Assets component itself is not exported, so users construct the element via the positional assets() factory and rarely name this type directly — which caps the impact at a naming-consistency cost, not a functional one. Rename is currently a trivial change; after wider release it would require a deprecation alias.

</details>

---

### 30. Capability-group enforcement is inconsistent: hydration and Activity groups fail loudly, but the portal and hoisted-asset groups the spec claims are "enforced at runtime with clear errors" fail silently when partially implemented.

- **Location:** `packages/fig-reconciler/src/index.ts:342`
- **Severity:** minor
- **Reviewer:** fig-reconciler:api-design

concepts/renderer-authoring.md states every optional capability group is "enforced at runtime with clear errors when the feature is first used (hydration, Activity visibility, portals, hoisted assets)". Hydration (requireHydrationHostConfig, index.ts:1693) and Activity (index.ts:4509, :2056) do throw. But: (a) a host defining `isHoistedInstance` without `commitHoistedInstance` silently skips acquisition — acquireHoistedInstance (index.ts:3644) is `host.commitHoistedInstance?.(instance) ?? instance`, so hoisted fibers are marked committed but never attached to the document, and removal (index.ts:3733 `removeHoistedInstance?.`) silently leaks; (b) portals never check anything — commitPortal (index.ts:3500) optional-chains preparePortalContainer and portal children are inserted via plain insertBefore into the user-supplied target, so a renderer without portal support crashes inside its own insertBefore with a host-specific error instead of "Portals are not supported by this renderer." The type layer reinforces the trap: HostHydrationConfig wraps its Pick in Required<> (line 304) so TS enforces completeness, while HostHoistedAssetConfig/HostPortalConfig/HostActivityConfig/HostSuspenseHydrationConfig (lines 316-348) are Picks of optional members, so a config typed as the group can omit members without any compile- or run-time signal.

<details><summary>Verification</summary>

Verified against packages/fig-reconciler/src/index.ts as it exists: only two capability errors exist in the whole file ("Hydration is not supported by this renderer." at line 1693 and "Activity is not supported by this renderer." at line 4509, plus an Activity-hydration message at 2056), while concepts/renderer-authoring.md lines 12-14 claim runtime enforcement with clear errors for all four groups including portals and hoisted assets. The hoisted half is confirmed concretely: hoisted fibers skip host.insertBefore (lines 3480-3486) and rely on acquireHoistedInstance, where line 3644 is `host.commitHoistedInstance?.(instance) ?? instance`; since that path is only reachable when host.isHoistedInstance returned true, the optional chain has no legitimate absence case — a host defining isHoistedInstance without commitHoistedInstance gets fibers marked committed but instances never attached, silently. removeHoistedInstance is likewise optional-chained (3736, 3763). Type-layer claim confirmed: HostHydrationConfig wraps Required<> (line 304) while the other group aliases (316-348) are Picks of optional members. Tests pin only the hydration error (index.test.ts:515). The portal half is overstated: portal children insert via required-core insertBefore into props.target, and preparePortalContainer/removePortalContainer are auxiliary hooks, so a core-only host gets mostly-working portals rather than a guaranteed crash — for portals the defect is mainly that the spec sentence is inaccurate. fig-dom, the only in-repo host, implements all members, so only third-party renderer authors are exposed. Real spec/code mismatch plus a silent partial-config failure mode; minor severity is accurate.

</details>

---

### 33. The refresh-error row tag is absent from the concepts/payload.md row model (the declared stable contract), and its throw-through-the-decoder delivery drops buffered rows

- **Location:** `packages/fig-server/src/payload.ts:158`
- **Severity:** minor
- **Reviewer:** fig-server:api-design

PayloadRow (exported, documented as "the stable contract") includes { boundary; tag: "refresh-error" } but concepts/payload.md:30-44 lists only model/client/data/assets/error/refresh — the spec that codec authors and framework integrators are told is authoritative omits a tag the server emits on every failed refresh (payload.ts:1140-1145). Mechanically, processRow signals it by throwing errorFromPayload out of the codec's onRow callback (payload.ts:780-783): jsonPayloadCodec's processBufferedLines then discards the buffered partial tail line (payload.ts:431-436), so the first row of the next chunk is truncated and also lost, and readByteStream stops consuming, dropping all later rows. It also imposes an undocumented requirement on custom PayloadCodec implementations: onRow may throw and the decoder must propagate it while still processing sibling lines — jsonPayloadCodec does this carefully, but nothing in the PayloadCodec docs tells a codec author to.

<details><summary>Verification</summary>

Verified against payload.ts and concepts/payload.md as they exist on disk. Confirmed: (1) PayloadRow (payload.ts:143-159) is doc-commented as "the stable contract" and includes tag "refresh-error" (line 158), emitted on every failed refresh root (payload.ts:1140-1145, pinned by test payload.test.ts:1522-1538), yet the concepts/payload.md:29-44 row-tag list — the declared authoritative spec — lists only model/client/data/assets/error/refresh; git shows refresh-error landed in commit e0fbe19 without the concept-file update the project's CLAUDE.md requires. (2) PayloadCodec/PayloadDecoder docs (payload.ts:278-292) never say onRow may throw, though jsonPayloadCodec must handle it carefully (firstError pattern at 416-438) — an undocumented requirement on custom codec authors. Partially refuted: the "throw drops buffered rows" mechanics are accurate but by design, not a runtime bug — fetchPayload rejects with the decoded server error and fig-start catches it (client.ts:887-894, reportPayloadFetchError); notify() fires before the throw; the dropped later rows are fill-ins for a refresh model that was never applied, so no user-visible correctness failure. Net: a real spec/contract documentation gap for a package whose concepts/ docs are the declared spec, not a functional defect.

</details>

---

### 40. li/dd/dt auto-close diagnostic resets list scope on non-special ancestors, missing re-parenting through formatting elements

- **Location:** `packages/fig/src/dom-nesting.ts:162`
- **Severity:** minor
- **Reviewer:** fig:correctness

invalidAncestorFor sets `inListScope = false` for any ancestor that is not address/div/p. But the HTML li/dd/dt start-tag algorithm only breaks its stack walk on elements in the _special_ category (excluding address/div/p); non-special formatting/phrasing elements like span, b, em, a continue the walk. So for `<ul><li><span><li>…` the parser closes the outer <li> and re-parents, producing DOM that differs from the fiber tree, yet validateInstanceNesting reports nothing: at ancestor 'span' the code clears inListScope, so the subsequent 'li' ancestor check at line 150 is skipped. The result is a false negative in the dev diagnostic — SSR output and client expectations silently diverge and surface later as an unexplained hydration mismatch instead of the intended clear 'Invalid DOM nesting: <li> cannot appear inside <li>' error. The reset condition should additionally require the ancestor to be in the special category before clearing inListScope.

<details><summary>Verification</summary>

Confirmed against dom-nesting.ts as on disk: line 162 clears inListScope for any ancestor other than address/div/p, so a non-special ancestor like span between two li elements suppresses the check at line 150. Per the HTML spec's li/dd/dt start-tag algorithm, the stack walk only breaks on special-category elements (excluding address/div/p); span/b/em are not special, so browsers auto-close the outer li in <ul><li><span><li> and re-parent — the diagnostic silently misses this, a false negative. Not handled elsewhere: diagnostics.test.ts covers the div-intervening and nested-ul cases but nothing pins the span case; no upstream guard. Not a documented divergence: concepts/rendering.md claims the checks model li/dd/dt implied end tags, and the inline comment claims to encode the spec rule but encodes it incompletely. Mitigating: React's validateDOMNesting has the identical clearing rule, so this is inherited React behavior, and the failure mode is dev-only and a missed error (never a wrong throw) affecting an unusual markup pattern that only bites SSR+hydration (client-only rendering builds the DOM imperatively and works). Severity minor is correct.

</details>

---

## Unverified

These findings were reported by reviewers but their verification agents never completed. Treat as plausible, not confirmed.

### 1. isWithinSuspenseBoundary tests boundary membership with an O(subtree) recursive walk that allocates an array per DOM node, on a path that runs per dehydrated boundary per event during the hydration window.

- **Location:** `packages/fig-dom/src/suspense-markers.ts:124`
- **Severity:** major
- **Reviewer:** fig-dom:performance
- **Status note:** Never verified — workflow terminated first.

containsNode (suspense-markers.ts:124-132) recurses through every descendant, calling Array.from(parent.childNodes) at each node, and isWithinSuspenseBoundary (line 107) invokes it for each top-level sibling between the boundary markers. The reconciler calls this from findDehydratedSuspenseBoundaryForTarget for every fiber with a dehydrated suspense state, on every hydration-eligible event -- including continuous mousemove/pointermove/scroll fired at 60-120Hz while the page is still streaming/hydrating (exactly when the main thread is busiest). For a pending boundary wrapping a large subtree (e.g. a streamed page body with thousands of nodes), each mousemove costs O(subtree nodes) node visits plus one array allocation per node, repeated per dehydrated boundary, and the walk usually MISSES (target outside the boundary) so the full cost is paid every time. The equivalent check is O(depth) with zero allocation: walk event.target's parentNode chain up to the boundary's container and test whether the encountered top-level ancestor sits between boundary.start and boundary.end (or use native Node.contains with the current code as a duck-typed fallback for test doubles).

---

### 2. Fig elements inside Map/Set prop values are silently serialized as plain objects, corrupting the decoded value

- **Location:** `packages/fig-server/src/payload.ts:1450`
- **Severity:** major
- **Reviewer:** fig-server:correctness
- **Status note:** Never verified — workflow terminated first.

serializeValue delegates `value instanceof Map || value instanceof Set || value instanceof Date` wholesale to encodePayloadValueInternal, which has no handling for elements, thenables, or client references — those renderer-level types are only intercepted for top-level values, arrays, and plain objects (whose encodeChild is serializeValue). An element inside a Map/Set (e.g. `<Widget data={new Map([["el", <div>hi</div>]])} />`) reaches serializePlainObject, passes the prototype check (elements are Object.prototype literals; the $$typeof symbol key is skipped by Object.entries), and encodes as `{$fig:"object", id, value:{type:"div", key:null, props:...}}`— confirmed by repro. The client decodes a plain`{type,key,props}` object instead of an element, with no error anywhere, violating concepts/payload.md's contract that the payload renderer serializes Fig elements in server-component values into row references (and that shared graphs span Map, Set, and rendered elements). Promises/client references inside Map/Set at least throw, but with the misleading generic "Cannot serialize ..." error rather than being outlined like their top-level counterparts.

---

### 3. isLikelyComponentType is an orphan export with no consumer, and its acceptance criteria contradict the runtime's own registration policy

- **Location:** `packages/fig-refresh/src/index.ts:108`
- **Severity:** minor
- **Reviewer:** fig-refresh:api-design
- **Status note:** Never verified — workflow terminated first.

Nothing in the repo consumes it except this package's own test: fig-vite's transform uses its own build-time AST heuristic (isComponentName in packages/fig-vite/src/transform.ts), and no other package imports it. Meanwhile the runtime itself accepts far more than this predicate does — asKey (line 25) registers any function OR plain object, and anonymous functions (type.name.length === 0) register fine — so tooling that uses isLikelyComponentType as a pre-filter for register() will silently skip types the runtime fully supports (anonymous/default-export arrow components, object-typed component wrappers). Shipping this in 0.0.1 locks an unused, inconsistent heuristic into the public surface where removing it later is a breaking change; per concepts/architecture.md's 'every export has one home', it currently has no home at all.

---

### 4. scheduleDehydratedSuspenseRetries walks the entire committed tree on every commit, even for pure client roots that can never have dehydrated boundaries

- **Location:** `packages/fig-reconciler/src/index.ts:3207`
- **Severity:** minor
- **Reviewer:** fig-reconciler:performance
- **Status note:** Never verified — workflow terminated first.

commitRoot unconditionally calls scheduleDehydratedSuspenseRetries(root) (line 3145), which runs collectRetriableDehydratedSuspense over root.current.child via walkFiberForest — a full-tree traversal returning true (descend) for every non-dehydrated fiber. Roots created with createRoot (or hydration roots after all boundaries hydrate) contain zero dehydrated boundaries, yet every commit — every keystroke — pays an O(total fibers) pointer walk plus a stack allocation. A per-root counter of live dehydrated Suspense states (incremented in tryDehydrateSuspenseBoundary, decremented on hydration/removal, mirroring the existing hiddenStates pattern) would skip this walk entirely in the common case.

## Refuted

Reported by reviewers but overturned by adversarial verification.

### 1. injectScheduleRefresh accumulates schedulers into a Set with no removal API, and its add-semantics diverge from every sibling wiring seam

- **Location:** `packages/fig-refresh/src/index.ts:75`
- **Severity:** minor
- **Reviewer:** fig-refresh:api-design

The three refresh wiring points across packages use three shapes for the same concept: reconciler setRefreshHandler(handler | null) replaces and is nullable (uninstallable), fig-dom configureDomRefreshScheduler(fn) replaces, and fig-refresh injectScheduleRefresh(fn) appends to a module-global Set (line 21) with no unsubscribe or reset. A dev bootstrap or custom-renderer integration whose module re-evaluates during the session and passes a fresh closure (identity differs, so Set dedupe does not help) leaves the stale scheduler dispatching every subsequent RefreshUpdate into torn-down roots for the rest of the dev session, with no escape hatch to detach. Adding removal later is additive, but the naming/semantics inconsistency (set vs configure vs inject; replace vs accumulate) is baked in at first publish.

**Why refuted:** The surface facts check out: fig-refresh/src/index.ts line 21 is an add-only module-global Set, line 75-80 has no removal API, and the sibling seams (reconciler setRefreshHandler nullable-replace, fig-dom configureDomRefreshScheduler replace) do differ in shape. But the concrete failure scenario cannot occur through any in-tree path. The only production caller of injectScheduleRefresh is the fig-vite virtual module (packages/fig-vite/src/index.ts:63), which passes `scheduleRefresh` — a stable, module-level named export of @bgub/fig-dom/refresh, not a per-evaluation closure. If that virtual module ever re-evaluates during an HMR session, its import resolves to the same cached module instance, so the identical function is re-added and the Set dedupes it; a full page reload resets the entire module graph including the Set. The DOM side already handles renderer-instance replacement via configureDomRefreshScheduler's replace semantics, so a "fresh closure per evaluation" never reaches the Set. The scenario therefore requires a hypothetical third-party custom-renderer integration that both re-evaluates without a page reload and passes a new closure each time — misuse the stack's own pattern (stable forwarder + replaceable slot, exactly what fig-dom/refresh.ts implements) is designed to avoid. The accumulate-vs-replace divergence is also not an accident: injectScheduleRefresh is the fan-out point that broadcasts one RefreshUpdate to N renderers (performRefresh loops the Set at line 104), while the other two seams are single-renderer slots, so the differing semantics reflect differing roles. Naming ("inject") matches react-refresh's injectIntoGlobalHook precedent, which likewise has no un-inject. Everything is dev-only HMR runtime code. What remains is a taste-level API-consistency note with no reachable failure, and the reviewer concedes removal can be added additively later.

---

### 2. preloadData silently resets a cached rejection back to pending, bypassing the documented invalidate-to-retry contract

- **Location:** `packages/fig/src/data-store.ts:402`
- **Severity:** minor
- **Reviewer:** fig:api-design

data.md documents invalidateData/invalidateDataError as the way a cached rejection is cleared ('so a remounted ErrorBoundary retries afresh'), and readData deliberately rethrows a stored rejection without retrying. But preloadData's guards (data-store.ts:411-412) only skip when a load is pending or the entry is fresh-fulfilled — a `rejected` entry falls through to startLoad, which flips entry.status to "pending" and clears the error on the entry (the fulfill path then schedules all subscribers). So an unrelated speculative preload (e.g. a hover-intent preload of the same key) silently erases the error state an ErrorBoundary and invalidateDataError-based recovery UI are built around, re-running a loader the docs say 'does not auto-retry'. Either document preload-retries-rejections as part of the freshness contract or make preloadData respect the rejected state like reads do; changing it after release alters observable retry behavior.

**Why refuted:** Verified the code mechanics in packages/fig/src/data-store.ts: preloadData (lines 402-418) does fall through to startLoad for a settled rejected entry, flipping it to pending and re-running the loader, with fulfill clearing entry.error. But the finding's contract claim and failure scenario both fail. (1) The 'no auto-retry' invariant in concepts/data.md (lines 135-136) is explicitly scoped to reads; preloadData is listed in data.md (line 154-155) among the imperative verbs alongside refreshData, which also deliberately re-runs a rejected loader — an explicit preload call for a key is a re-arm, not an auto-retry, and there is no storm risk. The guard structure (retry stale, skip only fresh) shows preload semantics are 'ensure fresh or loading', making rejected-entry retry consistent by design. (2) The claimed breakage of invalidateDataError-based recovery cannot occur: error→key attribution is stored on the error object via markDataResourceError (lines 644/718), so the boundary's caught error still resolves and invalidates the key after any preload retry; the errored subtree already unmounted so no subscriber is spuriously scheduled, and a successful retry only makes recovery succeed faster. (3) data.md's invalidate text describes what invalidate does, not that it is the sole rejection-clearing path, and no test pins preload-skips-rejected behavior. What remains is at most a one-line documentation clarification, not a confirmed defect with a concrete failure or cost.

---

### 3. Malformed events/bind/unsafeHTML props on an update throw during the commit mutation phase instead of before commit.

- **Location:** `packages/fig-dom/src/events.ts:746`
- **Severity:** minor
- **Reviewer:** fig-dom:correctness

eventDescriptors throws for a non-array events value (e.g. `events={on("click", fn)}` without the array wrapper, from untyped JS), and updateBind (bind.ts:117) / unsafeHTMLValue (props.ts:422) throw similarly. On initial mount these fire in finalizeInitialInstance (render phase, catchable by error boundaries per the 'diagnostics throw before commit' stance in concepts/rendering.md), but on updates they fire inside commitUpdate → commitHostMutation (fig-reconciler/src/index.ts:3451), aborting the commit mid-mutation and routing to onUncaughtError after part of the tree has already been mutated. A prop that was valid on mount and becomes malformed on a later render (conditionally built events array that degrades to a single descriptor) hits the harsher, partially-committed path. Low likelihood with TypeScript, but it violates the documented throw-before-commit contract.

**Why refuted:** Verified the throw sites (eventDescriptors at fig-dom/src/events.ts:746, called from updateElement in both finalizeInitialInstance and commitUpdate), then traced both error paths in fig-reconciler/src/index.ts. The finding's core premises fail: (1) The mount-path throw is NOT boundary-catchable — finalizeInitialHostInstance runs in complete()/completeUnit (lines 2833, 1294-1302), and performUnit only wraps begin() in the try/catch that routes to captureErrorBoundary (lines 1261-1265); complete-phase errors escape to performRoot's catch and go to onUncaughtError, the same terminal path as the update case, so the claimed mount/update asymmetry does not exist. (2) No partially-committed tree persists — performRoot's catch calls clearRootAfterUncaughtError (line 3308), which clears the entire container, so mount and update produce identical user-visible outcomes (onUncaughtError + full root teardown). (3) The 'throw before commit' contract in concepts/rendering.md (Pre-Commit Diagnostics, lines 58-70) explicitly enumerates duplicate keys, invalid children, render-phase state updates, and invalid DOM nesting; host prop shape validation is not part of the documented contract, so no spec violation. No test pins the behavior either way. What remains true — the throw happens during the commit phase on updates — has no differential consequence and no contract breach, so the finding's failure scenario cannot occur as described.
