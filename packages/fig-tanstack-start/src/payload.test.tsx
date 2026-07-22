// @vitest-environment happy-dom
import {
  clientReference,
  createDataStore,
  isValidElement,
  type FigNode,
} from "@bgub/fig";
import { afterEach, describe, expect, it } from "vitest";
import { payloadTransportMarkerId } from "./document-markers.ts";
import { injectPayloadDocument } from "./payload-internal.ts";
import { Isomorphic, payloadResource } from "./payload.ts";
import { renderPayloadResponse } from "./server.tsx";
import { runWithStartContext } from "./storage-context.ts";

afterEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
});

describe("TanStack Start payload resources", () => {
  it("renders a compiled Isomorphic client reference with component props", () => {
    const Counter = clientReference<{ initial: number }>({ id: "counter" });
    const node = Isomorphic({ component: Counter, initial: 3 });

    expect(isValidElement(node)).toBe(true);
    if (!isValidElement(node)) throw new Error("Expected a Fig element.");
    expect(node.type).toBe(Counter);
    expect(node.props).toEqual({ initial: 3 });
  });

  it("rejects an Isomorphic boundary missed by the compiler", () => {
    function Counter(): FigNode {
      return null;
    }

    expect(() => Isomorphic({ component: Counter })).toThrow(
      /through the Fig TanStack Start compiler/,
    );
  });

  it("rejects a payload resource missed by the compiler", () => {
    expect(() =>
      payloadResource<void>({
        key: () => ["payload"],
        render: () => null,
      }),
    ).toThrow(/must be compiled/);
  });

  it("adopts the initial payload stream from the document without refetching", async () => {
    let requests = 0;
    const resource = compiledPayloadResource(
      {
        key: (id: string) => ["payload-profile", id],
        render: (id: string) => <main data-profile={id} />,
      },
      (id: string) => {
        requests += 1;
        return renderPayloadResponse(
          <main data-profile={id}>{`profile-${id}</script>`}</main>,
        );
      },
    );
    const html = await runWithStartContext({}, async () => {
      await createDataStore().ensureData(resource, "ada");
      return readStream(
        injectPayloadDocument(
          streamFromString(
            `<!doctype html><html><body><template id="${payloadTransportMarkerId}"></template></body></html>`,
          ),
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

function compiledPayloadResource<TInput>(
  options: Parameters<typeof payloadResource<TInput>>[0],
  request: (
    input: TInput,
    context: { signal: AbortSignal },
  ) => Response | PromiseLike<Response>,
) {
  return payloadResource(Object.assign(options, { request }));
}

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
