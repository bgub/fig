# Fig UI

Accessible, unstyled widgets built around Fig host mixins. Widget roots own
state and coordination; applications keep ownership of the rendered host tree.

Status: experimental and source-distributed. `@bgub/fig-ui` is a private
workspace package used to test the canonical implementation; it is not
published to npm or JSR and carries no compatibility promise yet.

## Copy Into An Application

Copy `packages/fig-ui/src` into an application-owned directory such as
`src/ui`, preserving its directory structure. Widgets share selected modules
under `internal`, so copying the whole source tree is the reliable starting
point; unused widget directories can then be deleted after checking their
relative imports.

The examples below assume `~` resolves to the application's `src` directory.
Copied files remain ordinary application code: edit their markup contracts,
delete behavior the application does not need, and keep only the accessibility
invariants that still apply to the resulting design.

Agents should copy from a pinned Fig commit, retain the relevant tests while
adapting behavior, and use application-local imports. Do not add a registry
dependency on `@bgub/fig-ui`.

## Tabs

`useTabs` returns host-part mixins for the caller's own elements:

```tsx
import { useTabs } from "~/ui/tabs/tabs.tsx";

export function SettingsTabs() {
  const tabs = useTabs({ defaultValue: "account" });

  return (
    <div>
      <div aria-label="Settings" mix={tabs.list({ activateOnFocus: true })}>
        <button mix={tabs.tab("account")}>Account</button>
        <button mix={tabs.tab("security")}>Security</button>
      </div>
      <section class="panel" mix={tabs.panel("account")}>
        Account settings
      </section>
      <section class="panel" mix={tabs.panel("security")}>
        Security settings
      </section>
    </div>
  );
}
```

`Tabs` is the same widget as a component, for markup that is not already a
component of its own. Selection re-renders the callback's output rather than
the caller:

```tsx
import { Tabs } from "~/ui/tabs/tabs.tsx";

export function SettingsTabs() {
  return (
    <Tabs defaultValue="account">
      {(tabs) => (
        <div>
          <div aria-label="Settings" mix={tabs.list({ activateOnFocus: true })}>
            <button mix={tabs.tab("account")}>Account</button>
            <button mix={tabs.tab("security")}>Security</button>
          </div>
          <div class="panels">
            <section class="panel" mix={tabs.panel("account")}>
              Account settings
            </section>
            <section class="panel" mix={tabs.panel("security")}>
              Security settings
            </section>
          </div>
        </div>
      )}
    </Tabs>
  );
}
```

Each widget has its own source entry. There is intentionally no root barrel,
namespace object, or module side effect, so copied applications can retain only
the entries they use.

The root can be controlled with a defined `value`, or uncontrolled with
`defaultValue`. `undefined` means the prop is absent and `null` means no active
tab. With neither prop the root selects the first enabled tab before paint.
Uncontrolled roots automatically recover when the selected tab becomes disabled
or unmounts, and report the value they settled on with a `null` event.
`onValueChange(value, details, signal)` reports user and automatic changes;
`details.cancel()` cancels user selection. Activation events retain their
native propagation; a handler on the target may use `stopPropagation()` to
suppress both the widget and its ancestors.

Manual activation is the default: arrow keys move the roving tab stop and
`Enter` or `Space` selects. Use `tabs.list({ activateOnFocus: true })` when
panels appear without latency.
Lists loop by default, support Home/End, vertical orientation, RTL, and leave
modified key chords alone. Leaving a manually activated list resets its roving
tab stop to the selected tab.

Disabled tabs remain keyboard-focusable so their labels and unavailable state
can be discovered, but they cannot activate. `tabs.panel()` keeps caller-owned
hosts mounted and hides inactive ones. For presence, branch directly on
`tabs.value`; rendering policy stays ordinary Fig state.

Control selection and wrap the state update with Fig's `useTransition` when the
application wants to animate it:

```tsx
import { useState, useTransition, ViewTransition } from "@bgub/fig";

const [value, setValue] = useState<string | null>("account");
const [, startTransition] = useTransition();
const tabs = useTabs({
  value,
  onValueChange: (next) =>
    startTransition(() => setValue(next), {
      types: ["settings-tabs"],
      viewTransition: "interrupt",
    }),
});

<ViewTransition name="settings-panel">
  <div class="frame">
    {tabs.value === "account" ? (
      <section mix={tabs.panel("account")}>Account settings</section>
    ) : null}
    {tabs.value === "security" ? (
      <section mix={tabs.panel("security")}>Security settings</section>
    ) : null}
  </div>
</ViewTransition>;
```

One boundary animates both sides: its old and new images carry the outgoing and
incoming panel, and its group interpolates the frame's height.

The images are flat snapshots that move with their animation, so a border or
background left on the frame slides away with the outgoing panel. Paint that
chrome on the group instead, and let the live frame drop it while a
`settings-tabs` transition is active:

```css
::view-transition-group(settings-panel) {
  background: var(--card);
  border: 1px solid var(--border);
  box-sizing: border-box;
  overflow: clip;
}

:root:active-view-transition-type(settings-tabs) .frame {
  background: transparent;
  border-color: transparent;
}
```

The application owns the transition type and animation policy. It can use one
type as above or derive directional types from `details.trigger` and the
currently selected tab. Captured descendants cannot receive pointer input
during an animation, so keep the tab list outside the boundary.

The indicator remains optional, so applications that do not render one bundle
no measurement code:

```tsx
import { useTabsIndicator } from "~/ui/tabs/indicator.ts";

const indicator = useTabsIndicator();

<div mix={[tabs.list(), indicator.list()]}>
  <button mix={tabs.tab("account")}>Account</button>
  <button mix={tabs.tab("security")}>Security</button>
  <span
    mix={indicator.indicator()}
    style={{
      left: "var(--active-tab-left)",
      width: "var(--active-tab-width)",
    }}
  />
</div>;
```

It publishes `--active-tab-left`, `--active-tab-width`, and the other box
edges, and stays hidden until it has measured the active tab before paint.

## Radio group

```tsx
import { useRadioGroup } from "~/ui/radio-group/radio-group.tsx";

export function SizeChoice() {
  const group = useRadioGroup({ defaultValue: "medium", name: "size" });

  return (
    <div aria-label="Size" mix={group.root()}>
      {["small", "medium", "large"].map((value) => (
        <label>
          <input mix={group.radio(value)} /> {value}
        </label>
      ))}
    </div>
  );
}
```

`radio()` applies to a real `<input type="radio">`. Radios sharing a name are
already a group to the browser, so it owns the single tab stop, arrow movement
on either axis, wrapping, skipping disabled radios, Space, form submission, and
validity — the widget adds no keyboard handling at all. It names the group,
drives `checked`, and reports what the platform decided. Style the input with
`appearance: none`, or hide it and style its label.

`required` marks the group for validation, the generated `name` is on the parts
object, and your own `name` or `value` prop wins over the generated one.
`readOnly` prevents changes without disabling focus or form submission. Native
form reset restores `defaultValue` for an uncontrolled group and reasserts
`value` for a controlled group.

## Accordion

```tsx
import { useAccordion } from "~/ui/accordion/accordion.tsx";

export function Help() {
  const accordion = useAccordion({ defaultValue: ["shipping"] });

  return (
    <div mix={accordion.root()}>
      <h3>
        <button mix={accordion.trigger("shipping")}>Shipping</button>
      </h3>
      {accordion.isOpen("shipping") ? (
        <section mix={accordion.panel("shipping")}>Ships in two days.</section>
      ) : null}
    </div>
  );
}
```

`value` and `defaultValue` are arrays in every mode. One panel opens at a time
by default; `collapsible: false` keeps the last one open and `multiple` holds
several. Headers stay in the tab order, with optional arrow, Home, and End
movement between them. Animate the panel frame by controlling the open values:

```tsx
const [values, setValues] = useState<readonly string[]>(["shipping"]);
const [, startTransition] = useTransition();

const accordion = useAccordion({
  value: values,
  onValueChange: (next) =>
    startTransition(() => setValues(next), {
      types: ["help-accordion"],
      viewTransition: "interrupt",
    }),
});
```

The application may use separate expansion and collapse types when its visual
design needs that distinction.

## Dialog

```tsx
import { useDialog } from "~/ui/dialog/dialog.tsx";

export function DeleteFile() {
  const dialog = useDialog();

  return (
    <>
      <button mix={dialog.trigger()}>Delete</button>
      <dialog mix={dialog.dialog()}>
        <h2 mix={dialog.title()}>Delete this file?</h2>
        <p mix={dialog.description()}>This cannot be undone.</p>
        <button mix={dialog.dismiss()}>Cancel</button>
      </dialog>
    </>
  );
}
```

You render a real `<dialog>`, so the platform provides the top layer, focus
containment, focus restoration, the inert background, `::backdrop`, and Escape.
The widget adds open state, labelling, and dismissal policy: `closeOnEscape`
and `closeOnBackdrop` default to `true`, and a backdrop click is told apart
from a click on the dialog's own padding.

The user agent centres a modal dialog with `margin: auto`, so a reset that
zeroes margins leaves it in the corner; restore `margin: auto` on the element.

Animate it with `@starting-style` and `transition-behavior: allow-discrete`
rather than a view transition, and lock scrolling with
`html:has(dialog[open]) { overflow: clip }`, paired with `scrollbar-gutter:
stable` so hiding the scrollbar does not shift the page. All of it is CSS, so
none of it is an option on the root.

## Popover

```tsx
import { usePopover } from "~/ui/popover/popover.tsx";

export function Filters() {
  const popover = usePopover({ id: "filters-popover" });

  return (
    <>
      <button mix={popover.trigger()}>Filters</button>
      <div class="panel" mix={popover.popover()}>
        ...
      </div>
    </>
  );
}
```

```css
.panel {
  position-area: block-end span-inline-end;
}
```

The popover attribute provides the top layer, light dismiss, and Escape; CSS
anchor positioning provides placement. The widget measures nothing and adds no
outside-click, scroll, or resize listener — it generates one anchor name, puts
it on the trigger as `anchor-name` and on the popover as `position-anchor`, and
leaves placement to your CSS. The trigger also carries `popovertarget`, so it
works before hydration. Pass a custom popover id to the root; the root owns the
host `id` so the server-rendered trigger and popover cannot diverge.

Anchor positioning has not shipped in every browser yet, so pair your placement
with a `@supports not (anchor-name: --a)` fallback. Where the popover API
itself is missing, the widget falls back to toggling `hidden`.

## Tooltip

```tsx
import { useTooltip } from "~/ui/tooltip/tooltip.tsx";

const tooltip = useTooltip({ id: "save-help" });

<>
  <button mix={tooltip.trigger()}>Save</button>
  <div mix={tooltip.tooltip()}>Save this document</div>
</>;
```

Keyboard focus opens immediately, mouse hover uses a configurable delay, and
Escape closes. Existing `aria-describedby` references are preserved. Tooltip
content is descriptive and non-interactive; use a popover for controls.

## Listbox

```tsx
import { useListbox } from "~/ui/listbox/listbox.tsx";

const listbox = useListbox({ defaultValue: ["apple"], multiple: true });

<div aria-label="Fruit" mix={listbox.root()}>
  <div mix={listbox.option("apple")}>Apple</div>
  <div mix={listbox.option("banana")}>Banana</div>
</div>;
```

Selection is array-shaped in single and multiple modes. DOM focus stays on the
root while arrows, Home/End, and typeahead move an active descendant. Movement
selects in single mode; Enter and Space toggle in multiple mode. The
application owns scrolling, virtualization, and form serialization, so an
unmounted option does not implicitly erase its selected value.

## Select

Prefer native `<select>` when its rendering works. The Fig UI select covers
the custom-popup case while leaving every host and label to the application:

```tsx
import { useSelect } from "~/ui/select/select.tsx";

const select = useSelect({ defaultValue: "apple", name: "fruit" });

<>
  <button mix={select.trigger()}>{select.value}</button>
  <div mix={select.popup()}>
    <div mix={select.option("apple")}>Apple</div>
    <div mix={select.option("banana")}>Banana</div>
  </div>
  <input mix={select.hiddenInput()} />
</>;
```

It provides active-descendant navigation, disabled-option skipping, typeahead,
controlled or uncontrolled selection, read-only inspection, form submission,
and reset. Native constraint validation remains a reason to use `<select>`.

## Combobox

```tsx
import { useCombobox } from "~/ui/combobox/combobox.tsx";

const combobox = useCombobox({ name: "fruit" });
const matches = fruits.filter((fruit) =>
  fruit.startsWith(combobox.inputValue.toLowerCase()),
);

<>
  <input mix={combobox.input()} />
  <div mix={combobox.popup()}>
    {matches.map((fruit) => (
      <div mix={combobox.option(fruit)}>{fruit}</div>
    ))}
  </div>
  <input mix={combobox.hiddenInput()} />
</>;
```

Fig UI owns input/listbox relationships, active-descendant movement,
selection, controlled state, and form reset. The application owns filtering,
async loading, option rendering, empty states, and placement CSS.

## Menu

```tsx
import { useMenu } from "~/ui/menu/menu.tsx";

export function Actions() {
  const menu = useMenu({ onSelect: (value) => run(value) });

  return (
    <>
      <button mix={menu.trigger()}>Actions</button>
      <div class="menu" mix={menu.menu()}>
        <button mix={menu.item("rename")}>Rename</button>
        <button mix={menu.item("remove")}>Remove</button>
      </div>
    </>
  );
}
```

The menu is built on the popover, so it inherits the top layer, light dismiss,
Escape, and anchor positioning, and adds what a menu needs: roles, arrow and
Home/End movement, typeahead, and focus. `showPopover()` leaves focus alone, so
the menu moves it to the first item on open — the last with ArrowUp — and
returns it to the trigger on close. Tab closes rather than walking the items.
From a submenu, Tab closes the whole menu tree.

`onSelect` runs before the menu closes, and `details.cancel()` keeps it open.
Action items close by default and can set `closeOnSelect: false`.
`checkboxItem(value, { checked })` and `radioItem(value, { checked })` expose
controlled checked menu items and stay open by default.

Submenus are optional:

```tsx
import { useMenuSubmenu } from "~/ui/menu/submenu.ts";

const share = useMenuSubmenu(menu, "share");

<div mix={menu.menu()}>
  <button mix={share.trigger()}>Share</button>
  <div mix={share.menu()}>
    <button mix={share.item("email")}>Email</button>
  </div>
</div>;
```

Inline-end opens, inline-start closes, RTL reverses both, and hover uses a
configurable delay. Focus enters the child on keyboard open and returns to the
parent trigger on close. An accepted child action closes the whole menu tree.

## Toolbar

```tsx
import { useToolbar } from "~/ui/toolbar/toolbar.tsx";

const toolbar = useToolbar();

<div aria-label="Formatting" mix={toolbar.root()}>
  <button mix={toolbar.item("bold")}>Bold</button>
  <button mix={toolbar.item("italic")}>Italic</button>
</div>;
```

Toolbar provides one roving tab stop, orientation-aware and RTL-aware arrow
movement, Home/End, disabled-item skipping, and optional focus looping. It owns
no command or selection state; every item remains the application's control.

## Toast region

```tsx
import { useToastRegion } from "~/ui/toast/toast.tsx";

const region = useToastRegion({
  onDismiss: (id) =>
    setToasts((items) => items.filter((item) => item.id !== id)),
});

<div mix={region.region()}>
  {toasts.map((toast) => (
    <div mix={region.toast(toast.id)}>
      {toast.message}
      <button mix={region.dismiss(toast.id)}>Dismiss</button>
    </div>
  ))}
</div>;
```

The application owns the toast array, markup, placement, and stacking. Keep the
region mounted before adding notifications; it supplies polite or assertive
live semantics, dismiss requests, and lifetimes that pause for focus, hover,
and a hidden document. Urgency is region-scoped, so use separately labelled
regions when an application genuinely needs both. There is no provider, global
queue, portal, or gesture policy.

## Checkbox, switch, and field

```tsx
import { useCheckbox } from "~/ui/checkbox/checkbox.tsx";
import { useField } from "~/ui/field/field.tsx";

export function Terms({ invalid }: { invalid: boolean }) {
  const field = useField({ invalid, required: true });
  const checkbox = useCheckbox({ name: "terms", value: "accepted" });

  return (
    <div>
      <label mix={field.label()}>Accept the terms</label>
      <input mix={[field.control(), checkbox.control()]} />
      {invalid ? <p mix={field.error()}>This is required.</p> : null}
    </div>
  );
}
```

Both the checkbox and the switch apply to a native `<input type="checkbox">`,
so the browser owns toggling, focus, Space, submission, and validity. The
switch is the same control with `role="switch"`. The one thing the widget must
write itself is `indeterminate`, which the platform exposes only as a property.
Both controls accept `readOnly`, which blocks toggling without removing focus
or form submission. Form reset restores their initial `defaultChecked` state.

`useField` preserves authored `aria-describedby` references and then wires all
mounted descriptions followed by active errors. Pass stable keys to
`description(key)` and `error(key)` when rendering repeated messages; errors
are referenced only while `invalid` is true.

## Development diagnostics

Development builds reject markup that would silently discard a widget's
accessibility contract. Checkbox, switch, and radio parts require native
`<input>` elements; accordion, dialog, popover, and menu triggers require
native `<button>` elements, as does a toast dismiss control; `dialog()` requires
`<dialog>`; and `field.label()` requires `<label>`. Tab lists, radio groups,
listboxes, and toast regions require an accessible name, dialogs and field
controls require their naming parts or an explicit ARIA name, singleton parts,
item, panel, and toast values, and field message ids must be unique, and every
mounted panel must have a matching control. These checks are removed from
production bundles.
