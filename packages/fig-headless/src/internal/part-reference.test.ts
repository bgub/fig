// @vitest-environment happy-dom
import { createElement, createMixin, type MixinDescriptor } from "@bgub/fig";
import { expect, it } from "vitest";
import { createPartReference, type PartReference } from "./part-reference.ts";

type Attribute = "aria-labelledby" | "aria-describedby" | "for";
function compose(
  attribute: Attribute,
  authored: Record<string, unknown> = {},
  after?: MixinDescriptor,
) {
  let reference!: PartReference;
  const relation = createMixin((context) => {
    reference = createPartReference(context, attribute, "generated");
    return reference.props;
  });
  const props: Record<string, unknown> = {
    ...authored,
    mix: [relation(), after],
  };
  const element = createElement("div", props);
  const node = document.createElement("div");
  for (const name of [
    "aria-labelledby",
    "aria-label",
    "aria-describedby",
    "for",
  ]) {
    const value = element.props[name];
    if (typeof value === "string") node.setAttribute(name, value);
  }
  return { reference, node };
}
const override = createMixin(
  (_context, props: Record<string, unknown>) => props,
);

it.each(["aria-labelledby", "aria-describedby", "for"] as const)(
  "updates and removes generated %s references",
  (attribute) => {
    const { reference, node } = compose(attribute);
    reference.sync(node, "custom-mounted-id");
    expect(node.getAttribute(attribute)).toBe("custom-mounted-id");
    reference.sync(node, undefined);
    expect(node.hasAttribute(attribute)).toBe(false);
  },
);

it("preserves an authored reference even when it equals the generated id", () => {
  const { reference, node } = compose("aria-labelledby", {
    "aria-labelledby": "generated",
  });
  reference.sync(node, "other");
  expect(node.getAttribute("aria-labelledby")).toBe("generated");
});

it.each(["authored", "generated"])(
  "honors a later mixin replacing the reference with %s",
  (value) => {
    const { reference, node } = compose(
      "aria-labelledby",
      {},
      override({ "aria-labelledby": value }),
    );
    expect(reference.sync(node, "mounted")).toBe(false);
    expect(node.getAttribute("aria-labelledby")).toBe(value);
  },
);

it("removes its own reference when a later mixin supplies a literal name", () => {
  const { reference, node } = compose(
    "aria-labelledby",
    {},
    override({ "aria-label": "authored" }),
  );
  expect(reference.sync(node, "mounted")).toBe(false);
  expect(node.hasAttribute("aria-labelledby")).toBe(false);
});

it("never removes an explicit reference just because a literal name is also authored", () => {
  const { reference, node } = compose("aria-labelledby", {
    "aria-labelledby": "explicit",
    "aria-label": "literal",
  });
  reference.sync(node, undefined);
  expect(node.getAttribute("aria-labelledby")).toBe("explicit");
});
