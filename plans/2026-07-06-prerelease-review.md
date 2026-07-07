# Pre-release review — 2026-07-06

Multi-agent review of `fig`, `fig-dom`, `fig-reconciler`, `fig-refresh`, `fig-server` ahead of the first npm release. 8 focused reviewers (per-package correctness + API design, performance, release hygiene), every finding independently adversarially verified. 48 confirmed, 5 refuted.

## Blockers (3)

### JSX types reject runtime-supported form props: defaultValue, defaultChecked, textarea/select value

- **Where:** `packages/fig-dom/src/jsx-attribute-policy.ts:27`
- **Category:** api-design (found by `fig-dom-props-events` reviewer)

The closed attribute vocabulary is generated from html-element-attributes, which has no defaultValue/defaultChecked (they are DOM properties, not HTML attributes) and no value attribute on textarea or select. The hand-written policy layer (FigHostProps) does not add them either. So the fully-implemented, documented form API (props.ts setFormProperty/updateSelectOptions; concepts/intentional-differences-from-react.md line 100-102: "value controls the live DOM value; defaultValue owns the default value and HTML representation") is unauthorable in TSX: <input defaultValue="x"/>, <input defaultChecked/>, <textarea value={v}/>, <select value={v}/>, and <select defaultValue={v}/> are all compile errors. Users cannot write uncontrolled inputs or controlled textareas/selects without `as any` casts on day one of the public release.

**Evidence:** Verified with tsc against the package tsconfig: `<input defaultValue="x" />` → "Type '{ defaultValue: string; }' is not assignable to type 'HtmlHostProps<\"input\", ...>'"; same errors for `<input defaultChecked />`, `<textarea value="controlled" />`, `<select value="b">`, `<select defaultValue="b">`. Meanwhile props.ts lines 334-348 implement value/defaultValue/checked/defaultChecked, and jsx-attributes.generated.ts lists no "value" under textarea (lines 398-412) or select (lines 343-351).

**Suggested fix:** Add the form-state props to the policy layer (e.g. a per-tag extension in jsx-attribute-policy.ts giving input/textarea/select `value`/`defaultValue` and input `checked`/`defaultChecked` with appropriate types), and pin them in jsx-types.test.tsx.

<details><summary>Verifier note</summary>

Confirmed by direct tsc reproduction against packages/fig-dom/tsconfig.json: `<input defaultValue="x"/>`, `<input defaultChecked/>`, `<textarea value="..."/>`, `<select value="b"/>`, and `<select defaultValue="b"/>` all fail with TS2322 ("not assignable to type 'HtmlHostProps<...>'"), while `<input value checked/>` compiles because "value"/"checked" happen to exist as HTML attributes on input in jsx-attributes.generated.ts (lines 217-255). textarea (lines 398-412) and select (lines 343-351) in the generated snapshot have no "value" at all, and no tag has defaultValue/defaultChecked — as expected, since html-element-attributes only lists HTML attributes, not DOM properties. The hand-written policy layer (packages/fig-dom/src/jsx-attribute-policy.ts), which per concepts/jsx.md is explicitly where "Fig-specific decisions" belong ("The generated file... should not accumulate Fig policy"), adds nothing for form state. Meanwhile the runtime fully implements these props: packages/fig-dom/src/props.ts (setFormProperty at ~334-348, updateSelectOptions at ~423-440, defaultValue→value attribute mapping at 277-278) plus extensive props.test.ts and hydration.test.ts coverage — all of which use createElement directly, which is why the JSX-type gap went unnoticed. concepts/intentional-differences-from-react.md lines 100-102 documents value/defaultValue as the public form contract, so this is a spec-vs-types mismatch, not intentional exclusion; jsx.md frames the closed vocabulary as a typo-catcher, not as a form-API restriction. Not refutable as intentional, dev-only, or guarded elsewhere. Blocker severity stands for a public release: uncontrolled inputs and controlled/uncontrolled textarea/select — day-one form basics — are unauthorable in TSX without `as any`, and jsx-types.test.tsx pins none of these props, so nothing would catch the regression either way.

</details>

---

### Hydration breaks on text runs merged across component boundaries (no server text separators)

- **Where:** `packages/fig-server/src/renderer.ts:483`
- **Category:** bug (found by `fig-dom-tree-hydration` reviewer)

The server writes text with no separator between text produced by different fibers, so `<div>{"Hi "}<Name/></div>` (Name returns a string) or `<div>a<Nothing/>b</div>` (component returning null between text siblings) serializes as one contiguous byte run that the browser parses into a SINGLE text node. The client fiber tree has two (or more) text fibers, and `collectChildren` only merges sibling strings within one children array — it cannot merge across a component boundary. During hydration the first text fiber claims the merged node, the next text fiber finds no node, and `throwHydrationMismatch` fires with recovery "root": the entire server-rendered DOM is cleared and client re-rendered on every page load, silently in prod (onRecoverableError) for extremely common patterns. Verified by repro test against the repo's own harness: both scenarios produce "Hydration mismatch: expected text, but found no DOM node." React emits <!-- --> separators for exactly this case.

**Evidence:** renderer.ts:483 `writeText(String(node), frame.segment);` with no separator logic anywhere (only suspense markers are emitted as comments); children.ts:14 comment claims "Adjacent text merging here MUST match on both sides" but merging only happens within one normalized children array. Repro (run with vp test): hydrateRoot(container containing <div> with single text node "Hi Ben", createElement("div", null, "Hi ", createElement(Name))) where Name = () => "Ben" → onRecoverableError receives Error("Hydration mismatch: expected text, but found no DOM node."); same for createElement("div", null, "a", createElement(Nothing), "b") vs one "ab" text node.

**Suggested fix:** Emit a comment separator (e.g. <!--,-->) between adjacent text chunks whenever consecutive text output does not come from the same normalized text child, and teach fig-dom's getNextHydratableSibling/hydration cursor to skip that separator comment (as React does with <!-- -->). Add hydration tests that build the DOM by parsing real server output instead of hand-assembling FakeText nodes, so parser text-merging is exercised.

<details><summary>Verifier note</summary>

Confirmed by independent repro against the repo's own harness. (1) Server side: /Users/bgub/code/fig/packages/fig-server/src/renderer.ts renderNode (line 483, `writeText(String(node), frame.segment)`) emits text with no separator; the only comments emitted anywhere are suspense markers (lines 1146-1168). renderToHtml(createElement("div", null, "Hi ", Name)) with Name = () => "Ben" produces exactly `<div>Hi Ben</div>`, which any browser HTML parser materializes as ONE text node. (2) Client side: collectChildren (/Users/bgub/code/fig/packages/fig/src/children.ts) merges adjacent strings only within a single normalized children array, so a component boundary yields two separate text fibers; its own comment (line 14) states the merge "MUST match on both sides" — an invariant the parser's cross-boundary merge violates. (3) Hydration: canHydrateTextInstance in /Users/bgub/code/fig/packages/fig-dom/src/index.ts:121/375 checks only nodeType, so the first text fiber ("Hi ") claims the merged "Hi Ben" node and tryHydrateText advances the cursor to null; the second text fiber ("Ben") then hits throwHydrationMismatch (/Users/bgub/code/fig/packages/fig-reconciler/src/index.ts:1450, 1608-1636) with recovery: "root". My repro (single FakeText("Hi Ben") in the container, hydrateRoot with the two-fiber tree) reproduced 'Hydration mismatch: expected text, but found no DOM node.' via onRecoverableError for both the component-returning-string case and the null-component-between-text case — meaning the entire server-rendered DOM is discarded and client re-rendered, silently in prod. (4) Intent check: nothing in concepts/hydration.md, concepts/server-rendering.md, or docs mentions text separators or blesses this; the mismatch policy describes recovery for genuine divergence, not for identical trees. Existing hydration tests hand-assemble FakeText nodes per pre-merged fiber, which is why the parser-merge case was never exercised. Blocker severity stands: `{"Hi "}<Name/>` and text-flanked null-returning components are ubiquitous patterns, and this silently defeats SSR/hydration (full DOM teardown on every page load) in a framework whose server rendering is a headline feature.

</details>

---

### Updates scheduled during render/commit on an in-flight lane are permanently dropped (setState in useBeforeLayout never applies)

- **Where:** `packages/fig-reconciler/src/index.ts:2971`
- **Category:** bug (found by `fig-reconciler` reviewer)

commitRoot computes the remaining lanes as `root.pendingLanes & ~root.renderLanes`. Any update dispatched after its fiber rendered but before this line runs — most directly a setState inside a useBeforeLayout effect (commitEffects(BeforeLayoutEffect) runs at line 2954, before markRootFinished at 2971), and also any same-lane update dispatched while a time-sliced render of that lane is yielded — lands on a lane inside renderLanes and is stripped from pendingLanes. The update sits parked in its hook queue with fiber.lanes set, but the root has no pending lanes and no callback (scheduleRoot at dispatch time early-returned because root.callback was non-null with the same priority lane), so nothing ever renders it. Verified empirically: a component that does `useBeforeLayout(() => setValue("measured"), [])` under a default-lane `root.render()` stays at the initial value forever (test asserts "measured", receives "initial"). The classic measure-then-set layout pattern is silently broken; the UI stays stale until an unrelated update happens to render that lane.

**Evidence:** index.ts:2954 `commitEffects(finishedWork.child, BeforeLayoutEffect);` runs before index.ts:2971 `markRootFinished(root, root.pendingLanes & ~root.renderLanes);`, and only OffscreenLane is rescued afterwards: `if (includesSomeLane(finishedWork.childLanes, OffscreenLane)) { markRootPending(root, OffscreenLane); ... }`. Repro test failed: `expected 'initial' to be 'measured'`.

**Suggested fix:** Compute remaining lanes from the committed tree rather than pendingLanes-minus-renderLanes: markLanes/markChildLanes already record concurrent update lanes on finishedWork (finishedWork.childLanes contains the dropped DefaultLane at line 2972), so pass `(root.pendingLanes & ~root.renderLanes) | finishedWork.lanes | finishedWork.childLanes` (masking out lanes that only reflect already-processed work), or track lanes of updates dispatched during render/commit (React's concurrently-updated-lanes) and re-mark them pending after markRootFinished.

<details><summary>Verifier note</summary>

Confirmed real, on both claimed mechanisms, via independent repros. Statically: scheduleHookUpdate → scheduleFiber → scheduleRoot early-returns (index.ts:972) when root.callback is live with the same priority lane; begin() only clears fiber.lanes when it visits the fiber (index.ts:1234-1235); commitRoot then runs markRootFinished(root, root.pendingLanes & ~root.renderLanes) (index.ts:2971), stripping the parked update's lane, and finishRootWork (index.ts:1135) sees pendingLanes===NoLanes and deschedules the root. No concurrently-updated-lanes tracking exists anywhere in the reconciler (React preserves these via getConcurrentlyUpdatedLanes merged into markRootFinished). Empirically: (1) setState inside useBeforeLayout under a default-lane root.render() stays at "initial" forever — commitEffects(BeforeLayoutEffect) at 2954 precedes markRootFinished at 2971; test failed exactly as claimed ("expected 'initial' to be 'measured'"), with no dev diagnostic despite Fig's diagnostics-throw-before-commit stance. (2) The severe half also reproduces: a plain setTimeout setState on an already-rendered fiber, fired while a time-sliced default-lane render was yielded, is permanently dropped (UI still "initial" 500ms later) — ordinary usage, not an anti-pattern. One overstated detail: the "classic measure-then-set layout pattern" is useBeforePaint in Fig (useLayoutEffect analog), which runs after markRootFinished and works (verified passing); useBeforeLayout is the useInsertionEffect analog where React forbids setState. That framing error does not rescue the code: the interleaved same-lane drop alone is silent permanent state loss in ordinary concurrent rendering, so blocker severity stands for a pre-release renderer.

</details>

---

## Majors (20)

### Invalidation is silently lost when a load for the key is already in flight

- **Where:** `packages/fig/src/data-store.ts:680`
- **Category:** bug (found by `fig-core` reviewer)

invalidateEntry() only sets entry.stale = true; it neither supersedes the in-flight load (no generation bump/abort) nor records that an invalidation arrived mid-flight. When the load that was started BEFORE the invalidation settles, fulfill() passes the generation guard and unconditionally clears stale, so the pre-invalidation response is marked fresh and no reload ever happens. This violates the spec ('mark stale; the next read reloads lazily' — concepts/data.md): the invalidation is not honored lazily, it is dropped entirely. Concrete scenario (verified with a repro test): entry fulfilled; invalidateData triggers a background refresh (gated/slow); a second mutation lands and calls invalidateData again while that refresh is in flight; the refresh (carrying pre-second-mutation data) settles -> stale=false, subscribers render the outdated value, subsequent readData calls never reload (loads stayed at 2, expected 3). The same race applies to an initial pending load invalidated mid-flight. In any mutation-heavy app (or with focus/interval refetching layered on top), users will see stale data pinned indefinitely.

**Evidence:** invalidateEntry (line 860-876) does only `entry.stale = true; entry.refreshError = undefined; ...` with no effect on entry.pending/generation. fulfill (line 671-687) checks only `if (entry.generation !== generation || controller.signal.aborted)` and then runs `entry.stale = false; entry.status = "fulfilled"; entry.value = value;` — clearing the stale flag set by an invalidation that happened after this load started. Repro test run in-repo: after a second invalidateData during an in-flight refresh, inspectDataEntries() shows stale=false post-settle and readData starts no new load (expected 3 loads, got 2).

**Suggested fix:** Track invalidation against the load generation: e.g. record `invalidatedAtGeneration = entry.generation` (or a boolean `invalidatedWhileLoading`) in invalidateEntry when entry.pending !== null, and have fulfill()/reject() keep stale=true (and re-arm read-triggered revalidation) when the settling load's generation predates the invalidation. Alternatively, abort-and-restart the in-flight load on invalidate — but the flag approach preserves the lazy 'next read reloads' semantics without extra fetches.

<details><summary>Verifier note</summary>

Confirmed by code reading and an in-repo repro. In /Users/bgub/code/fig/packages/fig/src/data-store.ts, invalidateEntry (lines 860-876) only sets `entry.stale = true` and clears refreshError; it does not bump entry.generation, abort entry.controller, or record that the invalidation landed while entry.pending !== null. The settle guard in fulfill (line 672) checks only `entry.generation !== generation || controller.signal.aborted` — both untouched by invalidation — so line 680 unconditionally sets `entry.stale = false`, erasing the invalidation. readData's re-load path (lines 427-449) requires `entry.pending === null`, so a subscriber re-render triggered by the mid-flight invalidation cannot start a superseding load either; after the stale pre-invalidation response settles, no path re-arms a reload. Repro test run in-repo reproduced the exact claimed scenario: fulfilled entry, invalidate → read starts a gated refresh (load 2), second invalidate mid-flight (snapshot shows stale=true), refresh settles → subsequent readData starts no load (expected 3 loads, got 2; test assertion failed at loads===3). This contradicts the spec in concepts/data.md line 112/116 ("mark stale; the next read reloads lazily") — the invalidation is dropped, not deferred. Nothing in concepts/ sanctions this: the spec's only in-flight-race provision is "Loads are generation-guarded: a superseded load's settlement is inert" (line 138), and hydration explicitly aborts in-flight loads as superseded (lines 166-171), showing the design intends mid-flight races to be handled — invalidateEntry just doesn't. Not dev-only, not guarded by any caller. Major severity is appropriate: it is a realistic race in mutation-heavy apps (invalidate-after-mutation while a prior refresh is in flight) that pins stale data indefinitely, but it requires overlapping invalidations and self-heals on the next explicit invalidate/refresh, so it is not a blocker.

</details>

---

### concepts/events.md still documents the removed `once` listener option and its tombstone semantics

- **Where:** `concepts/events.md:14`
- **Category:** release-hygiene (found by `fig-dom-props-events` reviewer)

The spec (the repo's single authoritative source per CLAUDE.md) promises `on(type, callback, options?)` supports the "capture/once/passive subset" and that "A consumed `once` slot stays as a tombstone — it does not re-arm ... and it does not shift its siblings" (lines 14, 20-22). But `once` support was deliberately removed in commit 198dcfd ("clarify form defaults and event options"): EventOptions is now `Pick<AddEventListenerOptions, "capture" | "passive">` (events.ts line 9), normalizedOptions drops everything else, and dispatch never consumes slots. A user following the spec gets a type error on `{ once: true }` inline, or — if the options come from a wider-typed variable — the flag is silently ignored and the handler fires forever.

**Evidence:** concepts/events.md line 14: "supports the `capture`/`once`/`passive` subset"; lines 20-22: "A consumed `once` slot stays as a tombstone". events.ts line 9: `export type EventOptions = Pick<AddEventListenerOptions, "capture" | "passive">`; git show 198dcfd removes `"once"` from the option pick, the tombstone logic, and 126 lines of once tests.

**Suggested fix:** Update concepts/events.md to say the supported subset is `capture`/`passive` and delete the tombstone paragraph (or, if `once` is meant to be supported, restore the implementation) before the release.

<details><summary>Verifier note</summary>

Confirmed. concepts/events.md line 14 promises the "capture/once/passive subset" and lines 20-22 document once-tombstone semantics, but packages/fig-dom/src/events.ts line 9 defines EventOptions = Pick<AddEventListenerOptions, "capture" | "passive"> with no once/tombstone logic anywhere (dist/index.d.ts matches). Commit 198dcfd shows the removal was intentional — its plans/api-review-2026-07.md edit says "Done: the ambiguous declarative `once` option was dropped from Fig event options" and it deleted 126 lines of once tests — yet concepts/events.md was not updated, violating the repo rule that contract changes update the owning concept file in the same commit. The drop is also absent from concepts/intentional-differences-from-react.md, so the stale spec is the only remaining documentation and it affirms a removed feature. A user following the spec gets a type error on inline { once: true }, or a silently ignored flag (normalizedOptions at events.ts line 1117 reads only capture/passive) when options come from a wider AddEventListenerOptions type. Major (not blocker) is right: docs-only fix, but the file is the declared authoritative spec, marked stable, and contradicts the shipped API before release.

</details>

---

### Controlled `checked` prop rewrites the checked content attribute, corrupting defaultChecked/form-reset state

- **Where:** `packages/fig-dom/src/props.ts:390`
- **Category:** bug (found by `fig-dom-props-events` reviewer)

setChecked unconditionally writes/removes the `checked` content attribute for BOTH the `checked` and `defaultChecked` props. In the real DOM the checked attribute IS the defaultChecked reflection, so a controlled `<input type="checkbox" checked={state}/>` mutates the element's default on every commit: form.reset() resets to the last-committed controlled state instead of the authored default, and element serialization drifts. Worse, when both props are given (the documented Fig model — commit 198dcfd's fix made `defaultValue` "own the HTML representation" for value, implying the pair is supported), the two props fight over one attribute and the JSX author order decides: `<input defaultChecked checked={state}/>` ends with the attribute tracking `state`, so `input.defaultChecked` no longer reflects `defaultChecked={true}` and form reset unchecks the box. The value path was fixed in 198dcfd to write the attribute only for defaultValue; checked was missed.

**Evidence:** props.ts line 390: `setAttribute(element, "checked", checked);` runs before the `options.defaultChecked` and `options.live` gates, so it executes for the controlled `checked` call (`setChecked(element, next, { live: true })`, line 342) as well. Contrast setFormValue lines 360-369, where after commit 198dcfd the `value` attribute is written only under `options.defaultValue === true`.

**Suggested fix:** Move the attribute write under `options.defaultChecked === true`, mirroring setFormValue: controlled `checked` should touch only the live `checked` property; `defaultChecked` owns the attribute/defaultChecked reflection.

<details><summary>Verifier note</summary>

Confirmed. props.ts line 390 (`setAttribute(element, "checked", checked)`) executes unconditionally inside setChecked, before the `options.defaultChecked` and `options.live` gates, and the controlled `checked` prop path (line 342) calls it with only `{ live: true }`. Since the DOM's `checked` content attribute reflects `defaultChecked`, every commit of a controlled checkbox rewrites the element's default: form.reset() restores the last-committed controlled state, and when both `checked` and `defaultChecked` are given the two prop writes fight over one attribute (prop iteration order wins), breaking `input.defaultChecked` reflection. This is not intentional: commit 198dcfd made exactly the symmetric fix for `value` (attribute write moved under `options.defaultValue === true`, lines 363-369) and documented the model in concepts/intentional-differences-from-react.md lines 100-102 ("`defaultValue` owns the default value and HTML representation"); the comment at props.ts lines 328-331 groups defaultChecked under the same model, so checked was simply missed. Tests miss it because FakeElement (test-utils.ts) does not model checked-attribute→defaultChecked reflection, and no test asserts the attribute for the controlled path. Severity major stands: real-browser correctness bug in controlled checkboxes/radios violating the project's own documented contract, though limited to form-reset/default-reflection/serialization flows.

</details>

---

### unsafeHTML hydration compares raw prop string to browser-re-serialized innerHTML, causing false mismatches that discard the whole SSR tree

- **Where:** `packages/fig-dom/src/index.ts:372`
- **Category:** bug (found by `fig-dom-tree-hydration` reviewer)

canHydrateInstance → hasMatchingUnsafeHTML checks `element.innerHTML === expected`. In a real browser, innerHTML is a re-serialization of the parsed DOM, which differs textually from many valid source strings: `<br/>` → `<br>`, `<input disabled>` → `<input disabled="">`, uppercase tag names lowercased, unquoted attribute values quoted, numeric character references decoded. Any app whose unsafeHTML value is not already serialization-canonical (CMS/markdown/sanitizer output frequently is not) fails canHydrateInstance on every load → throwHydrationMismatch with recovery "root" → clearContainer wipes the entire server-rendered DOM and client re-renders, silently in prod. The test suite cannot catch this because FakeElement stores innerHTML verbatim. React deliberately skips comparing dangerouslySetInnerHTML content during hydration for exactly this reason — and Fig itself silently patches plain text mismatches, so strict equality here is doubly inconsistent.

**Evidence:** index.ts:368-373 `function hasMatchingUnsafeHTML(element, props) { ... return element.innerHTML === expected; }` wired via `canHydrateInstance: (node, type, props) => isHydratableElement(node, type, props)`; reconciler tryHydrateInstance throws Hydration mismatch (recovery: "root") when it returns false.

**Suggested fix:** Drop the innerHTML equality check (trust the server value like React) or downgrade it to a dev-only warning; if a check is kept, compare parsed DOM structure rather than serialized strings.

<details><summary>Verifier note</summary>

Verified end-to-end. fig-dom's hasMatchingUnsafeHTML (packages/fig-dom/src/index.ts:368-373) does `element.innerHTML === expected` with no NODE_ENV gate, wired into canHydrateInstance (lines 119-120, 309-316). The server emits the raw unsafeHTML string verbatim (packages/fig-server/src/renderer.ts:821-822), so in a real browser element.innerHTML is the serializer's re-serialization of the parsed DOM, which textually differs from many valid sources (`<br/>`→`<br>`, boolean attrs gaining `=""`, uppercased tags lowercased, unquoted values quoted, numeric character references decoded). On failure, the reconciler (packages/fig-reconciler/src/index.ts:1420-1425, 1025-1038, 1081-1085) throws HydrationMismatchError with recovery "root", sets clearContainerBeforeCommit, and fig-dom clearContainer (index.ts:134-147) wipes the entire container before a client re-render — surfaced only through onRecoverableError, so silent in prod without a handler. The test suite cannot catch it: hydration.test.ts (lines 1370-1411) uses FakeElement, which stores innerHTML verbatim, and no e2e test exercises unsafeHTML in a real browser. concepts/hydration.md's mismatch policy never mandates strict unsafeHTML equality, so this is not a documented intentional contract; React's dangerouslySetInnerHTML hydration check is dev-warning-only and never discards the tree. One minor narrowing: inside a dehydrated Suspense boundary recovery is per-boundary rather than root, but the common top-level case is a full-tree wipe as claimed. Severity stays major (not blocker): the client render still produces correct UI and the failure is scoped to unsafeHTML users with non-serialization-canonical HTML — a common but not universal class — costing SSR benefit and a full re-render rather than correctness.

</details>

---

### HMR signatures ignore custom-hook internals, so editing a custom hook refreshes in place with misaligned hook slots (state corruption or hook-order crash)

- **Where:** `packages/fig-vite/src/transform.ts:46`
- **Category:** bug (found by `fig-dom-tree-hydration` reviewer)

A component's refresh signature is just the list of `use[A-Z]` callee names inside the component body. Editing a custom hook (same module or an imported one) to add/remove/reorder its internal hooks does not change any component's signature — the component still just calls `useCounter` — so isSignatureStale returns false and performRefresh buckets the family as "updated": in-place re-render preserving the old fiber hook list. The re-render then walks hook slots that no longer line up with the code: if hook kinds differ, updateHook throws "Hook order changed" / "Rendered more/fewer hooks" inside scheduleRefresh's flushSync (red error, manual reload); if kinds coincidentally align (e.g. a new useState added before an existing one), the old slot's state is silently bound to the wrong hook — live state corruption on refresh. React Refresh solves this by giving custom hooks their own signatures and composing them into component keys; Fig's transform does not instrument custom hooks at all.

**Evidence:** transform.ts:43-52 collects only `t.isIdentifier(callee) && /^use[A-Z]/.test(callee.name)` names into `hookNames.join("\n")`; fig-refresh isSignatureStale compares only these keys; fig-reconciler updateHook (index.ts:2664-2692) throws on kind/count mismatch and otherwise reuses slots positionally.

**Suggested fix:** Instrument custom hooks too (register a signature per top-level use* function and include callee signatures recursively in component keys, as react-refresh does), or conservatively mark a family stale whenever any use*-named function in the edited module changed.

<details><summary>Verifier note</summary>

Verified end-to-end. transform.ts:42-52 builds a component's refresh signature solely from use[A-Z] callee names inside the component body; custom hooks (lowercase, top-level) are never registered or signed, and component-less hook modules get no transform/accept boundary (transformModule returns null, so edits bubble to the self-accepting component module). Editing a custom hook's internal hooks therefore leaves the component's signature key (e.g. "useCounter") unchanged, so fig-refresh isSignatureStale (index.ts:114-126, prev.key !== next.key) returns false and performRefresh buckets the family as updated → reconciler scheduleFamilyRefresh does scheduleFiber(node, SyncLane), an in-place re-render that preserves the old fiber hook list while renderFunction runs the new code. updateHook (fig-reconciler/src/index.ts:2664-2692) then throws "Hook order changed"/"Rendered more/fewer hooks" on kind/count mismatch, or silently binds old slots to the wrong hooks when kinds coincidentally align (state corruption). Nothing in concepts/ or the HMR design notes documents this as intentional — the stated intent is "hook-signature changes remount" (concepts/renderer-authoring.md), which this gap defeats for the common edit-a-custom-hook flow; react-refresh solves it via composed per-hook signatures. Mitigating factor: dev-only (NODE_ENV-gated, apply:"serve"), recoverable by manual reload — but silent state corruption during a headline just-shipped HMR feature justifies major.

</details>

---

### Hydration silently patches text content mismatches, contradicting the spec'd mismatch policy and making suppressHydrationWarning-for-text dead code

- **Where:** `packages/fig-dom/src/index.ts:375`
- **Category:** bug (found by `fig-dom-tree-hydration` reviewer)

concepts/hydration.md (the authoritative spec per CLAUDE.md) says: "text mismatches recover with a root client render (reported through onRecoverableError, digests included)" and positions suppressHydrationWarning as the escape hatch for intentional text divergence. But fig-dom's canHydrateTextInstance ignores the text argument entirely — isHydratableText only checks nodeType — so server text "Server" vs client "Client" hydrates silently and commitTextUpdate rewrites the DOM with no recoverable error, no dev diagnostic, and no root recovery (hydration.test.ts:27 enshrines the silent patch). Environment-dependent SSR divergence (dates, locale, random) — the exact class the spec's mismatch policy and the hydration-stable-environment exploration exist for — is therefore invisible to developers, violating the "always-strict dev rendering" stance. Either the implementation or the concept file is wrong; shipping both as-is contradicts the published contract on release day.

**Evidence:** index.ts:121 `canHydrateTextInstance: (node) => isHydratableText(node)` (text param dropped); index.ts:375-378 checks only nodeType; concepts/hydration.md:34 "text mismatches recover with a root client render (reported through onRecoverableError, digests included)"; reconciler tryHydrateText passes the expected text but it is never compared.

**Suggested fix:** Compare the text value in canHydrateTextInstance (honoring suppressHydrationWarning one level up) and route divergence through the spec'd recoverable-error path — or, if silent adoption is the intended design, update concepts/hydration.md in the same commit and remove the text half of the suppressHydrationWarning contract.

<details><summary>Verifier note</summary>

Confirmed. concepts/hydration.md:34 (the authoritative spec) and docs/4-async-streaming-hydration.md:90 both promise "text mismatches recover with a root client render (reported through onRecoverableError)". The implementation cannot do this: packages/fig-dom/src/index.ts:121 defines `canHydrateTextInstance: (node) => isHydratableText(node)`, dropping the expected-text argument the reconciler passes (packages/fig-reconciler/src/index.ts:1448), and isHydratableText (index.ts:375-378) checks only node type. A diverging text node is therefore always adopted and silently rewritten by commitTextUpdate (index.ts:160-161); the fully wired root-recovery path (throwHydrationMismatch → recovery:"root" + onRecoverableError, reconciler index.ts:1608-1636) fires for element/structural mismatches but is unreachable for text. hydration.test.ts:27-63 enshrines the silent patch (server "Server" → client "Client", no error asserted). Additionally, suppressHydrationWarning only gates the extra-attribute dev warning (props.ts:179-189), so its documented text-divergence half (open-questions.md:19-20, hydration.md:36) is dead code. No doc, plan, or NODE_ENV gate marks silent text adoption as intentional — docs state the opposite — so this is a genuine spec/implementation contradiction on release day. Severity stays major (not blocker): the DOM converges to the client render so nothing breaks functionally; the harm is a published contract that is false plus invisible environment-dependent SSR divergence.

</details>

---

### A suspension stops the work loop without rescheduling other pending lanes — pending transitions/offscreen work stall indefinitely

- **Where:** `packages/fig-reconciler/src/index.ts:999`
- **Category:** bug (found by `fig-reconciler` reviewer)

performRoot's two suspension exits — the thenable catch (root-level suspension, lines 999-1005) and the PreservedSuspense catch (lines 989-992) — call restartRootWork/markRootSuspended and return without ever calling scheduleRoot. Unlike React's ensureRootIsScheduled-after-every-attempt invariant, nothing re-examines pendingLanes, so any OTHER pending, unsuspended lane (a lower-priority transition queued before the suspending render, DeferredLane from useLaggedValue, OffscreenLane prerender work re-marked by commitRoot) is left with no scheduled callback. It only runs when the suspending thenable pings or an unrelated future update calls scheduleRoot; with a slow or never-settling promise the queued work is a user-visible hang. Verified empirically: after `transition(() => setX(1)); setY(1);` where the y-update suspends at the root with a never-resolving promise, the transition never renders (test asserts "x1,y0", receives "x0,y0" even after 100ms).

**Evidence:** index.ts:999-1005: `if (isThenable(error)) { const suspendedLanes = root.renderLanes; restartRootWork(root); markRootSuspended(root, suspendedLanes); attachPing(root, error, suspendedLanes); return; }` — no scheduleRoot; same for `if (error === PreservedSuspense) { restartRootWork(root); return; }` at 989-992. Repro test failed: `expected 'x0,y0' to be 'x1,y0'`.

**Suggested fix:** After markRootSuspended/restartRootWork in both suspension paths, call scheduleRoot(root) so getNextLanes can pick up remaining pending & ~suspended lanes (it already handles returning NoLanes when nothing else is eligible).

<details><summary>Verifier note</summary>

Confirmed by code reading and an independent empirical repro. In /Users/bgub/code/fig/packages/fig-reconciler/src/index.ts, performRoot's two suspension exits (PreservedSuspense at lines 989-992, root-level thenable at lines 999-1005) both call restartRootWork — which nulls root.callback and root.callbackPriority (resetRootWork, lines 1147-1155) — and return without calling scheduleRoot. attachPing only reschedules when the suspended thenable settles (ping → scheduleRoot, line 3760). getNextLanes (lanes.ts:142-168) correctly computes `pending & ~suspendedLanes`, so any other pending lane (e.g. a transition lane) remains eligible, but nothing ever asks for it: there is no callback and no fallback rescheduler (flushSync's pendingRoots loop only runs inside flushSync; nothing else sweeps pendingRoots). This violates the schedule-after-every-attempt invariant React enforces via ensureRootIsScheduled, and no concepts/ doc sanctions it. I reproduced it independently in fig-dom with happy-dom fakes: `transition(() => setX(1)); setY(1);` where y=1 suspends at the root on a never-settling readPromise. The eligible transition lane never rendered — container stayed "x0,y0" after 200ms — and as a control, resolving the promise (the only remaining scheduleRoot trigger) immediately rendered "x1,y1", proving the transition lane was runnable the whole time and only the missing reschedule stalled it. The suggested fix (call scheduleRoot after markRootSuspended/restartRootWork in both catch paths; scheduleRoot already no-ops via getNextLanes===NoLanes when nothing else is eligible) is correct. Severity "major" is right: it is an indefinite, user-visible stall of unrelated pending work, but it requires a suspension that escapes to performRoot (root-level suspension with no enclosing Suspense boundary, or the shouldPreserveSuspenseBoundary path) coinciding with other queued lanes, so it is not a universal blocker.

</details>

---

### Commit-phase tree walks recurse once per sibling — a 10,000-item flat list crashes every commit with RangeError: Maximum call stack size exceeded

- **Where:** `packages/fig-reconciler/src/index.ts:4589`
- **Category:** bug (found by `fig-reconciler` reviewer)

visitFiberHooks (called unconditionally from commitLiveHookInstances on every commit), commitExternalStores (index.ts:4461), flushCaughtBoundaryErrors (index.ts:3066), collectReactiveEffects (index.ts:4519), and visitEffects (index.ts:4573) all recurse on `node.sibling`, so recursion depth grows linearly with sibling count, not tree depth. Mounting or updating a flat list of ~10,000 children (the standard js-framework-benchmark row count — exactly the workload a public React re-implementation will be measured on) overflows the call stack during commitRoot. Verified empirically: rendering `main` with 10,000 keyed `div` children throws `RangeError: Maximum call stack size exceeded` at visitFiberHooks (index.ts:4588/4589). Other walks (markSubtreeLanes, commitMutationEffects, commitDeletions) already loop over siblings correctly, so this is an inconsistency in just these functions.

**Evidence:** index.ts:4588-4589 `visitFiberHooks(node.child, visitor); visitFiberHooks(node.sibling, visitor);` — the test failure stack shows repeated frames at src/index.ts:4589. Same sibling-recursion pattern at index.ts:4461 (`commitExternalStores(node.sibling)`), 3066 (`flushCaughtBoundaryErrors(root, node.sibling)`), 4519 (`collectReactiveEffects(root, node.sibling)`), 4573 (`visitEffects(node.sibling, visitor)`).

**Suggested fix:** Convert the sibling dimension of these walks to `for (let cursor = node; cursor !== null; cursor = cursor.sibling)` loops (recursing only into `child`), matching markSubtreeLanes/commitMutationEffects/hideNestedBoundaryContent.

<details><summary>Verifier note</summary>

Verified in source and reproduced empirically. All five cited walks recurse on `node.sibling`: visitFiberHooks at packages/fig-reconciler/src/index.ts:4588-4589, commitExternalStores at :4461, flushCaughtBoundaryErrors at :3066, collectReactiveEffects at :4519, and visitEffects at :4573 (clearHiddenSubtreeFlags at :4532 has the same pattern). These run unconditionally on every commit from commitRoot: commitLiveHookInstances(finishedWork.child) at :2952 calls visitFiberHooks, and commitExternalStores/flushCaughtBoundaryErrors/collectReactiveEffects are called at :2979-2986 (collectReactiveEffects inside a `finally`, so it cannot be skipped). I wrote a minimal test in fig-dom rendering a flat `main` with 10,000 keyed `div` children via flushSync; it crashed exactly as claimed: `RangeError: Maximum call stack size exceeded` with repeated frames at src/index.ts:4589 (visitFiberHooks sibling recursion). Not dev-only — none of these walks are NODE_ENV-gated — and nothing in concepts/rendering.md documents a depth/sibling limit as intentional; on the contrary, neighboring walks in the same file (collectRetriableDehydratedSuspense at :3019, markSubtreeLanes, commitMutationEffects, commitDataDependencies at :3468) already loop over siblings iteratively, confirming the sibling-recursion in these five functions is an inconsistency rather than a design choice. The suggested fix (loop over the sibling chain, recurse only into child) matches the existing house pattern. Severity major is fair: it is a hard crash on every commit for wide flat lists (~10k siblings, the js-framework-benchmark workload a public React re-implementation will be judged on), though apps below roughly that sibling count are unaffected.

</details>

---

### Re-entrant flushSync from a commit-phase effect on the same root corrupts the in-flight commit and loses the flushed update

- **Where:** `packages/fig-reconciler/src/index.ts:2967`
- **Category:** bug (found by `fig-reconciler` reviewer)

flushSync's own comment (index.ts:906-908) says a nested flushSync from a commit-phase effect must be supported, but re-entering performRoot for the SAME root mid-commit is destructive: useBeforeLayout effects run at index.ts:2954 before `root.current = finishedWork` (2967), so the nested performRootWork renders against the stale root.current, and `createWorkInProgress(root.current, ...)` reuses `current.alternate` — which is the outer finishedWork tree currently being walked by the outer commit — resetting its child/flags fields in place. When the outer commit resumes, it clobbers root.current with its (now recycled) finishedWork and strips the lanes the nested pass used. Verified empirically: `useBeforeLayout(() => flushSync(() => setValue("flushed")))` never applies — container text stays "initial" 100ms later (in React the equivalent warns but the update still commits).

**Evidence:** index.ts:903-925 flushSync iterates pendingRoots and calls performRoot(root, true) with no guard against the root being mid-commit; index.ts:2954 runs user effects before index.ts:2967 `root.current = finishedWork;`; index.ts:4024-4026 `const next = current.alternate ?? fiber(...)` recycles the outer finishedWork. Repro test failed: `expected 'initial' to be 'flushed'`.

**Suggested fix:** Track an isCommitting/root-in-commit flag; when flushSync (or scheduleRoot) targets a root that is mid-commit, defer the flush until commitRoot completes (e.g. run the pendingRoots flush loop after finishRootWork), rather than re-entering performRootWork.

<details><summary>Verifier note</summary>

Confirmed empirically and mechanically. (1) Mechanism holds: `flushSync` (packages/fig-reconciler/src/index.ts:903-925) iterates `pendingRoots` and calls `performRoot(root, true)` with no mid-commit guard; `commitRoot` runs `commitEffects(finishedWork.child, BeforeLayoutEffect)` at line 2954 before `root.current = finishedWork` at 2967, and there is no isCommitting/executionContext flag anywhere in the file (grep for performRoot guards found none). Since the outer `performRootWork` has already set `root.wip = null` before calling `commitRoot` (line 1130), the nested `performRootWork` takes the fresh-render branch at 1104 and `createWorkInProgress(root.current, ...)` (4024-4027) returns `current.alternate` — the exact finishedWork object the outer commit is mid-walk on — and wipes its `child`, `flags`, `deletions`, `effects` in place (4029-4050). The nested `finishRootWork` also resets `root.renderLanes` to NoLanes, so when the outer commit resumes, `markRootFinished(root, root.pendingLanes & ~root.renderLanes)` at 2971 strips ALL pending lanes. (2) Repro verified: I wrote a test with `useBeforeLayout(() => flushSync(() => setValue("flushed")))` gated to fire once — it fails with `expected 'initial' to be 'flushed'`; the flushed update is silently lost. Worse, an ungated variant (guarding on `value === "initial"` alone, which the corruption keeps true) produces `RangeError: Maximum call stack size exceeded` via infinite re-entrant commits (stack: flushSync → performRoot → commitRoot → commitEffects → runEffect → flushSync). (3) Not intentional: concepts/rendering.md and errors.md only spec flushSync error routing; nothing disallows commit-phase flushSync, and the code's own comment at index.ts:906-908 says nested flushSync from a commit-phase effect (e.g. unmount()) must be supported — that comment only saves/restores the error-routing flag for the cross-root unmount case; same-root re-entrancy is unhandled. Severity "major" is right: it is silent state loss plus a possible hang/stack-overflow, but only on the uncommon flushSync-inside-commit-effect path, not a mainline flow, so not a blocker.

</details>

---

### getNextLanes lets expiredLanes bypass suspendedLanes, so an expired suspended transition preempts and starves new sync/default input

- **Where:** `packages/fig-reconciler/src/lanes.ts:146`
- **Category:** bug (found by `fig-reconciler` reviewer)

getNextLanes selects `next = root.expiredLanes & pending` before the `pending & ~root.suspendedLanes` filtering, and markRootSuspended never clears root.expiredLanes. A transition lane can expire while starved (markStarvedLanesAsExpired arms a 5s clock whenever the lane is pending and unsuspended — e.g. continuous higher-priority churn keeps restarting a large transition render for 5s). Once the lane is in expiredLanes AND its render suspends via PreservedSuspense (committed boundary content, slow data), every subsequent scheduleRoot — including ones triggered by fresh SyncLane input — selects the expired suspended lane first (it is not filtered by suspendedLanes), renders it, suspends again, and (per the performRoot suspension path, which also fails to reschedule) drops back to idle without ever rendering the sync update. User input appears frozen until the suspending thenable settles; if the finding about rescheduling after suspension is fixed in isolation, this instead becomes a busy render-suspend-reschedule spin on the expired lane. Code-evidence finding (not empirically driven — requires the 5s starvation window); the masking logic is unambiguous.

**Evidence:** lanes.ts:146-154: `let next = root.expiredLanes & pending; if (next === NoLanes) { const suspended = pending & ~root.suspendedLanes; next = getHighestPriorityLanes(suspended); ... }` — the expired branch ignores suspendedLanes entirely; lanes.ts:213-224 markRootSuspended sets suspendedLanes and resets expirationTimes but never touches root.expiredLanes.

**Suggested fix:** Exclude suspended-and-unpinged lanes from the expired selection (`root.expiredLanes & pending & (~root.suspendedLanes | root.pingedLanes)`), and/or clear the lane's expiredLanes bit in markRootSuspended — expiration exists to defeat starvation by other work, not to force re-rendering work that is blocked on data.

<details><summary>Verifier note</summary>

Confirmed by direct code reading. lanes.ts:146 selects `root.expiredLanes & pending` before the `pending & ~root.suspendedLanes` filter, so an expired lane preempts a fresh pending SyncLane and is never masked by suspension; markRootSuspended (lanes.ts:213-224) resets expirationTimes and sets suspendedLanes but never clears root.expiredLanes (only markRootFinished does, which requires the lane to complete). The starvation window is reachable: markStarvedLanesAsExpired runs on every scheduleRoot (index.ts:963) and arms a 5s clock on any pending unsuspended transition; sustained sync/input churn that keeps restarting a large transition for 5s expires it without the clock being reset. The suspension path matches the claim: captureSuspenseBoundary → shouldPreserveSuspenseBoundary (index.ts:3899, committed content + transition render) → markRootSuspended + throw PreservedSuspense (index.ts:3811-3813), caught at index.ts:989 with restartRootWork + return (no reschedule). After that, every fresh sync input (markRootUpdated clears suspendedLanes, scheduleRoot) selects the expired transition lane at NormalPriority, re-renders it to the suspension point, re-suspends, and drops idle — the sync update is never rendered until the thenable settles (ping → T completes → markRootFinished clears the expired bit → finishRootWork finally schedules SyncLane). With slow data this is an unbounded input freeze; if the separate no-reschedule-after-suspension finding is fixed alone, it becomes a busy render-suspend-reschedule spin on the expired lane, exactly as claimed. Refutation attempts failed: no concepts/ doc defines expiration semantics (not intentional), no caller guards the raw getNextLanes result, and React parity does not apply (React never selects lanes by expiredLanes and filters suspendedLanes first; expiration there only disables time-slicing). One nuance: the suggested `~suspendedLanes | pingedLanes` mask alone is insufficient for the first event after an update, because markRootUpdated clears suspendedLanes wholesale before scheduleRoot runs — clearing the lane's expiredLanes bit in markRootSuspended (the second half of the suggested fix) is the robust part. Severity 'major' is accurate: real liveness bug freezing sync input, but gated behind a 5s continuous-starvation window plus a preserved-boundary suspension.

</details>

---

### Cancelling a payload stream leaves allReady's rejection unhandled, crashing Node on client disconnect

- **Where:** `packages/fig-server/src/payload.ts:482`
- **Category:** bug (found by `fig-server` reviewer)

createPayloadRequest never pre-attaches a catch handler to allReady. When the consumer cancels the stream (the normal path when an HTTP client disconnects mid-stream and the framework aborts the Response body), closeWithError() rejects request.allReady. Any caller that returns `new Response(result.stream)` without awaiting allReady — the typical pattern — gets an unhandledRejection, which terminates a default-configured Node process. renderer.ts guards this exact case (lines 218-223, with a comment explaining why); payload.ts forgot the same guard. Verified with a repro: rendering a suspended tree, cancelling the stream, and observing `unhandledRejection: Error: client disconnected`.

**Evidence:** payload.ts createPayloadRequest: `allReady: deferred<void>()` with no `.catch` attached, and closeWithError: `request.allReady.reject(error)`. Contrast renderer.ts:221-223: `void shellReady.promise.catch(() => undefined); void headReady.promise.catch(() => undefined); void allReady.promise.catch(() => undefined);` with the comment "pre-attached no-op handlers keep the ones a caller does not await from becoming unhandled rejections". Repro observed `unhandledRejection observed: Error: client disconnected`.

**Suggested fix:** Mirror renderer.ts: after creating the deferred in createPayloadRequest, add `void request.allReady.promise.catch(() => undefined);` so un-awaited allReady never surfaces as an unhandled rejection while awaiters still observe it.

<details><summary>Verifier note</summary>

Verified end-to-end. createPayloadRequest (packages/fig-server/src/payload.ts:482) creates allReady via deferred() with no pre-attached catch (shared.ts:67 attaches none); the ReadableStream cancel handler (payload.ts:512-513) calls closeWithError, which rejects allReady (payload.ts:1671). renderer.ts:218-223 pre-attaches no-op catch handlers to the equivalent readiness promises with a comment explaining they exist precisely to prevent un-awaited rejections from becoming unhandled — payload.ts lacks the same guard. The in-repo caller fig-start/src/server.ts:535 works around it with `void payload.allReady.catch(() => undefined)`, confirming the hazard and leaving only external consumers of the public renderToPayloadStream API exposed (the demo-payload app also never handles allReady). I independently reproduced it: rendering a suspended tree via dist/payload.js, reading one chunk, then reader.cancel(new Error('client disconnected')) yielded `unhandledRejection observed: Error: client disconnected`, which kills a default-configured Node process on a routine client disconnect. Not a blocker since the fig-start path is guarded, but a real major bug for the public payload API; the one-line fix mirrors renderer.ts.

</details>

---

### An element prop literally named "$fig" silently destroys all props on payload decode

- **Where:** `packages/fig-server/src/payload.ts:1101`
- **Category:** bug (found by `fig-server` reviewer)

serializeProps writes props as a bare record with no escaping, but decodeModel treats any object containing a "$fig" key as a special model. concepts/payload.md line 54 explicitly promises round-tripping of "plain objects, including objects with a user-authored `$fig`key". Verified repro:`createElement("div", { $fig: "x", a: 1, children: "hi" })`round-trips to an element whose decoded props are`{}`— every prop and the children silently dropped (decodeSpecialModel falls off its switch and returns undefined). Worse, if the $fig prop's value happens to be "client" or "promise", decodeSpecialModel reads`model.id` (undefined) and creates a chunk for id undefined that never resolves, suspending the subtree forever.

**Evidence:** serializeProps (payload.ts:1099-1105) emits `serialized[name] = serializeValue(value, frame)` with no `$fig` escaping, while decodeModel (payload.ts:1819) does `if ("$fig" in model) return decodeSpecialModel(...)`. Repro output: `decoded props: {}` and `expected undefined to be 1` for prop `a`.

**Suggested fix:** Route element props through the same collision escape used for values: have serializeProps use encodePayloadRecord (wrapping records containing "$fig" in { $fig: "object", value }) and make the element decode path unwrap it — together with fixing the wrapper decode asymmetry in the next finding.

<details><summary>Verifier note</summary>

Confirmed by direct code reading and a live repro. serializeProps (packages/fig-server/src/payload.ts:1095-1105) writes props into a bare record with no `$fig` escaping — unlike nested objects, which serializeValue routes through encodePayloadRecord (payload.ts:1234-1243) that wraps colliding records in `{ $fig: "object", value }`. On decode, decodeSpecialModel's "element" case calls decodeModel on the props record, and decodeModel (payload.ts:1819) treats any object with a `$fig` key as a special model. I ran an actual round-trip test in the repo: `createElement("div", { $fig: "x", a: 1, children: "hi" })` produced the wire row `props:{"$fig":"x","a":1,"children":"hi"}` and decoded to an element whose props no longer contain `a` or `children` (assertion `props.a === 1` failed with undefined) — decodeSpecialModel falls off its switch for tag "x" and returns undefined, silently discarding every prop. If the `$fig` prop value is "client" or "promise", decodeSpecialModel reads `model.id` (undefined) and creates/reads a chunk that never resolves, so the subtree suspends forever. This is not intentional: concepts/payload.md ("Value Serialization") explicitly promises round-tripping of "plain objects, including objects with a user-authored `$fig` key", and there is no dev-mode validation anywhere rejecting a `$fig` prop name (grepped fig core and fig-server). The nested-object path honors the promise; only top-level element props violate it. Severity "major" is right: the trigger (a prop literally named `$fig`) is rare, so not a blocker, but the failure is silent data loss or a permanent hang that breaches a documented wire-format invariant, so it is more than minor. The suggested fix direction (route props through encodePayloadRecord and unwrap on the element decode path) matches the existing collision-escape machinery.

</details>

---

### "$fig":"object" escape wrapper decodes its children with the value-only decoder, corrupting nested elements/promises/client refs and skipping refresh id shifts

- **Where:** `packages/fig-server/src/payload.ts:1242`
- **Category:** bug (found by `fig-server` reviewer)

serializeValue escapes a plain object containing a user-authored "$fig" key by wrapping it in { $fig: "object", value } (encodePayloadRecord, line 1242) and its children are serialized with the full renderer codec, so they may contain element/lazy/promise/client row references. But on the client, decodeSpecialModel routes the "object" tag to decodePayloadSpecialValue -> decodePayloadPlainObject -> decodeModelValue (lines 1837-1846, 1328-1332), which knows nothing about renderer specials. Verified repro: `createElement("div", { data: { $fig: 1, node: <span>s</span> } })` decodes `data.node` as the raw record `{"$fig":"element","key":null,"props":{"children":"s"},"type":"span"}`instead of a FigElement; a nested promise would decode as`{$fig:"promise",id:n}`junk. Additionally shiftModelIds (line 1785-1803) hits the`default: return` branch for the "object" tag, so any promise/lazy/client ids inside the wrapper are NOT offset during a refresh payload and would resolve against wrong or stale chunks.

**Evidence:** encodePayloadRecord: `return "$fig" in encoded ? { $fig: "object", value: encoded } : encoded;` combined with decodeSpecialModel case "object" -> decodePayloadSpecialValue (value-only), and shiftModelIds `default: return;`. Repro output: `nested node: {"$fig":"element","key":null,"props":{"children":"s"},"type":"span"}` — isValidElement false.

**Suggested fix:** In decodeSpecialModel, handle the "object" tag locally: decode its value record with decodeModel(response, ...) instead of delegating to decodePayloadSpecialValue; and in shiftModelIds, recurse into the "object" wrapper's value.

<details><summary>Verifier note</summary>

Confirmed by independent code reading and an executed repro. (1) Encoder: packages/fig-server/src/payload.ts:1134 has serializeValue (the full renderer codec) call encodePayloadRecord with serializeValue as the child encoder, and line 1242 wraps any record containing a "$fig" key as `{ $fig: "object", value: encoded }` — so the wrapper's children can legitimately contain renderer specials (element/lazy/promise/client rows). (2) Decoder: decodeSpecialModel (line 1842) routes the "object" tag to decodePayloadSpecialValue (line 1317) -> decodePayloadPlainObject (1328) -> decodeModelValue, whose isPayloadValueSpecialModel (1285-1300) only recognizes value-codec tags (bigint/date/map/number/object/set/symbol/undefined), so element/promise/client/lazy records decode as raw plain objects. I ran the repro in the package's test runner: `createElement("div", { data: { $fig: 1, node: <span>s</span> } })` produced wire row `{"$fig":"object","value":{"$fig":1,"node":{"$fig":"element",...}}}`and decoded to`data.node = {"$fig":"element","key":null,"props":{"children":"s"},"type":"span"}` with isValidElement=false — silent corruption, no error. (3) shiftModelIds (1785-1803) handles only client/lazy/promise/element/boundary and hits `default: return` for "object", never recursing into `value`, so nested chunk ids in an escaped object are not offset during refresh rows and would resolve against wrong/stale chunks. This is not intentional: concepts/payload.md:54 explicitly promises round-tripping of "plain objects, including objects with a user-authored `$fig` key", and lines 64-66 say server component values can additionally contain elements, client references, and promises. Not dev-only, no guarding caller found, and no existing test covers the escape wrapper with nested specials. Severity major is fair: the trigger (a user object with a literal "$fig" key holding nested elements/promises) is rare, but it is a documented-supported input that fails as silent data corruption in the wire format, pre-release. The suggested fix (decode the "object" wrapper's value with decodeModel(response, ...) in decodeSpecialModel, and recurse into it in shiftModelIds) is sound.

</details>

---

### A refresh payload whose root render throws is silently swallowed on the client

- **Where:** `packages/fig-server/src/payload.ts:880`
- **Category:** api-design (found by `fig-server` reviewer)

In refresh mode, a successful root render emits a { tag: "refresh" } row, but a failing one falls into the generic error path and emits { id: 0, tag: "error" } (retryTask lines 880-885). Client-side, that id is shifted past mounted chunks (beginRefreshPayload), the rejected chunk is created, its rejection is immediately suppressed (`void chunk.promise.catch(() => undefined)`), and nothing ever reads it — readBoundary only consults the boundaries map. Net effect: fetchPayload(..., { refreshBoundary }) resolves successfully, the boundary keeps stale content, and the application has no way to observe that the refresh failed (no rejected promise, no notify, no error row tied to the boundary).

**Evidence:** retryTask: the refresh branch only covers the success path — `if (request.refreshBoundary !== null && task.id === 0) { emitRow(request, { boundary..., tag: "refresh", ... }) }` — while the catch emits `{ id: task.id, tag: "error", ... }`; processRow only routes `tag === "refresh"` to the boundaries map, and resolveDecodedRow's error handling ends with `void chunk.promise.catch(() => undefined)` on a chunk no reader references.

**Suggested fix:** Give refresh failures a wire representation (e.g. a refresh row variant carrying the ServerErrorPayload, or reject fetchPayload/notify subscribers when the refresh root errors) so callers can surface refresh failures.

<details><summary>Verifier note</summary>

Verified end-to-end. Server: retryTask (payload.ts:855-886) only emits a { tag: "refresh", boundary } row on success; a throwing refresh root falls into the generic catch and emits { id: 0, tag: "error" } with no boundary association. Client: processRow shifts the error row id by rowIdBase (beginRefreshPayload sets it to maxRowId), so the row.id === 0 notify branch never fires; resolveDecodedRow rejects the chunk and immediately suppresses it (void chunk.promise.catch(...)); readBoundary only consults the boundaries map, which only refresh rows populate. Net: fetchPayload resolves, fig-start's fetchServerRoutePayload calls control.complete(), and the boundary keeps stale content with zero observable signal. Not intentional: concepts/payload.md says error rows make "the decoded chunk reject with a digest-carrying error" (a contract with no reader in refresh mode), documents nothing about refresh failure, and payload.test.ts has no refresh-error test. The reviewer actually understated it: the error row's server id 0 shifts to exactly maxRowId, colliding with the initial payload's highest chunk id — resolveDecodedRow overwrites that existing chunk's status/value to rejected, and readChunk checks status before its decode cache, so a mounted lazy/promise chunk can later throw the server error into an unrelated subtree. Silent failure of a public API plus a latent chunk-clobber makes this worth fixing pre-release.

</details>

---

### Core singleton packages are exact-pinned regular dependencies instead of peerDependencies

- **Where:** `packages/fig-dom/package.json:39`
- **Category:** release-hygiene (found by `api-design` reviewer)

@bgub/fig holds process-global protocol state (currentDispatcher in hooks.ts, currentDataStore in data.ts, the thenable registry, the transition handler slot). fig-dom, fig-reconciler, fig-server, and fig-refresh declare @bgub/fig / @bgub/fig-reconciler as regular "dependencies": "workspace:\*", which pnpm publishes as an exact version pin. The first time an app's installed @bgub/fig version differs from the one fig-dom/fig-reconciler pins (e.g. app bumps fig to 0.0.2 before fig-dom releases), the package manager installs two copies: the app's components call useState from copy A while the reconciler sets the dispatcher via setCurrentDispatcher on copy B, so every hook call throws "Hooks can only be called while rendering a component" — the classic duplicate-React failure, and the reason React makes react a peerDependency of react-dom. Same for fig-refresh: setRefreshHandler on a duplicated @bgub/fig-reconciler/refresh copy silently kills HMR. The stray duplicate devDependencies entries for @bgub/fig in fig-dom and fig-reconciler (lines 43-45 / 48-50) look like a half-finished conversion to the peerDependencies + devDependencies pattern (fig-start already uses peerDependencies correctly). Moving a regular dep to a peer dep after release is a breaking change, so this is far cheaper to fix before tomorrow.

**Evidence:** packages/fig-dom/package.json: "dependencies": { "@bgub/fig": "workspace:_", "@bgub/fig-reconciler": "workspace:_" } AND "devDependencies": { "@bgub/fig": "workspace:\*" }. Same duplicated dep/devDep pattern in fig-reconciler; fig-server and fig-refresh pin @bgub/fig / @bgub/fig-reconciler as regular deps. dist confirms no bundling: packages/fig-reconciler/dist/index.js does `import { ... } from "@bgub/fig/internal"`, so a second copy means split module state.

**Suggested fix:** Declare @bgub/fig (and @bgub/fig-reconciler where imported) as peerDependencies with a range (plus devDependencies for local builds) in fig-dom, fig-reconciler, fig-server, and fig-refresh, or at minimum publish with caret ranges instead of exact workspace:\* pins.

<details><summary>Verifier note</summary>

Every load-bearing fact verifies. (1) fig-dom (packages/fig-dom/package.json:39-45), fig-reconciler, fig-server, and fig-refresh all declare @bgub/fig / @bgub/fig-reconciler as regular "dependencies": "workspace:_", which pnpm rewrites to exact version pins on publish; fig-dom and fig-reconciler also carry the stray duplicate devDependencies entry the reviewer noted. (2) The singleton hazard is real: packages/fig/src/hooks.ts:85 holds module-level `let currentDispatcher` with setCurrentDispatcher at line 209, and the built packages/fig-reconciler/dist/index.js imports setCurrentDispatcher/setCurrentDataStore/setTransitionHandler from "@bgub/fig/internal" unbundled — two installed copies of @bgub/fig split the dispatcher slot and every hook call throws, the classic duplicate-React failure. (3) Version drift is not hypothetical: release-please-config.json versions each package independently (no linked-versions lockstep), so @bgub/fig will be bumped by commits that don't touch fig-dom, producing the exact-pin mismatch and duplicate install. (4) Nothing in concepts/ documents a lockstep or bundling strategy that would make exact pins intentional. One detail in the claim is wrong but strengthens it: fig-start does NOT already use peerDependencies for fig packages (its peers are only tailwind/postcss; @bgub/fig_ are regular workspace:\* deps at lines 66-70), so the fix surface is larger than stated. Severity 'major' is correct: initial 0.0.1 installs dedupe fine so it's not an immediate blocker, but the first independent bump breaks consumers, and moving dep→peerDep after release is itself breaking, so fixing pre-release is materially cheaper.

</details>

---

### concepts/events.md (the authoritative spec) documents an `once` listener option that was removed from the implementation

- **Where:** `concepts/events.md:14`
- **Category:** api-design (found by `api-design` reviewer)

The events spec — status: stable — says `on(type, callback, options?)` supports the `capture`/`once`/`passive` subset and specifies tombstone semantics for consumed `once` slots (line 21). But commit 198dcfd (Jul 3) removed `once` entirely: EventOptions is now Pick<AddEventListenerOptions, "capture" | "passive">, normalizedOptions/eventKey only handle capture/passive, and no test covers once. A TypeScript user following the spec gets a compile error on `on("click", cb, { once: true })`; a JS user gets a handler that silently fires on every click instead of once. The spec was consolidated into concepts/ AFTER the removal, so the authoritative contract shipping tomorrow describes a feature that does not exist, violating the repo's own rule that contract changes update the owning concept file in the same commit.

**Evidence:** concepts/events.md:14-21: "supports the `capture`/`once`/`passive` subset ... A consumed `once` slot stays as a tombstone". packages/fig-dom/src/events.ts:9: `export type EventOptions = Pick<AddEventListenerOptions, "capture" | "passive">`; normalizedOptions (line 1117) and eventKey (line 1124) contain no once handling. git show 198dcfd shows the once fields, tombstone logic, and 126 lines of once tests being deleted.

**Suggested fix:** Before release, either restore `once` support (the deleted implementation and tests exist in history) or update concepts/events.md and remove the once/tombstone paragraphs so the stable spec matches the shipped API.

<details><summary>Verifier note</summary>

Verified in full. concepts/events.md:14 documents the `capture`/`once`/`passive` subset and lines 20-22 specify once-tombstone semantics, but packages/fig-dom/src/events.ts:9 defines EventOptions = Pick<AddEventListenerOptions, "capture" | "passive">, and normalizedOptions (line 1117) / eventKey (line 1124) handle only capture/passive. Commit 198dcfd (Jul 3 22:24) intentionally removed `once` — its own diff updates plans/api-review-2026-07.md to say "the ambiguous declarative `once` option was dropped from Fig event options" — and deleted 126 lines of once tests; the only remaining `once: true` in tests are native signal.addEventListener calls, not Fig's on(). Critically, git merge-base --is-ancestor confirms the concepts consolidation commit 100af0f (Jul 3 23:06) postdates the removal and the stale once text was present in concepts/events.md at its creation, so the stable authoritative spec was written after the feature was dropped, violating the repo rule that contract changes update the owning concept file. Not covered by docs/intentional-differences-from-react.md. Impact is as claimed: TS users get a compile error on { once: true }; JS users get a handler that fires repeatedly. The fix is a small doc edit (or restoring the feature), but a stable spec shipping with a nonexistent API option is worth acting on before release; major severity is appropriate.

</details>

---

### Every commit performs multiple full-tree traversals regardless of update size

- **Where:** `packages/fig-reconciler/src/index.ts:2952`
- **Category:** perf (found by `performance` reviewer)

commitRoot runs at least three walks that visit EVERY fiber in the tree on EVERY commit, even when a single leaf updated: (1) commitLiveHookInstances -> visitFiberHooks, which is documented as 'Deliberately traverses adopted subtrees' and additionally runs isInsideHiddenBoundary(owner) (an O(depth) parent walk) for every stable-event hook; (2) commitExternalStores, which recurses node.child unconditionally (except under hidden boundaries) and calls instance.getSnapshot() for every useExternalStore hook anywhere in the tree on every commit; (3) flushCaughtBoundaryErrors, which recurses child+sibling over the whole tree even when the app has zero error boundaries. Unlike commitMutationEffects/commitDeletions/collectReactiveEffects, none of these honor the AdoptedFlag bailout, so commit cost is O(total fibers), not O(dirty subtree). In a 5-10k fiber app, a keystroke setState pays ~15-30k fiber visits plus hook-chain iteration per commit — a perf cliff React avoids with subtreeFlags. flushCaughtBoundaryErrors is also non-tail recursion over sibling chains, so very wide children lists add stack-depth risk.

**Evidence:** index.ts:2952 `commitLiveHookInstances(finishedWork.child);` ... :2979 `commitExternalStores(finishedWork.child);` ... :2982 `flushCaughtBoundaryErrors(root, finishedWork.child);`; visitFiberHooks (4578-4590): '// Deliberately traverses adopted subtrees' with unconditional `visitFiberHooks(node.child, ...)`; commitExternalStores (4451-4462) recurses unconditionally and commitExternalStore (4483) ends with `scheduleExternalStoreIfChanged(owner, instance)` which calls `instance.getSnapshot()` (4492); flushCaughtBoundaryErrors (3061-3067) recurses node.child and node.sibling with no AdoptedFlag/subtree-flag check.

**Suggested fix:** Track per-fiber 'has hooks needing commit work' / 'has external store' / 'has caught boundary error' bits that bubble like childLanes (or collect fibers into per-root lists during render, the way pendingReactiveEffects already works), so commit walks only the dirty subtree. At minimum, honor AdoptedFlag in flushCaughtBoundaryErrors (error state is set on the boundary during render, so a list of erroring boundaries per commit is trivial) and maintain a per-root registry of live external-store instances instead of rediscovering them via full-tree walks.

<details><summary>Verifier note</summary>

All cited evidence checks out in packages/fig-reconciler/src/index.ts: commitRoot (:2951) unconditionally runs commitLiveHookInstances (:2952), commitExternalStores (:2979), and flushCaughtBoundaryErrors (:2982) every commit. visitFiberHooks (:4578-4590) recurses child+sibling with no AdoptedFlag check ('Deliberately traverses adopted subtrees'), and commitLiveHookInstances runs an O(depth) isInsideHiddenBoundary parent walk (:4428, :4439-4445) per stable-event hook even when no hidden boundaries exist. commitExternalStores (:4451-4462) walks the whole tree and calls user getSnapshot() per external-store hook per commit (:4483→:4492). flushCaughtBoundaryErrors (:3061-3067) recurses the entire tree with no bailout even with zero error boundaries. This is not spec-sanctioned: concepts/rendering.md promises that with AdoptedFlag 'render and the commit mutation/deletion/effect walks all skip the subtree' — and sibling walks like visitEffects (:4570) and collectReactiveEffects (:4511) do honor AdoptedFlag, showing these three are outliers rather than a documented tradeoff. The code comment only explains why correctness needs to reach non-re-rendered hooks under the current structures; per-root registries (as pendingReactiveEffects already demonstrates) would preserve that. No NODE_ENV gating — this is production hot-path cost, O(total fibers) per commit vs React's O(dirty subtree) via subtreeFlags. Mitigating factor: per-visit cost is tiny, so small/medium apps (<~2k fibers) won't observe it, and correctness is unaffected — hence major, not blocker, is the right severity.

</details>

---

### Core packages are exact-pinned regular dependencies instead of peerDependencies — dual-instance hazard for @bgub/fig

- **Where:** `packages/fig-dom/package.json:40`
- **Category:** release-hygiene (found by `release-hygiene` reviewer)

fig-dom, fig-reconciler, fig-server, and fig-refresh declare @bgub/fig / @bgub/fig-reconciler as regular dependencies with `workspace:*`, which pnpm rewrites to the EXACT version on publish (verified via `pnpm pack`: the tarball manifest contains "@bgub/fig": "0.0.1", no range). release-please is configured to bump each package independently, so versions WILL drift: once a user has @bgub/fig@0.0.2 alongside @bgub/fig-dom@0.0.1, the package manager nests a second copy of @bgub/fig@0.0.1 under fig-dom. Fig's hook dispatcher is singleton module state (setCurrentDispatcher re-exported from packages/fig/src/internal.ts:70) — the reconciler sets the dispatcher on ITS copy of fig while user components read hooks from THEIR copy, so every useState/readContext call breaks. Worse, elements are branded with Symbol.for (packages/fig/src/element.ts:106) so elements pass validation across copies, making the failure maximally confusing (the classic two-Reacts problem with no early error).

**Evidence:** packages/fig-dom/package.json: "dependencies": { "@bgub/fig": "workspace:_", "@bgub/fig-reconciler": "workspace:_" } — packed tarball shows "dependencies": { "@bgub/fig": "0.0.1", "@bgub/fig-reconciler": "0.0.1" }. No peerDependencies field exists in any releasing package.

**Suggested fix:** Make @bgub/fig (and @bgub/fig-reconciler where applicable) a peerDependency of fig-dom/fig-server/fig-reconciler/fig-refresh with a range (use `workspace:^` so pnpm publishes "^0.0.1"), keeping a devDependency copy for local builds/tests. At minimum switch workspace:\* to workspace:^ so publish writes a range instead of an exact pin.

<details><summary>Verifier note</summary>

Every link in the chain checks out in the repo. (1) fig-dom, fig-reconciler, fig-server, fig-refresh all declare @bgub/fig / @bgub/fig-reconciler as regular dependencies with `workspace:*` (e.g. packages/fig-dom/package.json:40-41) and no releasing package has a peerDependencies entry for fig core (only fig-start has peers, and those are postcss/tailwind). pnpm publish rewrites `workspace:*` to the exact version, so published manifests pin e.g. "@bgub/fig": "0.0.1". (2) release-please-config.json versions each package independently with no linked-versions/node-workspace plugin and the workflow is a bare release-please-action, so version drift between @bgub/fig and its renderers is inevitable, at which point npm/pnpm nests a second copy of @bgub/fig under fig-dom. (3) The dual-instance failure is real and severe: `currentDispatcher` is module-level singleton state (packages/fig/src/hooks.ts:85) and the reconciler sets it via `import { setCurrentDispatcher } from "@bgub/fig/internal"` (packages/fig-reconciler/src/index.ts:42,1681) — with two copies, the reconciler writes the dispatcher into its copy while user components read hooks from theirs, breaking every useState/readContext. (4) Elements are branded with Symbol.for (packages/fig/src/element.ts:106), so cross-copy elements pass isValidElement and there is no early error — the classic two-Reacts failure mode with maximal confusion. Nothing in concepts/ or docs/ documents this as intentional. The suggested fix (peerDependencies, or at minimum workspace:^) matches how React itself handles react-dom→react. Severity: major is correct — the initial 0.0.1 alpha publish works, but the first independent version bump (guaranteed by the release-please setup) breaks all downstream installs that mix versions, and this is exactly the kind of thing to fix before the imminent release.

</details>

---

### @bgub/fig-refresh is missing from release-please config and manifest — the release automation will never version or release it

- **Where:** `release-please-config.json:5`
- **Category:** release-hygiene (found by `release-hygiene` reviewer)

fig-refresh publishes tomorrow but release-please-config.json lists only fig, fig-server, fig-reconciler, fig-devtools, and fig-dom; .release-please-manifest.json lists only fig, fig-dom, fig-reconciler, fig-server. fig-refresh will get no version bumps, no CHANGELOG, no GitHub releases/tags from the automated flow, silently diverging from its siblings on the very first post-release fix (its exact-pinned "@bgub/fig-reconciler": "0.0.1" dependency then goes stale, compounding the dual-instance issue).

**Evidence:** .release-please-manifest.json: {"packages/fig": "0.0.1", "packages/fig-dom": "0.0.1", "packages/fig-reconciler": "0.0.1", "packages/fig-server": "0.0.1"} — no packages/fig-refresh entry in either file, while packages/fig-devtools IS in the config.

**Suggested fix:** Add packages/fig-refresh to release-please-config.json and .release-please-manifest.json (note it has no jsr.json, so omit the "extra-files" entry or add a jsr.json first).

<details><summary>Verifier note</summary>

The factual core is confirmed. /Users/bgub/code/fig/release-please-config.json lists only packages/fig, fig-server, fig-reconciler, fig-devtools, fig-dom; /Users/bgub/code/fig/.release-please-manifest.json lists only fig, fig-dom, fig-reconciler, fig-server. packages/fig-refresh has no entry in either file, yet its package.json is fully publish-ready: no "private" flag, no restrictive publishConfig, version 0.0.1, "files": ["dist"], repository.directory set — so any recursive publish will ship it, after which release-please will never bump, changelog, or tag it. The workspace has no other mechanism that would cover it (release-please.yml just runs the action with this config; no publish script exists in root package.json). Two corrections to the reviewer's framing: (1) the dependency is "@bgub/fig-reconciler": "workspace:_" in source, not a literal "0.0.1" pin — but pnpm rewrites workspace:_ to the exact current version at publish time, so the published artifact does end up exactly pinned and the divergence/dual-instance concern still materializes on the first reconciler bump; (2) the omission is broader than stated — packages/fig-start and packages/fig-vite are also non-private and missing from both files, and fig-devtools is in the config but missing from the manifest, so the config/manifest pair is internally inconsistent even for configured packages. One caveat tempering severity: the five configured packages are exactly the five with jsr.json files, so it is plausible fig-refresh/fig-start/fig-vite were deliberately left out of release scope — but if so they should be marked "private": true or excluded from publish, which they are not. Either way the current state needs a decision before release (add all three to config+manifest, or mark them private), making this a valid, actionable release-hygiene finding. Severity "major" stands given the imminent publish, though the fix is trivial.

</details>

---

### First npm publish of the scoped packages will fail (or publish privately): no publishConfig.access and no publish step in CI

- **Where:** `packages/fig/package.json:2`
- **Category:** release-hygiene (found by `release-hygiene` reviewer)

None of the five releasing packages are on npm yet (`npm view @bgub/fig` 404s) and none declare "publishConfig": {"access": "public"}. npm/pnpm default new scoped packages to restricted access, so `pnpm publish -r` tomorrow errors with E402 (payment required) on a free account — or, on a paid account, silently publishes them as PRIVATE packages. The release-please workflow only opens release PRs and tags; there is no publish job at all (release-please.yml has zero publish/registry steps despite requesting id-token: write), so nothing in CI passes --access public either.

**Evidence:** grep publishConfig packages/\*/package.json returns nothing; .github/workflows/release-please.yml contains only the googleapis/release-please-action step; `npm view @bgub/fig version` fails (unpublished).

**Suggested fix:** Add "publishConfig": { "access": "public" } to all five releasing package.json files (and add an actual npm-publish job, or document the manual `pnpm publish -r --access public` command).

<details><summary>Verifier note</summary>

All cited evidence verified: no publishConfig in any of packages/\*/package.json (and no private flag, no repo/.npmrc or pnpm-workspace access setting); npm view @bgub/fig returns E404 so the next publish is a first publish of scoped packages, which npm/pnpm default to restricted access (E402 on free accounts, silent private publish on paid ones); .github/workflows/release-please.yml contains only the googleapis/release-please-action step with no publish/registry step despite requesting id-token: write, and no publish command is documented anywhere in scripts/, docs/, or AGENTS.md. release-please-config.json confirms the five releasing packages named in the claim. Nothing in concepts/ or docs/ suggests private publishing is intentional (packages have public homepage/repository/license metadata and jsr.json manifests). Severity major is appropriate: the free-account path fails loudly with a trivial workaround, but the paid-account path silently publishes all five packages as private — a genuine release-hygiene defect to fix before first release.

</details>

---

## Minors (25)

### Preload retention timer evicts value-bearing (refreshing) entries, discarding cached data

- **Where:** `packages/fig/src/data-store.ts:762`
- **Category:** bug (found by `fig-core` reviewer)

The store's documented invariant (comment in abortOrphanedLoad, and the test 'keeps a refreshing entry's value when its last subscriber is released') is that only value-less cache-miss loads may be dropped — 'Evicting those would discard a live value or strand a sibling'. The preload grace-window timer violates this: its eviction check only requires zero subscribers and a pending load, not the absence of a value. Verified scenario: an entry holds a cached fulfilled value, its subscriber unmounts, the entry is invalidated, then preloadData() warms it (starting a background refresh). If the refresh is still in flight when the 30s preload window elapses, the timer evicts the entry — the cached value is destroyed, the refresh is aborted, and refreshData awaiters coalesced onto it settle 'evicted'. A subsequent readData suspends on a cold cache miss instead of returning the stale value, exactly the outcome abortOrphanedLoad was written to prevent.

**Evidence:** retainPreload callback (lines 761-766): `if (entry.subscribers.size === 0 && entry.pending !== null) { this.evictEntry(entry, "evicted"); return; }` — no entryHasValue() guard, unlike abortOrphanedLoad (lines 283-289) which returns early when `entryHasValue(entry)`. Repro test run in-repo: with preloadRetentionMs: 0, invalidate + preloadData on a value-bearing entry whose refresh hangs -> onEntryEvict fires for the key even though inspectDataEntries() showed hasValue: true just before.

**Suggested fix:** In the retainPreload timer callback, mirror abortOrphanedLoad: only evict when `!entryHasValue(entry)`; for value-bearing refreshing entries fall through to scheduleInactiveCleanup (which already correctly defers while pending !== null, letting the refresh settle into the normal inactive-retention path).

<details><summary>Verifier note</summary>

Confirmed by code, spec, and an executed repro. retainPreload's timer (data-store.ts:762-764) evicts on `subscribers.size === 0 && entry.pending !== null` with no entryHasValue() guard, while abortOrphanedLoad (lines 282-290) guards `entryHasValue(entry)` and documents the invariant that value-bearing (refreshing) entries must never be dropped. concepts/data.md draws the same split: preload grace window (30s) is for unclaimed preloads; fulfilled entries with no subscribers follow the inactivity window (5 min). I reproduced the exact scenario with the repo's own test runner (preloadRetentionMs: 0): fulfilled entry -> subscriber released -> invalidateData -> preloadData (refresh hangs) -> snapshot shows hasValue:true, pending:true -> after the window, onEntryEvict fires and the entry is gone, discarding the cached value and aborting the refresh; a coalesced refreshData awaiter settles 'evicted' (matching the existing "reports retention eviction as 'evicted'" test's mechanics). Severity 'minor' is correct: the trigger needs zero subscribers/readers for the full 30s window plus a refresh outlasting it, and the consequence is a cold re-fetch (suspend + latency) rather than permanent data loss. The suggested fix (add !entryHasValue guard, fall through to scheduleInactiveCleanup, which already defers while pending !== null) is consistent with the existing design.

</details>

---

### hydrate() ignores the disposed flag, resurrecting entries in a disposed store

- **Where:** `packages/fig/src/data-store.ts:306`
- **Category:** bug (found by `fig-core` reviewer)

Dispose is documented as terminal: entryFor comments 'A disposed store is terminal: ... post-dispose reads cannot resurrect the cache', and invalidateData/invalidateDataError/invalidateDataKey/invalidateDataPrefix/preloadData/refreshData all guard `if (this.disposed) return ...` (the 'ignores store mutations after dispose' test locks this in). hydrate() has no such guard: hydration entries arriving after dispose create new Entry objects in the disposed store's map and fire host.onEntryChange callbacks into a torn-down renderer host. Concrete scenario (verified with a repro): a streaming payload/SSR handoff delivers data rows after the root unmounts (root.data.hydrate on a disposed per-root store) — inspectDataEntries() returns the resurrected entry and onEntryChange fired, instead of the no-op every other mutation verb guarantees. For existing entries hydrateEntry also mutates them and publish() schedules subscribers on the disposed host.

**Evidence:** Lines 306-329: `hydrate(entries) { for (const hydrated of entries) { ... this.entries.set(storeKey, entry); this.notifyEntryChange(entry); } }` — no `if (this.disposed) return;` while every sibling mutation method (invalidateData line 352, invalidateDataError line 361, invalidateDataKey line 377, invalidateDataPrefix line 386, preloadData line 403, refreshData line 458, startLoad line 629) checks disposed. Repro test run in-repo: dispose() then hydrate([{key: ["late","one"], value: "v"}]) leaves one entry in inspectDataEntries() and one onEntryChange call.

**Suggested fix:** Add `if (this.disposed) return;` at the top of hydrate() to match the terminal-dispose contract of the other mutation verbs.

<details><summary>Verifier note</summary>

The missing guard is real: DefaultDataStore.hydrate (packages/fig/src/data-store.ts:306-329) has no `if (this.disposed) return;` while every sibling mutation verb does (invalidateData:352, invalidateDataError:361, invalidateDataKey:377, invalidateDataPrefix:386, preloadData:403, refreshData:458, startLoad:629), and the entryFor comment (lines 555-557) plus the 'ignores store mutations after dispose' test (data-store.test.ts:489) establish terminal dispose as the contract. Post-dispose hydrate on the raw store does create entries and fire host.onEntryChange, contradicting that contract. This is reachable through documented API: readDataStore() explicitly encourages capturing the handle and using it after awaits (data-store.ts:139-149), and DefaultDataStore.run sets the ambient store to the raw store (`setCurrentDataStore(this)`, line 490), so an effect-captured handle used after unmount hits the unguarded hydrate; FigDataStoreHandle includes hydrate (data.ts:71-72). HOWEVER, the reviewer's headline scenario is wrong: a streaming handoff calling root.data.hydrate after unmount does NOT hit this. root.data is the reconciler wrapper (createRootDataStore, packages/fig-reconciler/src/index.ts:4874-4940), whose dispose() sets `inner = null` (line 4928); post-dispose wrapper.hydrate just re-buffers entries into the dead wrapper (line 4880) — the disposed store's map is never touched and no onEntryChange fires. wrapper.inspectDataEntries() returns []. The fig-server payload client (payload.ts:822, rootData = root.data) goes through the same guarded wrapper, and the only raw-store hydrate call in the repo (reconciler index.ts:846) runs at root creation. So the bug survives only via a user-held readDataStore() handle after unmount — a narrow edge, but the one-line fix matches the contract and severity 'minor' is accurate.

</details>

---

### lazy() permanently caches a rejected loader promise, making chunk-load failures unrecoverable

- **Where:** `packages/fig/src/element.ts:201`
- **Category:** bug (found by `fig-core` reviewer)

lazy() memoizes the loader promise on first render (`promise ??= load()`), and the shared thenable registry (thenables.ts) caches a settled rejection by promise identity forever. If the dynamic import fails once (flaky network, deploy skew 404 on a hashed chunk), every subsequent render of the lazy component rethrows the same cached rejection: an ErrorBoundary retry/remount — the recovery path Fig explicitly designs for elsewhere (invalidateData resets cached data rejections back to pending precisely so 'a remounted ErrorBoundary retries afresh', concepts/data.md) — can never succeed until a full page reload. The data layer got a reset verb for this exact failure class; lazy has no equivalent, so the one transient failure users hit most in production (chunk load error) is the one that is permanently pinned.

**Evidence:** element.ts lines 197-202: `let promise ... = null; return function Lazy(props) { return createElement(readPromise((promise ??= load())), props); };` — promise is never cleared on rejection. thenables.ts readThenable (lines 44-49): `if (record.status === "rejected") throw record.reason;` with the record kept in the process-wide WeakMap, so the same reason is rethrown on every retry render of the same cached promise.

**Suggested fix:** On rejection, reset the memoized promise so the next render attempt calls load() again, e.g. `promise ??= load(); promise.then(undefined, () => { promise = null; }); return createElement(readPromise(promise), props);` (keep the settled-fulfilled fast path; only failed loads become retryable).

<details><summary>Verifier note</summary>

Confirmed by reading the full chain. packages/fig/src/element.ts:197-201 memoizes the loader promise (`promise ??= load()`) and never clears it; packages/fig/src/thenables.ts:44-49 permanently rethrows a cached rejection by promise identity (and the lazy closure holds a strong ref, so the WeakMap record never dies); packages/fig-reconciler/src/index.ts:755-756 shows the reconciler dispatcher's readPromise is a bare readThenable with no retry/reset path. Reset verbs exist only for data resources (invalidateData/invalidateDataError/invalidateDataKey in data-store.ts) — there is no promise/lazy equivalent. So an ErrorBoundary remount (the recovery loop concepts/errors.md explicitly designs for) re-runs Lazy against the same rejected promise and rethrows the same reason forever; a transient chunk-load failure is unrecoverable without a page reload. Nothing in concepts/rendering.md ("a plain component over readPromise") or docs/intentional-differences-from-react.md declares this intentional. It matches React.lazy's known behavior (parity, not a regression), only affects the transient-rejection path, and the fix needs a small design decision about re-fetch timing — so the claimed severity of minor is correct.

</details>

---

### A select defaultValue that appears after mount clobbers the user's live selection

- **Where:** `packages/fig-dom/src/props.ts:424`
- **Category:** bug (found by `fig-dom-props-events` reviewer)

updateSelectOptions deletes the select's state record whenever value and defaultValue are both empty, so the "default already applied" latch is lost. If a defaultValue later appears (common with async-loaded defaults: `<select defaultValue={loaded ? saved : undefined}>`), the next update sees no previous value/defaultValue and no state, so shouldApply is true and setSelectValue overwrites whatever option the user picked in the meantime. This violates the invariant the input path explicitly enforces (setFormProperty comment, lines 328-331: "a defaultValue/defaultChecked that APPEARS on a later update must not clobber what the user typed or toggled since mount").

**Evidence:** Lines 424-427: `if (value === undefined || value === null || value === false) { selectState.delete(element); return; }` followed by lines 437-441 where shouldApply passes because `previousProps.value === undefined && previousProps.defaultValue === undefined && state?.appliedDefault !== true` — state was just deleted on the prior render.

**Suggested fix:** Keep the state record (with appliedDefault latched) when the default disappears, or gate uncontrolled application on the instance's initial render like setFormProperty does with options.initial.

<details><summary>Verifier note</summary>

Confirmed empirically. In packages/fig-dom/src/props.ts, updateSelectOptions (line 424-427) does `selectState.delete(element); return;` whenever both value and defaultValue are empty, so a select mounted without a defaultValue never gets (or loses) its `appliedDefault` latch. When a defaultValue later appears, shouldApply (lines 436-441) evaluates true because previousProps.value/defaultValue are undefined and state is undefined, and setSelectValue overwrites the option the user selected. I reproduced this with the package's own FakeElement test harness: mount `<select>` with no defaultValue, set option A selected (simulating the user), re-render with defaultValue="b" — option B becomes selected (test FAILED expecting A to survive). The identical scenario on `<input>` passes, because setFormProperty gates defaultValue live-writes on `options.initial` (comment at lines 328-331 states the invariant: "a defaultValue/defaultChecked that APPEARS on a later update must not clobber what the user typed or toggled since mount"). Nothing in concepts/intentional-differences-from-react.md sanctions the select divergence — it says "defaultValue owns the default value and HTML representation," and React itself does not re-apply a late defaultValue to an uncontrolled select. The existing test suite only covers defaultValue present from mount, so this gap is untested. Severity: minor is correct — it is real user-visible data loss (a live selection reset), but only in the narrow uncontrolled-select-with-async-appearing-default pattern; controlled selects and defaults present at mount are unaffected.

</details>

---

### Hydration reassigns identical unsafeHTML, destroying and re-parsing the server-rendered subtree

- **Where:** `packages/fig-dom/src/props.ts:64`
- **Category:** bug (found by `fig-dom-props-events` reviewer)

hydrateElement calls updateElement with previousProps = {}, so the unsafeHTML branch sees previous (undefined) !== next (string) and runs setUnsafeHTML, assigning element.innerHTML even though canHydrateInstance already verified `element.innerHTML === expected` (index.ts hasMatchingUnsafeHTML). Assigning innerHTML — even an identical string — discards the existing child nodes and re-parses: iframes inside the trusted HTML reload, media elements restart, user text selection is lost, and hydration pays a pointless parse for every unsafeHTML element.

**Evidence:** props.ts line 177: `updateElement(element, {}, nextProps, { hydrating: true });` and lines 63-66: `if (name === "unsafeHTML") { if (previous !== next) setUnsafeHTML(element, next); continue; }` — with previous always undefined during hydration. index.ts lines 368-373 show equality was already established before matching the node.

**Suggested fix:** Skip the setUnsafeHTML write when options.hydrating is true (the match was verified), or compare against element.innerHTML before assigning.

<details><summary>Verifier note</summary>

Confirmed. hydrateElement (packages/fig-dom/src/props.ts:177) calls updateElement(element, {}, nextProps, { hydrating: true }), and the unsafeHTML branch (props.ts:63-66) checks only `previous !== next` with no hydrating guard — previous is always undefined during hydration, so setUnsafeHTML (props.ts:400-405) unconditionally reassigns element.innerHTML. This is redundant by construction: canHydrateInstance → hasMatchingUnsafeHTML (index.ts:368-373) already established `element.innerHTML === expected`, and a mismatch takes the recovery path (new client element), never reaching hydrateElement. In real browsers, assigning innerHTML — even an identical string — discards children and re-parses, so iframes reload, media restarts, and selection is lost. Notably, other prop families DO gate on hydration (setFormProperty checks `options.hydrating !== true` at props.ts:332; updateSelectOptions at props.ts:433), showing the missing guard is an oversight, not intent; nothing in concepts/ sanctions the rewrite. The existing test (hydration.test.ts:1370) can't catch it because FakeElement.innerHTML is a plain string slot with no child-destruction semantics. Severity minor is accurate: rendered output is identical, harm is limited to live state inside trusted HTML plus a wasted parse.

</details>

---

### Events from a nested Fig root never reach outer-root handlers despite native bubbling

- **Where:** `packages/fig-dom/src/events.ts:504`
- **Category:** bug (found by `fig-dom-props-events` reviewer)

When a second Fig root is mounted inside another root's DOM (widget embeds, modal libraries), a click inside the inner root natively bubbles through the outer root's elements — a raw addEventListener on any of them fires — but Fig's delegated handlers on those outer elements never run: the outer root's delegated listener bails because the nearest registered container for the target is the inner root. Portals get a logical-path compensation (mirrored listeners plus logicalPortalPath); nested roots get nothing, so `events={[on("click", ...)]}` on an ancestor silently drops events that native propagation delivers, contradicting the "native propagation semantics, no exceptions" contract (concepts/events.md). React 17+ deliberately made events bubble to outer roots for exactly this case.

**Evidence:** events.ts line 504: `if (listenerTargetFor(event.target) !== listenerTarget) return;` — listenerTargetFor (lines 978-994) returns the nearest ancestor container with a record (the inner root), so the outer root's dispatchRootEvent returns before extracting any dispatches; unlike portals, no mirror/logical-path mechanism exists for nested roots.

**Suggested fix:** Either dispatch the outer root's path segment (elements between the inner root container and the outer container) when the target's nearest container is a registered root nested inside this root, or document nested-root event scoping as a known limitation next to the shadow-DOM note in tree.ts.

<details><summary>Verifier note</summary>

Confirmed both statically and empirically. Static: in packages/fig-dom/src/events.ts, dispatchRootEvent (line 504) bails with `if (listenerTargetFor(event.target) !== listenerTarget) return;`, and listenerTargetFor (lines 978-994) returns the nearest ancestor container whose record has `portalOwner !== null || record.root` — for a target inside a nested root that is the inner root's container, so the outer root's delegated listener returns before extractDispatches. The inner root's own dispatch cannot compensate: eventPath (lines 911-936) walks only up to its listenerTarget (the inner container), and logicalPortalPath (lines 938-943) returns [] because a plain nested root has no portalOwner — the mirror/logical-path mechanism exists only for portals. Empirical: I wrote a repro test (outer root renders an ancestor div with on("click") containing a host div; a second createRoot mounts a button in the host; click dispatched on the button with the repo's bubbling FakeElement harness). Result log was ['inner-fig', 'outer-raw'] — the inner Fig handler and a raw addEventListener on the outer ancestor both fired, but the outer root's Fig handler did not. This contradicts the stated contract: concepts/events.md and CLAUDE.md say "native propagation semantics, no exceptions", and here a raw listener on an element fires while the Fig events handler on the same element silently drops. Nothing in concepts/events.md, docs/intentional-differences-from-react.md, or code comments documents nested-root event scoping as intentional (the only nearby intent comments cover per-root hydration results and portals). Severity: minor is accurate — nested roots (widget embeds, third-party modal mounts) are a niche scenario and the failure is a silent drop rather than a crash, but it should be fixed or documented as a known limitation before release. Repro test file was removed after verification.

</details>

---

### HMR transform self-accepts modules regardless of non-component exports, leaving importers with stale bindings

- **Where:** `packages/fig-vite/src/transform.ts:80`
- **Category:** bug (found by `fig-dom-tree-hydration` reviewer)

Any module containing at least one top-level PascalCase function gets `import.meta.hot.accept()` appended. If that module also exports plain values or helper functions consumed by other modules (constants, utils, non-component functions), an edit re-executes only this module: importers keep their old bindings, so the running dev app silently mixes old and new code after a hot update — behavior diverges from a fresh load with no error. @vitejs/plugin-react handles this by invalidating (full reload) when a hot-updated module's exports are not all component-like; Fig's transform has no such check.

**Evidence:** transform.ts:79-81 unconditionally appends `if (import.meta.hot) { import.meta.hot.accept(); __figRefresh(); }` whenever components.length > 0, with no inspection of the module's other exports.

**Suggested fix:** Track whether every export of the module is a registered component; when not, call `import.meta.hot.invalidate()` (or skip self-accept) so mixed modules trigger a full reload instead of running stale bindings.

<details><summary>Verifier note</summary>

Confirmed. transform.ts:39,78-82 appends `import.meta.hot.accept()` whenever the module has at least one top-level PascalCase function, with zero inspection of the module's exports; grep shows no `import.meta.hot.invalidate` anywhere in fig-vite or the fig-start dev server, and vite-runtime.test.ts:79 shows the same self-accept is emitted in the new fig-start HMR path. Component exports are safe despite stale importer bindings because the refresh runtime's family registry (`__figReg(C, "id#C")` + reconciler resolving fiber type to `family.current`) provides indirection — but plain-value/helper exports have none, so after an edit importers silently keep old bindings, diverging from a fresh load. This is precisely the mixed-exports hazard @vitejs/plugin-react handles via its isRefreshBoundary check + hot.invalidate(); Fig lacks the equivalent, and nothing in concepts/, docs/, or the HMR plan documents it as an accepted limitation. It is dev-only (plugin is apply:"serve") with no production impact, so the claimed "minor" severity is correct.

</details>

---

### Three unconditional full-tree walks per commit make every commit O(tree size) regardless of what changed

- **Where:** `packages/fig-reconciler/src/index.ts:2952`
- **Category:** perf (found by `fig-reconciler` reviewer)

commitRoot always runs commitLiveHookInstances (visitFiberHooks over the entire tree, deliberately including adopted/bailed-out subtrees), commitExternalStores (full tree — re-reads every useExternalStore snapshot on every commit), and flushCaughtBoundaryErrors (full tree, even when the app has zero error boundaries). Other commit walks (commitMutationEffects, commitDeletions, commitDataDependencies, collectReactiveEffects, visitEffects) prune via AdoptedFlag, but these three visit every fiber and every hook on every commit, so a one-character text update in a 10k-fiber app pays three full traversals plus a getSnapshot call per external store. React avoids exactly this with subtreeFlags/effect lists.

**Evidence:** index.ts:2952 `commitLiveHookInstances(finishedWork.child);`, index.ts:2979 `commitExternalStores(finishedWork.child);`, index.ts:2982 `flushCaughtBoundaryErrors(root, finishedWork.child);` — none consult AdoptedFlag; visitFiberHooks' own comment (index.ts:4576-4577) confirms it deliberately traverses adopted subtrees; commitExternalStore (index.ts:4483) calls scheduleExternalStoreIfChanged → instance.getSnapshot() for every store hook each commit.

**Suggested fix:** Track the presence of stable-event/action-state hooks, external stores, and captured boundary errors with subtree bits (analogous to AdoptedFlag/childLanes) so these walks can prune unchanged subtrees, or maintain per-root registries (e.g. a Set of live external-store instances and a list of boundaries with unreported errors) instead of rediscovering them by full traversal.

<details><summary>Verifier note</summary>

The factual claims all check out in packages/fig-reconciler/src/index.ts. commitRoot (line 2951) unconditionally calls commitLiveHookInstances(finishedWork.child) at 2952, commitExternalStores at 2979, and flushCaughtBoundaryErrors at 2982 on every commit. None of the three prunes: (1) commitLiveHookInstances uses visitFiberHooks (4578-4590), whose recursion visits node.child/node.sibling with no AdoptedFlag or flag check, and its own comment (4576-4577) confirms adopted subtrees are traversed deliberately; (2) commitExternalStores (4451-4462) recurses the whole tree, skipping only hidden-boundary children, and calls commitExternalStore → scheduleExternalStoreIfChanged → instance.getSnapshot() (4492) for every external-store hook every commit; (3) flushCaughtBoundaryErrors (3061-3067) recurses child+sibling unconditionally, visiting every fiber even when the app has no error boundaries. By contrast the other commit walks do prune (commitDeletions at 3165, commitDataDependencies at 3461, collectReactiveEffects at 4511, visitEffects at 4570 all consult AdoptedFlag), so a targeted one-fiber update pays three O(tree) traversals it otherwise wouldn't. This is not an intentional accepted trade-off per the spec — the opposite: concepts/rendering.md (lines 35-37) advertises that adopted subtrees are skipped by "render and the commit mutation/deletion/effect walks," and that bailout cheapness is the stated rationale for Fig having no memo(); these three walks undercut that story. concepts/open-questions.md's Performance section tracks placement perf but not this. Caveats keeping it minor rather than major: the walks are cheap per-node (flag/tag checks and hook-kind comparisons, no host work), the full external-store re-read has a plausible correctness motive (reaching stores in bailed-out subtrees, per the code comment) that a per-root registry would preserve anyway, and no benchmark evidence shows this dominating commit time. Accurate finding, correctly scoped as a minor perf issue; the suggested fixes (subtree bits or per-root registries for store instances and unreported boundary errors) are sound.

</details>

---

### Invalid Date encodes as { value: null } and decodes to the 1970 epoch

- **Where:** `packages/fig-server/src/payload.ts:1192`
- **Category:** bug (found by `fig-server` reviewer)

encodePayloadValueInternal uses `value.toJSON()` for Dates. Per spec, Date.prototype.toJSON returns null when the time value is not finite, so `new Date(NaN)` encodes as `{"$fig":"date","value":null}` (violating the declared `value: string` wire type), and decodePayloadSpecialValue's `new Date(model.value)` turns null into `new Date(0)`. An Invalid Date in server data (a common result of parsing bad user input) silently becomes 1970-01-01 on the client instead of round-tripping or throwing. Verified by repro: encoded `{"$fig":"date","value":null}`, decoded `Wed Dec 31 1969 16:00:00 GMT-0800`.

**Evidence:** `if (value instanceof Date) { return { $fig: "date", value: value.toJSON() }; }` (encode) and `case "date": return new Date(model.value);` (decode, line 1306-1307). Repro output confirms epoch decode.

**Suggested fix:** Either reject invalid dates with a clear serialization error, or encode them explicitly (e.g. value: null -> new Date(NaN) on decode) so the round trip is faithful.

<details><summary>Verifier note</summary>

Confirmed by direct reading and repro. Encode (payload.ts:1192) uses `value.toJSON()`, which per ES spec returns null for a non-finite time value, so `new Date(NaN)` serializes as {"$fig":"date","value":null} — violating the declared wire type `{ $fig: "date"; value: string }` at payload.ts:163. Decode (payload.ts:1306-1307) does `new Date(model.value)`, and `new Date(null)` coerces null to 0, yielding the 1970 epoch; verified with node. This contradicts the file's own conventions: special numbers (NaN/Infinity/-0) get explicit faithful encodings (lines 1246-1249) and unserializable values throw clear errors (functions, cycles, non-plain prototypes), while an Invalid Date silently becomes a valid-looking 1970 date. concepts/payload.md line 56 lists Date as supported with no invalid-date carve-out, so this is not intentional. Severity minor is correct: it is silent data corruption but only on the Invalid Date edge case, and the fix is small (throw or encode null → new Date(NaN) on decode).

</details>

---

### Leading newline in <textarea> value and <pre> text is eaten by the HTML parser (no compensation)

- **Where:** `packages/fig-server/src/html.ts:59`
- **Category:** bug (found by `fig-server` reviewer)

The HTML spec drops a single newline immediately after the <textarea>, <pre>, and <listing> start tags. formTextContent writes the textarea value verbatim (renderer.ts:827-831 writeText(formText)), and renderHostElement writes <pre> children verbatim, so a value/text beginning with "\n" loses that newline when the browser parses the stream: `<textarea defaultValue={"\nline2"}/>` yields a field containing "line2", and `<pre>{"\ntext"}</pre>` renders differently from the client render — a content corruption plus a guaranteed hydration mismatch. React's server renderer emits an extra leading "\n" for exactly this reason; fig-server has no equivalent anywhere (grep for pre/newline compensation comes up empty).

**Evidence:** formTextContent returns the raw value (`return formString(value);`) and renderer.ts writes it directly: `const formText = formTextContent(type, props); if (formText !== null) { writeText(formText, frame.segment); ... }` — no leading-newline doubling for textarea or pre.

**Suggested fix:** When the emitted text content of <textarea> (and the first text child of <pre>/<listing>) starts with "\n", write an extra "\n" first so the parser-consumed newline is the synthetic one.

<details><summary>Verifier note</summary>

The core claim is verified. `formTextContent` (packages/fig-server/src/html.ts:55-60) returns the textarea value verbatim via `formString(value)`, and renderer.ts (~line 827) writes it directly with `writeText(formText, frame.segment)` with no leading-newline compensation; `<pre>` children go through the generic `renderChildren`/`writeText` path with no special-casing either. A grep for "newline" across fig-server, fig-dom, and concepts/ finds only payload-codec (NDJSON) references — there is no compensation anywhere, and nothing in concepts/ or docs/intentional-differences-from-react.md declares this intentional (textarea/pre are not mentioned at all). The existing test (fig-server/src/index.test.ts:1457, expecting `<textarea>Hello &lt;Fig&gt;</textarea>`) confirms the raw emission. Per the HTML spec, the parser drops a single newline immediately after `<textarea>`/`<pre>`/`<listing>` start tags, so `<textarea defaultValue={"\nline2"}/>` and `<pre>{"\ntext"}</pre>` parse with the leading newline lost — React's server renderer prepends an extra "\n" for exactly this case and Fig does not. One part of the claim is overstated: it is NOT a "guaranteed hydration mismatch" error. fig-dom's `canHydrateTextInstance` ignores text content (index.ts `isHydratableText`), `tryHydrateText` always sets UpdateFlag, and commit runs `commitTextUpdate` which silently rewrites nodeValue to "\ntext"; likewise textarea with value/defaultValue skips text hydration entirely (`hydratableFirstChild` returns null) and `setFormValue` rewrites textContent/defaultValue during `hydrateElement`. So hydrated pages self-repair (with a visible pre-hydration content shift and, for textarea, a wrong edit base if the user types before hydration), while non-hydrated output (static export, no-JS, email HTML) is permanently corrupted. Real spec-compliance bug confined to leading-newline values; claimed severity of minor is appropriate.

</details>

---

### In-band head marker collides with user text: a text node equal to " fig:head " is replaced by the document head

- **Where:** `packages/fig-server/src/renderer.ts:1445`
- **Category:** bug (found by `fig-server` reviewer)

Document mode signals the head-injection point by pushing the sentinel string documentHeadMarker (" fig:head ") as an ordinary segment chunk, and writeChunk compares every flushed chunk against it by string equality. escapeText only rewrites &, <, > — the sentinel contains none of those — and each text node is pushed as its own chunk, so a text child whose value is exactly " fig:head " (NUL bytes are legal in JS strings, e.g. hostile data rendered as text) is swallowed and replaced by the head HTML at that position, duplicating <title>/meta tags mid-body and dropping the text.

**Evidence:** renderer.ts:204 `const documentHeadMarker = " fig:head ";`, renderNode writes text via `writeText(String(node), frame.segment)` (one chunk per text node, escaping only &<>), and writeChunk: `if (request.document === null || chunk !== documentHeadMarker) { write(request, chunk); return; } write(request, request.assetRegistry.headHtml(request.nonce));`.

**Suggested fix:** Make the marker out-of-band: represent the head-injection point structurally (e.g. a dedicated child segment or a chunk wrapper object) instead of a magic string compared against escaped user text.

<details><summary>Verifier note</summary>

Confirmed. The sentinel is actually NUL-delimited (" fig:head ", renderer.ts:204), not " fig:head " as the title says, but the described collision is real: the marker is pushed as a plain string chunk (renderer.ts:850 via segment.write, which just does chunks.push), each text node becomes its own chunk (renderer.ts:483 writeText), escapeText (html.ts:271-277) rewrites only &, <, > so NUL bytes pass through verbatim, and writeChunk (renderer.ts:1444-1452) identifies the injection point by string equality on every flushed chunk when request.document !== null. No guard prevents it: the document-shell text check (renderer.ts:477) only applies before <head> exists, there is no NUL stripping anywhere in renderer.ts/html.ts, and no concept doc documents the in-band marker as accepted. A body text child exactly equal to " fig:head " in document mode is dropped and replaced by headHtml plus asset-flush side effects. Severity minor is correct: the trigger requires exact NUL-delimited bytes in rendered text (exotic but reachable from hostile data), and the substituted content is server-generated head HTML, so it is a correctness/robustness bug, not attacker-controlled injection.

</details>

---

### Cyclic objects in element props crash with stack overflow instead of the documented cyclic-value error

- **Where:** `packages/fig-server/src/payload.ts:1134`
- **Category:** bug (found by `fig-server` reviewer)

encodePayloadValueInternal carries a WeakSet and throws "Cannot serialize cyclic values into the payload.", but serializeValue — the codec actually used for element props and any object containing elements/promises — recurses through arrays (line 1131) and records (line 1134) with no seen-tracking. A cyclic object passed as a prop to a client reference recurses until RangeError ("Maximum call stack size exceeded"), which is then emitted as the error row (and, in dev, that unhelpful message crosses the wire) instead of the spec'd cyclic-values diagnostic. concepts/payload.md says the codec "rejects ... cyclic object graphs" — it does, but via stack exhaustion on this path.

**Evidence:** serializeValue: `if (Array.isArray(value)) { return value.map((item) => serializeValue(item, frame)); } return encodePayloadRecord(plainPayloadObject(value), (child) => serializeValue(child, frame));` — no WeakSet, unlike encodePayloadValueInternal's withSeen() guard three functions below.

**Suggested fix:** Thread a seen WeakSet through serializeValue (or share withSeen) so cycles in the renderer-value path throw the same explicit cyclic-values error.

<details><summary>Verifier note</summary>

Confirmed by direct code reading and an empirical probe. In /Users/bgub/code/fig/packages/fig-server/src/payload.ts, serializeValue (line 1108) recurses through arrays (line 1131) and plain records (lines 1134-1136 via encodePayloadRecord) with no seen-tracking, while encodePayloadValueInternal (lines 1163+) guards every container with withSeen() and throws the explicit "Cannot serialize cyclic values into the payload." (line 1255). serializeValue is the path taken for client-reference props (serializeProps, line 1102), so any cyclic plain object or array in props bypasses the guarded codec. I reproduced it through the public API: rendering createElement(Widget, { data: cyc }) where cyc.self = cyc via renderToPayloadStream produced a stack-exhaustion crash whose stack is purely the serializeValue <-> encodePayloadRecord recursion (in this runtime it surfaced as "TypeError: undefined is not a function" at payload.ts:1119, even less helpful than the RangeError the reviewer predicted). concepts/payload.md line 63 states the codec "rejects functions, cyclic object graphs, ..." — the intent is an explicit rejection, and the shared codec delivers one, so this path is an unintended inconsistency, not a documented difference. Mitigating factors that keep severity at minor: the crash is caught by the renderer's error handling and emitted as an error row (id 0, tag "error"), so the server process does not crash and the stream completes; cyclic props are a programming error; and the wire only carries whatever onError returns (digest/message), so leakage of the confusing message is limited to dev-facing diagnostics. The suggested fix (thread a WeakSet through serializeValue) is correct and small.

</details>

---

### Server render abort listener is never removed from the caller's AbortSignal

- **Where:** `packages/fig-server/src/renderer.ts:298`
- **Category:** perf (found by `fig-server` reviewer)

createServerRenderRequest adds an abort listener to options.signal with { once: true } but never removes it when the render completes normally. Each listener closes over the whole Request (segments, buffered HTML chunks, data store). With a long-lived signal shared across requests (e.g. a process-shutdown or server-scoped AbortController, a natural pattern), every completed render leaks its full request graph until the signal fires or is GC'd, growing memory linearly with request count and eventually triggering max-listeners warnings.

**Evidence:** `options.signal.addEventListener("abort", () => abort(request, options.signal?.reason), { once: true });` — no corresponding removeEventListener on close; fatalError/flushCompletedQueues close paths never touch the signal. Contrast readByteStream in payload.ts:1722-1723 which does `signal?.removeEventListener("abort", abort)` in its finally.

**Suggested fix:** Keep a reference to the listener and remove it when the request reaches status "closed" (in flushCompletedQueues' close branch and fatalError).

<details><summary>Verifier note</summary>

Verified in packages/fig-server/src/renderer.ts: lines 297-303 add an abort listener closing over the full Request with { once: true }, and grep confirms no removeEventListener exists anywhere in the file; the terminal paths (fatalError at line 1035 and the status="closed" branch of flushCompletedQueues at line 1091) never touch options.signal, and the signal isn't stored on the Request, so nothing can unhook it on normal completion. once:true only detaches the listener if the signal fires, so with a long-lived shared signal (e.g. a server-scoped shutdown AbortController) each completed render retains its Request (dataStore, assetRegistry, boundary sets, writeBuffer) until the signal fires or is GC'd, and Node warns past 10 listeners on one AbortSignal. The cited contrast holds: readByteStream in payload.ts (lines 1710, 1723) removes its abort listener in a finally, so cleanup is the codebase's own standard elsewhere. Mitigation: React's renderToReadableStream has the same behavior, and per-request signals (the common case) are GC'd with the request, so impact is limited — minor is the right severity.

</details>

---

### Payload renderer's onError drops the ServerErrorInfo argument the spec says is shared with the HTML renderer

- **Where:** `packages/fig-server/src/payload.ts:79`
- **Category:** api-design (found by `api-design` reviewer)

concepts/server-rendering.md defines the error contract as `onError(error, info) => { digest?, message? }` and states it is "Shared by the HTML renderer and the payload renderer". The HTML renderer's ServerRenderOptions.onError receives (error, info: ServerErrorInfo { componentStack }), but PayloadRenderOptions.onError is `(error: unknown) => ServerErrorPayload | undefined` — no info parameter, and the call site (line 1447, `request.onError(error)`) passes nothing. A user sharing one onError handler between renderToStream and renderToPayloadStream gets a compile error (a 2-parameter callback is not assignable to the 1-parameter payload signature), and payload error digests can never incorporate the component stack. Signature divergence on the same documented contract inside one package is exactly the kind of inconsistency that is cheap to fix now and awkward after release.

**Evidence:** packages/fig-server/src/types.ts:19-22: `onError?: (error: unknown, info: ServerErrorInfo) => ServerErrorPayload | undefined` vs packages/fig-server/src/payload.ts:79: `onError?: (error: unknown) => ServerErrorPayload | undefined`, invoked at line 1447 as `request.onError(error) ?? {}`. concepts/server-rendering.md:50-53: "onError(error, info) => { digest?, message? } ... Shared by the HTML renderer and the payload renderer". The payload.ts doc comment (line 74) even claims it is "mirroring the HTML renderer's contract".

**Suggested fix:** Give the payload onError the same (error, info) shape — at minimum info: { componentStack } built from the payload render frame — or explicitly carve out the difference in payload.md and server-rendering.md before release.

<details><summary>Verifier note</summary>

Verified: types.ts:19-22 gives the HTML renderer onError the (error, info: ServerErrorInfo) shape while payload.ts:79 declares onError as (error: unknown) only and invokes it at payload.ts:1447 as request.onError(error) with no info; concepts/server-rendering.md:50-54 and concepts/errors.md:40-43 both explicitly state the onError(error, info) contract is "shared by the HTML renderer and the payload renderer", with no carve-out in payload.md. The TS assignability point is correct — a two-parameter handler written to the documented shared contract is not assignable to the one-parameter payload signature, so sharing one handler fails to compile. The payload renderer also tracks no component stack at all (componentStack exists only in renderer.ts), so info can never be synthesized today. This is a genuine spec/code divergence in a repo whose CLAUDE.md designates concepts/ as the authoritative contract source, so it survives refutation. Severity is downgraded from major to minor: there is no runtime bug (one-parameter handlers behave identically in both renderers), and the fix is backwards compatible even post-release — widening the payload callback to (error, info) keeps existing narrower handlers assignable — so the "cheap now, awkward later" framing is overstated. Worth fixing pre-release (align the signature or carve out the difference in server-rendering.md/errors.md/payload.md), but it is a consistency/documentation defect, not a major API hazard.

</details>

---

### fig-dom re-exports FigRootOptions but not FigRoot (or RecoverableErrorInfo), violating its own types-follow-signatures rule

- **Where:** `packages/fig-dom/src/index.ts:245`
- **Category:** api-design (found by `api-design` reviewer)

concepts/architecture.md: "a package re-exports a type only when that type appears in its own public signatures (types follow signatures — that is what gives consumers semver protection)". FigRoot is the return type of fig-dom's two primary entry points, createRoot and hydrateRoot, and RecoverableErrorInfo appears in FigRootOptions.onRecoverableError — yet fig-dom re-exports only FigRootOptions. Any app that stores a root in a typed variable/field (`let root: FigRoot`) or writes a named onRecoverableError handler must add a direct dependency on @bgub/fig-reconciler, the renderer-authoring package apps are explicitly not supposed to depend on, or resort to ReturnType<typeof createRoot>. This is the first type every typed Fig app needs.

**Evidence:** packages/fig-dom/src/index.ts:245: `export type { FigRootOptions };` while `createRoot(...): FigRoot` (line 250) and `hydrateRoot(...): FigRoot` (line 260) return the non-re-exported type. packages/fig-dom/dist/index.d.ts line 275 export list contains FigRootOptions but no FigRoot or RecoverableErrorInfo, and line 3 shows both are imported from "@bgub/fig-reconciler".

**Suggested fix:** Add `export type { FigRoot, RecoverableErrorInfo }` (alongside FigRootOptions) to packages/fig-dom/src/index.ts.

<details><summary>Verifier note</summary>

Confirmed against the code and spec. concepts/architecture.md lines 10-12 state the types-follow-signatures rule, and packages/fig-dom/src/index.ts violates it: line 245 re-exports only FigRootOptions while createRoot (line 250) and hydrateRoot (line 260) return FigRoot, imported from @bgub/fig-reconciler (line 15) and never re-exported. RecoverableErrorInfo (fig-reconciler/src/index.ts:362) appears in FigRootOptions.onRecoverableError (line 358) and is likewise not re-exported. The existing FigRootOptions re-export proves the rule was meant to apply here, making the FigRoot omission an inconsistency, and architecture.md frames fig-reconciler as the renderer-authoring package apps should not need. No exception exists in concepts/. However, major is overstated: types-only gap, no runtime impact, inference covers unannotated usage, ReturnType<typeof createRoot> is a workaround, and adding the export later is non-breaking — though the one-line fix (export type { FigRoot, FigRootOptions, RecoverableErrorInfo }) is worth taking before release.

</details>

---

### architecture.md lists `Assets` as a @bgub/fig export, but it is only exported from @bgub/fig/internal

- **Where:** `concepts/architecture.md:15`
- **Category:** api-design (found by `api-design` reviewer)

The architecture spec (mirrored in CLAUDE.md) lists the components exported by @bgub/fig as "Fragment, Suspense, Activity, ErrorBoundary, Assets", but packages/fig/src/index.ts does not export Assets — it is defined in element.ts and exported only from the internal entry (packages/fig/src/internal.ts:37). A user following the spec with `import { Assets } from "@bgub/fig"` gets a resolution error. The assets concept and docs steer users to the `assets([...], children)` creator instead, so either the export list in architecture.md/CLAUDE.md is stale or the component export is missing; both spec and code claim to be authoritative the day before release.

**Evidence:** concepts/architecture.md:14-15: "components (`Fragment`, `Suspense`, `Activity`, `ErrorBoundary`, `Assets`)". packages/fig/src/index.ts exports Fragment/Suspense/Activity/ErrorBoundary (lines 27-49) but no Assets; grep shows Assets only in internal.ts:37. concepts/assets.md instead documents `assets([...], children)`.

**Suggested fix:** Either export Assets from the main @bgub/fig entry or drop `Assets` from the component list in concepts/architecture.md and CLAUDE.md (leaving `assets()` as the documented surface).

<details><summary>Verifier note</summary>

Verified: packages/fig/src/index.ts (lines 26-51) exports Fragment, Suspense, Activity, ErrorBoundary but not Assets; Assets is defined in element.ts:114 and exported only from internal.ts:37. Even the package's own index.test.ts imports Assets/isAssets from "./internal.ts" while importing the other components from "./index.ts", confirming the main entry never exposed it. concepts/architecture.md:14-15 nonetheless lists Assets in the @bgub/fig component export list, so `import { Assets } from "@bgub/fig"` per the spec fails. concepts/assets.md documents the assets([...], children) creator (exported at index.ts:84) as the public surface, so the internal-only Assets brand looks intentional and the architecture.md line is stale — the fix is dropping `Assets` from that list. One correction to the claim: the project CLAUDE.md does not mirror the component list (it only links to architecture.md), so only the concept file needs updating. Severity minor is correct: it's a one-word doc/spec inconsistency, but worth fixing pre-release since concepts/ is declared the authoritative spec.

</details>

---

### flushSync discards the callback's return value while sibling batchedUpdates is generic

- **Where:** `packages/fig-reconciler/src/index.ts:903`
- **Category:** api-design (found by `api-design` reviewer)

flushSync is typed `(callback: () => void): void`, so `const rect = flushSync(() => { root.render(x); return node.getBoundingClientRect(); })` — React's flushSync<R>(fn): R pattern, common for measure-after-commit — silently loses the value and types as void. The adjacent batchedUpdates on the same renderer object is `<T>(callback: () => T): T`, so the surface is internally inconsistent. This divergence from React is not listed in docs/intentional-differences-from-react.md (which names flushSync as "the only escape hatch"). Widening the signature later is non-breaking, but shipping the narrow one invites userland wrappers now.

**Evidence:** packages/fig-reconciler/src/index.ts:903: `function flushSync(callback: () => void): void { runWithPriority(SyncLane, callback); ... }` vs line 927: `function batchedUpdates<T>(callback: () => T): T`. fig-dom re-exports it directly (packages/fig-dom/src/index.ts:243: `export const flushSync = renderer.flushSync`).

**Suggested fix:** Make flushSync generic: `flushSync<T>(callback: () => T): T` — runWithPriority already returns the callback result at line 904, so only the annotation changes.

<details><summary>Verifier note</summary>

Verified: flushSync at packages/fig-reconciler/src/index.ts:903 is `(callback: () => void): void` and discards the result of `runWithPriority(SyncLane, callback)`, even though runWithPriority (lanes.ts:366) is already generic `<T>(lane, cb: () => T): T`; batchedUpdates at line 927 is generic on the same renderer object; fig-dom re-exports flushSync directly (packages/fig-dom/src/index.ts:243). The void return is not documented as intentional anywhere — concepts/intentional-differences-from-react.md and concepts/rendering.md only call flushSync 'the only escape hatch' and never specify a return type, so this fails the project's own 'divergences are documented' bar. Two caveats temper it: (1) the reviewer's motivating example is wrong — the callback runs BEFORE the sync flush (line 904 vs. the flush loop at 912-921), so measuring getBoundingClientRect inside the callback reads pre-commit DOM in Fig and in React alike; React's generic return is a convenience for arbitrary values, not post-commit measurement; (2) the batchedUpdates inconsistency is weaker than claimed because concepts/renderer-authoring.md explicitly says batchedUpdates 'is not an app-facing API' (event-dispatch seam only), so the app-facing surface itself isn't inconsistent. Still, the type divergence from React's flushSync<R>(fn): R is real, undocumented, and the fix is a two-line zero-risk change (capture runWithPriority's result, return it after the flush). Valid minor api-design finding; severity 'minor' is correct — widening later is non-breaking, so it is a papercut, not a blocker.

</details>

---

### TransitionHandler injection-slot type is exported from the public @bgub/fig entry instead of /internal

- **Where:** `packages/fig/src/index.ts:108`
- **Category:** api-design (found by `api-design` reviewer)

The main entry exports `type TransitionHandler` alongside `transition`, but TransitionHandler appears in no public signature — transition itself is `<T>(callback: () => T) => T`. TransitionHandler is only the parameter type of setTransitionHandler, the renderer injection slot that architecture.md assigns to @bgub/fig/internal ("injection slots: the render dispatcher and transition handler"). Per the project's own rules (every export has one home; types follow signatures), this type belongs next to setTransitionHandler in internal.ts. Removing a public export after release is breaking; removing it today is free.

**Evidence:** packages/fig/src/index.ts:108: `export { type TransitionHandler, transition } from "./transition.ts";` while packages/fig/src/internal.ts:97 exports only `setTransitionHandler` — the sole consumer of the type (packages/fig/src/transition.ts:1,14).

**Suggested fix:** Move the `type TransitionHandler` export from index.ts to internal.ts next to setTransitionHandler.

<details><summary>Verifier note</summary>

Verified. packages/fig/src/index.ts:108 exports `type TransitionHandler` from the public entry, while packages/fig/src/internal.ts:97 exports only `setTransitionHandler` without its type. In packages/fig/src/transition.ts, `transition` is declared as its own generic function (`function transition<T>(callback: () => T): T`), so TransitionHandler appears in no public signature; its sole use is the parameter of `setTransitionHandler(handler: TransitionHandler)`, the renderer injection slot that concepts/architecture.md explicitly assigns to the internal entry ("injection slots: the render dispatcher and transition handler"). The codebase's own precedent for the other injection slot confirms the correct home: internal.ts:70 exports `type RenderDispatcher` next to `setCurrentDispatcher`, and RenderDispatcher is not in index.ts. The built dist/index.d.ts publicly re-exports TransitionHandler while dist/internal.d.ts omits it, so the type is currently orphaned from its signature — a violation of the project's stated "every export has one home; types follow signatures" rule. The only counterargument — that TransitionHandler could describe `transition`'s shape for users — fails because `transition` is not typed via it and no other package imports the type (fig-reconciler imports only setTransitionHandler). Removing the public export pre-release is free; post-release it would be breaking. Severity minor is correctly stated.

</details>

---

### fig-refresh is publishable but absent from release-please config and has no jsr.json

- **Where:** `release-please-config.json:4`
- **Category:** release-hygiene (found by `api-design` reviewer)

release-please-config.json configures fig, fig-server, fig-reconciler, fig-devtools, and fig-dom (each with a jsr.json extra-file), but @bgub/fig-refresh — a public, non-private package that fig-start depends on via workspace:_ and that pairs with the published @bgub/fig-reconciler/refresh subpath — is missing, and packages/fig-refresh has no jsr.json. If fig-refresh ships tomorrow, its version will never advance through the release automation and it will silently skew against the reconciler it pins exactly; if it is intentionally unreleased, fig-start's workspace:_ dependency on it cannot resolve for any published fig-start.

**Evidence:** release-please-config.json packages block lists only fig, fig-server, fig-reconciler, fig-devtools, fig-dom. packages/fig-refresh/package.json has no "private": true and depends on "@bgub/fig-reconciler": "workspace:\*"; `ls packages/fig-refresh/jsr.json` → No such file or directory, while packages/fig/jsr.json exists.

**Suggested fix:** Add packages/fig-refresh (and a jsr.json) to release-please-config.json, or mark it private/document its release path before publishing packages that reference it.

<details><summary>Verifier note</summary>

Every factual assertion verified: release-please-config.json lists only packages/fig, fig-server, fig-reconciler, fig-devtools, and fig-dom (each with a jsr.json extra-file); packages/fig-refresh has no jsr.json (jsr.json exists in the other five); packages/fig-refresh/package.json has no "private": true and declares "@bgub/fig-reconciler": "workspace:_"; fig-start (line 68) and fig-vite (line 39) both depend on "@bgub/fig-refresh": "workspace:_"; and fig-reconciler exports a "./refresh" subpath, so a published fig-refresh really would pin against the reconciler. concepts/architecture.md line 34 lists @bgub/fig-refresh alongside fig-start/fig-vite/fig-devtools as public scoped packages, and fig-devtools — its layer-mate — IS wired into release-please with a jsr.json, so the omission is inconsistency rather than documented intent; no concepts/plans doc says fig-refresh is deliberately unreleased. The only mitigating context is that fig-start and fig-vite are equally absent from the config and .release-please-manifest.json (which lists only 4 packages), suggesting the whole fig-start layer simply isn't release-wired yet — but none of the three are marked private either, so the gap is real and the claim actually understates its scope (fig-start and fig-vite share it). Severity minor is correct: the five configured packages release fine today; this only bites when the fig-start layer ships, and the fix (add to config + jsr.json, or mark private) is cheap.

</details>

---

### intentional-differences doc still describes data as "a separate package" after the fig-data merge

- **Where:** `concepts/intentional-differences-from-react.md:51`
- **Category:** release-hygiene (found by `api-design` reviewer)

The React-migrant orientation doc — the first thing many release-day readers will open — contains two stale sentences from before the data layer was folded into @bgub/fig: "Data is a separate package (`@bgub/fig`) that renderers never bundle" (a package cannot be separate from itself), and "Data-protocol types ... export from `@bgub/fig`; runtime data APIs export exclusively from `@bgub/fig`" (a distinction with no difference as written; the real split is main entry vs the lazy store-factory bundling trick). Both read as editing accidents and undermine the doc's authority on the exact topic — export homes — the doc is asserting.

**Evidence:** concepts/intentional-differences-from-react.md:51: "Data is a separate package (`@bgub/fig`) that renderers never bundle"; lines 61-63: "Data-protocol _types_ (`FigDataStoreHandle`, ...) export from `@bgub/fig`; runtime data APIs export exclusively from `@bgub/fig`."

**Suggested fix:** Rewrite both bullets to say the data layer lives in @bgub/fig but renderers never bundle the store implementation (the dataResource factory-slot protocol), matching concepts/architecture.md.

<details><summary>Verifier note</summary>

Confirmed by reading the file and its git history. Commit 8eddd10 ("feat(fig)!: fold fig-data into fig", dated today 2026-07-06) did a mechanical find-and-replace of `@bgub/fig-data` → `@bgub/fig` in concepts/intentional-differences-from-react.md, leaving exactly the two nonsensical sentences the reviewer quotes: line 51 now reads "Data is a separate package (`@bgub/fig`) that renderers never bundle" — self-contradictory, since @bgub/fig is the core package and the whole point of the commit was that data is no longer a separate package — and lines 60-62 read "Data-protocol _types_ ... export from `@bgub/fig`; runtime data APIs export exclusively from `@bgub/fig`", a distinction with no content once both sides name the same package. The correct current framing exists in concepts/architecture.md ("Lazy Data-Store Installation": renderers never import the store implementation; resources carry the store factory on an internal symbol, so data-free bundles never ship the store) and in the commit message itself, so this is purely stale prose, not a contested design point. The suggested fix matches architecture.md's documented seam. It is a doc-only defect (no runtime impact) in the React-migrant orientation doc, on the very topic (export homes) the doc asserts authority over, and it is trivially fixable before release — so it stands at the claimed minor severity.

</details>

---

### reconcile() allocates key strings, a nextKeys array, and a Set per parent fiber per render; the Set is populated in production but only read in dev

- **Where:** `packages/fig-reconciler/src/index.ts:2779`
- **Category:** perf (found by `performance` reviewer)

reconcile runs for every non-bailed-out fiber on every render and, before doing anything, allocates `nextKeys: string[]` and `seenKeys: Set<string>()` and computes a string key for every child up front. Three costs: (1) `seenKeys` exists solely for the duplicate-key check, which is gated behind NODE_ENV — but `seenKeys.add(key)` is NOT gated, so production allocates and populates a Set per parent per render for a check that never runs; (2) the common unkeyed fast path compares `fiberChildKey(old) !== nextKeys[index]`, and both `implicitKey(index)` (`.${index}`) and `fiberChildKey` allocate a fresh string per child per render just to compare what could be `old.key === child.key && old.index === index`; (3) even leaf fibers with zero children pay 3 allocations (collectChildren array + nextKeys + seenKeys). Compare React's reconcileChildrenArray, which allocates nothing on the prefix fast path and builds the map lazily only after the first mismatch. Multiplied across a 10k-fiber re-render this is tens of thousands of avoidable allocations of GC churn on the single hottest path in the library.

**Evidence:** index.ts:2778-2783 `const nextKeys: string[] = []; const seenKeys = new Set<string>(); for (...) nextKeys.push(childKey(nextChildren[index], index, seenKeys));` and childKey (4974-4989): `if (process.env.NODE_ENV !== "production" && seenKeys.has(key)) { throw duplicateKeyError(...) } seenKeys.add(key);` — the `.add` is outside the dev gate and seenKeys has no other reader. Fast path comparison at 2799: `if (fiberChildKey(old) !== nextKeys[index] || !sameType(old, child))` where fiberChildKey (4991-4995) builds `` `$${String(key)}` `` or `` `.${index}` `` per call.

**Suggested fix:** Gate seenKeys creation and population behind NODE_ENV (allocate it lazily inside childKey in dev only). Compare raw keys/indices on the fast path (element.key vs fiber.key, index vs fiber.index) instead of materializing prefixed strings, and defer nextKeys/existing-map construction until the prefix loop breaks, mirroring React's two-phase array reconciliation.

<details><summary>Verifier note</summary>

Code facts verified: reconcile (packages/fig-reconciler/src/index.ts:2777-2783) allocates collectChildren array + nextKeys + seenKeys per call; childKey's seenKeys.add (line 4987) is outside the NODE_ENV gate while the only read (line 4984) is dev-gated, so production carries a dead Set — contradicting the project's stated 'dev behavior strips via inline NODE_ENV gates' stance; and the lockstep fast path (line 2799) compares freshly-allocated prefixed strings (fiberChildKey/implicitKey/explicitKey) where raw key/index comparison would allocate nothing. But the claim overstates in two ways: (a) the Set is only populated for explicitly-keyed children (unkeyed children return implicitKey before .add), so the common unkeyed case allocates an empty Set rather than populating one; (b) the 'existing' map at line 2836 is ALREADY built lazily after the first mismatch — plans/reconciler-placement-performance.md Phase 3 (all checkboxes done) deliberately adopted React's two-phase strategy, and the eager flat-collect-with-duplicate-validation was an explicit design choice there. concepts/open-questions.md already tracks that same-order updates trail React, so this is a known, benchmarked gap. Real optimization opportunity (especially gating seenKeys and comparing raw keys on the prefix loop) but unmeasured nursery-GC churn with no correctness impact and half the suggested fix already shipped — minor, not major.

</details>

---

### emitDataRows re-snapshots and re-normalizes the entire data store on every payload task completion (O(tasks x entries))

- **Where:** `packages/fig-server/src/payload.ts:894`
- **Category:** perf (found by `performance` reviewer)

retryTask calls emitDataRows for every task that completes (the root plus every outlined lazy node and promise, once per successful retry). emitDataRows calls request.dataStore.inspectDataEntries(), which allocates a fresh 10-field snapshot object for every entry in the store (data-store.ts:342-346, snapshotEntry 828-842), and then calls normalizeDataResourceKey(snapshot.key) — a full encodeArray re-serialization of the key — for every entry, even though the snapshot already carries the precomputed `canonicalKey`. With T outlined tasks and E cached data entries the payload render performs O(T\*E) snapshot allocations and key encodings just to discover, via the emittedDataKeys Set, that almost all entries were already emitted. A data-heavy page (hundreds of readData entries) with many streamed boundaries pays this on every chunk-producing tick.

**Evidence:** payload.ts:860 `emitDataRows(request);` inside retryTask (runs per task), and 897-907: `for (const snapshot of request.dataStore.inspectDataEntries()) { ... const key = normalizeDataResourceKey(snapshot.key); if (request.emittedDataKeys.has(key)) continue; ... }` — normalizeDataResourceKey (data-store.ts:165-167) calls normalizeKey -> encodeArray on every pass, while DataStoreEntrySnapshot already exposes `canonicalKey` (data-store.ts:831).

**Suggested fix:** Use snapshot.canonicalKey instead of re-normalizing, and replace the full-store rescan with an incremental feed: have the data store record newly-settled entries (or expose an onEntryChange hook, which already exists as notifyEntryChange) into a pending list that emitDataRows drains, making the cost proportional to new data rather than tasks x entries.

<details><summary>Verifier note</summary>

Verified against the code: emitDataRows (payload.ts:894) is called from retryTask (payload.ts:860) on every successful task completion, and iterates request.dataStore.inspectDataEntries(), which allocates a fresh 10-field snapshot for every entry in the store (data-store.ts:342-346, snapshotEntry 828-842). It then calls normalizeDataResourceKey(snapshot.key) (payload.ts:904), re-running normalizeKey/encodeArray per entry per pass, even though snapshot.canonicalKey (data-store.ts:831) already holds the identical precomputed canonical string (entries set canonicalKey = normalizeKey(...).canonical at creation, line 578, and hydration, line 308; encoding is deterministic, so substitution is safe). The emittedDataKeys Set dedupes emission but only after the O(E) snapshot+encode pass runs, so cost is genuinely O(tasks x entries). Not dev-gated, not a cold path (runs per chunk-producing tick of every streamed payload render), and no caller mitigates it. The payload's createDataStore host (payload.ts:488-492) registers no onEntryChange, so the suggested incremental-feed fix is available; concepts/open-questions.md:70 even frames inspectDataEntries/onEntryChange as devtools-facing inspection surface, reinforcing that a full-store snapshot API on the streaming loop is a misuse. Severity is correctly stated as minor: absolute per-pass cost (small allocations plus key encoding) only matters on data-heavy pages with many streamed boundaries, and it is per-request server work, not a per-frame loop.

</details>

---

### PayloadResponse chunk map grows without bound across refresh payloads

- **Where:** `packages/fig-server/src/payload.ts:571`
- **Category:** perf (found by `performance` reviewer)

beginRefreshPayload deliberately offsets each refresh payload's row ids past every id seen so far so new rows cannot clobber still-mounted chunks — but nothing ever evicts the superseded chunks. Every refresh via fetchPayload(..., { refreshBoundary }) appends its full set of model/lazy/promise/client rows to `this.chunks` (and each carries decoded trees via `chunk.decoded` after render), while `boundaries.set(row.boundary, ...)` replaces the boundary model, orphaning the previous refresh's chunk graph forever. A long-lived SPA that refreshes a boundary on navigation/polling accumulates the decoded element trees of every past refresh: memory grows linearly with refresh count for the lifetime of the PayloadResponse.

**Evidence:** payload.ts:571-578 beginRefreshPayload: 'Offset an incoming refresh payload's ids past every id seen so far so its outlined client/lazy/promise rows cannot collide with — and clobber — still-mounted chunks' (`this.rowIdBase = this.maxRowId;`) — collision is prevented by keeping the old rows, and there is no corresponding deletion anywhere: `chunks` (line 541) only ever grows via getOrCreateChunk (1948-1968); processRow's refresh branch (660-669) replaces the boundaries entry but leaves the previous model's outlined chunks resident, including their cached `chunk.decoded` trees.

**Suggested fix:** Track which chunk ids each refresh payload for a given boundary introduced, and delete the previous generation's ids when a newer refresh for the same boundary lands (after its root row decodes). Alternatively, record the id range [rowIdBase of the superseded payload, rowIdBase of the replacement) per boundary and prune it on replacement.

<details><summary>Verifier note</summary>

The core claim holds. In /Users/bgub/code/fig/packages/fig-server/src/payload.ts, `this.chunks` (line 541) is only ever populated via `getChunk` → `getOrCreateChunk` (lines 808-811, 1948+); a repo-wide grep finds no `chunks.delete`/`chunks.clear` anywhere. `beginRefreshPayload` (lines 571-578) deliberately namespaces each refresh's row ids past `maxRowId` precisely so old chunks are kept rather than overwritten, and the refresh branch of `processRow` (lines 660-669) only replaces the `boundaries` map entry, orphaning the superseded generation's outlined model/lazy/promise chunks in the map forever. The scenario is realistic: fig-start's client (/Users/bgub/code/fig/packages/fig-start/src/client.ts) keeps ONE PayloadResponse per mounted server route (`createEntry`/`entryForRoute`) and `control(entry).refresh(url)` re-fetches into that same response with `refreshBoundary: entry.routeId` (lines 507-527), so same-route URL changes, `renderActiveRoute` navigations, and dev-server HMR updates (`refreshActiveRoute`, line 660/832) each append a full payload's chunks to the shared map until the route unmounts. concepts/payload.md documents the id-namespacing and decode-cache-drop behavior but says nothing about eviction being intentional, and concepts/open-questions.md does not track it. One correction to the claimed magnitude: decoded element trees do NOT accumulate — `invalidateDecodeCaches` (lines 705-711) clears `chunk.decoded`/`hasDecoded` on every chunk at each refresh row, and orphaned chunks are never re-read, so only raw serialized models, resolved values, and Map entries are retained per superseded generation, not full decoded trees. That makes growth smaller than described but still unbounded and linear in refresh count. Minor severity is correct: it is retained-memory growth on a long-lived page, not a correctness issue, and each retained generation is raw model data only.

</details>

---

### @bgub/fig is listed in both dependencies and devDependencies of fig-dom and fig-reconciler, and both fields ship in the published manifest

- **Where:** `packages/fig-dom/package.json:44`
- **Category:** release-hygiene (found by `release-hygiene` reviewer)

fig-dom and fig-reconciler each declare "@bgub/fig": "workspace:\*" twice — once in dependencies and again in devDependencies. The duplicate survives into the published tarball manifest (verified via pnpm pack: devDependencies: {"@bgub/fig": "0.0.1"}). npm resolves the conflict in favor of dependencies so installs work, but the published manifest is contradictory, trips linters (npm doctor / publint flag it), and becomes an actual trap if the fix for the peer-dependency finding moves the dependencies entry without deleting this one.

**Evidence:** packages/fig-dom/package.json lines 39-45: "dependencies": {"@bgub/fig": "workspace:_", ...}, "devDependencies": {"@bgub/fig": "workspace:_"}; same duplication at packages/fig-reconciler/package.json lines 45-50.

**Suggested fix:** Delete the devDependencies duplicate in both packages (or keep only the devDependency once @bgub/fig becomes a peerDependency).

<details><summary>Verifier note</summary>

Verified directly: packages/fig-dom/package.json declares "@bgub/fig": "workspace:_" under both "dependencies" (alongside "@bgub/fig-reconciler") and "devDependencies", and packages/fig-reconciler/package.json does the same. Neither package has a publishConfig, and the repo has no clean-publish or manifest-rewriting publish step (root package.json builds via "vp pack" and pnpm pack only rewrites workspace:_ to the version), so the contradictory duplicate ships in the published manifest. It is harmless at install time (npm/pnpm resolve in favor of dependencies) but is genuine release hygiene debt: linters like publint flag it, and it is a latent trap if the dependencies entry is later moved to peerDependencies without deleting the devDependencies duplicate. The fix is a two-line deletion. Claimed severity of minor is correct.

</details>

---

### fig's jsr.json is missing the ./jsx-dev-runtime export and its publish include lists a LICENSE file that does not exist in the package

- **Where:** `packages/fig/jsr.json:8`
- **Category:** release-hygiene (found by `release-hygiene` reviewer)

The npm package.json correctly maps both ./jsx-runtime and ./jsx-dev-runtime, but jsr.json exports only ".", "./internal", "./jsx-runtime", "./server". Any jsr consumer compiling with jsxImportSource in development mode (the default dev transform emits imports from '@bgub/fig/jsx-dev-runtime') gets an unresolvable specifier. Additionally jsr.json's publish.include lists "LICENSE", but the LICENSE file lives at the repo root, not in packages/fig/, so the jsr artifact ships without license text. The jsr.json files are wired into release-please ("extra-files"), so jsr publishing is clearly part of the release story.

**Evidence:** packages/fig/jsr.json exports: {".": ..., "./internal": ..., "./jsx-runtime": "./src/jsx-runtime.ts", "./server": ...} — no "./jsx-dev-runtime"; "include": ["LICENSE", "README.md", "src/**/*.ts"] while `ls packages/fig/LICENSE*` finds nothing (LICENSE is at repo root only).

**Suggested fix:** Add "./jsx-dev-runtime": "./src/jsx-runtime.ts" to jsr.json exports (src/jsx-runtime.ts already exports jsxDEV) and copy LICENSE into each package (or fix the include path) so the jsr artifact carries the MIT text.

<details><summary>Verifier note</summary>

Verified directly: packages/fig/jsr.json exports lack "./jsx-dev-runtime" while the npm package.json maps it (both jsx-runtime and jsx-dev-runtime point at the same file, and src/jsx-runtime.ts already exports jsxDEV via `export { Fragment, jsx as jsxs, jsx as jsxDEV }`), so a JSR consumer using jsxImportSource with the dev transform would get an unresolvable specifier. Also verified LICENSE exists only at the repo root, not in packages/fig/, while jsr.json publish.include lists "LICENSE" — the JSR artifact would ship without license text. release-please-config.json wires jsr.json into extra-files for all packages, confirming JSR is part of the release story. Mitigating factor keeping severity at minor: the release workflow (.github/workflows/release-please.yml) contains no actual jsr publish step yet, so no artifact has shipped broken; this is pre-publish hygiene worth fixing before JSR publishing goes live.

</details>

---

## Refuted (for the record)

- **insertAssetResources does not gate on critical stylesheets adopted from SSR/host DOM that are still loading** (`packages/fig-dom/src/asset-resources.ts`) — The code does behave exactly as the reviewer describes (asset-resources.ts:271-279: adoption sets `ready: null`, so only Fig-inserted, still-pending sheets contribute gates), but this is documented, tested, intentional behavior — not a bug. Three pieces of evidence: (1) The spec deliberately scopes the join-gate rule: concepts/assets.md:48-49 says "If a later payload depends on a stylesheet _Fig already inserted_ and that sheet is still loading, it joins the existing gate" — the same scoping as

- **fig-dom is the only published package without "sideEffects": false** (`packages/fig-dom/package.json`) — The omission is deliberate, not an oversight. Commit 25e882d ("chore: clean up package manifests for publish", 2026-07-02) explicitly REMOVED "sideEffects": false from packages/fig-dom/package.json, and the commit message states the reason: "fig-dom and fig-scheduler drop sideEffects:false — both run real module-scope side effects (renderer/event-batching wiring, a live MessageChannel)." The wiring the reviewer cites (packages/fig-dom/src/index.ts:239-241) is exactly what the maintainer already

- **updateElement allocates a Set-union of prop names for every host element update** (`packages/fig-dom/src/props.ts`) — The code shape is as described (props.ts:44-47 builds a Set union; fig-dom/src/index.ts:163 wires updateElement as commitUpdate), but the perf claim does not hold up as actionable. The reconciler gates commitUpdate behind hostPropsChanged (fig-reconciler/src/index.ts:2895-2899, hostUpdateFlags), so updateElement runs only for host fibers whose props actually changed, and when it runs the loop body does far heavier work per name (regex event() tests, setAttribute/CSSOM style writes, form live-val

- **Non-releasing packages (fig-start, fig-vite, fig-devtools) are not marked private, and fig-devtools is in the release-please config** (`release-please-config.json`) — The raw observations check out (no package under packages/ has "private": true, and release-please-config.json line 21 lists packages/fig-devtools), but the harm story collapses on inspection. (1) The claim's premise that fig-devtools is "explicitly not in the release set" is contradicted by the repo itself: fig-devtools was added to release-please-config.json deliberately in the same commit that created the package (8b0b876 "feat: add Fig DevTools"), and it is the only non-manifest package that

- **fig-refresh publishes with no README (blank npm page) and, unlike every sibling, no jsr.json** (`packages/fig-refresh/package.json`) — The raw facts check out (packages/fig-refresh has no README.md and no jsr.json; the packed tarball would contain only dist + package.json + LICENSE), but the claim's release-impact framing is wrong on every load-bearing point. (1) fig-refresh is not a "releasing package": /Users/bgub/code/fig/release-please-config.json lists exactly five packages (fig, fig-server, fig-reconciler, fig-devtools, fig-dom) — fig-refresh is absent, so there is no npm page going live and nothing "silently dropping out

# Addendum — external agent findings, independently verified (2026-07-06)

A second review agent contributed 10 claims. Three duplicated findings above (payload `allReady` unhandled rejection = major; `hydrate()` on disposed store = minor; fig jsr.json missing `./jsx-dev-runtime` = minor) — treat those as corroborated. The remaining seven were adversarially verified: 5 confirmed, 2 refuted.

## Confirmed

### Direct/non-delegated event handlers lose root scope — MAJOR (bug)

- **Where:** `packages/fig-dom/src/events.ts:764`

`addEventSlot` creates slots with `root: null` and only `attachDelegatedEventSlot` (line 811) assigns `slot.root`; `attachDirectEventSlot` never does, so its dispatch runs `runWithRootScope(null, ...)` and skips the `root.data.run` scope. **Verified with a repro:** a `click` handler resolves `readDataStore()` fine, while `focus` and `scroll` handlers on the same element throw "readDataStore() must be called synchronously while Fig is executing...". Affects every non-delegated event type (load, error, focus, blur, scroll, media events, mouseenter/pointerenter). Violates concepts/data.md ("Ambient Store Vs Explicit Handle" — no direct/delegated carve-out).

**Fix:** assign `slot.root` in `attachDirectEventSlot` (and clear it in `detachDirectEventSlot`).

### Uncaught useReactive errors bypass root recovery — MAJOR (bug)

- **Where:** `packages/fig-reconciler/src/index.ts:4543` (throw at 4639 via `flushReactiveEffects` at 4559)

Reactive effects flush from a scheduler callback with no `performRoot` frame, so the catch at index.ts:985-1022 that calls `clearRootAfterUncaughtError`/`reportUncaughtError` never runs: `onUncaughtError` is not invoked and the committed UI stays in the container. **Verified with a repro** (uncaught `useReactive` throw, `onUncaughtError` registered, no ErrorBoundary → unhandled exception, handler never called). Contradicts concepts/errors.md:31-33 ("scheduler ticks never die silently") and the code's own comment at index.ts:1012-1015. The alternate flush path inside `performRoot` (index.ts:1093) routes correctly, proving the gap is unintended. Also strands remaining queued scheduler tasks until the next `scheduleCallback`.

### Suspended sibling retries regenerate wrong useId paths — MAJOR (bug)

- **Where:** `packages/fig-server/src/renderer.ts:507` (`withIdSegment` at 516-531)

`withIdSegment` restores the parent `idPath` in its `finally` before `spawnSuspendedTask(frame, children.slice(index), error)` runs, so the forked task loses the suspended child's sibling index and the retry re-indexes the sliced children from 0. **Verified with a repro:** `<Suspense>` with [Field(useId), Suspender(readPromise+useId), Field(useId)] — baseline emits `fig-0-0-0-0`/`fig-0-0-1-0`/`fig-0-0-2-0`; the suspended/retried render emits `fig-0-0-0-0` for BOTH the first Field and the Suspender (duplicate DOM id in served HTML) and `fig-0-0-1-0` for the trailing Field. Client hydration derives ids from real fiber indices (`fig-reconciler/src/index.ts:2553-2569`), so every `useId` at-or-after a suspended sibling drifts from hydration — breaks label/aria wiring in a mainstream streaming pattern.

### JSR: fig-dom / fig-reconciler are not publishable as-is — MAJOR gated on JSR intent (release-hygiene)

- **Where:** `packages/fig-dom/src/index.ts:239, 285`, `packages/fig-dom/src/jsx.ts:59`, `packages/fig-reconciler/src/index.ts:680`

Reproduced with `deno publish --dry-run` (deno 2.8.0): `@bgub/fig` passes cleanly; `@bgub/fig-dom` reports `missing-explicit-type` at index.ts:239 (`const renderer = createRenderer(hostConfig)`), `missing-explicit-return-type` at index.ts:285 (`createPortal`), `unsupported-ambient-module` at jsx.ts:59 (`declare module "@bgub/fig/jsx-runtime"`); `@bgub/fig-reconciler` reports `missing-explicit-return-type` at index.ts:680 (`createRenderer`). Both also fail Deno's plain type-check (implicit anys + stale `packages/fig/dist` chunk refs). Context: no jsr/deno publish step exists in any workflow, and nothing is on JSR yet — this gates the intended JSR release, not tomorrow's npm publish.

### JSR export maps diverge from npm/docs — MINOR (release-hygiene; extends the jsr.json finding above)

- **Where:** `packages/fig/jsr.json`, `packages/fig-server/jsr.json`

fig's jsr.json omits `./jsx-dev-runtime` (dev-mode automatic JSX unimportable on JSR); fig-server's jsr.json exports only `"."`, omitting `./payload` — the entry documented throughout docs/6-payload.md, concepts/payload.md, docs/2-quickstart.md, and CLAUDE.md.

### HTML Suspense boundary errors default to {} even in development — MINOR (spec divergence)

- **Where:** `packages/fig-server/src/renderer.ts:1387-1398`

`reportBoundaryError` returns `request.onError?.(error, info) ?? {}` with no NODE_ENV branch, so dev renders without a handler emit empty `data-dgst`/`data-msg`. The payload renderer (`payload.ts:1436-1451`) implements the spec'd dev default (`{ message }`), and concepts/server-rendering.md:51-53 + intentional-differences-from-react.md:72-75 require it of BOTH renderers; commit 67614bd even claims payload was aligned to an HTML contract HTML never implemented. Minor: safe direction (no prod leak), error resurfaces client-side on hydration. Two-line fix mirroring payload.ts.

### Side-fact worth an explicit decision

fig-refresh is absent from release-please config, the manifest, AND has no jsr.json — the automation currently treats it like non-releasing fig-start/fig-vite, and no publishable package depends on it (fig-dom's `./refresh` is its own `src/refresh.ts`). Decide explicitly whether fig-refresh is in the release set; if yes, wire it into release-please (per the major finding above).

## Refuted

- **Payload asset serialization dedupes by key without conflict checking** (`payload.ts:1531`) — cannot cause wrong metadata to load: the client's `insertAssetResources` (fig-dom/src/asset-resources.ts:262-281) is key-authoritative first-wins, so a conflicting second descriptor would be dropped at insertion anyway; descriptor-only wire dedupe is documented intent (payload.ts:1554-1556, plans/asset-resources.md:393-395), and same-key conflict detection outside the SSR registry is a tracked future dev diagnostic.
- **Fast Refresh misses roots created before the handler is installed** (`fig-reconciler/src/index.ts:791`) — code reads as claimed, but the vite transform unshifts the `virtual:fig-refresh` import to the top of every component module and that module installs the handler at top level, so ESM ordering guarantees installation before any `createRoot` in every real flow (verified against demo-hmr and fig-start wiring). Only reachable if an entry's entire static import graph contains zero components — hardening note at most.
