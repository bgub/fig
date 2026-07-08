# Fig pre-release review — 2026-07-07

Multi-agent review of `fig`, `fig-dom`, `fig-reconciler`, `fig-refresh`, and `fig-server` ahead of the planned release (`fig-start`, `fig-devtools`, `fig-vite` excluded as experimental, though a few findings landed in `fig-vite` where it implements fig-refresh's contract).

**Method.** 16 reviewer agents (each package × correctness / performance / API design, plus one release-readiness pass over packaging and exports) produced 80 raw findings. Every finding was then handed to an independent adversarial verifier instructed to refute it against the code on disk — several verifiers wrote and executed repro tests. The workflow was terminated before the last 7 verifiers finished; four findings remain unverified.

**Tally: 0 critical, 0 major, 34 minor confirmed · 4 unverified · 3 refuted.**

Severity scale: **critical** = corrupts state / crashes / silently breaks a headline feature in normal use; **major** = wrong behavior or serious cost in realistic use, or painful to fix post-release; **minor** = real but low-impact.

## Contents

- [Confirmed critical (0)](#confirmed-critical)
- [Confirmed major (0)](#confirmed-major)
- [Confirmed minor (44)](#confirmed-minor)
- [Unverified (4)](#unverified)
- [Refuted (3)](#refuted)

## Confirmed critical

No open confirmed critical findings remain.

## Confirmed major

No open confirmed major findings remain.

## Confirmed minor

### 1. updateEvents eagerly performs two full ancestor DOM walks (rootFor + listenerTargetFor) per event-bearing element on every commit, wasted in the common case where only callbacks are swapped.

- **Location:** `packages/fig-dom/src/events.ts:308`
- **Severity:** minor
- **Reviewer:** fig-dom:performance

Since events arrays are written inline (events={[on(...)]}) they fail the reconciler's identity diff (hostPropsChanged, fig-reconciler/src/index.ts:3077) on every re-render, so commitUpdate -> updateElement -> updateEvents runs for every event-bearing host element on every render that touches it. updateEvents (events.ts:305-309) computes rootFor(element) -- which internally walks the full parentNode chain via listenerTargetFor -- and then calls listenerTargetFor(element) again, a second full ancestor walk. Both results are only consumed by addEventSlot when a slot is created or its key changes; in the steady state every slot key matches and only slot.callback is reassigned (line 336-338), so both O(depth) walks are pure waste. For a deep tree (depth 30+) re-rendering many event-bearing elements, this adds O(elements x depth) parentNode hops per commit. Computing root/listenerTarget lazily on the first slot add/re-key (and sharing the single walk between the two values, since rootFor is derived from listenerTargetFor anyway) removes the cost from the common path.

<details><summary>Verification</summary>

Verified every link: (1) hostPropsChanged (fig-reconciler/src/index.ts:3071) uses identity comparison, so inline events arrays set UpdateFlag on every re-render; commitUpdate -> updateElement (fig-dom/src/props.ts:50-54) calls updateEvents unconditionally whenever the events prop exists, with no identity bail-out. (2) updateEvents (fig-dom/src/events.ts:305-309) eagerly computes rootFor(element) and listenerTargetFor(element); rootFor internally calls listenerTargetFor (lines 365-373), and listenerTargetFor (lines 999-1015) is an unmemoized parentNode walk to the nearest registered container, so two O(depth) walks per event-bearing element per commit. (3) Both values are consumed only by addEventSlot in the slot-undefined / key-changed branches; in the steady state only slot.callback is reassigned (lines 336-338), so the walks are pure waste. Production path, no NODE_ENV gate, no cache elsewhere. Cost is real but modest (pointer hops, comparable to other per-update work like the Set allocation in updateElement), so it stays a micro-optimization rather than a user-visible regression.

</details>

---

### 2. visitElementSubtree allocates Array.from(node.childNodes) at every node, so every insertBefore/removeChild host op allocates one array per DOM node in the moved subtree.

- **Location:** `packages/fig-dom/src/tree.ts:11`
- **Severity:** minor
- **Reviewer:** fig-dom:performance

attachSubtree/detachSubtree (attachment.ts) run on every host insertBefore, removeChild, clearContainer, hide/unhide, and asset attach (index.ts:176-187), and visitElementSubtree snapshots childNodes into a fresh array at every level of the recursion -- including for text nodes and elements with no bind/event slots. On initial mount the entire tree is walked once with one array allocation per node; on keyed list reorders each MOVED item is re-inserted and its whole subtree re-walked (the per-element work is two WeakMap gets that early-return, but the allocations remain), so reordering m items of k nodes each costs O(m\*k) array allocations per commit. The visitor never mutates siblings during attach, so iterating via firstChild/nextSibling (capturing next before visiting, as clearContainer already does) eliminates all per-node allocation; live-mutation safety is only needed on the detach path.

<details><summary>Verification</summary>

Verified tree.ts:11 allocates Array.from(node.childNodes ?? []) at every recursion level, and attachSubtree/detachSubtree (attachment.ts) are invoked from the production host-config insertBefore/removeChild/clearContainer (index.ts:167,182,185) and asset attach/detach (asset-resources.ts:103,149) — no NODE_ENV gate, so one short-lived array per DOM node per moved/removed subtree per commit is real, including for text nodes and slot-free elements (bind.ts/events.ts attach helpers are WeakMap-get early-returns). Two detail errors: (1) hide/unhide do not use this walk — index.ts:214-227 call suspendBind/resumeBind per instance; (2) the claim that the attach path never mutates siblings is wrong — attachBindSlot (bind.ts) synchronously runs user bind callbacks that can mutate the DOM, so the snapshot is load-bearing for robustness and the proposed firstChild/nextSibling fix is not trivially safe on attach either. Cost is young-gen array churn only, no correctness impact, no measurable regression demonstrated — minor is the correct severity.

</details>

---

### 3. Controlled/defaulted select maintenance is O(n^2): every live option insertion and every option commitUpdate triggers a full recursive rescan of all descendant options.

- **Location:** `packages/fig-dom/src/props.ts:119`
- **Severity:** minor
- **Reviewer:** fig-dom:performance

Host insertBefore calls updateParentSelect for each inserted option (index.ts:181), and updateElement calls updateParentSelect after every commitUpdate of an option/optgroup (props.ts:119). Each call runs setSelectValue (props.ts:487), which rebuilds the values Set and re-walks ALL options via descendantOptions (props.ts:511-523) -- a recursive scan using Array.from(childNodes) plus options.push(...spread) per optgroup -- then rewrites `selected` on every option, and currentOptionValue runs a regex-replace on textContent for every implicit-value option. Appending n options to a live controlled select (e.g. an async-loaded 1000-entry country/typeahead list) therefore costs n scans of up to n options = O(n^2) node visits with per-node allocation in one commit; likewise re-rendering a controlled select whose n option labels all change performs n full rescans. Batching to one setSelectValue per select per commit (e.g. a pending-selects set flushed once), or at least skipping the scan when the inserted option's own value does not match state.value for single-selects, collapses this to O(n).

<details><summary>Verification</summary>

Verified all three legs against the code on disk. (1) Reconciler commitPlacement/insertHostSubtree (fig-reconciler/src/index.ts:3488, 3518) call host.insertBefore once per placed host node with no batching, and fig-dom's insertBefore (index.ts:181) calls updateParentSelect for every option-like child. (2) For a controlled select, updateParentSelect (props.ts:463-485) passes both guards and always runs setSelectValue, which recursively collects ALL descendant options (descendantOptions, props.ts:511-523, with Array.from + spread allocation), rewrites selected on each, and regex-processes textContent for implicit-value options — so inserting n options into a live controlled select is n full scans = O(n²). (3) props.ts:119 calls updateParentSelect after every commitUpdate of an option/optgroup, so n option value-prop updates in one commit also rescan n times. Not dev-gated, no test pins batching, no pending-selects flush exists. Mitigations confirmed: uncontrolled selects early-return after appliedDefault, and initial mount is O(n) because select state is unset during render-phase assembly (appendInitialChild returns early; finalize applies once). One sub-example is overstated: pure label (text-child) changes go through commitTextUpdate, not option commitUpdate, but the insertion and value-prop cases fully stand. Perf-only, scoped to controlled selects with large dynamic option lists, final state correct — minor is the honest severity.

</details>

---

### 4. getFamilyByType duplicates @bgub/fig-reconciler/refresh's refreshFamilyFor, publishing two homes for the same lookup

- **Location:** `packages/fig-refresh/src/index.ts:40`
- **Severity:** minor
- **Reviewer:** fig-refresh:api-design

The reconciler's dev seam already exports refreshFamilyFor(type) (packages/fig-reconciler/src/refresh.ts:31), which routes through the installed handler and is the documented way for renderers/devtools to resolve a family. getFamilyByType is exported from fig-refresh only because it doubles as the handler passed to setRefreshHandler (line 37) — no consumer outside fig-refresh's own tests imports it. Post-release this gives users two subtly different entry points for the same concept (one works only when the fig-refresh runtime specifically is installed; the other works with any handler), violating the repo's 'every export has one home' stance; it could be a non-exported function with tests exercising it via register/performRefresh.

<details><summary>Verification</summary>

Verified every factual claim: getFamilyByType is exported at fig-refresh/src/index.ts:40 solely because it doubles as the setRefreshHandler argument (line 37); repo-wide grep shows no importer outside fig-refresh's own index.test.ts (fig-vite's virtual module imports only injectScheduleRefresh/performRefresh/register/setSignature; fig-devtools does not use it). refreshFamilyFor exists at fig-reconciler/src/refresh.ts:31 as the handler-routed lookup seam, documented in concepts/renderer-authoring.md as the dev-only seam. concepts/architecture.md:9 states the one-home stance, and fig-refresh's README explicitly says the package is 'wiring, not an API you call from application code', naming only register/setSignature/performRefresh — so the extra public export contradicts the package's own documented surface. Tests could pin the behavior via register + performRefresh's returned RefreshUpdate instead. The only counterpoint is that the two functions live at different layers (delegating seam vs. concrete map lookup), so it is not a literal symbol-mirroring violation and has zero runtime cost — which caps this at an API-hygiene nit, not a bug. Concrete cost: shipping gratuitous semver-bound public API with duplicate, subtly divergent entry points for family lookup at first publish.

</details>

---

### 5. performRefresh silently discards the update when called before any scheduler is injected, unlike fig-dom's seam which buffers exactly this race

- **Location:** `packages/fig-refresh/src/index.ts:84`
- **Severity:** minor
- **Reviewer:** fig-refresh:api-design

performRefresh drains pendingUpdates, advances family.current for every queued version, and dispatches to whatever is in scheduleRefreshFns — if injectScheduleRefresh has not run yet, the update is computed and permanently lost (queue drained, families advanced, zero renderers notified, no warning). The mounted tree keeps rendering stale components with no way to replay. fig-dom's counterpart explicitly buffers pre-configuration updates for this reason (packages/fig-dom/src/refresh.ts:8-11: 'dropping those updates would silently skip a refresh'), so the two packages disagree on how the same ordering hazard is handled. The shipped fig-vite virtual module happens to inject at import time before any register call, but a non-Vite tooling author following the top-of-file comment ('calls performRefresh() from an import.meta.hot.accept handler') hits a silent-failure ordering contract that nothing enforces or reports.

<details><summary>Verification</summary>

Verified against packages/fig-refresh/src/index.ts:84-106: performRefresh drains pendingUpdates and advances family.current before dispatching to scheduleRefreshFns, with no buffering or warning when the Set is empty — confirmed no guard exists. Confirmed the asymmetry: packages/fig-dom/src/refresh.ts:27-34 buffers pre-configuration updates with an explicit comment that dropping them 'would silently skip a refresh'. Confirmed no test pins the empty-scheduler case (index.test.ts injects at module top) and no concepts/ file documents a refresh ordering contract. Also confirmed the shipped fig-vite virtual module (fig-vite/src/index.ts:63) always injects before performRefresh can run, so only non-Vite tooling authors are exposed. The finding overstates impact in one respect: the update is not 'permanently lost with no way to replay' — the reconciler swaps node.type via resolveLatestType on every render (fig-reconciler/src/index.ts:1776), so subsequent renders pick up new code; what is lost is the proactive re-render for that edit and the staleFamilies remount decision (the latter can cause a dev hook-order throw on a later in-place re-render). The failure is real but transient and only reachable via a mis-ordered custom integration, matching the claimed minor severity.

</details>

---

### 6. commitDataDependencies calls rootOf(cursor) — an O(depth) walk to the root — once per dirty fiber, and every rendered function component is dirty every commit

- **Location:** `packages/fig-reconciler/src/index.ts:3677`
- **Severity:** minor
- **Reviewer:** fig-reconciler:performance

prepareHookRender (lines 1816-1817) sets node.dataDependenciesDirty = true and root.needsDataDependencyCommit = true for every function component render, even ones that use no data resources. commitDataDependencies then visits each dirty fiber and calls rootOf(cursor).dataStore.commitDataDependencies(...) — rootOf walks the return chain to the RootTag for every dirty fiber, so a commit that rendered n function components at average depth d does O(n x d) extra pointer hops. The root is invariant for the whole walk and is already in hand at the call site (commitRoot line 3108 has root); it should be threaded in as a parameter. Skipping the dirty-marking when a component registered no data dependencies would also shrink the walk's work.

<details><summary>Verification</summary>

Confirmed against packages/fig-reconciler/src/index.ts as it exists: prepareHookRender (1816-1817) unconditionally sets dataDependenciesDirty on every function-component render via renderFunction (1778, production path), commitDataDependencies (3674-3688) calls rootOf(cursor) — an O(depth) return-chain loop (4331-4337) — once per dirty fiber during the commit-phase forest walk, and commitRoot (3107-3108) already holds the invariant root and could thread it in (sibling helpers like commitEffects already take root as a parameter). The cost is real and on the per-commit hot path, not dev-gated. It stays minor: it is pointer-chasing layered on an already O(n) walk, rootOf calls are pervasive elsewhere (render path itself calls rootOf 2-3x per component), and absolute cost is small except for very deep/large trees. The secondary suggestion (skip marking when no deps registered) is plausible but needs care around releasing the alternate's stale deps.

</details>

---

### 7. Each resolved suspense thenable triggers a full recursive walk of the committed tree to find its pinged boundaries

- **Location:** `packages/fig-reconciler/src/index.ts:4142`
- **Severity:** minor
- **Reviewer:** fig-reconciler:performance

attachSuspensePing stores pings in a WeakMap keyed by boundary fiber (root.suspendedBoundaries), so on settlement pingSuspenseBoundaries cannot enumerate it and instead pingCurrentSuspenseBoundaries recursively visits every fiber of root.current probing pings.get(node) and pings.get(node.alternate). With k thenables resolving (typical for streaming payload/data-heavy pages with many boundaries), this is O(k x total fibers) even though each thenable usually pings one or two boundaries. Keeping a small Set of boundary fibers alongside the WeakMap entry (validated against the current tree via alternate/return checks at ping time, as React's retryQueue does) would make each ping O(#pinged boundaries).

<details><summary>Verification</summary>

Confirmed against packages/fig-reconciler/src/index.ts: root.suspendedBoundaries is WeakMap<thenable, WeakMap<Fiber, Lanes>> (lines 612, 673-676), so on settlement pingSuspenseBoundaries (4134) cannot enumerate pinged boundaries and pingCurrentSuspenseBoundaries (4142-4160) recursively visits every fiber of root.current with two WeakMap probes each, no early exit, no batching across thenables, no NODE_ENV gate. The attach site is captureSuspenseBoundary (3988), the main thrown-thenable path, so k settling thenables cost k full-tree walks — the claimed O(k x total fibers) is accurate. Refutation attempts failed: not dev-only, no upstream guard, not recently changed (shape dates to commit 9f1e557), and concepts/ documents no intentional trade-off. The WeakMap-for-GC rationale doesn't hold strongly since entries are deleted at settlement; the suggested Set-plus-alternate-check fix is feasible. Severity stays minor: cheap pointer-chasing per fiber, settlements spread over time, no correctness impact — a scalability cost on large streaming/data-heavy pages, not measured jank.

</details>

---

### 8. Devtools emits a full deep snapshot of the entire tree — including per-host DOM attribute enumeration — on every commit (dev-only)

- **Location:** `packages/fig-reconciler/src/index.ts:5437`
- **Severity:** minor
- **Reviewer:** fig-reconciler:performance

emitDevtoolsCommit (correctly NODE_ENV-gated and hook-gated, so no production cost) rebuilds a complete FigDevtoolsFiberSnapshot tree per commit: one object per fiber, one object per hook (devtoolsHooks), a props copy per fiber (devtoolsProps), plus devtoolsHost calling getAttributeNames()/getAttribute() on every host DOM node, and root.dataStore.inspectDataEntries(). With a devtools hook installed, a keystroke in a large dev app allocates O(total fibers + hooks + DOM attributes) per commit, which will make first-release dev-with-devtools feel sluggish on big trees. Incremental snapshots scoped to non-adopted subtrees (the AdoptedFlag information is available at snapshot time before flags are cleared) or lazy host/hook detail on inspection would bound this.

<details><summary>Verification</summary>

Confirmed at packages/fig-reconciler/src/index.ts. emitDevtoolsCommit is invoked on every commit (line 3157-3159, gated by NODE_ENV !== 'production' && root.devtools, default true) and runs synchronously in the commit path before requestPaint. With a global hook installed it eagerly builds a full deep snapshot: snapshotDevtoolsFiber (line 5437) walks the entire current tree with no incremental/AdoptedFlag scoping, allocating per fiber a props copy (devtoolsProps, Object.entries copy), a per-hook snapshot array (devtoolsHooks walks the whole hook list), and devtoolsHost calls getAttributeNames()+getAttribute() on every host DOM node; the root snapshot also calls root.dataStore.inspectDataEntries(). Refutation attempts failed: no throttling/sampling anywhere, only inspection is lazy, the fig-devtools hook (packages/fig-devtools/src/hook.ts onCommitRoot) additionally retains up to 100 full deep snapshots (the finding slightly understates memory cost), no test bounds this, and no concepts doc documents full-snapshot-per-commit as an accepted trade-off. Cost only exists in dev with a devtools hook installed, which the finding already acknowledged; 'minor' is the correct severity.

</details>

---

### 9. Hook calls via member expressions (namespace imports) are invisible to the signature, so adding or removing such a hook re-renders in place with shifted hook slots

- **Location:** `packages/fig-vite/src/transform.ts:168`
- **Severity:** minor
- **Reviewer:** fig-refresh:correctness

The signature visitor requires `t.isIdentifier(callee)` (line 168), so `import * as Fig from "@bgub/fig"; Fig.useState(...)` inside a component contributes nothing to the signature key. If an edit adds or removes a `Fig.useState`/`Fig.useReactive` call while the identifier-called hooks stay the same, both versions produce identical keys, `isSignatureStale` (packages/fig-refresh/src/index.ts:125) returns false, and the in-place refresh renders with a different hook-slot count — throwing the reconciler's hookOrderError (or silently mis-aligning state) instead of remounting. react-refresh records `callee.property.name` for member-expression hook calls for exactly this reason. Low frequency because Fig examples use named imports, hence minor.

<details><summary>Verification</summary>

Verified against disk: transform.ts:168 requires t.isIdentifier(callee) in signatureFor, so member-expression hook calls (Fig.useState via namespace import) are excluded from the signature key; no MemberExpression handling exists anywhere in fig-vite/fig-refresh. Downstream, fig-refresh/src/index.ts isSignatureStale (lines 114-126) compares only key strings, so two versions differing solely by a namespace-called hook get identical keys and land in updatedFamilies (performRefresh line 96-98), causing an in-place re-render. The reconciler (fig-reconciler/src/index.ts lines 1790/1796/2795) throws hookOrderError on count mismatch with no catch-and-remount fallback in scheduleRefresh (index.ts:4407-4428). No test pins member-expression hook calls (transform.test.ts has none) and no concepts/ doc declares namespace-imported hooks unsupported — renderer-authoring.md:55 states hook-signature changes must remount. Failure is dev-only (HMR), requires an uncommon import style, and is recoverable by full reload, so minor is the correct severity.

</details>

---

### 10. Every commit of a data-reading fiber schedules and immediately cancels an unref'd 5-minute setTimeout per retained data key (delete-then-resubscribe ordering)

- **Location:** `packages/fig/src/data-store.ts:257`
- **Severity:** minor
- **Reviewer:** fig:performance

commitDataDependencies (line 193) first runs deleteDataOwner(previousOwner) (line 208), which for each committed key removes the sole subscriber and calls scheduleInactiveCleanup (line 257); with subscribers now 0, no pending load, and no preload timer, scheduleInactiveCleanup allocates a setTimeout(…, 300000) plus an unref probe (scheduleStoreTimer, line 1087). The resubscribe loop that runs immediately after (line 216) calls clearInactiveTimer, destroying the timer it just created. Net effect: one setTimeout + clearTimeout + unref-lookup pair per data key per commit for keys the component still reads — pure churn on the commit hot path (this fires on every re-render commit because the previous generation always holds the live subscription). Reordering to resubscribe the new owner before tearing down the previous owner, or deferring scheduleInactiveCleanup until after resubscription, eliminates it.

<details><summary>Verification</summary>

Verified the full chain against the code on disk. (1) fig-reconciler/src/index.ts:1816 sets dataDependenciesDirty=true in prepareHookRender on every hook-component render, and the commit walk (line 3677) calls dataStore.commitDataDependencies(cursor, cursor.alternate) — so this runs on every re-render commit of a data-reading fiber. (2) Subscriptions are established only in commitDataDependencies (data-store.ts:211/217), so on a re-render the alternate (previousOwner) always holds the live subscription. (3) deleteDataOwner(previousOwner) at line 208 removes the sole subscriber per key and calls scheduleInactiveCleanup (line 257); for the common settled-entry case (pending===null, no preload timer, subscribers now 0, default inactiveRetentionMs=300000 finite per line 89) the guard passes and scheduleStoreTimer (line 1087) allocates setTimeout(cb, 300000) plus an unref probe. (4) The resubscribe loop immediately after (line 216) calls clearInactiveTimer, clearTimeout-ing the just-created timer in the same synchronous commit. No batching/deferral exists in scheduleStoreTimer, the code is not NODE_ENV-gated, and no test pins this as intended. It is pure wasted allocation/syscall churn per still-read key per re-render commit with zero correctness impact (timer always cleared before firing); entries with in-flight loads or multiple subscribers skip it, which bounds the cost. Minor severity is honest.

</details>

---

### 11. commitDataDependencies allocates a Set and runs full owner teardown for every rendered function component per commit, including components that never read data

- **Location:** `packages/fig/src/data-store.ts:200`
- **Severity:** minor
- **Reviewer:** fig:performance

The reconciler marks every rendered function-component fiber data-dirty unconditionally (fig-reconciler/src/index.ts prepareHookRender sets dataDependenciesDirty and needsDataDependencyCommit on every hook render), so DefaultDataStore.commitDataDependencies runs once per rendered fiber per commit. For the common no-data-reads case it still allocates `new Set()` (line 200) and performs ~6-8 WeakMap operations (pendingOwnerKeys.get/delete, ownerKeys.get for owner and previousOwner via collectSubscribedEntries and two deleteDataOwner calls) before discovering there is nothing to do. An early return when `pendingOwnerKeys.get(owner)` and both `ownerKeys.get(owner)`/`ownerKeys.get(previousOwner)` are absent — and lazy allocation of orphanCandidates only when a subscribed entry is found — would drop this to two WeakMap reads for the majority of fibers in a large commit.

<details><summary>Verification</summary>

Confirmed on disk: prepareHookRender (fig-reconciler/src/index.ts:1816-1817) marks every rendered function component data-dirty unconditionally, and DefaultDataStore.commitDataDependencies (fig/src/data-store.ts, Set allocation at the cited line) has no early return — it always allocates a Set and performs ~7 WeakMap ops (pendingOwnerKeys.get/delete, ownerKeys.get via collectSubscribedEntries for owner+alternate, two deleteDataOwner calls) even when the fiber never read data. The proposed early-out is valid. However, the finding overstates the 'common no-data-reads case': roots use a lazy store wrapper (createRootDataStore, fig-reconciler:846/5088) whose commitDataDependencies is `inner?.commitDataDependencies(...)` — a no-op until the app performs any data operation. So apps with zero data usage pay essentially nothing; the per-fiber cost only applies to apps that use data resources somewhere, where non-data-reading fibers then pay it every commit in production. It is a real constant-factor commit-phase overhead, dominated by render/reconcile cost, with no algorithmic blowup.

</details>

---

### 12. invalidateDataPrefix re-encodes the prefix (and rebuilds path strings) for every entry in the store instead of encoding it once

- **Location:** `packages/fig/src/data-store.ts:918`
- **Severity:** minor
- **Reviewer:** fig:performance

invalidateDataPrefix (line 388) loops over all entries calling dataResourceKeyStartsWith, which calls `encodeValue(prefix[index], `prefix[${index}]`)` inside the per-entry loop (lines 916-919) — the identical prefix elements are re-serialized (with fresh template-literal path strings) once per stored entry, O(entries × prefix elements) encodings per invalidation. It also re-encodes each entry's own key elements even though `entry.canonicalKey` already holds the canonical encoding (a startsWith comparison against the prefix's canonical form minus the closing bracket, checking the next char is ',' or ']', would need zero per-entry encoding). Invalidation is event-driven rather than per-render, so impact is bounded, but a broad-prefix invalidation over a store with hundreds of entries and object-bearing keys does hundreds of redundant deep encodes.

<details><summary>Verification</summary>

Verified against /Users/bgub/code/fig/packages/fig/src/data-store.ts as it exists on disk. The structure is exactly as claimed: `invalidateDataPrefix` (line 388) normalizes the prefix once via `normalizeKey` — but then discards the canonical string it just computed (`.key` is extracted, `.canonical` is thrown away) and loops over every entry in `this.entries` calling `dataResourceKeyStartsWith(entry.key, normalizedPrefix)`. That helper (lines 910-926) calls `encodeValue(prefix[index], \`prefix[${index}]\`)` inside its per-element loop, so identical prefix elements are re-serialized (with fresh template-literal path strings) once per stored entry — O(entries × prefix length) encodings. It also re-encodes each entry's own key elements (`encodeValue(key[index], ...)`) even though `entry.canonicalKey`(set at line 581 from the same deterministic`encodeArray`encoding, sorted object keys and all) already holds the canonical form, so the reviewer's proposed zero-encode string comparison (prefix canonical minus trailing`]`, next char `,`or`]`) is valid. `encodeValue`on object/array key elements is a deep recursive encode with`Object.keys().sort()` and JSON.stringify, so the redundant cost is real for object-bearing keys. Mitigating factors the reviewer already conceded: the API is event-driven (public mutation-side helper, line 129; not called during render), stores are typically small, behavior is correct (tests at data-store.test.ts:244,293 pin matching semantics, not cost), and nothing is quadratic in key size. So it is a genuine but bounded inefficiency — a correct, honest "minor" perf finding, not overclaimed and not refutable on the facts.

</details>

---

### 13. Key canonicalization eagerly builds per-element diagnostic path strings on every readData in production

- **Location:** `packages/fig/src/data-store.ts:1020`
- **Severity:** minor
- **Reviewer:** fig:performance

encodeArray (line 1019-1021) constructs a `${path}[${index}]` template string for every key element on every call, and encodeObject does the same per property (line 1039), but these path strings are only ever used inside thrown error messages for invalid keys. normalizeKey runs on the hottest data path — every readData/preloadData in every component render re-canonicalizes the key (the per-read encode itself is the documented contract in concepts/data.md) — so a k-element key pays k string allocations plus a closure and intermediate array per read purely for error-path diagnostics. Passing structural position lazily (e.g., computing the path only inside the throw branches, or a validate-then-encode split) removes the allocations without changing the canonical format.

<details><summary>Verification</summary>

Confirmed against /Users/bgub/code/fig/packages/fig/src/data-store.ts. readData (line 425) and preloadData (line 408) call entryFor, which calls normalizeKey -> encodeArray(key, "key") at line 526 with no NODE_ENV gate; only the fingerprintFor call is dev-gated (lines 529-532, with a comment showing the team already cares about prod encode cost). encodeArray (line 1020) eagerly builds `${path}[${index}]` per element and encodeObject builds `${path}.${key}` per property (line 1039), yet `path` is consumed only inside throw branches (lines 1026, 1036, 1056, 1063) — on the success path every path string is allocated and discarded. concepts/data.md confirms per-read canonical re-encoding is the documented contract, so this runs on every readData in every component render in production. No lazy-path variant or upstream guard exists; no test pins the allocation behavior (only the canonical format). The finding stands, but the cost is a constant-factor micro-allocation on top of an encode that must run anyway (JSON.stringify + join per element), and keys are typically short arrays — so it is a legitimate micro-optimization, correctly rated at the lowest severity.

</details>

---

### 14. Every refresh row wipes the decoded cache of ALL chunks, forcing a full re-decode and full client re-render of the entire payload tree per refresh.

- **Location:** `packages/fig-server/src/payload.ts:769`
- **Severity:** minor
- **Reviewer:** fig-server:performance

processRow's refresh branch calls this.invalidateDecodeCaches(), which clears decodedBoundaries and sets hasDecoded=false/decoded=undefined on every chunk in this.chunks (lines 824-830). The next render after notify() re-decodes every model row via readChunk (line 905-908), allocating a fresh element tree with new identities for the whole app, so the reconciler bailout that the readChunk comment and concepts/payload.md line 111 promise ('Decoded chunks are memoized so unchanged subtrees bail out of re-renders') is defeated on exactly the hot path refreshes create: a polling PayloadBoundary refreshing every second re-decodes and re-renders the entire payload-rendered app each tick, with cost proportional to total app size rather than the refreshed boundary's size. Only chunks/boundaries reachable from the refreshed boundary's old and new models need invalidation; graph objectRefs already keep shared values stable, so scoped invalidation preserves the documented 'fresh structure for refreshed boundaries' rationale at O(boundary) cost.

<details><summary>Verification</summary>

Confirmed the mechanics against disk: payload.ts:769 refresh branch calls invalidateDecodeCaches() which wipes decodedBoundaries and every chunk's decoded cache (824-830); the next render re-decodes all chunks (readChunk 905-908) with fresh element identities (tree children are serialized with preserveIdentity=false, so only prop-value elements keep graph-id identity), producing an O(app) re-decode + full render-phase pass per refresh. However, the finding is heavily overclaimed: (1) it is documented spec behavior — concepts/payload.md lines 112-113 (the sentence right after the line the reviewer quotes) explicitly say refresh rows clear decoded tree caches, and concepts/ is the repo's authoritative spec, with the mechanism deliberately reworked in the branch's two most recent commits and pinned by tests (payload.test.ts:909, :1330); (2) the wipe is correctness-load-bearing: Fig's reconciler bails on element-identity equality (fig-reconciler/src/index.ts:1737 canBailout props === alternate.memoizedProps, with begin() adopting whole clean subtrees), and PayloadBoundarySlot has no own subscription, so keeping ancestor chunk caches would make the refresh never render — the reviewer's proposed fix (invalidate only chunks reachable FROM the refreshed boundary's models) is downward reachability and would break refresh entirely; a real O(boundary) refresh needs a design change (per-slot lane subscription or reverse chunk-contains-boundary tracking). The residual truth is a documented, intentional per-refresh cost ceiling (render-phase only, no DOM mutations for unchanged content, graph refs keep shared values stable), worth noting as a known tradeoff but not a defect. Severity downgraded from major to minor.

</details>

---

### 15. Refresh processing performs four-plus full traversals of every retained model per refresh row, including computing activeBoundaryEntries twice back-to-back.

- **Location:** `packages/fig-server/src/payload.ts:979`
- **Severity:** minor
- **Reviewer:** fig-server:performance

For each refresh row (and each root model row), processRow runs refreshRetainedChunks() and then pruneObjectRefs(). refreshRetainedChunks computes referencedChunkClosure(rootModel) plus one closure per active boundary (re-walking shared chunk models per boundary, so O(boundaries × chunks) worst case) and calls activeBoundaryEntries(); pruneObjectRefs then calls activeBoundaryEntries() again (line 876) and re-walks every chunk model with collectObjectIds (line 873-875). Combined with shiftRowIds (full walk of the incoming row, line 750) and noteMaxObjectIds (another full walk, line 752), each small boundary refresh costs several complete scans of the entire retained payload graph — O(total payload size) CPU and Set/array allocations per refresh tick even when the refreshed boundary is tiny. Computing activeBoundaryEntries once and passing it to both consumers, and/or maintaining incremental reference counts, would remove most of this.

<details><summary>Verification</summary>

Verified every mechanical claim against packages/fig-server/src/payload.ts as it exists on disk: refresh rows and root model rows both trigger refreshRetainedChunks()+pruneObjectRefs() (lines 774-775, 789-790); refreshRetainedChunks computes referencedChunkClosure(rootModel) plus one fresh-Set closure per active boundary so shared chunk models are re-walked per boundary (lines 983-989, 2511-2530); activeBoundaryEntries() is computed twice back-to-back with no caching (lines 984 and 876), each full-walking root+boundary models; pruneObjectRefs re-walks every retained chunk model with collectObjectIds (lines 873-878). The code is production runtime (no NODE_ENV gate), and the tests added in commit 06e65a5 pin retention correctness only, not cost — nothing refutes the redundancy. One small inaccuracy: shiftRowIds (gated behind rowIdBase/objectIdBase > 0) and noteMaxObjectIds walk only the incoming row, not the retained graph, but the finding states that correctly in its parenthetical. Severity is correctly minor: the scans run per refresh event (user-action frequency, not per frame), are linear over an in-memory graph that is typically small, and the mark-and-sweep design just landed deliberately as a correctness fix — the avoidable redundancy (hoisting activeBoundaryEntries, memoizing closure walks) is a cheap optimization, not a user-visible problem at typical payload sizes.

</details>

---

### 16. updateMaxObjectIdFromRow deep-traverses every model/refresh/data row at ingest solely to track a max id that is only needed if a refresh later occurs.

- **Location:** `packages/fig-server/src/payload.ts:752`
- **Severity:** minor
- **Reviewer:** fig-server:performance

processRow calls updateMaxObjectIdFromRow(this, row) unconditionally, and noteMaxObjectIds (lines 2367-2418) walks the entire model tree of every row — a second full traversal on top of the decode traversal, doubling ingest CPU for the common case of a response that is never refreshed. The information is also derivable much more cheaply: encode-side graph ids are allocated monotonically per request (defineGraphObject, line 1573-1581), so the server could emit the final max (or the client could track ids as defineObjectRef/noteObjectId observe them during decode, which already happens at line 838/856 — making the eager pre-scan redundant except for ids inside not-yet-decoded rows, which could be resolved lazily in beginRefreshPayload).

<details><summary>Verification</summary>

Confirmed against packages/fig-server/src/payload.ts as it exists: processRow (line 752) unconditionally calls updateMaxObjectIdFromRow, and noteMaxObjectIds (2367-2418) fully re-walks every model/refresh/data row at ingest; maxObjectId is read only in beginRefreshPayload (line 680), so the work is pure overhead when no refresh occurs. Decode is eager (resolveDecodedRow line 786) and defineObjectRef (838) already tracks ids during decode, so the scan is largely a duplicate traversal — the core claim holds and it is on the hot, non-dev-gated client ingest path. However, two of the reviewer's framing points are off: (1) "doubling ingest CPU" is overstated, since ingest already includes the codec's JSON parse (dominant) plus the allocating decodeModel walk — this is a third, allocation-free traversal, a fraction of ingest cost; (2) the scan is more load-bearing than "redundant": superseded boundary initials skip decode (prepareBoundaryInitial early-return, line 863) and data rows decode via a separate graph context (line 1802) that never calls noteObjectId, so removing the scan without the proposed lazy fallback would violate the spec's refresh id-collision guarantee (concepts/payload.md). The suggested alternatives (server-emitted max = wire-format change; lazy scan at beginRefreshPayload = the same traversal deferred) are plausible but not free. Net: a real, verifiable perf nit with an honest but inflated cost estimate; minor is the correct severity.

</details>

---

### 17. The JSON payload decoder rescans the entire accumulated buffer from offset 0 on every incoming network chunk while a row spans chunks, giving O(rowSize²/chunkSize) scanning for large rows.

- **Location:** `packages/fig-server/src/payload.ts:421`
- **Severity:** minor
- **Reviewer:** fig-server:performance

createJsonPayloadDecoder.decode does `buffer += decoder.decode(chunk)` then processBufferedLines(), whose local `start` resets to 0 each call; when the buffer contains no newline yet (a single large model/data row split across many transport chunks), `buffer.indexOf('\n', start)` re-scans all previously-scanned bytes on every chunk. A multi-megabyte data-hydration row arriving in 64KB chunks scans hundreds of megabytes of characters in total. This is the default codec in production (options.codec ?? jsonPayloadCodec on both ends). Persisting the scanned offset across decode() calls (e.g., a `searchStart` field reset when the buffer is sliced) makes it linear.

<details><summary>Verification</summary>

Verified against packages/fig-server/src/payload.ts as it exists: createJsonPayloadDecoder (lines 410-454) appends each chunk to `buffer` and calls processBufferedLines, whose scan offset `start` is a local reset to 0 on every call; when the buffer holds no newline yet, `buffer.indexOf("\n", 0)` at line 421 rescans all previously scanned bytes on every subsequent chunk, giving O(rowSize²/chunkSize) scanning for a single row spanning many transport chunks. No mitigations exist: jsonPayloadCodec is the production default on both ends (`options.codec ?? jsonPayloadCodec` at lines 570 and 669), there is no NODE_ENV gate, concepts/payload.md confirms no other built-in codec ships, processPayloadStream feeds raw transport chunks directly into decode, no persisted-offset field exists in the current code, and no test pins linear scanning. Cost is real but bounded: indexOf is a memchr-speed scan, so even a 10MB row in 64KB chunks rescans ~800MB of characters (tens to low hundreds of ms, once per oversized row), with no correctness impact — so the claimed minor severity is accurate.

</details>

---

### 18. on() has no typed escape hatch for CustomEvent listeners even though custom elements are a first-class part of the JSX surface

- **Location:** `packages/fig-dom/src/events.ts:292`
- **Severity:** minor
- **Reviewer:** fig-dom:api-design

The fallback overload (events.ts:292-296) pins the callback to `EventCallback` = `(event: Event, signal: AbortSignal) => void`. Under strictFunctionTypes, a handler typed `(event: CustomEvent<Detail>, signal) => void` is not assignable (contravariant parameter), so `on("value-changed", (e: CustomEvent<number>) => ...)` is a compile error and there is no generic parameter form like `on<CustomEvent<number>>("value-changed", cb)`. Since jsx.ts:51 deliberately supports `${string}-${string}` custom elements, custom-element consumers — the population most likely to use CustomEvents — must widen to `Event` and cast inside every handler. jsx-types.test.tsx has no CustomEvent coverage, confirming the gap. The fix (an extra generic overload) is additive and non-breaking, hence minor, but it is a day-one papercut for the documented custom-element story.

<details><summary>Verification</summary>

Confirmed against disk. events.ts:287-296 has only two on() overloads; the fallback pins the callback to EventCallback<Event> and there is no generic form. Reproduced the exact compile failure with tsc --noEmit under the package tsconfig (strict: true): a handler annotated (event: CustomEvent<number>, signal: AbortSignal) => void fails TS2769 on on("value-changed", ...) due to parameter contravariance. jsx.ts:51 deliberately supports `${string}-${string}` custom elements (documented as intentional in concepts/jsx.md), yet grep finds zero CustomEvent references in packages/, concepts/, or jsx-types.test.tsx — no test pins the behavior and no concept doc declares the limitation intentional. Runtime dispatch works; the cost is purely a typing papercut with a cast workaround, so minor is the honest severity.

</details>

---

### 19. unhideInstance stringifies numeric style.display, contradicting the string-only style policy and leaving Activity content permanently hidden

- **Location:** `packages/fig-dom/src/index.ts:218`
- **Severity:** minor
- **Reviewer:** fig-dom:api-design

The style contract (concepts/jsx.md: 'numeric values are compile errors, matching the runtime's no-px-suffix stance') is enforced by HostStyle typing and by props.ts setStyleProperty (props.ts:571-581 drops numbers with a dev warning). But unhideInstance (index.ts:218-227) special-cases `typeof display === "number"` and writes `String(display)` via style.setProperty. Concrete failure: an element inside an Activity with `style={{display: 5}}` (JS user, or suppressed TS error) — the number is dropped at apply time, hideInstance sets `display: none !important`, and on unhide setProperty("display", "5") is a CSSOM no-op for the invalid value, so `display: none !important` survives and the revealed Activity content stays invisible with no warning. Removing the number branch (fall through to "") would restore the element's stylesheet display and match the rest of the system.

<details><summary>Verification</summary>

Confirmed against the code on disk. (1) packages/fig-dom/src/index.ts:218-227: unhideInstance does have the claimed `typeof display === "string" || typeof display === "number" ? String(display) : ""` branch, and hideInstance (line 214-216) sets `display: none !important`. (2) The string-only style policy is real: HostStyle is `Readonly<Record<string, string | EmptyPropValue>>` (jsx-attribute-policy.ts:19), setStyleProperty (props.ts:571-581) drops numbers/bigints with a dev-only warning, and concepts/jsx.md:31 states numeric style values are compile errors — so the number branch in unhideInstance contradicts the rest of the system and can never legally fire under TS. (3) The failure scenario reproduces: I ran happy-dom (the project's DOM test env) — after `setProperty('display','none','important')`, calling `setProperty('display','5')` is a CSSOM no-op (invalid value, per spec 'do nothing'), leaving `display: none !important` intact, while `setProperty('display','')` removes it. So a JS user (or suppressed TS error) with `style={{display: 5}}` inside an Activity gets the number silently dropped at mount, then permanently-hidden content after hide/unhide; falling through to "" (the fix the reviewer proposes) would restore visibility consistently with the drop-at-apply behavior. (4) No existing test pins this: grepped fig-dom src/tests for unhideInstance and numeric display — nothing covers it. Mitigations keep severity at minor: it requires bypassing the type system, a dev warning does fire at mount time about the dropped numeric style (reviewer's 'no warning' is only true in production or at unhide time), and the branch's mere existence is otherwise just a policy inconsistency.

</details>

---

### 20. The invalid-events-prop error does not tell users that descriptors come from on(), and throws during commit with no element context

- **Location:** `packages/fig-dom/src/events.ts:738`
- **Severity:** minor
- **Reviewer:** fig-dom:api-design

eventDescriptors() throws 'The events prop must be an array of event descriptors.' for both a non-array (`events={handler}`) and a raw function inside the array (`events={[handler]}` — the most likely React-migrant mistake). In the second case the user's value IS an array, so the message reads as satisfied while still throwing; it never mentions that descriptors are created with `on(type, callback)` from @bgub/fig-dom, nor which element/tag carried the bad prop. Because the throw happens in commitUpdate/finalizeInitialInstance (a host commit failure, which per concepts/errors.md ErrorBoundary does not catch), a JS user gets an app-level crash pointing at internal commit frames with no self-serve path. Naming on() (matching the excellent onClick dev warning at props.ts:145-147) and including the element type would fix this cheaply before release.

<details><summary>Verification</summary>

Verified against events.ts:731-747: the identical vague message is thrown for both non-array values and raw functions inside an array (the events={[handler]} migrant mistake), with no mention of on() and no element context; no dev-gated enhancement and no test pins it. Traced the throw paths in fig-reconciler/src/index.ts: the update path (commitUpdate -> commitHostMutation:3451) is a host commit failure that errors.md:19 says ErrorBoundary does not catch, and the mount path (finalizeInitialInstance in complete(), called from completeUnit OUTSIDE performUnit's try/catch at lines 1260-1272) also bypasses boundary capture and lands in performRoot's uncaught path — so the crash-with-no-self-serve-path scenario is real in both mount and update cases. Partial mitigation: onUncaughtError receives ErrorInfo with componentStack, but the default root rethrows from setTimeout with only the bare error. The contrasting high-quality onClick warning at props.ts:145-147 confirms the inconsistency. It is a DX/error-message issue, not a functional bug, so minor is the correct severity.

</details>

---

### 21. No "./package.json" subpath in the exports map of any of the five packages

- **Location:** `packages/fig/package.json:8`
- **Severity:** minor
- **Reviewer:** release-readiness

All five exports maps (packages/fig/package.json:8, packages/fig-dom/package.json:8, packages/fig-reconciler/package.json:8, packages/fig-refresh/package.json:8, packages/fig-server/package.json:8) omit "./package.json": "./package.json". Any tool that does require.resolve('@bgub/fig/package.json') or import.meta.resolve of the manifest — version sniffers, lint plugins, older bundler/framework integrations, monorepo tooling — throws ERR_PACKAGE_PATH_NOT_EXPORTED on day one. One-line addition per package; standard practice for packages with exports maps. (Nothing in fig's own released tooling needs it today — fig-vite/fig-start don't resolve it — so minor, but it is the cheapest future-proofing on this list.)

<details><summary>Verification</summary>

Confirmed against disk: none of the exports maps in packages/fig, fig-dom, fig-reconciler, fig-refresh, fig-server (nor fig-vite, fig-start, fig-devtools) includes "./package.json": "./package.json"; each map only lists code entry points. With an exports map present, Node's resolver seals all other subpaths, so require.resolve('@bgub/fig/package.json') or import.meta.resolve of the manifest throws ERR_PACKAGE_PATH_NOT_EXPORTED — I verified the exports blocks directly and grepped the whole packages tree: no fig code or test resolves a manifest subpath, so nothing in-repo is broken and no test pins this either way. The failure is therefore real but purely external/ecosystem-facing (version sniffers, lint plugins, older integrations that resolve manifests through the module resolver rather than reading the file from disk, which is how Vite/webpack do it). The fix is a one-line addition per package and is standard practice. The reviewer's framing and severity are honest and accurate: a confirmed omission with a concrete but hypothetical day-one cost for third-party tooling only. Minor is the correct severity — not major, since no current consumer in the repo or its released tooling hits it.

</details>

---

### 22. All subpath entries fail to resolve under legacy TS moduleResolution "node" (node10) — including ./jsx-runtime and ./jsx-dev-runtime

- **Location:** `packages/fig/package.json:24`
- **Severity:** minor
- **Reviewer:** release-readiness

attw against the real pnpm-packed tarballs: node10 resolution is a hard fail (💀) for @bgub/fig/internal, /server, /jsx-runtime, /jsx-dev-runtime, @bgub/fig-dom/refresh, @bgub/fig-reconciler/devtools and /refresh, and @bgub/fig-server/payload, because there is no typesVersions fallback and no physical ./jsx-runtime.js shim. A consumer with "jsx": "react-jsx", "jsxImportSource": "@bgub/fig" but an older tsconfig using moduleResolution "node" gets 'Cannot find module @bgub/fig/jsx-runtime' on their first TSX file. node16/nodenext/bundler are all green, so this only affects legacy configs; acceptable as a deliberate modern-only stance, but worth a line in the README/docs stating moduleResolution bundler|node16 is required.

<details><summary>Verification</summary>

Confirmed against packages/fig/package.json as it exists: subpaths (./jsx-runtime, ./jsx-dev-runtime, ./internal, ./server) are defined only via the exports map into dist/, files is ["dist"], and there is no typesVersions field in any package and no physical root shims. Reproduced the exact failure with tsc 5.9.3 against the publishable file set (package.json + dist copied into a temp node_modules): with moduleResolution "node", jsx "react-jsx", jsxImportSource "@bgub/fig", compilation fails with TS2875 ("module path '@bgub/fig/jsx-runtime' ... none could be found"), with TS explicitly noting the types exist at dist/jsx-runtime.d.ts but are unreachable under that setting. Switching the same project to moduleResolution "bundler" resolves the module (remaining errors are only missing host-element typings, which live in @bgub/fig-dom by design). No mitigation found: grep shows no moduleResolution guidance in README/docs/concepts. Severity minor is honest: the package is ESM-only (type: module, import-only export conditions, no main), so node10/CJS runtime consumers are already out of scope by design; the affected audience is bundler users with legacy tsconfigs, and the fix is a one-line docs note or typesVersions fallback.

</details>

---

### 23. dist is gitignored but no prepack/prepublishOnly guard exists, so publishing from a stale or missing dist ships silently broken tarballs

- **Location:** `packages/fig/package.json:41`
- **Severity:** minor
- **Reviewer:** release-readiness

All five packages have files:["dist"] with dist in the repo-root .gitignore, and their scripts blocks (e.g. packages/fig/package.json:40-44) define no prepack/prepare/prepublishOnly hook, so `pnpm publish` packs whatever dist happens to be on disk. If dist were missing the tarball would contain only package.json/README/LICENSE and still publish successfully; if stale, it ships code from an older commit with no error. Not currently firing — I verified every dist was rebuilt after HEAD 06e65a5 (mtimes 14:24-14:26 vs commit 14:18 today) and fig-server/dist/payload.js includes the new payload-graph work — but for tomorrow either add "prepack": "vp pack" per package or make the runbook build immediately before publishing.

<details><summary>Verification</summary>

Confirmed against disk: root .gitignore line 12 ignores dist; all workspace packages have files:["dist"]; grep across every packages/\*/package.json finds no prepack/prepare/prepublishOnly hook; .github/workflows/release-please.yml only runs release-please-action (no build+publish job, matching the project memory note 'no CI publish job'), and no .npmrc or runbook enforces building before publish. So a manual `pnpm publish` packs whatever dist is on disk — missing dist still publishes a tarball with just package.json/README/LICENSE, stale dist publishes silently. The finding actually understates scope: 8 publishable (non-private) packages carry the pattern, not 5. Mitigating factors (dist currently fresh at HEAD, this is a process gap rather than a live bug) were already acknowledged by the reviewer and support minor severity, not refutation.

</details>

---

### 24. ESM-only publish: every entry's "default" condition points at ESM, so require() from CJS fails on Node without require(esm)

- **Location:** `packages/fig/package.json:12`
- **Severity:** minor
- **Reviewer:** release-readiness

attw flags CJSResolvesToESM on every entry of all five packages: "import" and "default" both point to the same ESM file and there is no "main"/CJS build, so `require('@bgub/fig')` throws ERR_REQUIRE_ESM on Node < 20.19/22.12 (works via require(esm) on newer Node). This matches the repo's modern-ESM stance and node16-from-ESM/bundler are green, so it is informational — but there is also no "engines" field anywhere declaring the supported Node range, so CJS consumers get a runtime error rather than an install-time warning. Consider adding engines and a README note rather than changing the build.

<details><summary>Verification</summary>

Verified against disk: all published packages (fig, fig-dom, fig-reconciler, fig-server, fig-devtools, fig-refresh, fig-start, fig-vite) are "type": "module" with every exports entry's "import" and "default" pointing at the same ESM file, no "main", and no CJS build (dist/index.js is genuine ESM). No published package has an "engines" field — the only one is in the private workspace root (node >=20, which itself includes 20.0–20.18 where require(esm) is unavailable) and nothing in publishConfig or tooling injects it. No concepts/ file or README documents the ESM-only stance or a supported Node range, so the gap is not handled elsewhere. Concrete cost: a CJS consumer on Node <20.19/<22.12 gets ERR_REQUIRE_ESM at runtime with no install-time warning. ESM-only is clearly intentional, so the finding is informational packaging polish (add engines + README note), correctly scoped as minor.

</details>

---

### 25. Published .d.ts files end with sourceMappingURL comments pointing at .d.ts.map files that are never emitted or packed

- **Location:** `packages/fig/dist/jsx-runtime.d.ts:18`
- **Severity:** minor
- **Reviewer:** release-readiness

Every emitted declaration file in fig (dist/jsx-runtime.d.ts, index.d.ts, internal.d.ts, server.d.ts, and the shared chunks like element-DzV328p8.d.ts) ends with e.g. `//# sourceMappingURL=jsx-runtime.d.ts.map`, but no \*.d.ts.map exists in any dist directory (verified: glob matches nothing) and none is in the tarball. TypeScript ignores the missing map, but editors' go-to-source/declaration-map features log resolution failures and fall back to the .d.ts. Cosmetic for the release; fix later by either emitting declaration maps + shipping src, or configuring vp pack/tsdown to strip declarationMap output.

<details><summary>Verification</summary>

Verified on disk: packages/fig/dist/jsx-runtime.d.ts, internal.d.ts, server.d.ts, and every shared .d.ts chunk end with //# sourceMappingURL=<name>.d.ts.map, but find over packages/ (excluding node_modules) matches zero \*.d.ts.map files, while .js.map files are emitted normally. package.json ships "files": ["dist"] wholesale with no src, so the dangling references go into the published tarball. One detail in the report is overclaimed: index.d.ts (and index.js) carry no sourceMappingURL comment, so it is not literally every declaration file. Impact matches the claim — TypeScript ignores missing declaration maps and editors fall back to the .d.ts, so this is purely cosmetic/DX polish with no functional breakage; minor is the right severity.

</details>

---

### 26. release-please-managed CHANGELOG.md is excluded from the npm tarball by files:["dist"]

- **Location:** `packages/fig/package.json:37`
- **Severity:** minor
- **Reviewer:** release-readiness

packages/fig and packages/fig-dom have CHANGELOG.md files (release-please writes them), but npm-packlist only force-includes README/LICENSE/package.json — the packed tarballs (verified via tar -tzf on pnpm pack output) contain no CHANGELOG.md. Consumers browsing node_modules or unpkg see no changelog. Many projects consider this intentional (changelog lives on GitHub Releases); if you want it shipped, add "CHANGELOG.md" to the files array in each package. No functional impact on day one.

<details><summary>Verification</summary>

Verified every factual premise against the repo. (1) /Users/bgub/code/fig/packages/fig/package.json line 37 has files:["dist"], and packages/fig-dom/package.json lines 21-23 are identical. (2) Both packages have a CHANGELOG.md on disk, and release-please-config.json confirms release-please manages both packages (so the changelogs will keep being updated each release). (3) I reproduced the pack: `pnpm pack` of @bgub/fig produces a tarball whose only non-dist entries are package/LICENSE, package/package.json, and package/README.md — no CHANGELOG.md, matching npm-packlist's force-include list (README/LICENSE/package.json but not CHANGELOG). (4) No documented decision anywhere in concepts/, docs/, or project memory saying the changelog is intentionally GitHub-Releases-only, so this is an unexamined omission rather than a confirmed intentional one. The concrete cost is exactly as stated and nothing more: consumers inspecting node_modules or unpkg see no changelog; zero functional/runtime impact, and omitting CHANGELOG from tarballs is a common intentional norm (React itself ships only LICENSE/README/package.json). The finding stands as a true but low-stakes packaging observation; "minor" is the correct (floor) severity and the reviewer's own hedging ("many projects consider this intentional... no functional impact") is accurate.

</details>

---

### 27. title(value, key?) accepts a `key` parameter that is deliberately and silently ignored

- **Location:** `packages/fig/src/resource.ts:158`
- **Severity:** minor
- **Reviewer:** fig:api-design

Every other asset creator's `key` feeds assetResourceKey's `${kind}:${key}` dedupe override (resource.ts:208), but for titles assetResourceKey returns the constant "title" before consulting resource.key (resource.ts:203-206, by design per the singleton comment), and assetResourceHostAttributes emits nothing for titles (resource.ts:335-337), so the parameter has zero runtime effect anywhere. The behavior is even pinned by test (fig-server/src/asset-registry.test.ts:105-108: title("Dashboard","primary") vs title("Settings","secondary") still conflict). A signature that accepts a dedupe key it will never honor invites users to author 'scoped' titles that then throw on the server (see the title-conflict finding) with no hint that the key was inert. Drop the parameter (or make it meaningful) before the signature is frozen by release.

<details><summary>Verification</summary>

Verified every factual claim against the code on disk. packages/fig/src/resource.ts:158-162 shows `title(value: string, key?: string)` attaching `key` to the TitleResource, and it is the only creator whose second positional parameter exists solely for the key. The key is then inert on every path: (1) assetResourceKey returns the constant "title" at resource.ts:206 BEFORE the `resource.key` override at :208, per the deliberate singleton comment; (2) assetResourceHostAttributes emits nothing for title (resource.ts:335-337); (3) the server registry writer emits `<title>` with empty attrs (fig-server/src/asset-registry.ts:120-123); (4) head-only kinds never travel the payload wire (fig-server/src/payload.ts comments confirm title/meta excluded); (5) fig-dom's insertAssetResources explicitly skips title/meta (fig-dom/src/asset-resources.ts:249), and its update path keys via assetResourceKey so the key still collapses to "title". The behavior is pinned by test (fig-server/src/asset-registry.test.ts: title("Dashboard","primary") vs title("Settings","secondary") throws 'Conflicting Fig resource for key "title"'). No doc or concepts file documents a purpose for title's key; git history shows the param shipped in the original commit with no rationale, and concepts/assets.md only documents the singleton collapse. So the failure scenario is concrete: an author who passes a key expecting scoped dedupe (as every other creator honors) gets a server-side conflict throw whose message gives no hint the key was inert. Mitigating factors keep this minor, not major: the singleton collapse is intentional, commented, and tested; misuse fails loudly with a conflict error rather than corrupting output; and TitleResource.key would remain expressible via the object literal/ResourceBase regardless. But an inert, purpose-built positional parameter on a public creator about to be frozen is a genuine API-design defect, not a misread.

</details>

---

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

### 31. The published @bgub/fig-reconciler/refresh subpath exports five reconciler-internal helpers (hasRefreshHandler, refreshFamilyFor, resolveLatestType, runWithStaleRefreshFamilies, matchesComponentFamily) that no external consumer uses.

- **Location:** `packages/fig-reconciler/src/refresh.ts:27`
- **Severity:** minor
- **Reviewer:** fig-reconciler:api-design

refresh.ts doubles as the public `./refresh` entry (package.json exports map) and index.ts's internal module. Its actual external consumers import only `setRefreshHandler` + the `RefreshFamily`/`RefreshUpdate` types (fig-refresh/src/index.ts:1-5, fig-dom/src/refresh.ts:1-4); the other five exports exist solely for index.ts's own imports (index.ts:104-111) and leak reconciler internals — `runWithStaleRefreshFamilies` mutates module-global refresh state and `matchesComponentFamily` is the reconciler's type-identity primitive, both semver liabilities once published tomorrow (removing them later is a breaking change, and a misuse like calling runWithStaleRefreshFamilies outside scheduleRefresh silently changes reconciliation identity). Architecture doctrine says these dev subpaths are seams "with exactly the consumers they were built for"; splitting the internal helpers into a non-exported module (index.ts already imports by relative path, so nothing else changes) closes the leak. Note also that `RefreshUpdate` appears in the main entry's public FigRenderer.scheduleRefresh signature (index.ts:397) but is only importable from the subpath — worth re-exporting from the main entry per the types-follow-signatures rule.

<details><summary>Verification</summary>

Confirmed against disk: package.json exports ./refresh → dist/refresh.js (published, files:["dist"], public access), and dist/refresh.d.ts exports all five internal helpers. Repo-wide grep shows the only external importers of @bgub/fig-reconciler/refresh (fig-refresh/src/index.ts, fig-dom/src/refresh.ts, their tests) use only setRefreshHandler + RefreshFamily/RefreshUpdate types; the five helpers are consumed exclusively by fig-reconciler/src/index.ts:104-111 via a relative import. concepts/renderer-authoring.md:52-57 states the subpath is a dev-only seam "with exactly the consumers they were built for", so the wider surface contradicts the project's own spec. runWithStaleRefreshFamilies mutates module-global state and matchesComponentFamily is the type-identity primitive — real semver liabilities for the imminent 0.0.1 publish. The RefreshUpdate side-note also verifies: dist/index.d.ts:96 references it in the public FigRenderer.scheduleRefresh signature but only imports (not re-exports) it, against architecture.md's types-follow-signatures rule. No test or doc blesses the wider export, and the code is unchanged. It is an API-surface/doctrine hygiene issue with no runtime failure, so minor severity stands.

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

### 34. renderToPayloadStream has no signal option and its result has no abort(), unlike the HTML entry grid in the same package

- **Location:** `packages/fig-server/src/payload.ts:486`
- **Severity:** minor
- **Reviewer:** fig-server:api-design

ServerRenderOptions accepts signal and every HTML stream result exposes abort(reason) (packages/fig-server/src/types.ts:31,61), and server-rendering.md explicitly warns "A hung data source hangs the prerender — pass signal." PayloadRenderOptions (payload.ts:71-86) and PayloadRenderResult (payload.ts:65-69) offer neither: a hung data loader in a server component holds pendingTasks > 0 forever, so allReady never settles and the stream never closes; the only server-side escape is cancelling the ReadableStream from the consumer end (which routes through closeWithError, payload.ts:2155). Same concept, different shape across the two renderers in one package — request-timeout handling that is one line with the HTML entries requires plumbing stream cancellation for payloads.

<details><summary>Verification</summary>

Verified against payload.ts as it exists: PayloadRenderOptions (lines ~71-86) has no signal field and PayloadRenderResult (lines ~65-69) is only {allReady, contentType, stream} with no abort(), while ServerRenderOptions has signal (types.ts:31) and HTML stream results expose abort(reason) (types.ts:60). The hang scenario is real: the stream closes only when pendingTasks === 0, so a hung loader keeps allReady (a deferred) unsettled forever; the sole server-side escape is consumer-end stream.cancel() routing through closeWithError (payload.ts:605-607, 2155). Not handled elsewhere: fig-start's payload path (fig-start/src/server.ts:511-535) does not plumb request.signal into the render, all signal handling inside payload.ts is on the client fetch/decode path, no test pins abort behavior, and neither concepts/payload.md nor open-questions.md documents the omission as intentional — payload.md just mirrors the current signature while server-rendering.md explicitly tells HTML users to pass signal for hung sources. Severity stays minor because a working escape hatch exists (stream cancellation rejects allReady, errors the controller, and disposes the data store, and runtimes cancel response bodies on client disconnect), so this is an API asymmetry/ergonomics gap rather than an unrecoverable defect.

</details>

---

### 36. createPayloadResponse without loadClientReference/resolveClientReference silently decodes client rows into a component whose eventual error blames server rendering

- **Location:** `packages/fig-server/src/payload.ts:947`
- **Severity:** minor
- **Reviewer:** fig-server:api-design

decodeClientReference's final fallback (payload.ts:947-951) returns clientReference({ id, load: () => Promise.resolve({}) }). The client reconciler has no special handling for client-reference types (isClientReference is only consumed in fig-server), so rendering it invokes the marker function, which throws "Client reference \"X\" cannot be rendered on the server directly." (packages/fig/src/element.ts:180) — on the client, where the actual mistake is a missing loadClientReference option on createPayloadResponse. Nothing fails at decode time and preloadClientReferences() resolves immediately (no entries), so the misconfiguration surfaces late with a message pointing at the wrong layer; fig-start had to add its own requireClientReferenceResolver guard (packages/fig-start/src/client.ts:887) to fail loudly. Decoding a client row with neither option configured should throw or warn with the real cause.

<details><summary>Verification</summary>

Verified every mechanical claim: payload.ts:947-951 does return a clientReference marker with a no-op load when neither resolveClientReference resolves nor loadClientReference is set; decode happens eagerly (resolveDecodedRow, payload.ts:2241) with no warning; preloadClientReferences resolves immediately since the fallback registers no entry; isClientReference is consumed only in fig-server (renderer.ts:634), so the client reconciler renders the marker as a function component, which throws element.ts:180's "Client reference \"X\" cannot be rendered on the server directly." — a server-blaming message for a client-side misconfiguration. fig-start's requireClientReferenceResolver (client.ts:992, with tests) exists precisely to fail loudly for this case, confirming the footgun. Attempted refutations: (a) the fallback IS intentional/load-bearing for server-side decode (fig-start server.ts:412-417 decodes with resolveClientReference returning undefined for non-ssr refs, markers rendered via clientReferenceFallback placeholder at server.ts:257) and for metadata-only decodes (payload.test.ts:424/452/491 pin no-option decode succeeding) — so the finding's "should throw" remedy must be scoped to the neither-option-configured case (or dev-only warn), but this doesn't refute the identified failure; (b) no concepts/payload.md documentation of the no-resolver fallback behavior, so it is not a documented intentional divergence; (c) no test pins the client-side misleading-error behavior as desired. The failure scenario is concrete and reachable for any direct @bgub/fig-server/payload consumer (non-fig-start) that omits loadClientReference. DX-only, framework layer guards it, so minor is the honest severity.

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
