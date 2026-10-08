import { useStableEvent } from "@bgub/fig";
import { type ChangeDetails, createChangeDetails } from "./changes.ts";
import { useControllableValue } from "./controllable-value.ts";

export type OpenChangeDetails = ChangeDetails;
export type OpenChangeHandler = (
  open: boolean,
  details: OpenChangeDetails,
  signal: AbortSignal,
) => void;
export interface OpenStateOptions {
  defaultOpen?: boolean;
  onOpenChange?: OpenChangeHandler;
  open?: boolean;
  requestReconcile: () => void;
}

/** Widget open intent; browser observation belongs to the popup adapter. */
export function useOpenState(options: OpenStateOptions) {
  const state = useControllableValue({
    value: options.open,
    defaultValue: options.defaultOpen === true,
    onChange: options.onOpenChange,
    reconcile: options.requestReconcile,
  });
  const requestOpen = useStableEvent(
    (next: boolean, event: Event, trigger: Element | undefined) =>
      state.request(() => next, createChangeDetails(event, trigger)),
  );
  const setOpen = useStableEvent((next: boolean) =>
    state.request(() => next, createChangeDetails(null)),
  );
  return { open: state.value, requestOpen, setOpen };
}
