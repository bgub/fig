import { assertUniqueValues } from "./diagnostics.ts";

export type Orientation = "horizontal" | "vertical";

export interface CompositeItem {
  readonly disabled: boolean;
  readonly node: HTMLElement;
  readonly value: unknown;
}

export interface CompositeOptions {
  /** Selector for the owning container, such as `[role="tablist"]`. */
  readonly container: string;
  /** Selector for items inside it, such as `[role="tab"]`. */
  readonly item: string;
  /** Pattern name used by development diagnostics. */
  readonly name: string;
  /**
   * Runs whenever the mounted set changes, including binds that belong to the
   * root's own render. Roots use it to reconcile against the committed DOM.
   * A widget that renders nothing from registration can leave it out.
   */
  readonly registrationChanged?: () => void;
}

export interface FocusMoveOptions {
  /** Home and End jump to the first and last item. Defaults to `true`. */
  readonly edges?: boolean;
  /** Wraps movement at both ends. */
  readonly loop: boolean;
  /** `"both"` accepts either axis, the way a native radio group does. */
  readonly orientation: Orientation | "both";
  /**
   * Passes over disabled items. Tabs deliberately land on them so their
   * unavailable state is discoverable; radios cannot, because arrow movement
   * also selects.
   */
  readonly skipDisabled?: boolean;
}

export type Composite = ReturnType<typeof createComposite>;

/**
 * Shared registration and keyboard movement for widgets whose items live in
 * one container: tabs in a tablist, radios in a radiogroup, triggers in an
 * accordion.
 *
 * The live DOM is the source of truth for order and membership, so the
 * composite only remembers what the DOM cannot express: which value and
 * disabled state each host carries. Every binding is identified by object
 * identity, because a replacement binding for the same node commits before the
 * superseded signal aborts.
 */
export function createComposite(options: CompositeOptions) {
  const { container: containerSelector, item: itemSelector } = options;
  let container: { readonly node: HTMLElement } | null = null;
  let pointerDown = false;
  let typeahead = "";
  let typeaheadTimer: ReturnType<typeof setTimeout> | undefined;
  const registrations = new WeakMap<HTMLElement, CompositeItem>();

  function bindContainer(node: HTMLElement, signal: AbortSignal): void {
    const binding = { node };
    container = binding;
    items();
    options.registrationChanged?.();
    onAbort(signal, () => {
      if (container !== binding) return;
      container = null;
      options.registrationChanged?.();
    });
  }

  function bindItem(
    node: HTMLElement,
    signal: AbortSignal,
    value: unknown,
    disabled: boolean,
  ): void {
    const registration = { disabled, node, value };
    registrations.set(node, registration);
    items();
    options.registrationChanged?.();
    onAbort(signal, () => {
      if (registrations.get(node) !== registration) return;
      registrations.delete(node);
      options.registrationChanged?.();
    });
  }

  function containerNode(): HTMLElement | null {
    return container?.node ?? null;
  }

  /** Every mounted item this container owns, in DOM order. */
  function items(): readonly CompositeItem[] {
    const owner = container;
    if (owner === null) return [];
    const ordered: CompositeItem[] = [];
    for (const node of owner.node.querySelectorAll<HTMLElement>(itemSelector)) {
      const registration = registrations.get(node);
      if (registration !== undefined && owns(node)) ordered.push(registration);
    }
    assertUniqueValues(ordered, `${options.name} item`);
    return ordered;
  }

  function item(value: unknown): CompositeItem | undefined {
    return items().find((registration) => sameValue(registration.value, value));
  }

  /** The registered item an event happened inside, when this container owns it. */
  function itemAt(target: EventTarget | null): CompositeItem | undefined {
    if (!(target instanceof Element)) return undefined;
    const node = target.closest<HTMLElement>(itemSelector);
    if (node === null || !owns(node)) return undefined;
    return registrations.get(node);
  }

  function owns(node: HTMLElement): boolean {
    return (
      container !== null && node.closest(containerSelector) === container.node
    );
  }

  function containsFocus(): boolean {
    if (container === null) return false;
    return container.node.contains(container.node.ownerDocument.activeElement);
  }

  /** True while a pointer press that may also move focus is still down. */
  function pointerActive(): boolean {
    return pointerDown;
  }

  function notePointerDown(
    target: EventTarget | null,
    signal: AbortSignal,
  ): void {
    pointerDown = true;
    const release = () => {
      pointerDown = false;
    };
    if (target instanceof Element) {
      const owner = target.ownerDocument;
      owner.addEventListener("pointerup", release, { once: true, signal });
      owner.addEventListener("pointercancel", release, { once: true, signal });
    }
    onAbort(signal, release);
  }

  /**
   * Moves focus for an arrow, Home, or End key, and reports the item that took
   * it so a caller can select along with the movement.
   */
  function moveFocus(
    event: KeyboardEvent,
    move: FocusMoveOptions,
  ): CompositeItem | undefined {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return undefined;
    }
    const current = itemAt(event.target);
    if (current === undefined) return undefined;
    const ordered = items();
    if (!ordered.includes(current)) return undefined;

    const reachable =
      move.skipDisabled === true
        ? ordered.filter((entry) => !entry.disabled || entry === current)
        : ordered;
    const from = reachable.indexOf(current);
    const last = reachable.length - 1;

    const edges = move.edges !== false;
    let nextIndex: number;
    if (edges && event.key === "Home") nextIndex = 0;
    else if (edges && event.key === "End") nextIndex = last;
    else {
      const delta = arrowDelta(event.key, move.orientation, isRightToLeft());
      if (delta === null) return undefined;
      nextIndex = move.loop
        ? (from + delta + reachable.length) % reachable.length
        : Math.min(last, Math.max(0, from + delta));
    }

    event.preventDefault();
    const next = reachable[nextIndex];
    if (next === undefined || next === current) return undefined;
    next.node.focus();
    return next;
  }

  /**
   * Moves to the next item whose text starts with what has been typed.
   * Successive keystrokes extend the search until the pause resets it, and a
   * repeated single character steps through items starting with it.
   */
  function focusByTypeahead(key: string): CompositeItem | undefined {
    if (key.length !== 1 || key === " ") return undefined;
    if (typeaheadTimer !== undefined) clearTimeout(typeaheadTimer);
    typeaheadTimer = setTimeout(() => {
      typeahead = "";
    }, 500);
    const repeat = typeahead.length === 1 && typeahead === key.toLowerCase();
    typeahead = repeat ? typeahead : typeahead + key.toLowerCase();

    const ordered = items();
    const active = ordered.findIndex(
      (entry) => entry.node === entry.node.ownerDocument.activeElement,
    );
    const from = active === -1 ? 0 : active + (repeat ? 1 : 0);
    for (let step = 0; step < ordered.length; step += 1) {
      const entry = ordered[(from + step) % ordered.length];
      const label = entry?.node.textContent?.trim().toLowerCase() ?? "";
      if (entry !== undefined && label.startsWith(typeahead)) {
        entry.node.focus();
        return entry;
      }
    }
    return undefined;
  }

  function isRightToLeft(): boolean {
    if (container === null) return false;
    const declared = container.node.closest("[dir]")?.getAttribute("dir");
    if (declared === "rtl" || declared === "ltr") return declared === "rtl";
    return getComputedStyle(container.node).direction === "rtl";
  }

  return {
    bindContainer,
    bindItem,
    containerNode,
    containsFocus,
    focusByTypeahead,
    item,
    itemAt,
    items,
    moveFocus,
    notePointerDown,
    pointerActive,
  };
}

function arrowDelta(
  key: string,
  orientation: Orientation | "both",
  rightToLeft: boolean,
): -1 | 1 | null {
  const vertical = orientation !== "horizontal";
  const horizontal = orientation !== "vertical";
  if (vertical && key === "ArrowUp") return -1;
  if (vertical && key === "ArrowDown") return 1;
  if (horizontal && key === "ArrowLeft") return rightToLeft ? 1 : -1;
  if (horizontal && key === "ArrowRight") return rightToLeft ? -1 : 1;
  return null;
}

export function sameValue(left: unknown, right: unknown): boolean {
  return left === right || Object.is(left, right);
}

export function onAbort(signal: AbortSignal, callback: () => void): void {
  signal.addEventListener("abort", callback, { once: true });
}
