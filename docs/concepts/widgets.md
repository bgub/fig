# Headless Widgets

Status: exploring; private copy-first reference implementation

`packages/fig-ui` contains Fig's canonical source for accessible, unstyled DOM widgets: [tabs](#tabs), a [radio group](#radio-group), an [accordion](#accordion), a [dialog](#dialog), a [popover](#popover), a [tooltip](#tooltip), a [listbox](#listbox), a [select](#select), a [combobox](#combobox), a [menu](#menu), a [toolbar](#toolbar), a [toast region](#toast-region), a [checkbox](#checkbox-and-switch), a [switch](#checkbox-and-switch), and a [field](#field). The workspace package is private and unpublished; applications copy the source they need and own the result. A widget divides its interface at the same boundary as Fig: components own state and relationships; host mixins attach the resulting behavior to application-owned elements.

## Stateful Roots And Host Parts

A widget hook owns the state and returns descriptors for its host parts:

```tsx
import { useTabs } from "~/ui/tabs/tabs.tsx";

function Settings() {
  const tabs = useTabs({ defaultValue: "account" });

  return (
    <>
      <div aria-label="Settings" mix={tabs.list()}>
        <button mix={tabs.tab("account")}>Account</button>
        <button mix={tabs.tab("security")}>Security</button>
      </div>
      <section mix={tabs.panel("account")}>...</section>
      <section mix={tabs.panel("security")}>...</section>
    </>
  );
}
```

The hook owns state, stable event lifetimes, generated ids, and coordination across parts. It inserts no host element. The caller owns element types, children, layout, styling, and the placement of each part, and may pass the parts object to descendant components.

Every widget also ships the hook as a component taking a render callback, for a widget that is not already a component of its own:

```tsx
<Tabs defaultValue="account">{(tabs) => <>...</>}</Tabs>
```

The two are the same widget — the component is the hook plus `props.children(parts)`. Choose by what should re-render: the hook re-renders the component that calls it, so a widget sharing a component with unrelated markup re-renders that markup on every selection, while the component form confines the update to the callback's output.

Controlled roots treat `setOpen()` and `setChecked()` as requests. Every request that differs from the rendered prop invokes the change callback; if the owner keeps its prop unchanged, the widget reconciles back to that prop without leaving an optimistic value that suppresses a later retry. User-agent changes follow the same rule: a refused or canceled native toggle is restored before paint.

Part descriptors remain ordinary Fig mixins. They run whenever their intrinsic element is created, compose in authored `mix` order, and cannot call hooks, read context, or restructure children. A widget must resolve component state before constructing a descriptor rather than making the descriptor discover that state itself.

Each widget owns a dedicated source entry with direct named exports for its hook and component, with no root barrel, namespace object, or module side effects. The private workspace package mirrors those entries so repository tests and demos exercise the same boundaries applications copy.

Presentation stays outside the accessibility primitives. Tabs indicator measurement lives on an optional nested subpath, while applications animate controlled tabs and accordions with Fig's ordinary transition APIs.

## The Composite Primitive

Widgets whose items live in one container share an internal composite: registration by object identity, ordering and membership read from the live DOM, ownership checks that survive nesting, pointer tracking, and arrow, Home, and End movement. Each widget supplies the container and item selectors and the movement rules its pattern calls for.

Those rules are where the patterns genuinely differ, and the primitive makes the differences explicit rather than uniform:

- tabs land on disabled tabs, because a disabled tab's label and state should stay discoverable, while radios pass over them, because arrow movement also selects;
- radios accept either axis the way a native group does, tabs and accordions accept one; and
- radios have no edge keys, because Home and End would change the value.

Registration reports back to the root on every bind and unbind. A descendant component may own part of the markup, so without that report a root would never reconcile against the committed DOM, and a selected item that unmounted from a descendant's own state would strand both the selection and the roving tab stop.

## Tabs

The behavior follows the [WAI-ARIA Tabs Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/).

`Tabs` accepts arbitrary tab identities. A defined `value` creates controlled selection, `defaultValue` creates uncontrolled selection, `undefined` on either root prop means it is absent, and `null` represents no active tab. When neither is supplied, the root selects the first enabled mounted tab before paint. An explicit `defaultValue` of `null` means the opposite — the application asked for no selection — and is left alone.

Uncontrolled roots repair their selection when tabs change:

- a selected tab that becomes disabled falls back to the first enabled tab;
- a selected tab that unmounts falls back the same way; and
- no enabled fallback selects `null`.

A tabs root repairs where a radio group would not, because a tabs widget with nothing selected shows no panel at all, while an unanswered radio group is an ordinary state.

A root with no registered tabs at all keeps its selection: the subtree may be unmounting, or an `Activity` may have hidden it, and either way the value is worth restoring when tabs return.

Repairs do not depend on the root rendering. Parts may be authored by a descendant component that mounts or unmounts tabs from its own state, so registration reports back and the root reconciles against the committed DOM before paint. Without that report a removed selected tab would strand both the selection and the roving tab stop, leaving a list no keyboard user can enter.

Explicit disabled defaults and controlled values remain selected because the application owns that choice. Automatic repairs cannot be canceled.

`onValueChange(value, details, signal)` observes both requested and automatic changes. Details contain the native event, trigger, cancellation state, and `cancel()` control. A `null` event marks a change the root made for itself, which is the only distinction a caller needs: a repair reports the value it settled on, and a caller that wants more reads the tabs it rendered. Canceling a user request leaves uncontrolled state unchanged. Activation events retain native propagation; a target handler may call `stopPropagation()` to suppress both widget activation and ancestors. The signal follows the ordinary stable-event lifetime.

`useTabs(options)` and the `Tabs` child callback both provide `value` and these factories:

- `list({ activateOnFocus?, loopFocus? })` applies `tablist`, orientation, and composite keyboard navigation;
- `tab(value, { disabled? })` applies relationships, roving focus, button defaults, and activation;
- `panel(value)` applies a labelled, focusable, hidden/inert panel while the caller keeps the host mounted.

Matching tab and panel values receive generated ids. Mounted hosts with explicit ids are registered after commit, and their `aria-controls`/`aria-labelledby` relationships are synchronized before paint. Values must be unique within each part kind.

### Tab Focus And Keyboard Behavior

The list owns every tab interaction. Tabs are plain hosts carrying attributes, so a root keeps a fixed number of listeners no matter how many tabs it has, and a tab's own `mix={on(...)}` handlers run first in the target phase. A tab handler that calls `stopPropagation()` therefore suppresses widget activation, which is the native way to opt one tab out.

Manual activation is the default. Arrow, Home, and End keys move the roving tab stop without changing selection; Enter or Space activates it. `activateOnFocus` makes focus select enabled tabs. Horizontal lists follow LTR or RTL Left/Right movement, vertical lists use Up/Down, looping defaults on, and modified key chords retain their native behavior.

Focus and selection are independent. A controlled selection change moves the roving tab stop when focus is outside the list, but never steals it while a user is navigating inside. When focus leaves a manually activated list, its roving tab stop returns to the selected tab. Disabled tabs remain focusable from the composite keyboard sequence and expose `aria-disabled`; they never activate and native buttons deliberately do not receive `disabled`.

### Panel Transitions And Indicator Behavior

`panel()` is the ordinary zero-structure option: the caller authors every panel and inactive hosts remain mounted with `hidden`, `inert`, and `tabindex="-1"`. For presence, the caller branches on the controlled `tabs.value`; rendering policy is ordinary Fig state rather than another widget API. Presence composes directly with Fig's wrapperless `ViewTransition`. The application controls selection and wraps its state update in a transition; one boundary around the panel frame then animates both the content and the frame's height:

```tsx
import { useState, useTransition, ViewTransition } from "@bgub/fig";
import { enableViewTransitions } from "@bgub/fig-dom/view-transitions";
import { useTabs } from "~/ui/tabs/tabs.tsx";

enableViewTransitions();

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
      <section mix={tabs.panel("account")}>...</section>
    ) : null}
    {tabs.value === "security" ? (
      <section mix={tabs.panel("security")}>...</section>
    ) : null}
  </div>
</ViewTransition>;
```

```css
/* The group morphs; the old and new images animate inside it. */
::view-transition-group(settings-panel) {
  animation-duration: 320ms;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  box-sizing: border-box;
  overflow: clip;
}

:root:active-view-transition-type(settings-tabs)::view-transition-old(
    settings-panel
  ) {
  animation-name: slide-out-left;
}

/* The frame's own chrome would slide with the snapshots, so hand it to the
   group for the duration of the transition. */
:root:active-view-transition-type(settings-tabs) .frame {
  background: transparent;
  border-color: transparent;
}
```

The frame's group interpolates the old and new box, so the frame's height morphs while its old and new images carry the outgoing and incoming panel.

Decide deliberately which of the two paints the frame: an image is a flat snapshot that moves with its animation, so a border or background left on the captured element slides away with the outgoing panel and arrives with the incoming one. Chrome that should stay put and resize belongs on the group, and the live element gives up that chrome while the application's transition type is active. Keep the border off an ancestor of the frame as well — an uncaptured ancestor resizes immediately.

The controlled state update runs through `useTransition()` with `viewTransition: "interrupt"`. A newer intent aborts the hook's previous run, skips the active native animation, waits for restoration, and commits the latest rendered state. Native old/new snapshots retain the outgoing panel, so the live tree never needs two active panels. Transition type names, directional measurement, and choreography belong to the application; the tabs module performs no layout measurement.

Keep the list and tabs outside named transition surfaces. Browsers remove captured elements and their descendants from pointer hit testing while their snapshots animate, so naming an ancestor that contains the tab controls prevents click interruption. Interruptible Fig DOM commits cancel the implicit document-root snapshot, leaving controls outside the panel frame live even when panels have different heights.

Naming individual panels also works, but a boundary that only contains other boundaries has no change of its own to animate: a `ViewTransition` wrapped around a frame whose panels are each named is not captured, and the frame height snaps.

`useTabsIndicator()` from `~/ui/tabs/indicator.ts` returns `list()` and `indicator()` descriptors. The former composes with the core `tabs.list()` descriptor; the latter observes the list and tabs only while its host is mounted. It accounts for transforms and scrolling and writes active-tab top, right, bottom, left, width, and height CSS variables. Its host stays `hidden` until a measurement resolves a box, and Fig binds DOM behavior before paint during hydration, so a server-rendered indicator appears in place on the first painted frame after hydration rather than in the wrong place before it. Selection itself is server-rendered through `aria-selected` and `data-active`, so a design that must show the selected tab without client JavaScript should not depend on the indicator alone.

## Radio Group

The behavior follows the [WAI-ARIA Radio Group Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/radio/), which native radios already implement. `useRadioGroup(options)` and the `RadioGroup` child callback provide `value` and `name` plus `root()` and `radio(value, { disabled? })`.

```tsx
const group = useRadioGroup({ defaultValue: "medium", name: "size" });

<div aria-label="Size" mix={group.root()}>
  <label>
    <input mix={group.radio("small")} /> Small
  </label>
  <label>
    <input mix={group.radio("medium")} /> Medium
  </label>
</div>;
```

`radio()` applies to a real `<input type="radio">`. Radios sharing a name are already a group to the browser, so the platform owns the single tab stop, arrow movement on either axis, wrapping, skipping disabled radios, Space, form submission, and validity. The widget adds no keyboard handling at all: it names the group, drives `checked` from its value, and reports what the platform decided through the `change` event. `appearance: none` styles a native radio as freely as any element, and wrapping each input in its own `<label>` gives it a name and a click target.

The generated `name` is exposed on the parts object, `required` marks the group for validation, and a caller's own `name` or `value` prop wins over the generated one, so the submitted value can differ from the identity the widget tracks. Disabled radios take the native `disabled` attribute rather than `aria-disabled`, which is what removes them from both arrow movement and submission.

State still follows the element. The browser moves the checked radio before the widget hears about it, so a controlled owner that keeps its value — or a handler calling `details.cancel()` — reconciles, and the committed props re-assert on the next pass.

`readOnly` prevents pointer and keyboard changes without applying native `disabled`: radios remain focusable, retain their form value, and expose `aria-readonly` on the group plus `data-readonly` styling hooks. A native form reset restores an uncontrolled group to its initial `defaultValue`; a controlled group reasserts `value`. Reset does not invoke `onValueChange` because it restores state rather than requesting a user change.

## Accordion

The behavior follows the [WAI-ARIA Accordion Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/accordion/). `useAccordion(options)` and the `Accordion` child callback provide `values` and `isOpen(value)` plus `root()`, `trigger(value, { disabled? })`, and `panel(value)`.

```tsx
const accordion = useAccordion({ defaultValue: ["shipping"] });

<div mix={accordion.root()}>
  <h3>
    <button mix={accordion.trigger("shipping")}>Shipping</button>
  </h3>
  {accordion.isOpen("shipping") ? (
    <section mix={accordion.panel("shipping")}>...</section>
  ) : null}
</div>;
```

Open panels are a set: `value` and `defaultValue` are arrays in every mode, so a caller reads one shape whether or not `multiple` is on. A single-open root collapses the open panel by default; `collapsible: false` keeps the last one open. Headers wrap in the caller's own heading element, expose `aria-expanded` and `aria-controls`, and each region is labelled by the header that controls it.

Headers stay in the tab order, which is what the pattern calls for, so the accordion uses only the movement half of the composite. Arrow, Home, and End movement is the optional part of the pattern and does not wrap; it lands on disabled headers so a locked section stays discoverable. Enter and Space reach a native button as an ordinary click.

A controlled accordion composes with `useTransition()` the same way as controlled tabs: `onValueChange` starts a transition that updates the application's `value`, and the application chooses any expansion or collapse types its design needs. The panel-frame boundary described above applies unchanged: name the frame that holds the panel, and its group interpolates the height while its images carry the content. The accordion module imports no animation behavior.

## Dialog

The behavior follows the [WAI-ARIA Dialog Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/), and the caller renders a real `<dialog>`. `useDialog(options)` and the `Dialog` child callback provide `open` and `setOpen(open)` plus `trigger()`, `dialog()`, `title()`, `description()`, and `dismiss()`.

```tsx
const dialog = useDialog();

<>
  <button mix={dialog.trigger()}>Delete</button>
  <dialog mix={dialog.dialog()}>
    <h2 mix={dialog.title()}>Delete this file?</h2>
    <p mix={dialog.description()}>This cannot be undone.</p>
    <button mix={dialog.dismiss()}>Cancel</button>
  </dialog>
</>;
```

The platform owns the hard parts. `showModal()` provides the top layer, focus containment, focus restoration to the trigger, the inert background, the `::backdrop` pseudo-element, and Escape, so the widget contributes no focus trap and no `aria-hidden` sweep over sibling DOM. It owns open state, labelling, and dismissal policy: `closeOnEscape` and `closeOnBackdrop` both default to `true`, and a backdrop click is distinguished from a click on the dialog's own padding by testing the point against the element's box.

State follows the element rather than the other way around. Escape arrives as a cancelable `cancel` event, so a handler calling `details.cancel()` keeps the dialog open; a form submitted with `method="dialog"` closes it directly and the root reports that as an ordinary change. When the element moved but state did not — a controlled owner that kept `open`, or a handler that refused — the root reconciles and restores modality on the next pass.

One reset to watch for: the user agent centres a modal dialog with `margin: auto`, so a stylesheet that zeroes every margin — Tailwind's preflight, for one — leaves the dialog in the corner. Restoring `margin: auto` on the element is the fix, and it is worth an assertion, since nothing about the markup looks wrong.

Animate with the platform too, rather than with a view transition: a dialog enters and leaves the top layer, where `@starting-style` and `transition-behavior: allow-discrete` animate both the element and its `::backdrop` with no widget involvement. Scroll locking is CSS as well — `html:has(dialog[open]) { overflow: clip }` — which is why neither is an option on the root. Pair it with `scrollbar-gutter: stable` on the same element: hiding the scrollbar otherwise widens the page behind the dialog, and the whole layout shifts as it opens.

## Popover

`usePopover(options)` and the `Popover` child callback provide `open` and `setOpen(open)` plus `trigger()` and `popover()`. The caller renders its own element for each. The generated anchor name is an implementation detail expressed directly on those hosts, not application state.

```tsx
const popover = usePopover({ id: "filters-popover" });

<>
  <button mix={popover.trigger()}>Filters</button>
  <div mix={popover.popover()}>...</div>
</>;
```

```css
[popover] {
  position-area: block-end span-inline-end;
  margin-block-start: 0.5rem;
}
```

Two platform features do the work. The popover attribute owns the top layer, light dismiss, and Escape, so the widget adds no outside-click listener; CSS anchor positioning owns placement, so the widget measures nothing and installs no scroll or resize listener. It only names the pair: a generated `anchor-name` goes on the trigger and the matching `position-anchor` on the popover, both as inline styles, leaving the caller free to write `position-area` and `position-try-fallbacks` in ordinary CSS.

The trigger also carries `popovertarget` in server HTML, so it opens and closes before hydration. A custom id belongs on the root option rather than the host: one root-owned value drives the popover's `id`, the trigger's `aria-controls`, and `popovertarget`. State follows the element afterwards: `beforetoggle` is cancelable, so a handler refusing a change stops a light dismissal as readily as a click, and `toggle` reports what actually happened.

Two caveats worth stating plainly. Anchor positioning has not shipped everywhere — Firefox is still missing it at the time of writing — so a popover in a browser without it lands wherever the caller's fallback CSS puts it, and a `@supports not (anchor-name: --a)` block should place it somewhere sensible. And where the popover API itself is missing, the widget falls back to toggling `hidden`: the markup still shows and hides, without the top layer or light dismiss.

## Tooltip

`useTooltip(options)` and `Tooltip` coordinate one non-interactive description through `trigger()` and `tooltip()`. Keyboard focus opens immediately, mouse hover uses `delay` (500ms by default), pointer exit uses `closeDelay`, and Escape closes. Touch does not synthesize hover behavior.

```tsx
const tooltip = useTooltip({ id: "save-help" });

<>
  <button mix={tooltip.trigger()}>Save</button>
  <div mix={tooltip.tooltip()}>Save this document</div>
</>;
```

The trigger preserves authored `aria-describedby` references and adds the tooltip id. The popover API owns the top layer and Escape while CSS anchor positioning owns placement; the component measures nothing. Content must remain descriptive and non-interactive. A disclosure containing buttons or links is a popover, not a tooltip. The tooltip is a hook/component rather than a single mixin because delay, dismissal, controlled state, and the relationship between two hosts need one shared lifetime.

## Listbox

The behavior follows the [WAI-ARIA Listbox Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/). `useListbox(options)` and `Listbox` provide `values` plus `root()` and `option(value, { disabled?, textValue? })`.

```tsx
const listbox = useListbox({ defaultValue: ["apple"] });

<div aria-label="Fruit" mix={listbox.root()}>
  <div mix={listbox.option("apple")}>Apple</div>
  <div mix={listbox.option("banana")}>Banana</div>
</div>;
```

Selection is array-shaped in both modes: a single-select listbox accepts zero or one value, while `multiple: true` accepts any number. A defined `value` is controlled and `defaultValue` initializes uncontrolled state. Selecting an option reports the next array through `onValueChange(values, details, signal)`; cancellation leaves uncontrolled state unchanged and asks a controlled root to reconcile to its rendered value.

DOM focus stays on the root and options are active descendants. Arrow keys wrap through enabled options, Home and End reach the edges, and typeahead uses either `textValue` or the host's text content. In single-select mode those movements also select; in multiple mode they only move the highlight, while Enter or Space toggles the highlighted option. Pointer selection follows the same rules. `readOnly` preserves navigation while preventing selection, and `disabled` removes the root from sequential focus.

The application owns option structure, scrolling, grouping, virtualization, and data lifetime. Selection is therefore not pruned merely because an option is currently unmounted; an offscreen virtualized value remains selected until the application changes it. Every active descendant, however, is always a mounted enabled option. Listbox does not submit a form value—an application that needs one can serialize `listbox.values` into its own native input.

## Select

Use a native `<select>` when its rendering is acceptable. `useSelect(options)` and `Select` exist for the custom-popup case and return `trigger()`, `popup()`, `option(value)`, and an optional `hiddenInput()` for form submission.

```tsx
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

The trigger keeps DOM focus and exposes a listbox active descendant. Arrow, Home, and End movement wraps and skips disabled options; Enter and Space accept the highlighted option; typeahead works both open and closed. With no explicit default, an uncontrolled select adopts the first enabled mounted option before paint and repairs a removed selection. `readOnly` permits inspection without selection. The hidden input serializes through `getFormValue` and restores the initial uncontrolled selection on form reset. It intentionally does not emulate native constraint validation; applications needing `required` should use native `<select>`.

## Combobox

`useCombobox(options)` and `Combobox` coordinate an editable native input with a caller-filtered listbox. They own input, open, highlight, and selected-value state; they do not own filtering, remote loading, option markup, or placement.

```tsx
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

Typing reports `onInputValueChange`, clears any selected identity, and opens the popup. Arrow keys highlight enabled options without moving DOM focus; Enter selects one, writes its `textValue` or text content to uncontrolled input state, and closes. Pointer selection prevents the popup from stealing input focus. The optional hidden input submits the selected identity through `getFormValue`; uncommitted text has no submitted selected value. Native form reset restores both initial states. `readOnly` preserves inspection but refuses edits and selection.

## Menu

The behavior follows the [WAI-ARIA Menu Button Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/). `useMenu(options)` and the `Menu` child callback provide `open` and `setOpen(open)` plus `trigger()`, `menu()`, `item()`, `checkboxItem()`, and `radioItem()`. Submenu tree coordination is private to the optional submenu module rather than part of every flat menu's public contract.

```tsx
const menu = useMenu({ onSelect: (value) => run(value) });

<>
  <button mix={menu.trigger()}>Actions</button>
  <div mix={menu.menu()}>
    <button mix={menu.item("rename")}>Rename</button>
    <button mix={menu.item("remove")}>Remove</button>
  </div>
</>;
```

This is the first widget assembled from another. `menu()` and `trigger()` layer menu semantics over the popover's own parts by returning both descriptors, which compose exactly as two authored mixins would, so the popover keeps supplying the top layer, light dismiss, Escape, and anchor positioning while the menu adds roles, keys, and focus.

Focus is what the menu genuinely owns. `showPopover()` deliberately leaves focus where it was, unlike `showModal()`, so the menu moves it to the first item when opened with Enter or ArrowDown, to the last with ArrowUp, and returns it to the trigger when the menu closes with focus still inside. Items are never tab stops: focus moves between them directly, and Tab closes the whole menu tree rather than walking it.

Arrow keys move and wrap, Home and End jump, and anything else is offered to typeahead: successive keystrokes extend the search until a pause resets it, while a repeated single character steps through the items starting with it. Disabled items stay focusable so a locked action is still discoverable, and they refuse activation.

Choosing an item reports through `onSelect` before the menu closes, and a handler calling `details.cancel()` keeps it open — useful for an item that toggles.

Action items close by default and accept `closeOnSelect: false`. Checkbox and radio items expose `menuitemcheckbox` or `menuitemradio` with `aria-checked`, stay open by default, and accept controlled `checked` state. `details.kind` distinguishes the three selectable kinds. Selecting an already checked radio is a no-op.

Nested behavior is optional so a flat menu does not bundle timers or directional logic. `useMenuSubmenu(parent, value, options)` and `MenuSubmenu` live at `~/ui/menu/submenu.ts`; their `trigger()` composes a submenu's popover trigger with an item in its parent menu:

```tsx
import { useMenu } from "~/ui/menu/menu.tsx";
import { useMenuSubmenu } from "~/ui/menu/submenu.ts";

const actions = useMenu();
const share = useMenuSubmenu(actions, "share", { delay: 100 });

<div mix={actions.menu()}>
  <button mix={share.trigger()}>Share</button>
  <div mix={share.menu()}>
    <button mix={share.item("email")}>Email</button>
  </div>
</div>;
```

The inline-end arrow opens and focuses the first child; the inline-start arrow closes and returns focus to the parent item, with both directions reversed in RTL. Mouse entry and exit use the configurable delay and open without stealing focus. An accepted child action closes its submenu and every parent menu, while canceled selections and checked items that opt out of closing leave the tree open. A disabled submenu trigger remains focusable but cannot open.

## Toolbar

The behavior follows the [WAI-ARIA Toolbar Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/). `useToolbar(options)` and `Toolbar` provide `root()` and keyed `item(value, { disabled? })` descriptors without adding a selection model.

```tsx
const toolbar = useToolbar();

<div aria-label="Formatting" mix={toolbar.root()}>
  <button mix={toolbar.item("bold")}>Bold</button>
  <button mix={toolbar.item("italic")}>Italic</button>
</div>;
```

After hydration, exactly one enabled item is in the tab sequence. Server-rendered native controls retain their ordinary focusability until that roving focus behavior hydrates, so a toolbar remains usable without JavaScript. Horizontal toolbars use Left and Right with RTL-aware direction, vertical toolbars use Up and Down, Home and End reach the edges, and `loopFocus` defaults to true. Focus—not selection—is the entire state: clicking or programmatically focusing an item makes it the next tab stop, and removing or disabling it falls back to the first enabled item. Disabled native buttons receive `disabled`; disabled generic hosts expose `aria-disabled` and their clicks are canceled.

Every item remains a caller-owned control. Toolbar does not invent button groups, separators, overflow menus, labels, or command state, and it does not intercept keys from descendants outside a registered item. Controls whose own interaction depends on the toolbar's navigation keys should use a design-specific wrapper or key policy rather than asking the primitive to guess which behavior wins.

## Toast Region

`useToastRegion(options)` and `ToastRegion` coordinate caller-owned notifications through `region()`, `toast(value, { duration? })`, and `dismiss(value)`. The application owns the toast array and removes an item when `onDismiss(value, details, signal)` requests it:

```tsx
const region = useToastRegion({
  onDismiss: (value) =>
    setToasts((items) => items.filter((item) => item.id !== value)),
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

The region is a named `region` landmark and persistent live container, defaulting to “Notifications” and polite announcements. Each added toast is atomic; the region announces additions and text changes rather than removals. `priority: "assertive"` belongs to the region, not an individual toast, so applications that genuinely need both urgency levels render two separately labelled regions instead of nesting competing live semantics. Keep the empty region mounted before adding a toast so assistive technology observes the later insertion.

A finite lifetime defaults to 5000ms, while `duration: null` keeps a toast until the application removes it. Timers preserve their remaining duration across root renders and pause while focus or a pointer is inside the region or the document is hidden. `details.reason` distinguishes `"dismiss"` from `"timeout"`, and canceling a request leaves the caller-owned toast mounted.

There is deliberately no provider, global queue, portal, fixed position, swipe gesture, or stacking policy. Those choices depend on application shell and presentation; the primitive owns only announcement semantics, pauseable lifetimes, and dismissal intent. The dismiss descriptor applies to a native button so every notification can remain reachable without gesture-specific behavior.

## Checkbox And Switch

Both apply to a native `<input type="checkbox">`, which owns toggling, focus, Space, form submission, and validity. `useCheckbox(options)` and `useSwitch(options)` provide `checked` and `setChecked(checked)` plus `control()`.

```tsx
const checkbox = useCheckbox({ name: "terms", value: "accepted" });

<label>
  <input mix={checkbox.control()} /> Accept the terms
</label>;
```

A switch is the same control carrying `role="switch"`, so assistive technology announces it as on or off rather than checked, and it has no indeterminate state.

What the widget adds beyond reporting is one thing the platform cannot express in markup: `indeterminate` exists only as a property, so the widget writes it before paint and mirrors it as `data-indeterminate` for styling. The rest is the pattern the other native-hosted widgets use — the browser ticks the box first, so a controlled owner that keeps its value or a handler calling `details.cancel()` reconciles and the committed props re-assert.

`readOnly` prevents user toggles while preserving focus, validation, and form submission; it emits `aria-readonly` and `data-readonly` rather than disabling the input. A form reset returns uncontrolled state to the initial `defaultChecked` and makes controlled state reassert `checked`, without invoking `onCheckedChange`.

## Field

`useField(options)` ties one control to the text around it and provides `label()`, `control()`, `description()`, and `error()`. Its relationships need no behaviorless root part.

```tsx
const field = useField({ invalid: errors.length > 0 });

<div>
  <label mix={field.label()}>Email</label>
  <input mix={field.control()} />
  <p mix={field.description()}>We only use it to sign you in.</p>
  {invalid ? <p mix={field.error()}>Enter an email address.</p> : null}
</div>;
```

The relationships are the whole job, and only the committed DOM knows which parts a caller actually rendered. A description that is not there is not referenced, and mounted errors join `aria-describedby` only while `invalid` is true. Caller-authored references stay first, followed by every description and then every active error in render order. Pass a stable key to `description(key)` or `error(key)` when rendering more than one so each message receives a stable unique id. `aria-invalid`, `required`, and `disabled` reach the control from one place, and `control()` applies to whatever the caller uses as the control, including another widget's part.

## Development Diagnostics

Accessibility depends on a few host facts that a mixin type cannot express. Development builds therefore reject these mistakes while resolving or binding parts:

- checkbox, switch, radio, combobox input, and hidden form parts on anything other than `<input>`;
- accordion, dialog, popover, and menu triggers or toast dismiss controls on anything other than `<button>`;
- `dialog()` on anything other than `<dialog>` and `field.label()` on anything other than `<label>`;
- tab lists, radio groups, and listboxes without `aria-label` or a live `aria-labelledby` target;
- dialogs and field controls without their naming part or an explicit ARIA name;
- duplicate singleton parts, message ids, item values, toast values, or panel values within one root; and
- a mounted panel without the matching tab or accordion trigger.

These checks describe the supported interface rather than adding fallback semantics to arbitrary hosts. They use the same compile-time `__FIG_DEV__` gate as Fig and are absent from production artifacts. npm's `fig-development` condition selects the diagnostic build during development.

## Accessibility Verification Matrix

The semantic DOM and interaction tests are necessary but cannot establish what assistive technology announces. Fig UI uses this matrix as a release record; an unchecked manual row must not be described as verified in release notes.

| Environment | Coverage | Current alpha status | Stable release gate |
| --- | --- | --- | --- |
| Chromium, keyboard and pointer | Playwright exercises tabs, accordion, native radios, dialog modality, popover dismissal, menu focus, listbox selection, toolbar focus, toast dismissal, and form controls | Automated in the TanStack Start demo | Required on every change |
| Firefox, keyboard and pointer | The same interaction suite | Not configured | Required in CI |
| WebKit, keyboard and pointer | The same interaction suite | Not configured | Required in CI |
| Chrome or Edge + NVDA on Windows | Names, roles, state announcements, browse/focus modes, and focus return | Not yet manually recorded | Required before each stable minor |
| Safari + VoiceOver on macOS | Names, roles, rotor order, keyboard interaction, dialog/popover focus, and dynamic descriptions | Not yet manually recorded | Required before each stable minor |
| Safari + VoiceOver on iOS | Touch exploration, activation, modal containment, and dismissal | Not yet manually recorded | Required before each stable minor |
| Chrome + TalkBack on Android | Touch exploration, activation, modal containment, and dismissal | Not yet manually recorded | Required before each stable minor |

Automated checks assert roles, relationships, state, keyboard movement, native form behavior, and focus. Manual runs record the browser, operating-system and assistive-technology versions plus any exceptions in this section before a stable release.
