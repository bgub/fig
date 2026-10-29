import {
  type FigNode,
  useState,
  useTransition,
  ViewTransition,
} from "@bgub/fig";
import { on } from "@bgub/fig-dom";
import { enableViewTransitions } from "@bgub/fig-dom/view-transitions";
import { Link } from "@bgub/fig-tanstack-router";
import { useAccordion } from "@bgub/fig-headless/accordion";
import { useCheckbox } from "@bgub/fig-headless/checkbox";
import { useCombobox } from "@bgub/fig-headless/combobox";
import { useDialog } from "@bgub/fig-headless/dialog";
import { useField } from "@bgub/fig-headless/field";
import { useListbox } from "@bgub/fig-headless/listbox";
import { useMenu } from "@bgub/fig-headless/menu";
import { useMenuSubmenu } from "@bgub/fig-headless/menu/submenu";
import { usePopupPosition } from "@bgub/fig-headless/popup/position";
import { usePopover } from "@bgub/fig-headless/popover";
import { useRadioGroup } from "@bgub/fig-headless/radio-group";
import { useSelect } from "@bgub/fig-headless/select";
import { useSwitch } from "@bgub/fig-headless/switch";
import { useTabs } from "@bgub/fig-headless/tabs";
import { useTabsIndicator } from "@bgub/fig-headless/tabs/indicator";
import { useToastRegion } from "@bgub/fig-headless/toast";
import { useToolbar } from "@bgub/fig-headless/toolbar";
import { useTooltip } from "@bgub/fig-headless/tooltip";
import { createFileRoute } from "@tanstack/solid-router";

enableViewTransitions();

export const Route = createFileRoute("/")({ component: Home });

function Home(): FigNode {
  return (
    <section class="space-y-4">
      <h1 class="text-3xl font-semibold tracking-tight">
        Welcome to Fig TanStack Start
      </h1>
      <p class="text-demo-fg">
        Fig on TanStack orchestration: typed routes, nested layouts, route
        loaders, Payload server trees, and data that streams in over Suspense.
      </p>
      <p>
        <Link class="font-medium text-demo-link" to="/data">
          Explore data resources →
        </Link>
      </p>
      <p>
        <Link
          class="inline-block font-medium text-demo-link"
          to="/view-transitions"
          viewTransition
        >
          <ViewTransition
            default="fig-tanstack-route-title"
            enter="none"
            exit="none"
            name="start-vt-page-title"
            share="fig-tanstack-route-title"
          >
            <span class="inline-block" data-view-transition-surface="home-link">
              View transitions
            </span>
          </ViewTransition>
        </Link>
      </p>
      <section class="space-y-3 pt-4">
        <h2 class="text-2xl font-semibold tracking-tight">Components</h2>
        <p class="text-demo-fg">
          Headless widget state with behavior attached directly to the host
          elements through mixins.
        </p>
        <TabsExample />
        <AccordionExample />
        <RadioGroupExample />
        <DialogExample />
        <PopoverExample />
        <TooltipExample />
        <ListboxExample />
        <SelectExample />
        <ComboboxExample />
        <MenuExample />
        <ToolbarExample />
        <ToastRegionExample />
        <FormExample />
      </section>
    </section>
  );
}

function TabsExample(): FigNode {
  type Value = "composition" | "keyboard";
  const [value, setValue] = useState<Value | null>("composition");
  const [, startTransition] = useTransition();
  const tabs = useTabs({
    onValueChange: (next, details) =>
      startTransition(() => setValue(next), {
        types: tabTransitionTypes(details.trigger),
        viewTransition: "interrupt",
      }),
    value,
  });
  const indicator = useTabsIndicator();

  return (
    <div class="relative" data-tabs-demo-root="">
      <div
        aria-label="Tabs component example"
        class="relative flex gap-1 rounded-t-lg border border-demo-border bg-demo-card p-1"
        mix={[tabs.list({ activateOnFocus: true }), indicator.list()]}
      >
        <button
          class="rounded px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-demo-link"
          data-tabs-demo-tab=""
          mix={tabs.tab("composition")}
        >
          Composition
        </button>
        <button
          class="rounded px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-demo-link"
          data-tabs-demo-tab=""
          mix={tabs.tab("keyboard")}
        >
          Keyboard
        </button>
        <span
          class="absolute bottom-0 h-0.5 bg-demo-selected transition-[left,width] duration-200"
          data-tabs-demo-indicator=""
          mix={indicator.indicator()}
          style={{
            left: "var(--active-tab-left)",
            width: "var(--active-tab-width)",
          }}
        />
      </div>
      {/* One boundary around the panel frame animates the outgoing and
              incoming panel and interpolates the frame's height. The tab list
              stays outside it, so it keeps receiving pointer input while the
              animation runs. */}
      <ViewTransition name="tabs-demo-panel" enter="none" exit="none">
        <div
          class="rounded-b-lg border border-t-0 border-demo-border bg-demo-card"
          data-tabs-demo-frame=""
        >
          {tabs.value === "composition" ? (
            <section
              data-tabs-demo-panel="composition"
              mix={tabs.panel("composition")}
            >
              <div class="space-y-2 p-5">
                <h3 class="font-semibold">Application-owned markup</h3>
                <p class="text-demo-fg">
                  The root owns selection while list, tab, and panel mixins
                  attach semantics to these ordinary elements.
                </p>
              </div>
            </section>
          ) : null}
          {tabs.value === "keyboard" ? (
            <section
              data-tabs-demo-panel="keyboard"
              mix={tabs.panel("keyboard")}
            >
              <div class="space-y-2 p-5">
                <h3 class="font-semibold">Native keyboard behavior</h3>
                <p class="text-demo-fg">
                  Use Left Arrow, Right Arrow, Home, and End to move focus and
                  activate a tab.
                </p>
                <div class="flex flex-wrap gap-2 pt-1" aria-hidden="true">
                  <kbd class="rounded border border-demo-border bg-demo-hover px-2 py-1 text-xs font-medium">
                    ←
                  </kbd>
                  <kbd class="rounded border border-demo-border bg-demo-hover px-2 py-1 text-xs font-medium">
                    →
                  </kbd>
                  <kbd class="rounded border border-demo-border bg-demo-hover px-2 py-1 text-xs font-medium">
                    Home
                  </kbd>
                  <kbd class="rounded border border-demo-border bg-demo-hover px-2 py-1 text-xs font-medium">
                    End
                  </kbd>
                </div>
              </div>
            </section>
          ) : null}
        </div>
      </ViewTransition>
    </div>
  );
}

function tabTransitionTypes(trigger: Element | undefined): string[] {
  if (trigger === undefined) return [];
  const list = trigger.closest('[role="tablist"]');
  if (list === null) return [];
  const previous = list.querySelector('[role="tab"][aria-selected="true"]');
  if (previous === null || previous === trigger) return [];
  const before = previous.getBoundingClientRect();
  const after = trigger.getBoundingClientRect();
  const vertical = list.getAttribute("aria-orientation") === "vertical";
  const direction = vertical
    ? after.top < before.top
      ? "up"
      : "down"
    : after.left < before.left
      ? "left"
      : "right";
  return [`fig-tabs-${direction}`];
}

function AccordionExample(): FigNode {
  const [values, setValues] = useState<readonly string[]>(["shipping"]);
  const [, startTransition] = useTransition();
  const accordion = useAccordion<string>({
    onValueChange: (next, details) => {
      const expanding =
        details.trigger?.getAttribute("aria-expanded") !== "true";
      startTransition(() => setValues(next), {
        types: [expanding ? "fig-accordion-expand" : "fig-accordion-collapse"],
        viewTransition: "interrupt",
      });
    },
    value: values,
  });

  return (
    <div
      class="overflow-hidden rounded-lg border border-demo-border bg-demo-card"
      data-accordion-demo-root=""
      mix={accordion.root()}
    >
      {(
        [
          ["shipping", "How does shipping work?", "Orders ship in two days."],
          [
            "returns",
            "Can I return an order?",
            "Returns stay open for thirty days. Start one from the order page and we email a label. Refunds land about a week after the parcel arrives.",
          ],
        ] as const
      ).map(([value, question, answer]) => (
        <div class="border-b border-demo-border last:border-b-0">
          <h3>
            <button
              class="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-demo-link"
              data-accordion-demo-trigger={value}
              mix={accordion.trigger(value)}
            >
              {question}
              <span aria-hidden="true">
                {accordion.isOpen(value) ? "−" : "+"}
              </span>
            </button>
          </h3>
          <ViewTransition
            name={`accordion-demo-${value}`}
            enter="none"
            exit="none"
          >
            <div data-accordion-demo-frame={value}>
              {accordion.isOpen(value) ? (
                <section
                  class="px-4 pb-4 text-demo-fg"
                  data-accordion-demo-panel={value}
                  mix={accordion.panel(value)}
                >
                  {answer}
                </section>
              ) : null}
            </div>
          </ViewTransition>
        </div>
      ))}
    </div>
  );
}

function RadioGroupExample(): FigNode {
  const group = useRadioGroup<string>({
    defaultValue: "standard",
    name: "shipping-speed",
    orientation: "horizontal",
  });

  return (
    <div
      aria-label="Shipping speed"
      class="flex gap-2"
      data-radio-demo-root=""
      mix={group.root()}
    >
      {(["standard", "express", "overnight"] as const).map((value) => (
        <label
          data-radio-demo-label={value}
          class="cursor-pointer rounded-full border border-demo-border bg-demo-card px-3 py-1.5 text-sm font-medium has-[:checked]:border-demo-link has-[:checked]:bg-demo-selected has-[:checked]:text-demo-selected-fg has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-demo-link"
        >
          <input
            class="sr-only"
            data-radio-demo-option={value}
            mix={group.radio(value)}
            // A caller's own value wins, so what submits can differ from the
            // identity the group tracks.
            value={value === "overnight" ? "1-day" : undefined}
          />
          {value}
        </label>
      ))}
    </div>
  );
}

function DialogExample(): FigNode {
  const dialog = useDialog();

  return (
    <div>
      <button
        class="rounded-md border border-demo-border bg-demo-card px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-demo-link"
        data-dialog-demo-trigger=""
        mix={dialog.trigger()}
      >
        Delete file
      </button>
      <dialog
        class="w-80 max-w-[90vw] rounded-lg border border-demo-border bg-demo-card p-5 text-demo-fg"
        data-dialog-demo=""
        mix={dialog.dialog()}
      >
        <h3
          class="text-base font-semibold"
          data-dialog-demo-title=""
          mix={dialog.title()}
        >
          Delete this file?
        </h3>
        <p class="pt-2 text-sm text-demo-fg" mix={dialog.description()}>
          The platform owns the top layer, focus, and Escape. The widget owns
          open state and labelling.
        </p>
        <div class="flex justify-end gap-2 pt-4">
          <button
            class="rounded-md border border-demo-border px-3 py-1.5 text-sm font-medium"
            data-dialog-demo-dismiss=""
            mix={dialog.dismiss()}
          >
            Cancel
          </button>
          <button
            class="rounded-md bg-demo-selected px-3 py-1.5 text-sm font-medium text-demo-selected-fg"
            data-dialog-demo-confirm=""
            mix={dialog.dismiss()}
          >
            Delete
          </button>
        </div>
      </dialog>
    </div>
  );
}

function PopoverExample(): FigNode {
  const popover = usePopover();
  const position = usePopupPosition({ open: popover.open });

  return (
    <div>
      <button
        class="rounded-md border border-demo-border bg-demo-card px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-demo-link"
        data-popover-demo-trigger=""
        aria-haspopup="dialog"
        mix={[popover.trigger(), position.anchor()]}
      >
        Filters
      </button>
      <div
        class="w-56 rounded-lg border border-demo-border bg-demo-card p-3 text-sm text-demo-fg shadow-lg"
        data-popover-demo=""
        role="dialog"
        aria-label="Filters"
        mix={[popover.popover(), position.popup()]}
      >
        <label class="flex items-center gap-2">
          <input type="checkbox" autofocus data-popover-demo-filter="" />
          Only show available items
        </label>
        <button
          class="mt-3 rounded border border-demo-border px-2 py-1"
          data-popover-demo-apply=""
          mix={on("click", () => popover.setOpen(false))}
        >
          Apply filters
        </button>
      </div>
    </div>
  );
}

function TooltipExample(): FigNode {
  const tooltip = useTooltip({ id: "demo-save-tooltip", closeDelay: 150 });
  const position = usePopupPosition({
    open: tooltip.open,
    side: "top",
    align: "center",
  });

  return (
    <div>
      <button
        class="rounded-md border border-demo-border bg-demo-card px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-demo-link"
        data-tooltip-demo-trigger=""
        mix={[tooltip.trigger(), position.anchor()]}
      >
        Save
      </button>
      <div
        class="rounded bg-slate-950 px-2 py-1 text-xs text-white shadow-lg"
        data-tooltip-demo=""
        mix={[tooltip.tooltip(), position.popup()]}
      >
        Save this document
      </div>
    </div>
  );
}

const demoFruits = ["apple", "banana", "blueberry", "pear"] as const;

function ListboxExample(): FigNode {
  const listbox = useListbox<(typeof demoFruits)[number]>({
    defaultValue: ["apple"],
    multiple: true,
  });

  return (
    <div class="flex items-start gap-3">
      <div
        aria-label="Favorite fruit"
        class="w-48 rounded-lg border border-demo-border bg-demo-card p-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-demo-link"
        data-listbox-demo=""
        mix={listbox.root()}
      >
        {demoFruits.map((fruit) => (
          <div
            class="rounded px-3 py-1.5 text-sm data-[highlighted]:bg-demo-hover data-[selected]:font-semibold data-[selected]:text-demo-link"
            data-listbox-demo-option={fruit}
            mix={listbox.option(fruit)}
          >
            {fruit}
          </div>
        ))}
      </div>
      <span class="pt-2 text-sm text-demo-muted" data-listbox-demo-value="">
        {listbox.values.join(", ") || "none"}
      </span>
    </div>
  );
}

function SelectExample(): FigNode {
  const select = useSelect<(typeof demoFruits)[number]>({
    defaultValue: "apple",
  });
  const position = usePopupPosition({ open: select.open });

  return (
    <div>
      <button
        class="rounded-md border border-demo-border bg-demo-card px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-demo-link"
        data-select-demo-trigger=""
        mix={[select.trigger(), position.anchor()]}
      >
        {select.value}
      </button>
      <div
        class="w-40 rounded-lg border border-demo-border bg-demo-card p-1 shadow-lg"
        data-select-demo=""
        mix={[select.popup(), position.popup()]}
      >
        {demoFruits.map((fruit) => (
          <div
            class="rounded px-3 py-1.5 text-sm data-[highlighted]:bg-demo-hover"
            data-select-demo-option={fruit}
            mix={select.option(fruit)}
          >
            {fruit}
          </div>
        ))}
      </div>
    </div>
  );
}

function ComboboxExample(): FigNode {
  const combobox = useCombobox<(typeof demoFruits)[number]>();
  const position = usePopupPosition({ open: combobox.open });
  const matches = demoFruits.filter((fruit) =>
    fruit.startsWith(combobox.inputValue.toLowerCase()),
  );

  return (
    <div>
      <input
        aria-label="Find a fruit"
        class="rounded-md border border-demo-border bg-demo-card px-3 py-1.5 text-sm placeholder:text-demo-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-demo-link"
        data-combobox-demo-input=""
        mix={[combobox.input(), position.anchor()]}
        placeholder="Find a fruit"
      />
      <div
        class="w-48 rounded-lg border border-demo-border bg-demo-card p-1 shadow-lg"
        data-combobox-demo=""
        mix={[combobox.popup(), position.popup()]}
      >
        {matches.map((fruit) => (
          <div
            class="rounded px-3 py-1.5 text-sm data-[highlighted]:bg-demo-hover"
            data-combobox-demo-option={fruit}
            mix={combobox.option(fruit)}
          >
            {fruit}
          </div>
        ))}
      </div>
    </div>
  );
}

function MenuExample(): FigNode {
  const [chosen, setChosen] = useState("none");
  const [showHidden, setShowHidden] = useState(false);
  const [sort, setSort] = useState<"date" | "name">("name");
  const menu = useMenu<string>({
    onSelect: (value) => {
      if (value === "show-hidden") setShowHidden((shown) => !shown);
      else if (value === "sort-date" || value === "sort-name") {
        setSort(value === "sort-date" ? "date" : "name");
      } else setChosen(value);
    },
  });
  const share = useMenuSubmenu<string, string>(menu, "share", {
    delay: 50,
    onSelect: (value) => setChosen(value),
  });
  const menuPosition = usePopupPosition({ open: menu.open });
  const sharePosition = usePopupPosition({
    open: share.open,
    side: "inline-end",
  });
  const itemClass =
    "block w-full rounded px-3 py-1.5 text-left text-sm hover:bg-demo-hover focus:outline-2 focus:-outline-offset-2 focus:outline-demo-link";

  return (
    <div class="flex items-center gap-3">
      <button
        class="rounded-md border border-demo-border bg-demo-card px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-demo-link"
        data-menu-demo-trigger=""
        mix={[menu.trigger(), menuPosition.anchor()]}
      >
        Actions
      </button>
      <div
        class="w-44 rounded-lg border border-demo-border bg-demo-card p-1 shadow-lg"
        data-menu-demo=""
        mix={[menu.menu(), menuPosition.popup()]}
      >
        {(["rename", "duplicate"] as const).map((value) => (
          <button
            class={itemClass}
            data-menu-demo-item={value}
            mix={menu.item(value)}
          >
            {value}
          </button>
        ))}
        <button
          class={itemClass}
          data-menu-demo-checkbox=""
          mix={menu.checkboxItem("show-hidden", { checked: showHidden })}
        >
          Show hidden
        </button>
        <button
          class={itemClass}
          data-menu-demo-radio="name"
          mix={menu.radioItem("sort-name", { checked: sort === "name" })}
        >
          Sort by name
        </button>
        <button
          class={itemClass}
          data-menu-demo-radio="date"
          mix={menu.radioItem("sort-date", { checked: sort === "date" })}
        >
          Sort by date
        </button>
        <button
          class={itemClass}
          data-menu-demo-submenu-trigger=""
          mix={[share.trigger(), sharePosition.anchor()]}
        >
          Share…
        </button>
        <div
          class="w-36 rounded-lg border border-demo-border bg-demo-card p-1 shadow-lg"
          data-menu-demo-submenu=""
          mix={[share.menu(), sharePosition.popup()]}
        >
          <button
            class={itemClass}
            data-menu-demo-submenu-item="email"
            mix={share.item("email")}
          >
            Email
          </button>
          <button
            class={itemClass}
            data-menu-demo-submenu-item="link"
            mix={share.item("link")}
          >
            Copy link
          </button>
        </div>
        <button
          class={itemClass}
          data-menu-demo-item="remove"
          mix={menu.item("remove", { disabled: true })}
        >
          remove
        </button>
      </div>
      <span class="text-sm text-demo-muted" data-menu-demo-chosen="">
        {chosen}
      </span>
    </div>
  );
}

function ToolbarExample(): FigNode {
  const [lastCommand, setLastCommand] = useState("none");
  const toolbar = useToolbar<string>();
  const buttonClass =
    "rounded px-3 py-1.5 text-sm font-medium enabled:hover:bg-demo-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-demo-link";

  return (
    <div class="flex items-center gap-3">
      <div
        aria-label="Formatting"
        class="flex gap-1 rounded-lg border border-demo-border bg-demo-card p-1"
        data-toolbar-demo=""
        mix={toolbar.root()}
      >
        <button
          class={buttonClass}
          data-toolbar-demo-item="bold"
          mix={[
            toolbar.item("bold"),
            on("click", () => setLastCommand("bold")),
          ]}
        >
          Bold
        </button>
        <button
          class={buttonClass}
          data-toolbar-demo-item="italic"
          mix={toolbar.item("italic", { disabled: true })}
        >
          Italic
        </button>
        <button
          class={buttonClass}
          data-toolbar-demo-item="link"
          mix={[
            toolbar.item("link"),
            on("click", () => setLastCommand("link")),
          ]}
        >
          Link
        </button>
      </div>
      <span class="text-sm text-demo-muted" data-toolbar-demo-value="">
        {lastCommand}
      </span>
    </div>
  );
}

interface DemoToast {
  readonly id: number;
  readonly message: string;
}

function ToastRegionExample(): FigNode {
  const [nextId, setNextId] = useState(2);
  const [toasts, setToasts] = useState<readonly DemoToast[]>([
    { id: 1, message: "Draft saved" },
  ]);
  const region = useToastRegion<number>({
    onDismiss: (id) =>
      setToasts((items) => items.filter((toast) => toast.id !== id)),
  });

  return (
    <div class="space-y-2">
      <button
        class="rounded-md border border-demo-border bg-demo-card px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-demo-link"
        data-toast-demo-add=""
        mix={on("click", () => {
          setToasts((items) => [
            ...items,
            { id: nextId, message: `Notification ${nextId}` },
          ]);
          setNextId((id) => id + 1);
        })}
        type="button"
      >
        Add notification
      </button>
      <div class="space-y-2" data-toast-demo-region="" mix={region.region()}>
        {toasts.map((toast) => (
          <div
            class="flex items-center justify-between gap-4 rounded-lg border border-demo-border bg-demo-card px-3 py-2 text-sm shadow-sm"
            data-toast-demo={toast.id}
            mix={region.toast(toast.id, { duration: null })}
          >
            {toast.message}
            <button
              class="font-medium text-demo-link"
              data-toast-demo-dismiss={toast.id}
              mix={region.dismiss(toast.id)}
            >
              Dismiss
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function FormExample(): FigNode {
  const [submitted, setSubmitted] = useState("nothing yet");
  const email = useField({ required: true });
  const terms = useCheckbox({ name: "terms", value: "accepted" });
  const notifications = useSwitch({
    defaultChecked: true,
    name: "notifications",
    value: "on",
  });
  const plan = useCheckbox({
    defaultChecked: true,
    name: "plan",
    readOnly: true,
    value: "pro",
  });

  return (
    <form
      class="space-y-3 rounded-lg border border-demo-border bg-demo-card p-4"
      data-form-demo=""
      mix={on("submit", (event) => {
        event.preventDefault();
        const form = event.currentTarget as HTMLFormElement;
        const entries = [...new FormData(form).entries()];
        setSubmitted(
          entries
            .map(
              ([key, value]) =>
                `${key}=${typeof value === "string" ? value : value.name}`,
            )
            .join(" "),
        );
      })}
    >
      <div class="space-y-1">
        <label
          class="block text-sm font-medium"
          data-form-demo-label=""
          mix={email.label()}
        >
          Email
        </label>
        <input
          class="w-full rounded-md border border-demo-border px-2 py-1.5 text-sm"
          data-form-demo-email=""
          name="email"
          type="email"
          mix={email.control()}
        />
        <p
          class="text-xs text-demo-muted"
          data-form-demo-hint=""
          mix={email.description()}
        >
          Native validity and submission, wired by the field.
        </p>
      </div>
      <label class="flex items-center gap-2 text-sm">
        <input data-form-demo-terms="" mix={terms.control()} />
        Accept the terms
      </label>
      <label class="flex items-center gap-2 text-sm">
        <input data-form-demo-notifications="" mix={notifications.control()} />
        Email notifications
      </label>
      <label class="flex items-center gap-2 text-sm">
        <input data-form-demo-plan="" mix={plan.control()} />
        Pro plan (read only)
      </label>
      <button
        class="rounded-md border border-demo-border px-3 py-1.5 text-sm font-medium"
        data-form-demo-reset=""
        type="reset"
      >
        Reset
      </button>
      <button
        class="rounded-md bg-demo-selected px-3 py-1.5 text-sm font-medium text-demo-selected-fg"
        data-form-demo-submit=""
        type="submit"
      >
        Submit
      </button>
      <p class="text-xs text-demo-muted" data-form-demo-result="">
        {submitted}
      </p>
    </form>
  );
}
