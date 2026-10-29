// @vitest-environment happy-dom
import type { MixinContext } from "@bgub/fig";
import { describe, expect, it } from "vitest";
import {
  assertAccessibleName,
  assertControlLabel,
  assertPanelOwner,
  assertSinglePart,
  assertSingleSelection,
  assertUniqueIds,
  assertUniqueValues,
  expectHost,
  expectPopupId,
} from "./diagnostics.ts";

describe("Fig Headless development diagnostics", () => {
  it("rejects a part attached to the wrong host", () => {
    const context: MixinContext = {
      owns: () => false,
      props: {},
      type: "div",
    } as MixinContext;

    expect(() => expectHost(context, "dialog", "dialog")).toThrow(
      "Fig Headless dialog must be applied to <dialog>, not <div>.",
    );
  });

  it("requires one root-owned popover id", () => {
    const context: MixinContext = {
      owns: () => false,
      props: { id: "host-id" },
      type: "div",
    };

    expect(() => expectPopupId(context, "root-id")).toThrow(
      'Pass id: "host-id" to the widget root',
    );
    expect(() => expectPopupId(context, "")).toThrow(
      "Fig Headless popover id must not be empty",
    );
  });

  it("accepts direct and referenced accessible names", () => {
    const direct = document.createElement("div");
    direct.setAttribute("aria-label", "Settings");
    expect(() => assertAccessibleName(direct, "tab list")).not.toThrow();

    const label = document.createElement("h2");
    label.id = "settings-label";
    const referenced = document.createElement("div");
    referenced.setAttribute("aria-labelledby", label.id);
    document.body.append(label, referenced);
    expect(() => assertAccessibleName(referenced, "tab list")).not.toThrow();

    expect(() =>
      assertAccessibleName(document.createElement("div"), "tab list"),
    ).toThrow("Fig Headless tab list requires an accessible name");
  });

  it("requires a field label or explicit control name", () => {
    const input = document.createElement("input");
    expect(() => assertControlLabel(input)).toThrow(
      "Fig Headless field control requires an accessible name",
    );

    input.setAttribute("aria-label", "Email");
    expect(() => assertControlLabel(input)).not.toThrow();
  });

  it("rejects duplicate values and unowned panels", () => {
    expect(() =>
      assertUniqueValues([{ value: "same" }, { value: "same" }], "tabs item"),
    ).toThrow("Fig Headless tabs item values must be unique");
    expect(() => assertPanelOwner(undefined)).toThrow(
      "Fig Headless panel has no matching control",
    );
  });

  it("rejects repeated singleton parts and ids", () => {
    const first = document.createElement("p");
    const second = document.createElement("p");
    first.id = "message";
    second.id = "message";

    expect(() => assertSinglePart([first, second], "field label")).toThrow(
      "Fig Headless field label may be applied to only one mounted host",
    );
    expect(() => assertUniqueIds([first, second], "field messages")).toThrow(
      "Fig Headless field messages must use unique ids",
    );
    second.id = "";
    expect(() => assertUniqueIds([second], "field messages")).toThrow(
      "Fig Headless field messages must use non-empty ids",
    );
  });

  it("rejects multiple values in a single-selection widget", () => {
    expect(() =>
      assertSingleSelection(["apple", "banana"], "single-select listbox"),
    ).toThrow(
      "Fig Headless single-select listbox accepts at most one selected value",
    );
  });
});
