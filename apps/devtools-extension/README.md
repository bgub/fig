# Fig DevTools

Browser DevTools extension for inspecting Fig apps.

## Build

```sh
vp run --filter @bgub/fig-devtools-extension build
```

## Chrome

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click "Load unpacked".
4. Select `apps/devtools-extension/dist/chrome`.
5. Reload the inspected Fig page.
6. Open Chrome DevTools and select the "Fig" panel.

## Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click "Load Temporary Add-on".
3. Select the file `apps/devtools-extension/dist/firefox/manifest.json`.
4. Reload the inspected Fig page.
5. Open Firefox DevTools and select the "Fig" panel.

Firefox asks for a manifest file, not a directory. Loading
`apps/devtools-extension/dist` will fail because that parent directory only
contains the browser-specific builds.

The extension injects the Fig DevTools hook at `document_start`, so reloading the
inspected page after installing the unpacked extension is expected.
