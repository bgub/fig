# Changelog

## [1.0.0](https://github.com/bgub/fig/compare/fig-reconciler-v0.0.1...fig-reconciler-v1.0.0) (2026-07-11)


### ⚠ BREAKING CHANGES

* **fig:** FigDataResource and FigDataStoreEntrySnapshot are renamed to DataResource and DataStoreEntrySnapshot.
* **fig:** install @bgub/fig instead of @bgub/fig-data. Imports map 1:1 — @bgub/fig-data → @bgub/fig, /server → @bgub/fig/server, /vite → @bgub/fig/vite, /internal → @bgub/fig/internal.
* **fig-data:** dataResource.remote, serverDataResource({ remote }), createRoot({ dataRemoteFetch }), and the no-remote-fetcher refresh status are removed. Declare remote resources with remoteDataResource from @bgub/fig-start/server, or give an isomorphic dataResource a loader that calls your own endpoint.
* **fig-data:** dataResource loaders no longer receive { context }; FigData.Register, RegisteredContext, and the dataContext option on client roots, server renders, payload renders, and StartHandlerOptions are removed.
* **fig:** AbortSignals for useTransition and useActionState
* **fig:** rename useReactiveEvent to useStableEvent
* **fig-reconciler:** drop render(), getCurrentUpdatePriority, and public batchedUpdates
* **fig:** replace Dispatch/SetStateAction with StateSetter, drop FigChild
* **fig-reconciler:** fold the scheduler in as an internal module

### Features

* add Activity for hiding subtrees with preserved state ([0f531d3](https://github.com/bgub/fig/commit/0f531d32275a0c385ac62a4ccf8de3f9035a3d0b))
* add async transition propagation ([765412c](https://github.com/bgub/fig/commit/765412cafea9dd09e11be42d88e3356bf8e4d65e))
* add client Suspense ([cb60a43](https://github.com/bgub/fig/commit/cb60a431a0137e596bf900b98b483c30cd5df0b8))
* add data resource support ([c51f0c2](https://github.com/bgub/fig/commit/c51f0c2c1faeaba93720739cd88154245d1e2963))
* add document resources with head adoption and streaming ([ef7e866](https://github.com/bgub/fig/commit/ef7e8667b6fd2a57ea78193d71e17867e0f0e31e))
* add DOM portals ([9b12c0f](https://github.com/bgub/fig/commit/9b12c0f5e34dcab3a6813c9df0ca33cbd9867863))
* add embeddable Fig devtools ([d53265d](https://github.com/bgub/fig/commit/d53265de5d628edbd35896317270519c3f7715d6))
* add explicit context and promise reads ([9763d4f](https://github.com/bgub/fig/commit/9763d4fe63d2534045f7d5e10a9cbf51f586b11a))
* add external store hook ([a7d9b74](https://github.com/bgub/fig/commit/a7d9b74305caa31399cb8c8e9ff81a21fa712554))
* add Fig DevTools ([8b0b876](https://github.com/bgub/fig/commit/8b0b876576e17229cdc1dbcce569570d14e0a794))
* add hydration event replay ([c900c14](https://github.com/bgub/fig/commit/c900c14742aa6475c7c17b264c08c7cc938d625d))
* add hydration recovery diagnostics ([dbab4fc](https://github.com/bgub/fig/commit/dbab4fc260f8801d735190665da059529840c6f4))
* add hydration root recovery ([87a6c40](https://github.com/bgub/fig/commit/87a6c402cfa6f30f060433dd0c49e8f3ccedf8f2))
* add payload codecs and resource refresh support ([b5e06cd](https://github.com/bgub/fig/commit/b5e06cddba6ff859772b1c926774d3b98fc58b2f))
* add render diagnostics ([1363552](https://github.com/bgub/fig/commit/136355254826dad7dce15f22c9d23d6f837f8cc5))
* add selective Suspense hydration ([0cc9db3](https://github.com/bgub/fig/commit/0cc9db37844059a54d43a32dc80d25e5877157c6))
* add Suspense server recovery hydration ([8b7c698](https://github.com/bgub/fig/commit/8b7c698c445dc7634d840f9874ee7b5a2ac01f6a))
* add transition API ([dff1c01](https://github.com/bgub/fig/commit/dff1c01d312db4755ad71c5b6577f0a87d41cd8f))
* add true (state-preserving) HMR — Fast Refresh for Fig ([4d7584b](https://github.com/bgub/fig/commit/4d7584b44c71dc5c8c5efe0b2bae8c1b9074dbd1))
* add unsafeHTML host prop ([f4f48c4](https://github.com/bgub/fig/commit/f4f48c495cb446e75fb9adb538d8a466278fea31))
* add useActionState ([22b3adc](https://github.com/bgub/fig/commit/22b3adc1e5191167f929db53c1f0c9c5a6496294))
* add useLaggedValue hook ([9beb335](https://github.com/bgub/fig/commit/9beb3357dbab712a01e3858b768bfa573f84d4bd))
* add useReactiveEvent and remove useOnMount ([b720c14](https://github.com/bgub/fig/commit/b720c14cb81217bf56c1ff1b64bb5abeb96c63d4))
* add view transitions ([1c3e2fa](https://github.com/bgub/fig/commit/1c3e2faa1f5ca254344003637f850952a147ab53))
* always strict-render in development ([ec3063f](https://github.com/bgub/fig/commit/ec3063fc0419860796e54c86214038cc6aa08dc0))
* batch dom event updates ([ed4864c](https://github.com/bgub/fig/commit/ed4864c91d9813f6a7ea50c374f6d34eae8c9a66))
* capture and replay events that fire before the client bundle ([cf5f480](https://github.com/bgub/fig/commit/cf5f480090d5232b23973b2e728f98639bef5118))
* **data:** add server resource vite transform ([ad740cf](https://github.com/bgub/fig/commit/ad740cfb2a3a6ef117c8cb994e2ce563f4a48ee0))
* **data:** support server data resources ([2c43bca](https://github.com/bgub/fig/commit/2c43bcaae3618269f315492cb5a5e4f905b47c7d))
* diagnose invalid hook order ([f06909a](https://github.com/bgub/fig/commit/f06909ae46b5e9872da0e3292e7394d409d2721a))
* **fig-data:** add exact-key data invalidation ([f980b69](https://github.com/bgub/fig/commit/f980b69936599842b4e016c6b0daf0a7f7a68a8e))
* **fig-data:** explicit store handles for async data mutations ([02622bf](https://github.com/bgub/fig/commit/02622bf499eb890c5b261ce804e881df64c5eef0))
* **fig-data:** move remote refresh into fig-start ([e4bca20](https://github.com/bgub/fig/commit/e4bca20070e746035cba2c12bf683449390135cc))
* **fig-data:** remove loader and store context ([647a694](https://github.com/bgub/fig/commit/647a694eea63befdb0c3f4a02ee5aa5764028e1d))
* **fig-devtools:** restyle header, add component filter and hover highlights ([6c0e60b](https://github.com/bgub/fig/commit/6c0e60bc13abbfca0143988ec0c2cae9d20febf8))
* **fig-dom:** add act test utility ([0abbcdd](https://github.com/bgub/fig/commit/0abbcdd20fac32fd5978a04f622a07fc4cdf5bd7))
* **fig-dom:** add form semantics ([7742a8e](https://github.com/bgub/fig/commit/7742a8ef1c6ee15a6ce07d2da68b653c66cdd6d7))
* **fig-dom:** improve DOM compatibility ([57f0ada](https://github.com/bgub/fig/commit/57f0adae091ac7113f6cf505aff0c32cd0abcb48))
* **fig:** AbortSignals for useTransition and useActionState ([2ef4778](https://github.com/bgub/fig/commit/2ef4778db4a04c0f4fccf116ff5a48e865be34c1))
* **fig:** add error boundaries ([a413c3c](https://github.com/bgub/fig/commit/a413c3c6c5d42cfb56902a6fb83f6d52c6aa979e))
* **fig:** add memo hooks ([db4dc77](https://github.com/bgub/fig/commit/db4dc77c14b5acf03d04b36e8c3be3a4deadcfac))
* **fig:** add useId and useTransition ([66edd6b](https://github.com/bgub/fig/commit/66edd6be32fd688356ca0c3c79f0cf4920cbc96d))
* **fig:** fold fig-data into fig ([8eddd10](https://github.com/bgub/fig/commit/8eddd10c13546a7ad637db92e63da3eed72d5fca))
* **fig:** pass the caught error to ErrorBoundary function fallbacks ([37beb3e](https://github.com/bgub/fig/commit/37beb3e03e6454cbf76b1de1c61ab3f0b21b4ccd))
* **fig:** promote data-protocol types to the public entry ([b079199](https://github.com/bgub/fig/commit/b0791992041922be4d18fda62b0b8e184f70b433))
* **fig:** rename useReactiveEvent to useStableEvent ([9723719](https://github.com/bgub/fig/commit/97237190b20c5b0f346ea5a8ad59cf22f6d4d500))
* **fig:** replace Dispatch/SetStateAction with StateSetter, drop FigChild ([d4033f0](https://github.com/bgub/fig/commit/d4033f0fc4c9104ad729bdea3d515f956cfdeb08))
* implement inert Activity hydration ([e2cfb9b](https://github.com/bgub/fig/commit/e2cfb9b4da806af290eeffdf321df4b59a584ec4))
* measure view-transition surfaces to cancel still boundaries ([24cac9c](https://github.com/bgub/fig/commit/24cac9cf5192bf7d259ef33be7d4e91fb005431a))
* park view-transition commits instead of freezing the root ([4d36392](https://github.com/bgub/fig/commit/4d3639228c2ecfaf253b1dc12c349538856e2973))
* scaffold fig runtime ([82edf87](https://github.com/bgub/fig/commit/82edf87b4ac9c74f22932920bed3c904e2128657))
* schedule Suspense retries on retry lanes and harden async error paths ([9f1e557](https://github.com/bgub/fig/commit/9f1e557b619bccc937243b373045410a9856a279))
* validate DOM nesting in dev on client and server ([0b05769](https://github.com/bgub/fig/commit/0b057692db311251876f9b8ffe256b95055fb024))


### Bug Fixes

* add Suspense DevTools snapshots ([0618998](https://github.com/bgub/fig/commit/061899875ce9571482a613ad88f6b9f86a172988))
* address api-surface refactor regressions ([b794ea1](https://github.com/bgub/fig/commit/b794ea1be4f8930eaa9892804f7fc53645261225))
* address recent regression issues ([d3dcb46](https://github.com/bgub/fig/commit/d3dcb468a6e0878f93fddef57446b0e1c575db4c))
* clear processed lanes and stale styles ([4cf8ef5](https://github.com/bgub/fig/commit/4cf8ef55f7e7d584e0cd7d1ba5c923e2ac558799))
* close prerelease API and publish type gaps ([07394cc](https://github.com/bgub/fig/commit/07394cc2b978ba418c96833c993da099f0c35f0f))
* close remaining prerelease review items ([353aac1](https://github.com/bgub/fig/commit/353aac14c95f4ab7a6661cad7ab6826ddaf42cd9))
* data resource lifecycle and concurrency bugs ([07e9105](https://github.com/bgub/fig/commit/07e910552d50139315c541ae5baad7ea6aed586c))
* data resource lifecycle bugs and demo the APIs ([1602975](https://github.com/bgub/fig/commit/160297529c5a59da82ad0a178771b1747de4c935))
* exempt hoisted asset resources from hydration matching ([28cc552](https://github.com/bgub/fig/commit/28cc55272702288f0a78487300cb8c1d7440025f))
* **fig-dom:** tear down hydration listeners ([08de72e](https://github.com/bgub/fig/commit/08de72e010fec81703a248ebcbbd2d378a2934c5))
* **fig-reconciler:** harden commit and suspense scheduling ([ae17c2a](https://github.com/bgub/fig/commit/ae17c2a9b105537adb3946364899e755506682cc))
* **fig-reconciler:** harden release paths ([45fe7a4](https://github.com/bgub/fig/commit/45fe7a479ac8a7f56ad12ba95cc4b14fab0a62f8))
* **fig-reconciler:** harden sync flush edge cases ([5a91647](https://github.com/bgub/fig/commit/5a91647157121a58f45af96e3c13ad31920fd368))
* **fig-reconciler:** keep mid-commit updates and recover reactive effect errors ([332fdc2](https://github.com/bgub/fig/commit/332fdc253a5b53ba3542aada5b999208c29c6896))
* **fig-reconciler:** preserve provider context during child bailout ([621b7cf](https://github.com/bgub/fig/commit/621b7cfe474364b7d4f55477f1f0a85cdb782ea6))
* **fig-reconciler:** retry suspense pings for boundaries reused across bailouts ([d5a9bb8](https://github.com/bgub/fig/commit/d5a9bb82679440e10b4fca98fe9d53f0c52cf2d7))
* **fig-reconciler:** scope deletion teardown to the deleted subtree ([2f768c9](https://github.com/bgub/fig/commit/2f768c96377cb226c10408f79c9213c9ee67d118))
* **fig-reconciler:** stop re-entering bailed-out view-transition boundaries ([819b073](https://github.com/bgub/fig/commit/819b073a504715998095aae4b2a975c0cc8051a0))
* harden prerelease package metadata ([c8949c2](https://github.com/bgub/fig/commit/c8949c2f565ca08cdecabfde52695460a205458b))
* harden view transitions to match React semantics ([11e1c42](https://github.com/bgub/fig/commit/11e1c42421155bede72d5ac5e5e1b2c88eb88b0f))
* interrupted render and event cleanup ([bf3cc05](https://github.com/bgub/fig/commit/bf3cc05dc3388d896d26afec7e9571af3ff868e8))
* keep hydrated single-text fiber shape across re-renders ([ad17a50](https://github.com/bgub/fig/commit/ad17a50cf4883e0e170a74b92e216b433466637a))
* keep user form state authoritative and defer hidden binds ([be85ce5](https://github.com/bgub/fig/commit/be85ce5aab11adab68966290174d542a75a552b8))
* move hoisted resource lifecycle to commit phase ([2458793](https://github.com/bgub/fig/commit/245879341dd7ba19302e4c43f2cce031e991d049))
* **reconciler:** avoid duplicate moves for component rows ([5217fa3](https://github.com/bgub/fig/commit/5217fa370af1d3f8b597d38de80208171578787e))
* **reconciler:** harden host text content fast path ([e5bf52d](https://github.com/bgub/fig/commit/e5bf52d7e9c586394bade1d0ad3de9874a96029c))
* **reconciler:** preserve mixed host children with text fast path ([a7ba7ac](https://github.com/bgub/fig/commit/a7ba7ace341d9afe68ef94b8bf3a9ee0431222d4))
* recover after render errors ([f597c3b](https://github.com/bgub/fig/commit/f597c3b3b0d7e18d1407a7b9ea0de2303d9c4de4))
* resolve prerelease major runtime issues ([9f9e002](https://github.com/bgub/fig/commit/9f9e002c26a80b39cef5a872837d914107e8eddb))
* resolve prerelease release blockers ([d557f2f](https://github.com/bgub/fig/commit/d557f2f7f8cc93684c2a589cb09e896899ece5d0))
* resolve prerelease review blockers ([1ab730d](https://github.com/bgub/fig/commit/1ab730dd3a0d60ec2d06003c27ab80f6b1ff9277))
* resolve prerelease runtime blockers ([7ec1687](https://github.com/bgub/fig/commit/7ec16875894efba3de8f74a20013c67082418921))
* reuse alternate fiber trees ([801e726](https://github.com/bgub/fig/commit/801e72652086a758f4c26ebb0c88f4bf3b981664))
* scheduler hang on updates into a hidden re-suspended Suspense primary ([ef96cfc](https://github.com/bgub/fig/commit/ef96cfc54a8486a645699c6cb3f7c4b631e5eb31))
* stale reveal when Suspense re-suspension is driven from inside the boundary ([c5f29d3](https://github.com/bgub/fig/commit/c5f29d36c80f2923f655b45b5df8a86e540dc2ae))
* stream hidden Activity Suspense completions ([75c47b8](https://github.com/bgub/fig/commit/75c47b805de1c7e0c710e7856d4791de7965ebde))
* Suspense hidden primary updates ([7c50c05](https://github.com/bgub/fig/commit/7c50c05599e3b4ab633af32a3563183e2b1014f2))
* Suspense re-suspension retaining stale primary content ([a962d43](https://github.com/bgub/fig/commit/a962d43ce660e5e470c9db079246d1faa6cfa3c3))
* Suspense reveal dropping non-suspending siblings ([8406ae6](https://github.com/bgub/fig/commit/8406ae61d6707b63dfed1021092c854fcbf0a0f8))
* tighten release api surfaces ([01ed9ce](https://github.com/bgub/fig/commit/01ed9ce0924c374595a79255e4baf4d43e6b0af4))
* trim prerelease performance hot paths ([aa53951](https://github.com/bgub/fig/commit/aa5395160c0550a6f2492d1e0bf353616db25bb1))


### Performance Improvements

* bail out clean subtrees without cloning or re-rendering ([2b7eb28](https://github.com/bgub/fig/commit/2b7eb28a862446e01926e19aab097016269e5b34))
* cut production bundle size without behavior changes ([cdfcbd7](https://github.com/bgub/fig/commit/cdfcbd7b15deca9c39dc9e1d9e0356fceb1ab234))
* decouple @bgub/fig-data from renderer bundles ([817cd4b](https://github.com/bgub/fig/commit/817cd4bc4b99f713a9f9a869ab8243e3072dda7d))
* **fig-dom:** target-instance dehydrated boundary lookup ([cfb6331](https://github.com/bgub/fig/commit/cfb6331522067fed93021d4e72325725bb3fcab6))
* **fig-reconciler:** avoid host prop diff allocations ([3c91e9e](https://github.com/bgub/fig/commit/3c91e9e4ba2a2c5cd08393bfae8a3929a4d07948))
* **fig-reconciler:** avoid repeated root and hoist lookups ([34b5a01](https://github.com/bgub/fig/commit/34b5a0185ce5e8d31ee9ce3d70666e8d1fe95217))
* **fig-reconciler:** consolidate boundary fiber state ([e5c89ea](https://github.com/bgub/fig/commit/e5c89eadbe0bab2f88c0762a8fa738bcb561eb94))
* **fig-reconciler:** discover commit work in a render-time queue ([aeec10d](https://github.com/bgub/fig/commit/aeec10d0bea709a3e77ae6b0b3604dae2512a667))
* **fig-reconciler:** prune commit walks with subtree flags ([aec38c8](https://github.com/bgub/fig/commit/aec38c8101748601e40a4de2fbbcce83d9cbc607))
* **fig-reconciler:** prune external store checks ([1aa610e](https://github.com/bgub/fig/commit/1aa610e577cc893e5ba72893cf97d1e087739dab))
* **fig-reconciler:** queue-drive effect and deleted-view-transition commits ([a58989a](https://github.com/bgub/fig/commit/a58989a4fcbf0fc24e438602e428e86f34f252d0))
* **fig-reconciler:** queue-drive host updates with view-transition attribution ([e13c4fe](https://github.com/bgub/fig/commit/e13c4fed7c4019832a7d6c8fcac63d8772956160))
* **fig-reconciler:** reduce reconciliation key allocations ([1c99a11](https://github.com/bgub/fig/commit/1c99a11c97b8b4c699b505a44cf1c7d3b97648ed))
* **fig-reconciler:** strip refresh matching from production ([9ffdf23](https://github.com/bgub/fig/commit/9ffdf23f6ab6989bab90e9ec3f0e1427c4a57937))
* **fig-reconciler:** switch to lazy context propagation ([284df67](https://github.com/bgub/fig/commit/284df67d7f9bae9ded92e2d07f53b4f57616f630))
* **reconciler:** coalesce adjacent text children ([07a236b](https://github.com/bgub/fig/commit/07a236b00646c42a00f3d8f433fde37e949fea31))
* **reconciler:** fast path text-only host children ([a7d7fc6](https://github.com/bgub/fig/commit/a7d7fc6e010e1fddf23fa4cb8cde842570a18c14))
* **reconciler:** reduce host placement and update work ([3438302](https://github.com/bgub/fig/commit/34383021b7c643c074f3f62f1fb88e922c40ce7c))
* **reconciler:** skip generic host commits for text updates ([c4804d6](https://github.com/bgub/fig/commit/c4804d68e5b1cd205da12398f928cbf1dd4993fc))


### Code Refactoring

* **fig-reconciler:** drop render(), getCurrentUpdatePriority, and public batchedUpdates ([b9e4b2d](https://github.com/bgub/fig/commit/b9e4b2d029e0b85e9c7a4893853e294a928e76d1))
* **fig-reconciler:** fold the scheduler in as an internal module ([ac00c25](https://github.com/bgub/fig/commit/ac00c252fe9a272fa43fa6729670b76f5cb658df))
* **fig:** unify DataResource and DataStoreEntrySnapshot names ([573d051](https://github.com/bgub/fig/commit/573d051e0bbbec139c04f41b71c67057fcbdf3cf))
