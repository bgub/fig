import { type FigNode, useState } from "@bgub/fig";
import { on } from "@bgub/fig-dom";

// Edit this component while the dev server runs: the count should survive the
// edit (state-preserving HMR) as long as the hooks don't change.
export function Counter(): FigNode {
  const [count, setCount] = useState(0);

  return (
    <div class="counter">
      <h1>Fig HMR</h1>
      <p>count: {count}</p>
      <button events={[on("click", () => setCount(count + 1))]}>
        increment
      </button>
    </div>
  );
}
