import type { TemplateDescriptor, TemplateSlotSpec } from "@bgub/fig";
import { updateEvents } from "./events.ts";
import { updateElement } from "./props.ts";

// Experimental (bet-2 template project): DOM instance machinery for
// template descriptors (see @bgub/fig's template()). Static HTML is parsed
// once into a <template> prototype and cloned per instance; slot specs
// address the dynamic positions by child-index path. Slot kinds:
//   text   — path resolves to a placeholder Text node; value becomes its data
//   attr   — path resolves to an Element; value routes through the normal
//            attribute/property policy (single-prop updateElement)
//   events — path resolves to an Element; value is the events={[on(...)]}
//            array and reuses the standard event-slot machinery, so
//            positional identity, abort-on-change, delegation, and the
//            attach/detach-on-insertion lifecycle all apply unchanged.

declare const __FIG_DEV__: boolean | undefined;

const __DEV__ = typeof __FIG_DEV__ === "boolean" ? __FIG_DEV__ : false;

const prototypes = new WeakMap<TemplateDescriptor, Element>();
const instanceSlotNodes = new WeakMap<Element, readonly ChildNode[]>();

function prototypeFor(descriptor: TemplateDescriptor): Element {
  let prototype = prototypes.get(descriptor);
  if (prototype === undefined) {
    const holder = document.createElement("template") as HTMLTemplateElement;
    holder.innerHTML = descriptor.html;
    const root = holder.content.firstElementChild;
    if (__DEV__) {
      if (root === null) {
        throw new Error("A template descriptor must have a root element.");
      }
      if (root.nextSibling !== null) {
        throw new Error(
          "A template descriptor must have exactly one root node.",
        );
      }
    }
    prototype = root as Element;
    prototypes.set(descriptor, prototype);
  }
  return prototype;
}

function resolveSlotNode(root: Element, path: readonly number[]): ChildNode {
  let node: ChildNode = root;
  for (const index of path) {
    const child: ChildNode | undefined = node.childNodes[index];
    if (child === undefined) {
      throw new Error("A template slot path did not resolve to a node.");
    }
    node = child;
  }
  return node;
}

function resolveInstanceSlots(
  descriptor: TemplateDescriptor,
  instance: Element,
): readonly ChildNode[] {
  const nodes = descriptor.slots.map((slot) =>
    resolveSlotNode(instance, slot.path),
  );
  instanceSlotNodes.set(instance, nodes);
  return nodes;
}

function applySlot(
  spec: TemplateSlotSpec,
  node: ChildNode,
  previous: unknown,
  next: unknown,
  initial: boolean,
): void {
  if (spec.kind === "text") {
    node.nodeValue =
      next === null || next === undefined
        ? ""
        : String(next as string | number);
    return;
  }

  if (spec.kind === "events") {
    updateEvents(node as Element, next);
    return;
  }

  updateElement(
    node as Element,
    initial ? {} : { [spec.name]: previous },
    { [spec.name]: next },
    initial ? { initial: true } : {},
  );
}

export function createTemplateInstance(
  descriptor: TemplateDescriptor,
  slots: readonly unknown[],
): Element {
  const instance = prototypeFor(descriptor).cloneNode(true) as Element;
  const nodes = resolveInstanceSlots(descriptor, instance);
  for (let index = 0; index < descriptor.slots.length; index += 1) {
    applySlot(
      descriptor.slots[index],
      nodes[index],
      undefined,
      slots[index],
      true,
    );
  }
  return instance;
}

export function commitTemplateUpdate(
  instance: Element,
  descriptor: TemplateDescriptor,
  previous: readonly unknown[],
  next: readonly unknown[],
): void {
  const nodes =
    instanceSlotNodes.get(instance) ??
    resolveInstanceSlots(descriptor, instance);
  for (let index = 0; index < descriptor.slots.length; index += 1) {
    if (Object.is(previous[index], next[index])) continue;
    applySlot(
      descriptor.slots[index],
      nodes[index],
      previous[index],
      next[index],
      false,
    );
  }
}

function expectedHydratedInstance(
  descriptor: TemplateDescriptor,
  slots: readonly unknown[],
): Element {
  const expected = prototypeFor(descriptor).cloneNode(true) as Element;
  const nodes = descriptor.slots.map((slot) =>
    resolveSlotNode(expected, slot.path),
  );
  for (let index = 0; index < descriptor.slots.length; index += 1) {
    const spec = descriptor.slots[index];
    if (spec.kind === "events") continue;
    applySlot(spec, nodes[index], undefined, slots[index], true);
  }
  return expected;
}

function dynamicAttributes(
  descriptor: TemplateDescriptor,
  expected: Element,
): Map<ChildNode, string[]> {
  const attributes = new Map<ChildNode, string[]>();
  for (const spec of descriptor.slots) {
    if (spec.kind !== "attr") continue;
    const node = resolveSlotNode(expected, spec.path);
    let names = attributes.get(node);
    if (names === undefined) {
      names = [];
      attributes.set(node, names);
    }
    names.push(spec.name.toLowerCase());
  }
  return attributes;
}

function sameHydratedTree(
  actual: ChildNode,
  expected: ChildNode,
  expectedDynamicAttributes: ReadonlyMap<ChildNode, readonly string[]>,
): boolean {
  if (actual.nodeType !== expected.nodeType) return false;

  if (expected.nodeType === 3) return actual.nodeValue === expected.nodeValue;

  if (expected.nodeType === 1) {
    const actualElement = actual as Element;
    const expectedElement = expected as Element;
    if (actualElement.localName !== expectedElement.localName) {
      return false;
    }

    const dynamic = expectedDynamicAttributes.get(expected) ?? [];
    for (const name of expectedElement.getAttributeNames()) {
      if (dynamic.includes(name)) continue;
      if (
        actualElement.getAttribute(name) !== expectedElement.getAttribute(name)
      ) {
        return false;
      }
    }
    for (const name of actualElement.getAttributeNames()) {
      if (dynamic.includes(name) || expectedElement.hasAttribute(name)) {
        continue;
      }
      return false;
    }
  }

  if (actual.childNodes.length !== expected.childNodes.length) return false;
  for (let index = 0; index < expected.childNodes.length; index += 1) {
    if (
      !sameHydratedTree(
        actual.childNodes[index],
        expected.childNodes[index],
        expectedDynamicAttributes,
      )
    ) {
      return false;
    }
  }
  return true;
}

// Mirrors host hydration policy: a text-slot mismatch is a hydration
// mismatch (the caller recovers by client-rendering), attribute-slot
// differences are preserved with a dev warning, and event slots only need
// an element to bind to. Static regions between slots came from the same
// descriptor the server rendered, so they carry the same trust as any
// server-rendered markup.
export function canHydrateTemplateInstance(
  node: unknown,
  descriptor: TemplateDescriptor,
  slots: readonly unknown[],
): boolean {
  if (
    typeof node !== "object" ||
    node === null ||
    (node as Element).nodeType !== 1
  ) {
    return false;
  }
  const instance = node as Element;
  let expected: Element;
  let expectedNodes: readonly ChildNode[];
  let actualNodes: readonly ChildNode[];
  try {
    expected = expectedHydratedInstance(descriptor, slots);
    expectedNodes = descriptor.slots.map((slot) =>
      resolveSlotNode(expected, slot.path),
    );
    actualNodes = descriptor.slots.map((slot) =>
      resolveSlotNode(instance, slot.path),
    );
  } catch {
    return false;
  }

  if (
    !sameHydratedTree(
      instance,
      expected,
      dynamicAttributes(descriptor, expected),
    )
  ) {
    return false;
  }

  for (let index = 0; index < descriptor.slots.length; index += 1) {
    const spec = descriptor.slots[index];
    const target = actualNodes[index];

    if (spec.kind === "text") {
      if (target.nodeType !== 3) return false;
      continue;
    }

    if (target.nodeType !== 1) return false;

    if (spec.kind === "attr" && __DEV__) {
      const expectedValue = (expectedNodes[index] as Element).getAttribute(
        spec.name,
      );
      const actual = (target as Element).getAttribute(spec.name);
      if (actual !== expectedValue) {
        console.error(
          `Hydrated template attribute "${spec.name}" differs from the ` +
            `client slot value ("${actual ?? ""}" on the server, ` +
            `"${expectedValue ?? ""}" on the client). The server value is kept; ` +
            "updates apply once the slot value changes.",
        );
      }
    }
  }

  return true;
}

// Server segments already rendered text and attribute slot values; adoption
// only resolves the slot nodes for future updates and binds event slots
// (the server renders nothing for those).
export function commitHydratedTemplateInstance(
  instance: Element,
  descriptor: TemplateDescriptor,
  slots: readonly unknown[],
): void {
  const nodes = resolveInstanceSlots(descriptor, instance);
  for (let index = 0; index < descriptor.slots.length; index += 1) {
    const spec = descriptor.slots[index];
    if (spec.kind !== "events") continue;
    updateEvents(nodes[index] as Element, slots[index]);
  }
}

export function templateRootDisplay(
  descriptor: TemplateDescriptor,
  slots: readonly unknown[],
): string {
  for (let index = 0; index < descriptor.slots.length; index += 1) {
    const spec = descriptor.slots[index];
    if (
      spec.kind !== "attr" ||
      spec.name !== "style" ||
      spec.path.length !== 0
    ) {
      continue;
    }
    const display = (slots[index] as { display?: unknown } | null)?.display;
    return typeof display === "string" ? display : "";
  }
  return "";
}
