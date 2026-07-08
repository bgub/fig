# Fig pre-release review — 2026-07-07

Multi-agent review of `fig`, `fig-dom`, `fig-reconciler`, `fig-refresh`, and `fig-server` ahead of the planned release (`fig-start`, `fig-devtools`, `fig-vite` excluded as experimental, though a few findings landed in `fig-vite` where it implements fig-refresh's contract).

**Method.** 16 reviewer agents (each package × correctness / performance / API design, plus one release-readiness pass over packaging and exports) produced 80 raw findings. Every finding was then handed to an independent adversarial verifier instructed to refute it against the code on disk — several verifiers wrote and executed repro tests.

**Tally: 0 critical, 0 major, 0 minor confirmed · 0 unverified · 3 refuted.**

Severity scale: **critical** = corrupts state / crashes / silently breaks a headline feature in normal use; **major** = wrong behavior or serious cost in realistic use, or painful to fix post-release; **minor** = real but low-impact.

## Contents

- [Confirmed critical (0)](#confirmed-critical)
- [Confirmed major (0)](#confirmed-major)
- [Confirmed minor (0)](#confirmed-minor)
- [Unverified (0)](#unverified)
- [Refuted (3)](#refuted)

## Confirmed critical

No open confirmed critical findings remain.

## Confirmed major

No open confirmed major findings remain.

## Confirmed minor

No open confirmed minor findings remain.

## Unverified

No open unverified findings remain.

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
