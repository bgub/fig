// @vitest-environment happy-dom
import { createDataStore, createElement, isValidElement } from "@bgub/fig";
import { afterEach, describe, expect, it } from "vitest";
import { injectPayloadDocument } from "./payload-internal.ts";
import { payloadResource } from "./payload.ts";
import { renderPayloadResponse } from "./server.tsx";
import { runWithStartContext } from "./storage-context.ts";

afterEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
});

describe("TanStack Start payload resources", () => {
  it("adopts the initial payload stream from the document without refetching", async () => {
    let requests = 0;
    const resource = payloadResource<string>({
      key: (id) => ["payload-profile", id],
      request: (id) => {
        requests += 1;
        return renderPayloadResponse(
          createElement(
            "main",
            { "data-profile": id },
            `profile-${id}</script>`,
          ),
        );
      },
    });
    const html = await runWithStartContext({}, async () => {
      await createDataStore().ensureData(resource, "ada");
      return readStream(
        injectPayloadDocument(
          streamFromString("<!doctype html><html><body></body></html>"),
          undefined,
        ),
      );
    });
    expect(html).not.toContain("profile-ada</script>");
    const parsed = new DOMParser().parseFromString(html, "text/html");
    document.head.innerHTML = parsed.head.innerHTML;
    document.body.innerHTML = parsed.body.innerHTML;

    const clientStore = createDataStore();
    const node = await clientStore.ensureData(resource, "ada");

    expect(requests).toBe(1);
    expect(isValidElement(node)).toBe(true);
    if (!isValidElement(node)) throw new Error("Expected a payload element.");
    expect(node.props.children).toBe("profile-ada</script>");
  });
});

function streamFromString(value: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(value);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return result + decoder.decode();
    result += decoder.decode(value, { stream: true });
  }
}
