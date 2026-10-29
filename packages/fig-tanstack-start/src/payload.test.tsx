// @vitest-environment happy-dom
import {
  clientReference,
  createContext,
  readContext,
  createDataStore,
  type DataResourceKey,
  isValidElement,
  type FigNode,
} from "@bgub/fig";
import {
  createPayloadComponent,
  createRoot,
  flushSync,
  type PayloadComponentLoader,
} from "@bgub/fig-dom";
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import { payloadTransportMarkerId } from "./document-markers.ts";
import { injectPayloadDocument } from "./payload-internal.ts";
import {
  decodePayloadStream,
  createPayloadClientReferenceResolver,
} from "@bgub/fig/payload";
import { renderToPayloadStream } from "@bgub/fig-server/payload";
import { Isomorphic, serverPayload, type IsomorphicProps } from "./payload.ts";
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

  for (const asynchronous of [false, true]) {
    it(`preserves Isomorphic context providers through ${asynchronous ? "async" : "sync"} client resolution`, async () => {
      const Theme = createContext("light");
      expectTypeOf<
        IsomorphicProps<typeof Theme>["value"]
      >().toEqualTypeOf<string>();
      function Label() {
        return <span>{readContext(Theme)}</span>;
      }
      const ThemeRef = clientReference<{ value: string; children?: FigNode }>({
        id: "theme#Theme",
      });
      const LabelRef = clientReference({ id: "theme#Label" });
      // The compiler replaces the imported Theme and Label with these references.
      const result = renderToPayloadStream(
        <Theme value="server-only">
          <Isomorphic component={LabelRef} />
          <Isomorphic component={ThemeRef} value="dark">
            <Isomorphic component={LabelRef} />
            <Isomorphic component={ThemeRef} value="nested">
              <Isomorphic component={LabelRef} />
            </Isomorphic>
            <Isomorphic component={LabelRef} />
          </Isomorphic>
          <Isomorphic component={LabelRef} />
        </Theme>,
      );
      const resolver = createPayloadClientReferenceResolver((reference) => {
        const component = reference.id === "theme#Theme" ? Theme : Label;
        return asynchronous ? Promise.resolve(component) : component;
      });
      const decoded = await decodePayloadStream(result.stream, {
        resolveClientReference: resolver,
      });
      const container = document.createElement("div");
      const root = createRoot(container);
      try {
        flushSync(() => root.render(decoded));
        await expect
          .poll(() =>
            Array.from(
              container.querySelectorAll("span"),
              (span) => span.textContent,
            ),
          )
          .toEqual(["light", "dark", "nested", "dark", "light"]);
      } finally {
        root.unmount();
      }
    });
  }

  it("rejects an Isomorphic boundary missed by the compiler", () => {
    function Counter(): FigNode {
      return null;
    }

    expect(() => Isomorphic({ component: Counter })).toThrow(
      /through the Fig TanStack Start compiler/,
    );
  });

  it("rejects a server payload missed by the compiler before invoking it", () => {
    let calls = 0;

    expect(() =>
      serverPayload(() => {
        calls += 1;
        return null;
      }),
    ).toThrow(/must be compiled/);
    expect(calls).toBe(0);
  });

  it("adopts the initial payload stream from the document without refetching", async () => {
    let requests = 0;
    const resource = compiledPayloadComponent(
      ["payload-profile"],
      ({ id }: { id: string }) => {
        requests += 1;
        return renderPayloadResponse(
          <main data-profile={id}>{`profile-${id}</script>`}</main>,
        );
      },
    );
    const html = await runWithStartContext({}, async () => {
      await createDataStore().ensureData(resource, { id: "ada" });
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
    const node = await clientStore.ensureData(resource, { id: "ada" });

    expect(requests).toBe(1);
    expect(isValidElement(node)).toBe(true);
    if (!isValidElement(node)) throw new Error("Expected a payload element.");
    expect(node.props.children).toBe("profile-ada</script>");
  });
});

function compiledPayloadComponent<TProps extends object>(
  key: DataResourceKey,
  request: PayloadComponentLoader<TProps>,
) {
  return createPayloadComponent<TProps>({
    key,
    load: serverPayload(markCompiled(request)),
  });
}

function markCompiled<TProps extends object>(
  request: PayloadComponentLoader<TProps>,
): (props: TProps) => FigNode {
  return Object.assign(request, {
    [Symbol.for("fig.tanstack-start.compiled-server-payload")]: true as const,
  }) as unknown as (props: TProps) => FigNode;
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
