import { useState } from "@bgub/fig";
import { on } from "@bgub/fig-dom";

export function Counter() {
  const [count, setCount] = useState(0);
  return (
    <button mix={on("click", () => setCount((value) => value + 1))}>
      Count: {count}
    </button>
  );
}
