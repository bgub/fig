import type { Props } from "@bgub/fig";
import type { AssetResourceOwner } from "@bgub/fig-reconciler";
import { updateElement } from "./props.ts";

declare const __FIG_DEV__: boolean | undefined;

const __DEV__ = typeof __FIG_DEV__ === "boolean" ? __FIG_DEV__ : false;

export class MetadataClaims {
  readonly kind = "metadata" as const;
  private readonly byOwner = new Map<AssetResourceOwner, Props>();
  private rendered: Props | null = null;
  private winner: AssetResourceOwner;

  constructor(
    readonly element: Element,
    private readonly resourceKind: "title" | "meta",
    owner: AssetResourceOwner,
    props: Props,
  ) {
    this.winner = owner;
    this.byOwner.set(owner, props);
    this.applyWinner();
  }

  acquire(owner: AssetResourceOwner, props: Props): void {
    const isNewOwner = !this.byOwner.has(owner);
    this.byOwner.set(owner, props);
    if (isNewOwner) this.winner = owner;
    if (this.winner === owner) this.applyWinner();
  }

  update(owner: AssetResourceOwner, props: Props): void {
    if (!this.byOwner.has(owner)) {
      throw new Error("Expected a live metadata claim.");
    }
    this.byOwner.set(owner, props);
    if (this.winner === owner) this.applyWinner();
  }

  release(owner: AssetResourceOwner): "empty" | "retained" {
    if (!this.byOwner.delete(owner)) {
      if (__DEV__) throw new Error("Expected a live metadata claim.");
      return "retained";
    }
    if (this.byOwner.size === 0) return "empty";
    if (this.winner !== owner) return "retained";

    let winner: AssetResourceOwner | null = null;
    for (const candidate of this.byOwner.keys()) winner = candidate;
    if (winner === null) throw new Error("Expected a live metadata claim.");
    this.winner = winner;
    this.applyWinner();
    return "retained";
  }

  private applyWinner(): void {
    const props = this.byOwner.get(this.winner);
    if (props === undefined) throw new Error("Expected a live metadata claim.");

    updateElement(this.element, this.rendered ?? {}, props);
    if (this.resourceKind === "title") {
      this.element.textContent = metadataTextValue(props.children);
    }
    this.rendered = props;
  }
}

function metadataTextValue(value: unknown): string {
  if (value === null || value === undefined || typeof value === "boolean") {
    return "";
  }
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(metadataTextValue).join("");
  return "";
}
