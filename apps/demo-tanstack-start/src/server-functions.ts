import { createServerFn } from "@bgub/fig-tanstack-start";
import type { RemotePostStatus } from "./data.ts";
import { delay, requirePost } from "./posts.ts";
import type { ThemePreference } from "./theme.ts";

const remoteRefreshCountKey = "__figDemoTanStackStartRemoteRefreshCount";

export const getInitialTheme = createServerFn({ method: "GET" }).handler(
  ({ context }): ThemePreference => context.serverTheme,
);

export const getRemotePostStatus = createServerFn({ method: "GET" })
  .validator(validatePostId)
  .handler(async ({ data }): Promise<RemotePostStatus> => {
    await delay(80);
    const post = requirePost(data.id);
    return {
      id: data.id,
      refreshCount: nextRemoteRefreshCount(),
      source: "server-remote",
      title: post.title,
    };
  });

export function validatePostId(input: unknown): { id: string } {
  if (typeof input !== "object" || input === null) {
    throw new TypeError("A post id is required.");
  }
  const id = Reflect.get(input, "id");
  if (typeof id !== "string") throw new TypeError("A post id is required.");
  return { id };
}

function nextRemoteRefreshCount(): number {
  const current = Reflect.get(globalThis, remoteRefreshCountKey);
  const next = (typeof current === "number" ? current : 0) + 1;
  Reflect.set(globalThis, remoteRefreshCountKey, next);
  return next;
}
