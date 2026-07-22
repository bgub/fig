import { describe, expect, it } from "vitest";
import {
  compiledPayloadAssets,
  payloadStylesheetsSymbolKey,
} from "./payload-assets.ts";

describe("compiled Payload assets", () => {
  it("turns compiler annotations into Fig stylesheet resources", () => {
    function Card() {
      return null;
    }
    Object.defineProperty(Card, Symbol.for(payloadStylesheetsSymbolKey), {
      value: ["/assets/card.css"],
    });

    expect(compiledPayloadAssets(Card)).toEqual([
      {
        href: "/assets/card.css",
        kind: "stylesheet",
        precedence: "payload",
      },
    ]);
  });
});
