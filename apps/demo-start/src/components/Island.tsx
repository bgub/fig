import { type FigNode, useState } from "@bgub/fig";
import { on } from "@bgub/fig-dom";
import islandMarkHref from "./fig-mark.svg";

// Imported by a `.server.tsx` route, so the Start Vite plugin rewrites this
// component into a client reference for the payload stream.
export function Island(): FigNode {
  const [count, setCount] = useState(0);
  return (
    <button
      class="mt-1 inline-grid max-w-full cursor-pointer grid-cols-[36px_minmax(0,1fr)] items-center gap-2.5 rounded-lg border border-teal-300 bg-slate-50 px-3 py-2.5 text-left font-[inherit] text-teal-950 hover:border-teal-700 hover:bg-teal-50"
      events={[on("click", () => setCount(count + 1))]}
    >
      <img alt="" class="block size-9" src={islandMarkHref} />
      <span class="grid min-w-0 gap-0.5">
        <span>Client island</span>
        <span class="text-sm text-teal-700">clicks: {count}</span>
      </span>
    </button>
  );
}
