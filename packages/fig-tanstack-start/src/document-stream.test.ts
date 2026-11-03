// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  type StartStreamRecord,
  startStreamGlobal,
  takeStreamedPayload,
} from "./document-stream.ts";

describe("TanStack Start document stream receiver", () => {
  it("replays queued payload bytes and streams the rest", async () => {
    // Records pushed by parsed scripts before the client entry loaded.
    push(["o", "payload-key", "text/plain"], ["p", "payload-key", "first "]);

    const response = takeStreamedPayload("payload-key");
    if (response === undefined) throw new Error("Expected a payload.");
    expect(response.headers.get("content-type")).toBe("text/plain");
    expect(takeStreamedPayload("payload-key")).toBeUndefined();

    push(["p", "payload-key", "second"], ["e", "payload-key"]);

    await expect(response.text()).resolves.toBe("first second");
  });

  it("leaves unannounced payload keys to the network", () => {
    expect(takeStreamedPayload("missing-key")).toBeUndefined();
  });
});

function push(...records: StartStreamRecord[]): void {
  const target = ((globalThis as Record<string, unknown>)[startStreamGlobal] ??=
    []) as { push(...records: StartStreamRecord[]): void };
  target.push(...records);
}
