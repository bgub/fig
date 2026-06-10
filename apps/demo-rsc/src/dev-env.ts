// vp pack does not replace process.env.NODE_ENV in browser bundles, so give
// the bundled Fig packages a runtime value. The demos always run in dev mode.
(globalThis as { process?: unknown }).process ??= {
  env: { NODE_ENV: "development" },
};
