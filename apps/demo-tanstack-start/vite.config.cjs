module.exports = async () => {
  const { default: tailwindcss } = await import("@tailwindcss/vite");
  const { tanstackStart } =
    await import("@bgub/fig-tanstack-start/plugin/vite");
  const port = Number(process.env.PORT ?? 4185);

  return {
    plugins: [tanstackStart(), tailwindcss()],
    preview: { host: "127.0.0.1", port },
    server: { host: "127.0.0.1", port },
  };
};
