import {
  setResponseHeader,
  setResponseStatus,
} from "@tanstack/start-server-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn<(request: Request) => Promise<Response>>(),
}));

vi.mock("@tanstack/start-server-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/start-server-core")>()),
  createStartHandler: () => mocks.fetch,
}));

const { default: entry } = await import("./server.ts");

describe("default Start server entry", () => {
  beforeEach(() => {
    mocks.fetch.mockReset();
  });

  it("returns the handler's response", async () => {
    const response = new Response("document");
    mocks.fetch.mockResolvedValue(response);
    const request = new Request("https://example.test/");

    expect(await entry.fetch(request)).toBe(response);
    expect(mocks.fetch).toHaveBeenCalledWith(request, undefined);
  });

  it("converts uncaught errors with request-local status and headers", async () => {
    mocks.fetch.mockImplementation(async () => {
      setResponseStatus(503);
      setResponseHeader("retry-after", "60");
      throw new Error("private server detail");
    });

    const response = await entry.fetch(new Request("https://example.test/"));

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.text()).not.toContain("private server detail");
  });

  it("preserves a thrown response", async () => {
    const response = new Response("denied", { status: 401 });
    mocks.fetch.mockRejectedValue(response);

    expect(await entry.fetch(new Request("https://example.test/"))).toBe(
      response,
    );
  });

  it("rejects malformed encoded paths before invoking the handler", async () => {
    const response = await entry.fetch(
      new Request("https://example.test/%E0%A4%A"),
    );

    expect(response.status).toBe(400);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
