# Fig pre-release review — 2026-07-07

Multi-agent review of `fig`, `fig-dom`, `fig-reconciler`, `fig-refresh`, and `fig-server` ahead of the planned release (`fig-start`, `fig-devtools`, `fig-vite` excluded as experimental, though a few findings landed in `fig-vite` where it implements fig-refresh's contract).

**Method.** 16 reviewer agents (each package × correctness / performance / API design, plus one release-readiness pass over packaging and exports) produced 80 raw findings. Every finding was then handed to an independent adversarial verifier instructed to refute it against the code on disk — several verifiers wrote and executed repro tests. The workflow was terminated before the last 7 verifiers finished; four findings remain unverified.

**Tally: 0 critical, 0 major, 14 minor confirmed · 4 unverified · 3 refuted.**

Severity scale: **critical** = corrupts state / crashes / silently breaks a headline feature in normal use; **major** = wrong behavior or serious cost in realistic use, or painful to fix post-release; **minor** = real but low-impact.

## Contents

- [Confirmed critical (0)](#confirmed-critical)
- [Confirmed major (0)](#confirmed-major)
- [Confirmed minor (14)](#confirmed-minor)
- [Unverified (4)](#unverified)
- [Refuted (3)](#refuted)

## Confirmed critical

No open confirmed critical findings remain.

## Confirmed major

No open confirmed major findings remain.

## Confirmed minor

### 14. Every refresh row wipes the decoded cache of ALL chunks, forcing a full re-decode and full client re-render of the entire payload tree per refresh.

- **Location:** `packages/fig-server/src/payload.ts:769`
- **Severity:** minor
- **Reviewer:** fig-server:performance

processRow's refresh branch calls this.invalidateDecodeCaches(), which clears decodedBoundaries and sets hasDecoded=false/decoded=undefined on every chunk in this.chunks (lines 824-830). The next render after notify() re-decodes every model row via readChunk (line 905-908), allocating a fresh element tree with new identities for the whole app, so the reconciler bailout that the readChunk comment and concepts/payload.md line 111 promise ('Decoded chunks are memoized so unchanged subtrees bail out of re-renders') is defeated on exactly the hot path refreshes create: a polling PayloadBoundary refreshing every second re-decodes and re-renders the entire payload-rendered app each tick, with cost proportional to total app size rather than the refreshed boundary's size. Only chunks/boundaries reachable from the refreshed boundary's old and new models need invalidation; graph objectRefs already keep shared values stable, so scoped invalidation preserves the documented 'fresh structure for refreshed boundaries' rationale at O(boundary) cost.

<details><summary>Verification</summary>

Confirmed the mechanics against disk: payload.ts:769 refresh branch calls invalidateDecodeCaches() which wipes decodedBoundaries and every chunk's decoded cache (824-830); the next render re-decodes all chunks (readChunk 905-908) with fresh element identities (tree children are serialized with preserveIdentity=false, so only prop-value elements keep graph-id identity), producing an O(app) re-decode + full render-phase pass per refresh. However, the finding is heavily overclaimed: (1) it is documented spec behavior — concepts/payload.md lines 112-113 (the sentence right after the line the reviewer quotes) explicitly say refresh rows clear decoded tree caches, and concepts/ is the repo's authoritative spec, with the mechanism deliberately reworked in the branch's two most recent commits and pinned by tests (payload.test.ts:909, :1330); (2) the wipe is correctness-load-bearing: Fig's reconciler bails on element-identity equality (fig-reconciler/src/index.ts:1737 canBailout props === alternate.memoizedProps, with begin() adopting whole clean subtrees), and PayloadBoundarySlot has no own subscription, so keeping ancestor chunk caches would make the refresh never render — the reviewer's proposed fix (invalidate only chunks reachable FROM the refreshed boundary's models) is downward reachability and would break refresh entirely; a real O(boundary) refresh needs a design change (per-slot lane subscription or reverse chunk-contains-boundary tracking). The residual truth is a documented, intentional per-refresh cost ceiling (render-phase only, no DOM mutations for unchanged content, graph refs keep shared values stable), worth noting as a known tradeoff but not a defect. Severity downgraded from major to minor.

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
