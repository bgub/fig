import type { FigNode } from "@bgub/fig";
import type {
  CheckedChangeDetails,
  CheckedChangeHandler,
  ToggleControlOptions,
  ToggleControlParts,
} from "../internal/toggle.ts";
import { useToggleControl } from "../internal/toggle.ts";

export type SwitchCheckedChangeDetails = CheckedChangeDetails;

export type SwitchCheckedChangeHandler = CheckedChangeHandler;

/** A switch is on or off, so it has no indeterminate state. */
export type SwitchOptions = Omit<ToggleControlOptions, "indeterminate">;

export type SwitchParts = ToggleControlParts;

export interface SwitchProps extends SwitchOptions {
  children: (control: SwitchParts) => FigNode;
}

/**
 * Coordinates one switch: a native checkbox carrying `role="switch"`, so the
 * platform still owns toggling, focus, Space, and form submission while
 * assistive technology announces it as on or off rather than checked.
 */
export function useSwitch(options: SwitchOptions = {}): SwitchParts {
  return useToggleControl(options, "switch");
}

/**
 * {@link useSwitch} as a component, for a switch that is not already a
 * component of its own.
 */
export function Switch(props: SwitchProps): FigNode {
  return props.children(useSwitch(props));
}
