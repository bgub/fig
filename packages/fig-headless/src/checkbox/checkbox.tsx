import type { FigNode } from "@bgub/fig";
import type {
  CheckedChangeDetails,
  CheckedChangeHandler,
  ToggleControlOptions,
  ToggleControlParts,
} from "../internal/toggle.ts";
import { useToggleControl } from "../internal/toggle.ts";

export type CheckboxCheckedChangeDetails = CheckedChangeDetails;

export type CheckboxCheckedChangeHandler = CheckedChangeHandler;

export type CheckboxOptions = ToggleControlOptions;

export type CheckboxParts = ToggleControlParts;

export interface CheckboxProps extends CheckboxOptions {
  children: (checkbox: CheckboxParts) => FigNode;
}

/**
 * Coordinates one checkbox over a native input, which owns toggling, focus,
 * Space, form submission, and validity. The widget owns the checked value it
 * reports and writes `indeterminate`, which the platform exposes only as a
 * property.
 */
export function useCheckbox(options: CheckboxOptions = {}): CheckboxParts {
  return useToggleControl(options, undefined);
}

/**
 * {@link useCheckbox} as a component, for a checkbox that is not already a
 * component of its own.
 */
export function Checkbox(props: CheckboxProps): FigNode {
  return props.children(useCheckbox(props));
}
