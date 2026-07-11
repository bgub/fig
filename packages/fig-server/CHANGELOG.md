# Changelog

## [1.0.0](https://github.com/bgub/fig/compare/fig-server-v0.0.1...fig-server-v1.0.0) (2026-07-11)


### ⚠ BREAKING CHANGES

* **fig:** FigDataResource and FigDataStoreEntrySnapshot are renamed to DataResource and DataStoreEntrySnapshot.
* **fig:** install @bgub/fig instead of @bgub/fig-data. Imports map 1:1 — @bgub/fig-data → @bgub/fig, /server → @bgub/fig/server, /vite → @bgub/fig/vite, /internal → @bgub/fig/internal.
* **fig-data:** dataResource loaders no longer receive { context }; FigData.Register, RegisteredContext, and the dataContext option on client roots, server renders, payload renders, and StartHandlerOptions are removed.
* **fig:** AbortSignals for useTransition and useActionState
* **fig-server:** symmetric render entry points, drop onShellError
* **fig:** rename useReactiveEvent to useStableEvent
* **fig:** replace Dispatch/SetStateAction with StateSetter, drop FigChild
* **fig-server:** rename the RSC layer to payload

### Features

* add Activity for hiding subtrees with preserved state ([0f531d3](https://github.com/bgub/fig/commit/0f531d32275a0c385ac62a4ccf8de3f9035a3d0b))
* add automatic Start asset manifests ([fece3c8](https://github.com/bgub/fig/commit/fece3c818166019003b0e273d5579c31dbd51ac7))
* add data resource support ([c51f0c2](https://github.com/bgub/fig/commit/c51f0c2c1faeaba93720739cd88154245d1e2963))
* add document resources with head adoption and streaming ([ef7e866](https://github.com/bgub/fig/commit/ef7e8667b6fd2a57ea78193d71e17867e0f0e31e))
* add DOM portals ([9b12c0f](https://github.com/bgub/fig/commit/9b12c0f5e34dcab3a6813c9df0ca33cbd9867863))
* add external store hook ([a7d9b74](https://github.com/bgub/fig/commit/a7d9b74305caa31399cb8c8e9ff81a21fa712554))
* add Fig server component streams ([0e85a16](https://github.com/bgub/fig/commit/0e85a168a52ef86c617f3307f6803c17b26fc992))
* add Fig Start asset resource plumbing ([5f9c31b](https://github.com/bgub/fig/commit/5f9c31bacdaef7200d8609089a853314c95d57b3))
* add lazy component helper ([87b9b66](https://github.com/bgub/fig/commit/87b9b663d48546ed0ce0107284aea24099bdc86a))
* add payload codecs and resource refresh support ([b5e06cd](https://github.com/bgub/fig/commit/b5e06cddba6ff859772b1c926774d3b98fc58b2f))
* add server renderer ([a62335f](https://github.com/bgub/fig/commit/a62335fa2eaca4e592e5dceeef2dd542aa56233e))
* add streaming SSR support and demo ([8519088](https://github.com/bgub/fig/commit/8519088656b5b406ebca90da3a5d409e31db0c84))
* add Suspense server recovery hydration ([8b7c698](https://github.com/bgub/fig/commit/8b7c698c445dc7634d840f9874ee7b5a2ac01f6a))
* add unsafeHTML host prop ([f4f48c4](https://github.com/bgub/fig/commit/f4f48c495cb446e75fb9adb538d8a466278fea31))
* add useActionState ([22b3adc](https://github.com/bgub/fig/commit/22b3adc1e5191167f929db53c1f0c9c5a6496294))
* add useLaggedValue hook ([9beb335](https://github.com/bgub/fig/commit/9beb3357dbab712a01e3858b768bfa573f84d4bd))
* add useReactiveEvent and remove useOnMount ([b720c14](https://github.com/bgub/fig/commit/b720c14cb81217bf56c1ff1b64bb5abeb96c63d4))
* add view transitions ([1c3e2fa](https://github.com/bgub/fig/commit/1c3e2faa1f5ca254344003637f850952a147ab53))
* always strict-render in development ([ec3063f](https://github.com/bgub/fig/commit/ec3063fc0419860796e54c86214038cc6aa08dc0))
* capture and replay events that fire before the client bundle ([cf5f480](https://github.com/bgub/fig/commit/cf5f480090d5232b23973b2e728f98639bef5118))
* **data:** add server resource vite transform ([ad740cf](https://github.com/bgub/fig/commit/ad740cfb2a3a6ef117c8cb994e2ce563f4a48ee0))
* **data:** support server data resources ([2c43bca](https://github.com/bgub/fig/commit/2c43bcaae3618269f315492cb5a5e4f905b47c7d))
* **fig-data:** explicit store handles for async data mutations ([02622bf](https://github.com/bgub/fig/commit/02622bf499eb890c5b261ce804e881df64c5eef0))
* **fig-data:** remove loader and store context ([647a694](https://github.com/bgub/fig/commit/647a694eea63befdb0c3f4a02ee5aa5764028e1d))
* **fig-dom:** add form semantics ([7742a8e](https://github.com/bgub/fig/commit/7742a8ef1c6ee15a6ce07d2da68b653c66cdd6d7))
* **fig-dom:** improve DOM compatibility ([57f0ada](https://github.com/bgub/fig/commit/57f0adae091ac7113f6cf505aff0c32cd0abcb48))
* **fig-dom:** support suppressHydrationWarning on host elements ([8a51b6b](https://github.com/bgub/fig/commit/8a51b6b4065e5234242d714bc5f080436276fccb))
* **fig-server:** collect the render tree for DevTools prerendering ([3735c0e](https://github.com/bgub/fig/commit/3735c0e532e89c401512967c95aa0e59347996ab))
* **fig-server:** prerender for settled, script-free HTML ([eb5c3de](https://github.com/bgub/fig/commit/eb5c3de64b0a7b610e2c0b62cd4f769b74340647))
* **fig-server:** rename the RSC layer to payload ([df215c1](https://github.com/bgub/fig/commit/df215c1f999d7c04039533d3db1994d55c2ee51b))
* **fig-server:** support payload graph references ([8361d0c](https://github.com/bgub/fig/commit/8361d0cd8b1f88da24b8a7cb0eefccd061aa834c))
* **fig-server:** symmetric render entry points, drop onShellError ([f196330](https://github.com/bgub/fig/commit/f19633018c76f9e99454a8eefbfa23e495cf09ee))
* **fig-start:** add dev server hmr and payload patching ([3439e80](https://github.com/bgub/fig/commit/3439e80f581745af1aea5ed910a9542608474f7d))
* **fig:** AbortSignals for useTransition and useActionState ([2ef4778](https://github.com/bgub/fig/commit/2ef4778db4a04c0f4fccf116ff5a48e865be34c1))
* **fig:** add error boundaries ([a413c3c](https://github.com/bgub/fig/commit/a413c3c6c5d42cfb56902a6fb83f6d52c6aa979e))
* **fig:** add memo hooks ([db4dc77](https://github.com/bgub/fig/commit/db4dc77c14b5acf03d04b36e8c3be3a4deadcfac))
* **fig:** add useId and useTransition ([66edd6b](https://github.com/bgub/fig/commit/66edd6be32fd688356ca0c3c79f0cf4920cbc96d))
* **fig:** fold fig-data into fig ([8eddd10](https://github.com/bgub/fig/commit/8eddd10c13546a7ad637db92e63da3eed72d5fca))
* **fig:** promote data-protocol types to the public entry ([b079199](https://github.com/bgub/fig/commit/b0791992041922be4d18fda62b0b8e184f70b433))
* **fig:** rename useReactiveEvent to useStableEvent ([9723719](https://github.com/bgub/fig/commit/97237190b20c5b0f346ea5a8ad59cf22f6d4d500))
* **fig:** replace Dispatch/SetStateAction with StateSetter, drop FigChild ([d4033f0](https://github.com/bgub/fig/commit/d4033f0fc4c9104ad729bdea3d515f956cfdeb08))
* implement inert Activity hydration ([e2cfb9b](https://github.com/bgub/fig/commit/e2cfb9b4da806af290eeffdf321df4b59a584ec4))
* serialize client-reference asset resources in RSC (Phase 2) ([426bd26](https://github.com/bgub/fig/commit/426bd269426dc9b6e8d9b5ca2a3911bafd8bdc4f))
* support SSR client references in Fig Start ([12a02eb](https://github.com/bgub/fig/commit/12a02ebe7b3b82a40300a8b6f5e911f2f8b9af12))
* validate DOM nesting in dev on client and server ([0b05769](https://github.com/bgub/fig/commit/0b057692db311251876f9b8ffe256b95055fb024))


### Bug Fixes

* address api-surface refactor regressions ([b794ea1](https://github.com/bgub/fig/commit/b794ea1be4f8930eaa9892804f7fc53645261225))
* align server identifier prefixes with React ([b3e013b](https://github.com/bgub/fig/commit/b3e013b661740f3a73a1f5c53028ecc8a1e96e58))
* asset-resource review findings (fix-now batch) ([09b73ae](https://github.com/bgub/fig/commit/09b73ae691aab6585a3a13500aaa73bd0d4f8cff))
* asset-resource review findings (Phases 1-3) ([f6965f9](https://github.com/bgub/fig/commit/f6965f9db7a1c547e2211ab7626b4be7f274caa9))
* clear remaining prerelease majors ([34a5dfa](https://github.com/bgub/fig/commit/34a5dfa79735787fc3be7649be74aaa0a1e6fa36))
* close prerelease edge cases ([7a13fd8](https://github.com/bgub/fig/commit/7a13fd833c6fd915279ad5a0e6a118256b728a3e))
* close prerelease payload and dom gaps ([f5ef0ad](https://github.com/bgub/fig/commit/f5ef0ad331a310d67d6f99af834b34d4bd78433c))
* close remaining prerelease review items ([353aac1](https://github.com/bgub/fig/commit/353aac14c95f4ab7a6661cad7ab6826ddaf42cd9))
* data resource lifecycle and concurrency bugs ([07e9105](https://github.com/bgub/fig/commit/07e910552d50139315c541ae5baad7ea6aed586c))
* data resource lifecycle bugs and demo the APIs ([1602975](https://github.com/bgub/fig/commit/160297529c5a59da82ad0a178771b1747de4c935))
* **fig-server:** handle cancelled RSC requests ([cad56c4](https://github.com/bgub/fig/commit/cad56c4afe730bbe2e88172bd72556f2d0a6cba2))
* **fig-server:** harden payload refresh decoding ([e0fbe19](https://github.com/bgub/fig/commit/e0fbe1985197b08c47ab27fa8267ec9604c8c969))
* **fig-server:** harden payload refresh handling ([a7f2104](https://github.com/bgub/fig/commit/a7f21042bda0d071eadeea518b50c16bd6f065e8))
* **fig-server:** keep payload allReady rejections handled on cancel ([9d43692](https://github.com/bgub/fig/commit/9d43692790fb774539083a7cb70868bb7abba753))
* **fig-server:** keep text seams and useId paths stable across suspense ([e457b78](https://github.com/bgub/fig/commit/e457b78c5ebf6c92724efe9477538f3650898813))
* **fig-server:** preserve form default html state ([f1e7371](https://github.com/bgub/fig/commit/f1e737189c4d714e10e0be1dc4e3767ff0239356))
* **fig-server:** retain live payload graph chunks ([06e65a5](https://github.com/bgub/fig/commit/06e65a539d7ad9445541770dba9872ba929f7725))
* **fig-server:** stop leaking server error messages in RSC rows ([67614bd](https://github.com/bgub/fig/commit/67614bd556145fc38adf9669308a89fc494b976f))
* **fig-server:** structure payload transport failures ([c86d4c3](https://github.com/bgub/fig/commit/c86d4c3a7d6855075c98ed2df257b5a10cf376f5))
* **fig-start:** commit navigations only when the server route can render ([bafe233](https://github.com/bgub/fig/commit/bafe233df81eab8595512775db25c9aea8d55b7b))
* **fig:** align asset and data refresh semantics ([fc8bc90](https://github.com/bgub/fig/commit/fc8bc90f83ed7a473535829b0e53c40197e1464f))
* harden prerelease package metadata ([c8949c2](https://github.com/bgub/fig/commit/c8949c2f565ca08cdecabfde52695460a205458b))
* harden view transitions to match React semantics ([11e1c42](https://github.com/bgub/fig/commit/11e1c42421155bede72d5ac5e5e1b2c88eb88b0f))
* reduce data and payload scan work ([d3a1096](https://github.com/bgub/fig/commit/d3a109640879f6c4af5b28fda5780fb276eee2e2))
* resolve prerelease major runtime issues ([9f9e002](https://github.com/bgub/fig/commit/9f9e002c26a80b39cef5a872837d914107e8eddb))
* resolve prerelease release blockers ([d557f2f](https://github.com/bgub/fig/commit/d557f2f7f8cc93684c2a589cb09e896899ece5d0))
* resolve prerelease review blockers ([1ab730d](https://github.com/bgub/fig/commit/1ab730dd3a0d60ec2d06003c27ab80f6b1ff9277))
* resolve prerelease runtime blockers ([7ec1687](https://github.com/bgub/fig/commit/7ec16875894efba3de8f74a20013c67082418921))
* stream hidden Activity Suspense completions ([75c47b8](https://github.com/bgub/fig/commit/75c47b805de1c7e0c710e7856d4791de7965ebde))
* Suspense hydration protocol edge cases ([5873cc8](https://github.com/bgub/fig/commit/5873cc8fc5c8bf9dde8b591b3f206114d1122bc8))
* tighten release api surfaces ([01ed9ce](https://github.com/bgub/fig/commit/01ed9ce0924c374595a79255e4baf4d43e6b0af4))


### Code Refactoring

* **fig:** unify DataResource and DataStoreEntrySnapshot names ([573d051](https://github.com/bgub/fig/commit/573d051e0bbbec139c04f41b71c67057fcbdf3cf))
