import { createRoot } from "@bgub/fig-dom";
import { Counter } from "./Counter.tsx";

const container = document.getElementById("root");
if (container === null) throw new Error("Missing #root container.");

createRoot(container).render(<Counter />);
