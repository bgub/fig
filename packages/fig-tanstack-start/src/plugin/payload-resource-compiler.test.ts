import { describe, expect, it } from "vitest";
import { tanStackCompatibilityProfile } from "./compatibility-profile.ts";
import { transformPayloadResourceDefinitions } from "./payload-resource-compiler.ts";

describe("TanStack Start payload resource compiler", () => {
  it("compiles render into a private server function", async () => {
    const result = await transformPayloadResourceDefinitions(
      `
        import { payloadResource as definePayload } from "@bgub/fig-tanstack-start/payload";
        import { ProfilePayload } from "./profile.payload.server.tsx";

        export const profilePayload = definePayload<string>({
          key: (name) => ["profile-payload", name],
          render: async (name) => <ProfilePayload name={name} />,
        });
      `,
      "/app/profile-payload.tsx",
    );

    expect(result?.code).toContain(
      `import { createServerFn as _createServerFn } from "${tanStackCompatibilityProfile.packages.frameworkStart}"`,
    );
    expect(result?.code).toContain(
      'import { renderPayloadResponse as _renderPayloadResponse } from "@bgub/fig-tanstack-start/server"',
    );
    expect(result?.code).toMatch(
      /const _profilePayloadRequest = _createServerFn\(\)\.handler\(async \(\{\s*data: _data\s*\}\) => _renderPayloadResponse\(await \(async name => <ProfilePayload name=\{name\} \/>\)\(_data\)\)\)/,
    );
    expect(result?.code).toMatch(
      /request: \(_input, \{\s*signal: _signal\s*\}\) => _profilePayloadRequest\(\{\s*data: _input,\s*signal: _signal\s*\}\)/,
    );
    expect(result?.code).not.toContain("render:");
  });

  it("supports method syntax", async () => {
    const result = await transformPayloadResourceDefinitions(
      `
        import { payloadResource } from "@bgub/fig-tanstack-start/payload";
        const notePayload = payloadResource<void>({
          key: () => ["note"],
          render() { return <p>Note</p>; },
        });
      `,
      "/app/note.tsx",
    );

    expect(result?.code).toContain("_createServerFn().handler(async");
  });

  it.each([
    {
      code: "const options = { key: () => ['x'], render: () => null }; export const value = payloadResource(options);",
      message: /inline object literal/,
    },
    {
      code: "export const value = payloadResource({ key: () => ['x'], request: () => null });",
      message: /no longer accepts request/,
    },
    {
      code: "export const value = payloadResource({ key: () => ['x'] });",
      message: /requires an inline render callback/,
    },
    {
      code: "const render = () => null; export const value = payloadResource({ key: () => ['x'], render });",
      message: /render must be an inline function/,
    },
  ])(
    "rejects definitions the compiler cannot safely extract",
    async ({ code, message }) => {
      await expect(
        transformPayloadResourceDefinitions(
          `import { payloadResource } from "@bgub/fig-tanstack-start/payload"; ${code}`,
          "/app/payload.tsx",
        ),
      ).rejects.toThrow(message);
    },
  );
});
