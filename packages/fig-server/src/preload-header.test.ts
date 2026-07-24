import { preconnect, preload, stylesheet } from "@bgub/fig";
import { describe, expect, it } from "vitest";
import {
  createPreloadHeaderEntries,
  formatPreloadHeader,
} from "./preload-header.ts";

type HeaderResource =
  Parameters<typeof createPreloadHeaderEntries>[0] extends Iterable<
    infer Resource
  >
    ? Resource
    : never;

function format(resource: HeaderResource): string | undefined {
  return formatPreloadHeader(createPreloadHeaderEntries([resource]));
}

describe("preload headers", () => {
  it.each([
    {
      expected: "</assets/app%20shell.css>; rel=preload; as=style",
      label: "percent escapes",
      resource: stylesheet("/assets/app%20shell.css"),
    },
    {
      expected: "</search?q=a%2Fb>; rel=preload; as=fetch",
      label: "escaped query values",
      resource: preload("/search?q=a%2Fb", "fetch"),
    },
    {
      expected: "<https://[::1]>; rel=preconnect",
      label: "IPv6 hosts",
      resource: preconnect("https://[::1]"),
    },
    {
      expected: "</assets/100%25.css>; rel=preload; as=style",
      label: "unescaped percent signs",
      resource: stylesheet("/assets/100%.css"),
    },
    {
      expected: "</assets/caf%C3%A9.css>; rel=preload; as=style",
      label: "Unicode characters",
      resource: stylesheet("/assets/café.css"),
    },
  ])("preserves $label in URI references", ({ expected, resource }) => {
    expect(format(resource)).toBe(expected);
  });

  it("quotes and escapes parameter values", () => {
    expect(
      format(
        stylesheet("/app.css", {
          media: 'screen, "wide"\\mode',
        }),
      ),
    ).toBe(
      '</app.css>; rel=preload; as=style; media="screen, \\"wide\\"\\\\mode"',
    );
  });

  it("filters resources before formatting", () => {
    const entries = createPreloadHeaderEntries([
      preconnect("https://cdn.example.com"),
      preload("/hero.jpg", "image"),
    ]);

    expect(
      formatPreloadHeader(entries, {
        filter: (resource) => resource.kind === "preload",
      }),
    ).toBe("</hero.jpg>; rel=preload; as=image");
  });

  it("omits entries that exceed the configured budget", () => {
    const entries = createPreloadHeaderEntries([
      preconnect("https://cdn.example.com"),
      preload("/hero.jpg", "image"),
    ]);
    const preconnectHeader = "<https://cdn.example.com>; rel=preconnect";

    expect(
      formatPreloadHeader(entries, { maxLength: preconnectHeader.length }),
    ).toBe(preconnectHeader);
    expect(formatPreloadHeader(entries, { maxLength: 0 })).toBeUndefined();
  });

  it("enforces the default header budget", () => {
    const href = `/${"a".repeat(2_000)}.css`;

    expect(format(stylesheet(href))).toBeUndefined();
  });

  it.each(["/bad\ntarget", "/bad\ud800target"])(
    "omits unsafe target %j",
    (href) => {
      expect(format(preload(href, "image"))).toBeUndefined();
    },
  );
});
