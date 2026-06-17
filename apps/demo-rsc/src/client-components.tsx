import { useState, useTransition } from "@bgub/fig";
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
  const [isPending, startTransition] = useTransition();
  const displayStatus = isPending ? "pending" : status;

  return (
    <button
      class="action-button"
      data-refresh-state={displayStatus}
      events={[
        on("click", () => {
          const nextSeed = seed + refreshes + 1;
          startTransition(async () => {
            setStatus("pending");

            try {
              await refreshHandler(boundary, nextSeed);
              setRefreshes((value) => value + 1);
              setStatus("idle");
            } catch {
              setStatus("failed");
            }
          });
        }),
      ]}
      type="button"
    >
      {displayStatus === "pending"
        ? "Refreshing..."
        : displayStatus === "failed"
          ? "Retry refresh"
          : `Refresh feed (${refreshes})`}
    </button>
  );
}
