import { describe, expect, it } from "vitest";
import { tanStackCompatibilityProfile } from "./compatibility-profile.ts";
import { transformServerPayloadDefinitions } from "./server-payload-compiler.ts";

describe("TanStack Start serverPayload compiler", () => {
  it("compiles a server component into a private server function", async () => {
    const result = await transformServerPayloadDefinitions(
      `
        import { createPayloadComponent } from "@bgub/fig-dom";
        import { serverPayload as payload } from "@bgub/fig-tanstack-start/payload";
        import { Profile } from "./profile.server.tsx";

        export const ProfilePage = createPayloadComponent<{ name: string }>({
          key: ["profile"],
          load: payload(Profile),
        });
      `,
      "/app/profile-payload.tsx",
    );

    expect(result?.code).toContain(
      `import { createServerFn as _createServerFn } from "${tanStackCompatibilityProfile.packages.frameworkStart}"`,
    );
    expect(result?.code).toContain(
      'import { createElement as _createElement } from "@bgub/fig"',
    );
    expect(result?.code).toContain(
      'import { renderPayloadResponse as _renderPayloadResponse } from "@bgub/fig-tanstack-start/server"',
    );
    expect(result?.code).toMatch(
      /const _ProfilePageRequest = _createServerFn\(\)\.handler\(\(\{\s*data: _data\s*\}\) => _renderPayloadResponse\(_createElement\(Profile, _data\)\)\)/,
    );
    expect(result?.code).toMatch(
      /load: payload\(Object\.assign\(\(_input, \{\s*signal: _signal\s*\}\) => _ProfilePageRequest\(\{\s*data: _input,\s*signal: _signal\s*\}\), \{\s*\[Symbol\.for\("fig\.tanstack-start\.compiled-server-payload"\)\]: true\s*\}\)\)/,
    );
  });

  it("supports inline render callbacks", async () => {
    const result = await transformServerPayloadDefinitions(
      `
        import { serverPayload } from "@bgub/fig-tanstack-start/payload";
        const notePayload = serverPayload((props: { note: string }) => <p>{props.note}</p>);
      `,
      "/app/note.tsx",
    );

    expect(result?.code).toContain("_createServerFn().handler(({");
    expect(result?.code).not.toContain("serverPayload((props");
  });

  it.each([
    {
      code: "export const value = serverPayload();",
      message: /exactly one/,
    },
    {
      code: "export const value = serverPayload(Component, another);",
      message: /exactly one/,
    },
    {
      code: "export const value = serverPayload(createComponent());",
      message: /component reference or inline render callback/,
    },
    {
      code: "export function create() { return serverPayload(Component); }",
      message: /top-level statement/,
    },
  ])("rejects invalid definitions", async ({ code, message }) => {
    await expect(
      transformServerPayloadDefinitions(
        `import { serverPayload } from "@bgub/fig-tanstack-start/payload"; ${code}`,
        "/app/payload.tsx",
      ),
    ).rejects.toThrow(message);
  });
});
