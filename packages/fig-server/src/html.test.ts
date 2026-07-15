import { describe, expect, it } from "vitest";
import { writeElementStart } from "./html.ts";

describe("HTML serialization", () => {
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
});
