module.exports = async ({ mode }) => {
  const { default: tailwindcss } = await import("@tailwindcss/vite");
  const { tanstackStart } =
    await import("@bgub/fig-tanstack-start/plugin/vite");
  const port = Number(process.env.PORT ?? 4185);
  const development = mode === "development";

  return {
    define: {
      __FIG_DEV__: JSON.stringify(development),
      "process.env.NODE_ENV": JSON.stringify(
        development ? "development" : "production",
      ),
    },
    plugins: [tanstackStart(), tailwindcss()],
    preview: { host: "127.0.0.1", port },
    server: { host: "127.0.0.1", port },
  };
};
