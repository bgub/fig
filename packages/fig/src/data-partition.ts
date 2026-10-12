import type { DataResourceKeyInput, FigDataHydrationEntry } from "./data.ts";
import { encodeDataKeyInput } from "./data-key.ts";

/** Immutable partition identity shared by stores and transport boundaries. */
export class DataPartition {
  readonly key: string;

  constructor(value?: DataResourceKeyInput) {
    this.key =
      value === undefined ? "" : encodeDataKeyInput(value, "partition");
  }

  /** Copy the label so callers cannot mutate the store's identity. */
  label(): { partition?: DataResourceKeyInput } {
    return this.key === "" ? {} : { partition: JSON.parse(this.key) };
  }

  assert(value?: DataResourceKeyInput): void {
    const key =
      value === undefined ? "" : encodeDataKeyInput(value, "partition");
    if (key !== this.key) {
      throw new Error(
        "Data partition mismatch: incoming data does not belong to this store or decoder.",
      );
    }
  }

  /** Validate the complete batch before any entry is published or retired. */
  assertEntries(
    entries: readonly Pick<FigDataHydrationEntry, "partition">[],
  ): void {
    for (const entry of entries) this.assert(entry.partition);
  }
}
