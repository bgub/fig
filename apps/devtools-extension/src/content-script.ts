injectHook();

window.addEventListener("message", (event) => {
  if (event.source !== window || !isPageMessage(event.data)) return;
  chrome.runtime.sendMessage(event.data);
});

function injectHook(): void {
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("hook.js");
  script.async = false;
  script.addEventListener("load", () => script.remove(), { once: true });

  const parent = document.documentElement ?? document.head ?? document.body;
  parent.append(script);
}

function isPageMessage(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;

  const message = value as {
    source?: unknown;
    type?: unknown;
  };

  return (
    message.source === "fig-devtools-extension" &&
    (message.type === "fig-devtools:renderer" ||
      message.type === "fig-devtools:commit")
  );
}
