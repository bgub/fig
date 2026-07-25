// @vitest-environment happy-dom
import { createStartDataContext } from "./data.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hydrateRoot: vi.fn(),
  hydrateTanStackStart: vi.fn(),
}));

vi.mock("@bgub/fig-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bgub/fig-dom")>()),
  hydrateRoot: mocks.hydrateRoot,
}));

vi.mock("@tanstack/start-client-core/client", () => ({
  hydrateStart: mocks.hydrateTanStackStart,
}));

import { hydrateStart } from "./client.tsx";

afterEach(() => {
  delete window.$_TSR;
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("TanStack Start client hydration", () => {
  it("uses the container document for data and inline CSS hydration", async () => {
    const router = {
      options: { context: createStartDataContext().context },
    };
    const root = { unmount: vi.fn() };
    const serverDocument = document.implementation.createHTMLDocument("");
    const querySelector = vi.spyOn(serverDocument, "querySelector");
    const hydrated = vi.fn();
    window.$_TSR = { h: hydrated } as never;
    mocks.hydrateTanStackStart.mockResolvedValue(router);
    mocks.hydrateRoot.mockReturnValue(root);

    await expect(hydrateStart({ container: serverDocument })).resolves.toEqual({
      root,
      router,
    });

    const [, node] = mocks.hydrateRoot.mock.calls[0] ?? [];
    expect(node).toMatchObject({
      props: { ownerDocument: serverDocument, router },
    });
    expect(querySelector).toHaveBeenCalledWith("#__fig_tanstack_start_data__");
    expect(hydrated).toHaveBeenCalledOnce();
  });

  it("waits for the positioned router bootstrap while parsing", async () => {
    const router = {
      options: { context: createStartDataContext().context },
    };
    const root = { unmount: vi.fn() };
    vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
    mocks.hydrateTanStackStart.mockResolvedValue(router);
    mocks.hydrateRoot.mockReturnValue(root);

    const hydration = hydrateStart();
    await Promise.resolve();

    expect(mocks.hydrateTanStackStart).not.toHaveBeenCalled();

    const hydrated = vi.fn();
    window.$_TSR = { h: hydrated } as never;
    document.dispatchEvent(new Event("DOMContentLoaded"));

    await expect(hydration).resolves.toEqual({ root, router });
    expect(hydrated).toHaveBeenCalledOnce();
  });
});
