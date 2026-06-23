import { type FigNode, useState } from "@bgub/fig";
import { on } from "@bgub/fig-dom";

// A client island: imported by a `.server.tsx`, it becomes a client reference
// and hydrates into the server-rendered payload.
export function Island(): FigNode {
  const [count, setCount] = useState(0);
  return (
    <button class="island" events={[on("click", () => setCount(count + 1))]}>
      island clicks: {count}
    </button>
  );
}
