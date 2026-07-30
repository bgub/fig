import { describe, expect, it } from "vitest";
import * as htmlApi from "./html-entry.ts";
import {
  escapeAttribute,
  escapeScriptJson,
  escapeScriptText,
  escapeText,
  writeElementStart,
} from "./html.ts";

describe("HTML serialization", () => {
  it("exposes the companion-markup escaping surface", () => {
    expect(Object.keys(htmlApi).sort()).toEqual([
      "escapeAttribute",
      "escapeScriptJson",
      "escapeScriptText",
      "escapeText",
    ]);
  });

  it("batches an opening tag into one sink write", () => {
    const chunks: string[] = [];

    writeElementStart(
      "button",
      {
        "aria-label": "Save",
        class: "primary",
        "data-id": "save",
        disabled: true,
        style: {
          "--gap": "1rem",
          backgroundColor: "red",
          opacity: 0,
        },
        tabindex: 0,
        value: '<&"',
      },
      {
        write(chunk) {
          chunks.push(chunk);
        },
      },
    );

    expect(chunks).toEqual([
      '<button aria-label="Save" class="primary" data-id="save" disabled style="--gap:1rem;background-color:red;opacity:0" tabindex="0" value="&lt;&amp;&quot;">',
    ]);
  });

  it("escapes special attribute characters after the safe-value fast path", () => {
    expect(escapeAttribute("plain attribute value")).toBe(
      "plain attribute value",
    );
    expect(escapeAttribute('a&b"c<d>e')).toBe("a&amp;b&quot;c&lt;d&gt;e");
  });

  it("escapes special text characters after the safe-value fast path", () => {
    expect(escapeText("plain text value")).toBe("plain text value");
    expect(escapeText("a&b<c>d")).toBe("a&amp;b&lt;c&gt;d");
  });

  it("escapes raw script text without changing payload bytes", () => {
    expect(escapeScriptText('row:</script>&"\u2028')).toBe(
      'row:\\u003C/script>&"\\u2028',
    );
  });

  it("serializes JSON safely for an inline script", () => {
    expect(escapeScriptJson({ html: "</script>", separator: "\u2028" })).toBe(
      '{"html":"\\u003C/script>","separator":"\\u2028"}',
    );
  });
});
