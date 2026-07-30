import {
  createElement,
  type ElementType,
  type FigNode,
  type Props,
} from "./element.ts";
import { readPromise } from "./hooks.ts";
import { assets as attachAssets, type FigAssetResource } from "./resource.ts";
import { isThenable, trackThenable } from "./thenables.ts";

export interface PayloadClientReference {
  assets?: readonly FigAssetResource[];
  exportName?: string;
  id: string;
  ssr?: boolean;
}

export type ResolveClientReference = (
  reference: PayloadClientReference,
) => ElementType<any> | PromiseLike<ElementType<any>> | undefined;

/**
 * A caller-owned stateful resolver: a `ResolveClientReference` that also
 * owns component identity. Decodes given one (as `resolveClientReference`)
 * resolve every client reference to a single resolver-owned wrapper per
 * reference id, so re-decoding a payload updates islands in place instead
 * of remounting them. The caller owns the lifetime: drop entries when their
 * modules change (HMR) or the manifest swaps.
 */
export interface PayloadClientReferenceResolver {
  (
    reference: PayloadClientReference,
  ): ElementType<any> | PromiseLike<ElementType<any>> | undefined;
  clear(): void;
  delete(id: string): boolean;
}

const resolverEntries = new WeakMap<
  ResolveClientReference,
  Map<string, ElementType<any>>
>();

export function createPayloadClientReferenceResolver(
  resolve: ResolveClientReference,
): PayloadClientReferenceResolver {
  const entries = new Map<string, ElementType<any>>();
  const resolver = Object.assign(
    (reference: PayloadClientReference) => resolve(reference),
    {
      clear: (): void => entries.clear(),
      delete: (id: string): boolean => entries.delete(id),
    },
  );
  resolverEntries.set(resolver, entries);
  return resolver;
}

interface ElementDelivery {
  assets?: readonly FigAssetResource[];
  gate?: Promise<void>;
}

// Delivery belongs to the decoded element, not its stable component type. A
// newer decode therefore cannot re-suspend an already-mounted island.
const elementDelivery = new WeakMap<Props, ElementDelivery>();

/** Owns client-reference identity and per-decode delivery state. */
export class PayloadClientReferences {
  private readonly rows = new Map<number, ElementDelivery>();

  constructor(private readonly resolve?: ResolveClientReference) {}

  register(
    rowId: number,
    reference: PayloadClientReference,
    gate: Promise<void> | null,
    assets: readonly FigAssetResource[] | null,
  ): ElementType<any> {
    const hasDelivery = gate !== null || assets !== null;
    if (hasDelivery) {
      const delivery: ElementDelivery = {};
      if (gate !== null) delivery.gate = gate;
      if (assets !== null) delivery.assets = assets;
      this.rows.set(rowId, delivery);

      if (gate !== null) {
        void gate.then(() => {
          delete delivery.gate;
          if (delivery.assets === undefined) this.rows.delete(rowId);
        });
      }
    }

    return this.resolveComponent(reference, hasDelivery);
  }

  attach(rowId: number, props: Props): void {
    const delivery = this.rows.get(rowId);
    if (delivery !== undefined) elementDelivery.set(props, delivery);
  }

  private resolveComponent(
    reference: PayloadClientReference,
    hasDelivery: boolean,
  ): ElementType<any> {
    const entries =
      this.resolve === undefined
        ? undefined
        : resolverEntries.get(this.resolve);
    const existing = entries?.get(reference.id);
    if (existing !== undefined) return existing;

    let resolved: ReturnType<ResolveClientReference>;
    try {
      resolved = this.resolve?.(reference);
    } catch (error) {
      resolved = Promise.reject(error);
    }

    if (resolved === undefined) {
      // Never cache a missing manifest entry: a later decode may resolve it.
      return function PayloadUnresolvedClientComponent(): never {
        throw new Error(
          `Cannot render client reference "${reference.id}" because decodePayloadStream was not configured with a matching resolveClientReference.`,
        );
      };
    }

    // A direct synchronous component needs no wrapper when identity does not
    // need resolver ownership and this decode has no delivery state.
    if (entries === undefined && !isThenable(resolved) && !hasDelivery) {
      return resolved;
    }

    const component = clientReferenceWrapper(resolved, reference.id);
    entries?.set(reference.id, component);
    return component;
  }
}

function clientReferenceWrapper(
  resolved: ElementType<any> | PromiseLike<ElementType<any>>,
  referenceId: string,
): ElementType<any> {
  let render: (props: Props) => FigNode;
  if (isThenable(resolved)) {
    const pending = Promise.resolve(resolved);
    trackThenable(pending);
    let type: ElementType<any> | null = null;
    render = (props) => {
      type ??= clientReferenceType(readPromise(pending), referenceId);
      return createElement(type, props);
    };
  } else {
    render = (props) => createElement(resolved, props);
  }

  function PayloadClientContent(content: {
    gate?: Promise<void>;
    props: Props;
  }): FigNode {
    if (content.gate !== undefined) readPromise(content.gate);
    return render(content.props);
  }

  return function PayloadClientComponent(props: Props): FigNode {
    const delivery = elementDelivery.get(props);
    const content = createElement(PayloadClientContent, {
      gate: delivery?.gate,
      props,
    });
    return delivery?.assets === undefined
      ? content
      : attachAssets(delivery.assets, content);
  };
}

function clientReferenceType(value: unknown, id: string): ElementType<any> {
  if (typeof value === "function") return value as ElementType<any>;
  throw new Error(`Client reference "${id}" did not resolve to a component.`);
}
