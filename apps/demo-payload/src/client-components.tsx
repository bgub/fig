import { useState, useTransition, ViewTransition } from "@bgub/fig";
import { on } from "@bgub/fig-dom";
import type { LikeButtonProps } from "./resource-shared.ts";
import type { AppRefreshButtonProps, RefreshButtonProps } from "./shared.ts";

type RefreshHandler = (boundary: string, seed: number) => Promise<void>;
type AppRefreshHandler = (seed: number) => Promise<void>;

let appRefreshHandler: AppRefreshHandler = () => Promise.resolve();
let refreshHandler: RefreshHandler = () => Promise.resolve();
let nextRefreshSeed = 1;

function claimRefreshSeed(seed: number): number {
  nextRefreshSeed = Math.max(nextRefreshSeed, seed + 1);
  const next = nextRefreshSeed;
  nextRefreshSeed += 1;
  return next;
}

export function setAppRefreshHandler(handler: AppRefreshHandler): void {
  appRefreshHandler = handler;
}

export function setRefreshHandler(handler: RefreshHandler): void {
  refreshHandler = handler;
}

export function AppRefreshButton({ seed }: AppRefreshButtonProps) {
  const [status, setStatus] = useState<"idle" | "pending" | "failed">("idle");
  const [refreshes, setRefreshes] = useState(0);
  const [isPending, startTransition] = useTransition();
  const displayStatus = isPending ? "pending" : status;

  return (
    <ViewTransition
      default="payload-vt"
      name="payload-app-refresh-button"
      update="payload-vt"
    >
      <button
        class="button"
        data-refresh-state={displayStatus}
        events={[
          on("click", () => {
            const nextSeed = claimRefreshSeed(seed);
            startTransition(async () => {
              setStatus("pending");

              try {
                await appRefreshHandler(nextSeed);
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
          ? "Refreshing app..."
          : displayStatus === "failed"
            ? "Retry app refresh"
            : `Refresh app (${refreshes})`}
      </button>
    </ViewTransition>
  );
}

export function RefreshButton({ boundary, label, seed }: RefreshButtonProps) {
  const [status, setStatus] = useState<"idle" | "pending" | "failed">("idle");
  const [refreshes, setRefreshes] = useState(0);
  const [isPending, startTransition] = useTransition();
  const displayStatus = isPending ? "pending" : status;

  return (
    <ViewTransition
      default="payload-vt"
      name={`payload-refresh-button-${boundary}`}
      update="payload-vt"
    >
      <button
        class="action-button"
        data-refresh-state={displayStatus}
        events={[
          on("click", () => {
            const nextSeed = claimRefreshSeed(seed);
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
            : `${label} (${refreshes})`}
      </button>
    </ViewTransition>
  );
}

// The /resource page's interactive island: decoded out of the serialized
// post via resolveClientReference, with ordinary client state.
export function LikeButton({ label }: LikeButtonProps) {
  const [likes, setLikes] = useState(0);

  return (
    <button
      class="action-button"
      data-like-island={label}
      events={[on("click", () => setLikes((value) => value + 1))]}
      type="button"
    >
      Like ({likes})
    </button>
  );
}
