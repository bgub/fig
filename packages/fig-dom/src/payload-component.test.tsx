import {
  createDataStore,
  createElement,
  isValidElement,
  Suspense,
} from "@bgub/fig";
import { renderToPayloadStream } from "@bgub/fig-server/payload";
import { describe, expect, it } from "vitest";
import { createPayloadComponent, createRoot, flushSync } from "./index.ts";
import {
  FakeElement,
  installFakeDocument,
  waitForHostTurns,
} from "./test-utils.ts";

installFakeDocument();

describe("createPayloadComponent", () => {
  it("renders a payload tree as a component", async () => {
    const ProfilePage = createPayloadComponent<{ id: string }>({
      key: ["profile"],
      load: ({ id }) => payloadSource(<main>profile-{id}</main>),
    });
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createElement(
          Suspense,
          { fallback: <p>loading</p> },
          createElement(ProfilePage, { id: "ada" }),
        ),
      ),
    );
    expect(container.textContent).toBe("loading");

    await waitForHostTurns();
    expect(container.textContent).toBe("profile-ada");
  });

  it("works anywhere a data resource is accepted", async () => {
    let loads = 0;
    const ProfilePage = createPayloadComponent<{
      id: string;
      locale: string;
    }>({
      key: ["profile"],
      load: ({ id, locale }) => {
        loads += 1;
        return payloadSource(
          <main>
            profile-{id}-{locale}
          </main>,
        );
      },
    });
    const store = createDataStore();

    const node = await store.ensureData(ProfilePage, {
      id: "ada",
      locale: "en",
    });
    expect(isValidElement(node)).toBe(true);
    await store.ensureData(ProfilePage, { id: "ada", locale: "fr" });
    expect(loads).toBe(2);

    const refreshed = await store.refreshData(ProfilePage, {
      id: "ada",
      locale: "en",
    });
    expect(refreshed.status).toBe("fulfilled");
    expect(loads).toBe(3);
  });

  it("passes loaders only the public Payload context", async () => {
    let receivedContext: object | undefined;
    const ProfilePage = createPayloadComponent<{ id: string }>({
      key: ["profile-context"],
      load: (_props, context) => {
        receivedContext = context;
        return payloadSource(null);
      },
    });
    const store = createDataStore();

    await store.ensureData(ProfilePage, { id: "ada" });

    expect(Reflect.ownKeys(receivedContext ?? {})).toEqual(["key", "signal"]);
    expect(receivedContext).toMatchObject({
      key: ProfilePage.key({ id: "ada" }),
      signal: expect.any(AbortSignal),
    });
  });

  it("does not recompute the key for the loader context", () => {
    let keyCalls = 0;
    const ProfilePage = createPayloadComponent<{ id: string }>({
      cacheKey: ({ id }) => {
        keyCalls += 1;
        return id;
      },
      key: ["profile-context"],
      load: () => payloadSource(null),
    });

    const store = createDataStore();
    store.preloadData(ProfilePage, { id: "ada" });

    expect(keyCalls).toBe(1);
    store.dispose();
  });

  it("uses cacheKey only for the props portion of the key", () => {
    const ProfilePage = createPayloadComponent<{
      id: string;
      locale: string;
    }>({
      cacheKey: ({ id }) => id,
      key: ["profile"],
      load: () => payloadSource(null),
    });

    expect(ProfilePage.key({ id: "ada", locale: "en" })).toEqual([
      "profile",
      "ada",
    ]);
    expect(ProfilePage.key({ id: "ada", locale: "fr" })).toEqual([
      "profile",
      "ada",
    ]);
  });

  it("ignores plain-object property insertion order in default keys", async () => {
    let loads = 0;
    const Page = createPayloadComponent<{
      filters: { active: boolean };
      sort: { field: string };
    }>({
      key: ["page"],
      load: () => {
        loads += 1;
        return payloadSource(null);
      },
    });

    expect(
      Page.key({
        filters: { active: true },
        sort: { field: "name" },
      }),
    ).toEqual(
      Page.key({
        sort: { field: "name" },
        filters: { active: true },
      }),
    );

    const store = createDataStore();
    await store.ensureData(Page, {
      filters: { active: true },
      sort: { field: "name" },
    });
    await store.ensureData(Page, {
      sort: { field: "name" },
      filters: { active: true },
    });
    expect(loads).toBe(1);
  });

  it("uses its resource key as its DevTools name", () => {
    const Weather = createPayloadComponent<Record<string, never>>({
      key: ["resource-weather"],
      load: () => payloadSource(null),
    });

    expect(Weather).toHaveProperty("displayName", "Payload(resource-weather)");
  });

  it("validates excluded props", () => {
    const ProfilePage = createPayloadComponent<{
      format: () => string;
      id: string;
    }>({
      cacheKey: ({ id }) => id,
      key: ["profile"],
      load: () => payloadSource(null),
    });

    expect(() => ProfilePage.key({ id: "ada", format: String })).toThrow(
      "Functions cannot be serialized into the payload.",
    );
  });

  it("rejects children", () => {
    const ProfilePage = createPayloadComponent<{ id: string }>({
      key: ["profile"],
      load: () => payloadSource(null),
    });

    expect(() => ProfilePage({ id: "ada", children: undefined })).toThrow(
      "Payload components do not accept children.",
    );
  });
});

function payloadSource(node: Parameters<typeof renderToPayloadStream>[0]) {
  const { contentType, stream } = renderToPayloadStream(node);
  return { contentType, stream };
}
