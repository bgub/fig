import assert from "node:assert/strict";
import { Window } from "happy-dom";

const window = new Window({ url: "http://localhost/" });
for (const name of [
  "window",
  "document",
  "Node",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLButtonElement",
  "Element",
  "Document",
  "Text",
  "Event",
  "MouseEvent",
  "CustomEvent",
  "MutationObserver",
  "navigator",
]) {
  Object.defineProperty(globalThis, name, {
    value: name === "window" ? window : window[name],
    configurable: true,
  });
}
for (const name of [
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
]) {
  globalThis[name] = window[name].bind(window);
}
const { jsx } = await import("@bgub/fig-dom/jsx-runtime");
const { hydrateRoot } = await import("@bgub/fig-dom");
const { act } = await import("@bgub/fig-dom/test-utils");
const { renderToHtml } = await import("@bgub/fig-server");
const { useTabs } = await import("@bgub/fig-headless/tabs");
const { useCheckbox } = await import("@bgub/fig-headless/checkbox");

function App() {
  const tabs = useTabs({ defaultValue: "a" });
  return jsx("div", {
    children: [
      jsx("div", {
        "aria-label": "Tabs",
        mix: tabs.list(),
        children: [
          jsx("button", { mix: tabs.tab("a"), children: "A" }),
          jsx("button", { mix: tabs.tab("b"), children: "B" }),
        ],
      }),
      jsx("section", { mix: tabs.panel("a"), children: "Alpha" }),
      jsx("section", { mix: tabs.panel("b"), children: "Beta" }),
    ],
  });
}

const host = document.createElement("div");
host.innerHTML = await renderToHtml(jsx(App, {}));
document.body.append(host);
const originalNodes = [...host.querySelectorAll("*")];
const recoveries = [];
let root;
await act(() => {
  root = hydrateRoot(host, jsx(App, {}), {
    onRecoverableError: (error) => recoveries.push(error),
  });
});
const hydratedNodes = [...host.querySelectorAll("*")];
assert.equal(hydratedNodes.length, originalNodes.length);
hydratedNodes.forEach((node, index) =>
  assert.equal(node, originalNodes[index]),
);
assert.deepEqual(recoveries, []);
await act(() => host.querySelectorAll("button")[1].click());
assert.equal(
  host.querySelectorAll("button")[1].getAttribute("aria-selected"),
  "true",
);
assert.equal(host.querySelectorAll("section")[1].hidden, false);
await act(() => root.unmount());

function Invalid() {
  const checkbox = useCheckbox();
  return jsx("div", { mix: checkbox.control() });
}
if (process.execArgv.includes("--conditions=fig-development")) {
  await assert.rejects(
    () => renderToHtml(jsx(Invalid, {})),
    /must be applied to <input>/,
  );
}
await window.happyDOM.close();
console.log(
  process.execArgv.includes("--conditions=fig-development")
    ? "Packed SSR, hydration, interaction, and development diagnostics passed."
    : "Packed SSR, hydration, and interaction passed.",
);
