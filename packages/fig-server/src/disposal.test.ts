import {
  createDataStore,
  createElement,
  dataResource,
  readData,
  Suspense,
} from "@bgub/fig";
import { expect, it, vi } from "vitest";
import { renderToStream } from "./index.ts";
import { renderToPayloadStream } from "./payload.ts";

it.each(["html", "payload"] as const)(
  "errors the %s stream when transfer fails during disposal",
  async (kind) => {
    const error = new Error("transfer failed at disposal");
    const cleanup = vi.fn();
    let transfers = 0;
    const resource = dataResource({
      key: () => ["disposal"],
      load: ({ signal }) => {
        signal.addEventListener("abort", cleanup);
        return "value";
      },
      transfer: (value: string) => {
        // Payload sends one data row before disposal; HTML has no boundary row.
        if (kind === "payload" && transfers++ === 0) return value;
        throw error;
      },
    });
    function Value() {
      return readData(resource);
    }
    const render = kind === "html" ? renderToStream : renderToPayloadStream;
    const result = render(createElement(Value, null));
    await expect(new Response(result.stream).text()).rejects.toBe(error);
    expect(cleanup).toHaveBeenCalledOnce();
  },
);

it("preserves a fatal HTML render error when disposal also fails", async () => {
  const original = new Error("render failed");
  const store = createDataStore();
  const cleanup = vi.fn();
  await store.ensureData(
    dataResource({
      key: () => ["disposal"],
      load: ({ signal }) => {
        signal.addEventListener("abort", cleanup);
        return 1;
      },
      transfer: () => {
        throw new Error("transfer failed");
      },
    }),
  );
  function Fail(): never {
    throw original;
  }
  const result = renderToStream(createElement(Fail, null), {
    dataStore: store,
  });
  await expect(new Response(result.stream).text()).rejects.toBe(original);
  await expect(result.allReady).rejects.toBe(original);
  expect(cleanup).toHaveBeenCalledOnce();
});

it.each(["html", "html-boundary", "payload"] as const)(
  "preserves cancellation of the pending %s render when disposal fails",
  async (kind) => {
    const reason = new Error("cancelled");
    const controller = new AbortController();
    const cleanup = vi.fn();
    let loaded = false;
    const resource = dataResource({
      key: () => ["cancel-disposal"],
      load: ({ signal }) => {
        loaded = true;
        signal.addEventListener("abort", cleanup);
        return 1;
      },
      transfer: () => {
        throw new Error("transfer failed");
      },
    });
    const pending = dataResource({
      key: () => ["pending"],
      load: () => new Promise<string>(() => {}),
    });
    function Pending() {
      readData(resource);
      return readData(pending);
    }
    const render = kind === "payload" ? renderToPayloadStream : renderToStream;
    const child = createElement(Pending, null);
    const node =
      kind === "html-boundary"
        ? createElement(Suspense, { fallback: "loading" }, child)
        : child;
    const result = render(node, {
      signal: controller.signal,
    });
    const response = new Response(result.stream).text();
    await vi.waitFor(() => expect(loaded).toBe(true));
    controller.abort(reason);
    await expect(response).rejects.toBe(reason);
    await expect(result.allReady).rejects.toBe(reason);
    expect(cleanup).toHaveBeenCalledOnce();
  },
);
