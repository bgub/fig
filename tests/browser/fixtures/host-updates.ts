import { createElement } from "@bgub/fig";
import { createRoot, flushSync } from "@bgub/fig-dom";

const container = document.getElementById("root");
if (container === null) throw new Error("Missing host update fixture root.");
const root = createRoot(container);

function render(controlled: boolean): void {
  flushSync(() =>
    root.render(
      createElement(
        "select",
        { multiple: true, value: controlled ? "b" : undefined },
        createElement("option", { value: "a" }, "A"),
        createElement("option", { value: controlled ? "b" : "c" }, "B"),
      ),
    ),
  );
}

declare global {
  interface Window {
    hostUpdateFixture: { render: typeof render };
  }
}

window.hostUpdateFixture = { render };
