import { useState } from "@bgub/fig";
import { on } from "@bgub/fig-dom";
import type { RefreshButtonProps } from "./shared.ts";

type RefreshHandler = (boundary: string, seed: number) => Promise<void>;

let refreshHandler: RefreshHandler = () => Promise.resolve();

export function setRefreshHandler(handler: RefreshHandler): void {
  refreshHandler = handler;
}

export function RefreshButton({ boundary, seed }: RefreshButtonProps) {
  const [status, setStatus] = useState<"idle" | "pending" | "failed">("idle");
  const [refreshes, setRefreshes] = useState(0);

  return (
    <button
      class="action-button"
      data-refresh-state={status}
      events={[
        on("click", () => {
          const nextSeed = seed + refreshes + 1;
          setStatus("pending");

          void refreshHandler(boundary, nextSeed).then(
            () => {
              setRefreshes((value) => value + 1);
              setStatus("idle");
            },
            () => setStatus("failed"),
          );
        }),
      ]}
      type="button"
    >
      {status === "pending"
        ? "Refreshing..."
        : status === "failed"
          ? "Retry refresh"
          : `Refresh feed (${refreshes})`}
    </button>
  );
}
