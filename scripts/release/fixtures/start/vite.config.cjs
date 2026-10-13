module.exports = async () => {
  const { tanstackStart } =
    await import("@bgub/fig-tanstack-start/plugin/vite");
  return {
    plugins: [tanstackStart()],
    oxc: { jsx: { importSource: "@bgub/fig-dom" } },
    logLevel: "warn",
  };
};
