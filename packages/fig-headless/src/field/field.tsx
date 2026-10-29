import {
  createMixin,
  type FigNode,
  type MixinContext,
  type MixinDescriptor,
  useBeforePaint,
  useId,
  useMemo,
} from "@bgub/fig";
import {
  assertControlLabel,
  assertSinglePart,
  assertUniqueIds,
  expectHost,
} from "../internal/diagnostics.ts";
import {
  createPartReference,
  type PartReference,
} from "../internal/part-reference.ts";
import { usePartIds } from "../internal/ids.ts";
import { bindPart, setIdReference } from "../internal/parts.ts";
import { createPartCollection } from "../internal/registration.ts";
import { useRegistrationReconcile } from "../internal/reconcile.ts";

export interface FieldOptions {
  disabled?: boolean;
  /** Marks the control invalid and points it at the error message. */
  invalid?: boolean;
  required?: boolean;
}

export interface FieldParts {
  /** Applies to the caller's own control: an input, select, or widget part. */
  control(): MixinDescriptor;
  /** A stable key is required when rendering more than one description. */
  description(key?: unknown): MixinDescriptor;
  /** A stable key is required when rendering more than one error. */
  error(key?: unknown): MixinDescriptor;
  label(): MixinDescriptor;
}

export interface FieldProps extends FieldOptions {
  children: (field: FieldParts) => FigNode;
}

interface FieldState {
  readonly controlId: string;
  readonly disabled: boolean;
  readonly invalid: boolean;
  readonly labelId: string;
  readonly bind: (
    node: HTMLElement,
    signal: AbortSignal,
    part: FieldPart,
  ) => void;
  readonly required: boolean;
}

type FieldPart =
  | {
      readonly kind: "control";
      readonly describedBy: string | undefined;
      readonly label: PartReference;
    }
  | { readonly kind: "description" }
  | { readonly kind: "error" }
  | { readonly kind: "label"; readonly control: PartReference };

interface FieldMessageOwnState {
  readonly id: string;
}

const defaultDescription = Symbol("fig-headless.field.description");
const defaultError = Symbol("fig-headless.field.error");

const fieldLabelMixin = /* @__PURE__ */ createMixin(
  (context: MixinContext, state: FieldState) => {
    expectHost(context, "field label", "label");
    const control = createPartReference(context, "for", state.controlId);
    return {
      bind: bindPart(context, state.bind, (node, signal) =>
        state.bind(node, signal, {
          kind: "label",
          control,
        }),
      ),
      // A wrapping label needs no `for`, but pointing at the control also works
      // when the two are siblings, which is the arrangement that needs help.
      ...control.props,
      id: context.props.id ?? state.labelId,
    };
  },
);

const fieldControlMixin = /* @__PURE__ */ createMixin(
  (context: MixinContext, state: FieldState) => {
    const label = createPartReference(
      context,
      "aria-labelledby",
      state.labelId,
    );
    return {
      ...label.props,
      "aria-invalid": state.invalid ? "true" : undefined,
      bind: bindPart(context, state.bind, (node, signal) =>
        state.bind(node, signal, {
          describedBy: context.props["aria-describedby"],
          label,
          kind: "control",
        }),
      ),
      disabled: state.disabled ? true : context.props.disabled,
      id: context.props.id ?? state.controlId,
      required: state.required ? true : context.props.required,
    };
  },
);

const fieldDescriptionMixin = /* @__PURE__ */ createMixin(
  (context: MixinContext, state: FieldState, own: FieldMessageOwnState) => ({
    bind: bindPart(context, state.bind, (node, signal) =>
      state.bind(node, signal, { kind: "description" }),
    ),
    id: context.props.id ?? own.id,
  }),
);

const fieldErrorMixin = /* @__PURE__ */ createMixin(
  (context: MixinContext, state: FieldState, own: FieldMessageOwnState) => ({
    bind: bindPart(context, state.bind, (node, signal) =>
      state.bind(node, signal, { kind: "error" }),
    ),
    id: context.props.id ?? own.id,
  }),
);

/**
 * Ties one control to its label, description, and error message.
 *
 * The relationships are the whole job, and only the committed DOM knows which
 * parts a caller actually rendered: a description that is not there must not
 * be referenced, and an error that appears has to join the description list.
 */
export function useField(options: FieldOptions = {}): FieldParts {
  const { disabled = false, invalid = false, required = false } = options;
  const id = useId();
  const controlId = `${id}-control`;
  const labelId = `${id}-label`;
  const idFor = usePartIds();
  const requestReconcile = useRegistrationReconcile();
  const parts = useMemo(
    () => createPartCollection<FieldPart>(requestReconcile),
    [],
  );

  useBeforePaint(() => {
    const registrations = parts.items();
    const controls = registrations.filter(
      (part) => part.value.kind === "control",
    );
    const labels = registrations.filter((part) => part.value.kind === "label");
    assertSinglePart(controls, "field control");
    assertSinglePart(labels, "field label");
    const control = controls.at(-1);
    if (control === undefined) return;
    const node = control.node;
    const label = labels.at(-1);
    if (label?.value.kind === "label")
      label.value.control.sync(label.node, node.id);
    if (control.value.kind === "control")
      control.value.label.sync(node, label?.node.id);
    assertControlLabel(node);
    const descriptions = registrations
      .filter((part) => part.value.kind === "description")
      .map((part) => part.node)
      .sort(compareMessageOrder);
    const errors = registrations
      .filter((part) => part.value.kind === "error")
      .map((part) => part.node)
      .sort(compareMessageOrder);
    assertUniqueIds([...descriptions, ...errors], "field messages");
    const authored =
      control.value.kind === "control"
        ? control.value.describedBy?.split(/\s+/)
        : undefined;
    const described = uniqueReferences([
      ...(authored ?? []),
      ...descriptions.map((description) => description.id),
      ...(invalid ? errors.map((error) => error.id) : []),
    ]).join(" ");
    setIdReference(node, "aria-describedby", described);
  });

  const state: FieldState = {
    controlId,
    disabled,
    invalid,
    labelId,
    bind: parts.bind,
    required,
  };

  return {
    control: () => fieldControlMixin(state),
    description: (key = defaultDescription) =>
      fieldDescriptionMixin(state, { id: idFor(key, "description") }),
    error: (key = defaultError) =>
      fieldErrorMixin(state, { id: idFor(key, "error") }),
    label: () => fieldLabelMixin(state),
  };
}

// Stable registrations outlive keyed moves. Read order after DOM placement;
// unrelated trees have no DOM order, so retain their registration order.
function compareMessageOrder(first: HTMLElement, second: HTMLElement): number {
  const position = first.compareDocumentPosition(second);
  if (position & Node.DOCUMENT_POSITION_DISCONNECTED) return 0;
  if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
  if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
  return 0;
}

function uniqueReferences(references: readonly string[]): string[] {
  return [...new Set(references.filter((reference) => reference !== ""))];
}

/**
 * {@link useField} as a component, for a field that is not already a
 * component of its own.
 */
export function Field(props: FieldProps): FigNode {
  return props.children(useField(props));
}
