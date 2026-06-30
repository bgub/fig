import { type FigNode, useState } from "@bgub/fig";
import { on } from "@bgub/fig-dom";

// Imported by a `.server.tsx` route, so the Start Vite plugin rewrites this
// component into a client reference for the RSC payload.
export function Island(): FigNode {
  const [count, setCount] = useState(0);
  return (
    <button class="island" events={[on("click", () => setCount(count + 1))]}>
      island clicks: {count}
    </button>
  );
}
