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

function expectedSlotText(value: unknown): string | null {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  // Non-primitive slot values have no canonical server text; skip checking.
  return null;
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
  if (
    instance.localName.toLowerCase() !==
    prototypeFor(descriptor).localName.toLowerCase()
  ) {
    return false;
  }

  for (let index = 0; index < descriptor.slots.length; index += 1) {
    const spec = descriptor.slots[index];
    let target: ChildNode;
    try {
      target = resolveSlotNode(instance, spec.path);
    } catch {
      return false;
    }

    if (spec.kind === "text") {
      if (target.nodeType !== 3) return false;
      const expected = expectedSlotText(slots[index]);
      if (expected !== null && target.nodeValue !== expected) return false;
      continue;
    }

    if (target.nodeType !== 1) return false;

    if (spec.kind === "attr" && __DEV__) {
      const expected = expectedSlotText(slots[index]);
      const actual = (target as Element).getAttribute(spec.name);
      if (expected !== null && actual !== expected) {
        console.error(
          `Hydrated template attribute "${spec.name}" differs from the ` +
            `client slot value ("${actual ?? ""}" on the server, ` +
            `"${expected}" on the client). The server value is kept; ` +
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
