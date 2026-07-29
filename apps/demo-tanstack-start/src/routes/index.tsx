import {
  type FigNode,
  useState,
  useTransition,
  ViewTransition,
} from "@bgub/fig";
import { on } from "@bgub/fig-dom";
import { enableViewTransitions } from "@bgub/fig-dom/view-transitions";
import { Link } from "@bgub/fig-tanstack-router";
import { useAccordion } from "@bgub/fig-ui/accordion";
import { useCheckbox } from "@bgub/fig-ui/checkbox";
import { useCombobox } from "@bgub/fig-ui/combobox";
import { useDialog } from "@bgub/fig-ui/dialog";
import { useField } from "@bgub/fig-ui/field";
import { useListbox } from "@bgub/fig-ui/listbox";
import { useMenu } from "@bgub/fig-ui/menu";
import { useMenuSubmenu } from "@bgub/fig-ui/menu/submenu";
import { usePopover } from "@bgub/fig-ui/popover";
import { useRadioGroup } from "@bgub/fig-ui/radio-group";
import { useSelect } from "@bgub/fig-ui/select";
import { useSwitch } from "@bgub/fig-ui/switch";
import { useTabs } from "@bgub/fig-ui/tabs";
import { useTabsIndicator } from "@bgub/fig-ui/tabs/indicator";
import { useToastRegion } from "@bgub/fig-ui/toast";
import { useToolbar } from "@bgub/fig-ui/toolbar";
import { useTooltip } from "@bgub/fig-ui/tooltip";
import { createFileRoute } from "@tanstack/solid-router";

enableViewTransitions();

export const Route = createFileRoute("/")({ component: Home });

function Home(): FigNode {
  return (
    <section class="space-y-4">
      <h1 class="text-3xl font-semibold tracking-tight">
        Welcome to Fig TanStack Start
      </h1>
      <p class="text-slate-700">
        Fig on TanStack orchestration: typed routes, nested layouts, route
        loaders, Payload server trees, and data that streams in over Suspense.
      </p>
      <p>
        <Link class="font-medium text-teal-700" to="/data">
          Explore data resources →
        </Link>
      </p>
      <p>
        <Link
          class="inline-block font-medium text-teal-700"
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
        <p class="text-slate-700">
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
        class="relative flex gap-1 rounded-t-lg border border-slate-300 bg-white p-1"
        mix={[tabs.list({ activateOnFocus: true }), indicator.list()]}
      >
        <button
          class="rounded px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
          data-tabs-demo-tab=""
          mix={tabs.tab("composition")}
        >
          Composition
        </button>
        <button
          class="rounded px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
          data-tabs-demo-tab=""
          mix={tabs.tab("keyboard")}
        >
          Keyboard
        </button>
        <span
          class="absolute bottom-0 h-0.5 bg-teal-700 transition-[left,width] duration-200"
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
      <ViewTransition name="tabs-demo-panel">
        <div
          class="rounded-b-lg border border-t-0 border-slate-300 bg-white"
          data-tabs-demo-frame=""
        >
          {tabs.value === "composition" ? (
            <section
              data-tabs-demo-panel="composition"
              mix={tabs.panel("composition")}
            >
              <div class="space-y-2 p-5">
                <h3 class="font-semibold">Application-owned markup</h3>
                <p class="text-slate-700">
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
                <p class="text-slate-700">
                  Use Left Arrow, Right Arrow, Home, and End to move focus and
                  activate a tab.
                </p>
                <div class="flex flex-wrap gap-2 pt-1" aria-hidden="true">
                  <kbd class="rounded border border-slate-300 bg-slate-100 px-2 py-1 text-xs font-medium">
                    ←
                  </kbd>
                  <kbd class="rounded border border-slate-300 bg-slate-100 px-2 py-1 text-xs font-medium">
                    →
                  </kbd>
                  <kbd class="rounded border border-slate-300 bg-slate-100 px-2 py-1 text-xs font-medium">
                    Home
                  </kbd>
                  <kbd class="rounded border border-slate-300 bg-slate-100 px-2 py-1 text-xs font-medium">
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
      class="overflow-hidden rounded-lg border border-slate-300 bg-white"
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
        <div class="border-b border-slate-300 last:border-b-0">
          <h3>
            <button
              class="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-teal-600"
              data-accordion-demo-trigger={value}
              mix={accordion.trigger(value)}
            >
              {question}
              <span aria-hidden="true">
                {accordion.isOpen(value) ? "−" : "+"}
              </span>
            </button>
          </h3>
          <ViewTransition name={`accordion-demo-${value}`}>
            <div data-accordion-demo-frame={value}>
              {accordion.isOpen(value) ? (
                <section
                  class="px-4 pb-4 text-slate-700"
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
          class="cursor-pointer rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium has-[:checked]:border-teal-700 has-[:checked]:bg-teal-700 has-[:checked]:text-white has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-teal-600"
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
        class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
        data-dialog-demo-trigger=""
        mix={dialog.trigger()}
      >
        Delete file
      </button>
      <dialog
        class="w-80 max-w-[90vw] rounded-lg border border-slate-300 bg-white p-5 text-slate-950"
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
        <p class="pt-2 text-sm text-slate-700" mix={dialog.description()}>
          The platform owns the top layer, focus, and Escape. The widget owns
          open state and labelling.
        </p>
        <div class="flex justify-end gap-2 pt-4">
          <button
            class="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium"
            data-dialog-demo-dismiss=""
            mix={dialog.dismiss()}
          >
            Cancel
          </button>
          <button
            class="rounded-md bg-teal-700 px-3 py-1.5 text-sm font-medium text-white"
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

  return (
    <div>
      <button
        class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
        data-popover-demo-trigger=""
        mix={popover.trigger()}
      >
        Filters
      </button>
      <div
        class="w-56 rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-700 shadow-lg"
        data-popover-demo=""
        mix={popover.popover()}
      >
        Placement is CSS anchor positioning. The widget names the pair and
        measures nothing.
      </div>
    </div>
  );
}

function TooltipExample(): FigNode {
  const tooltip = useTooltip({ id: "demo-save-tooltip" });

  return (
    <div>
      <button
        class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
        data-tooltip-demo-trigger=""
        mix={tooltip.trigger()}
      >
        Save
      </button>
      <div
        class="rounded bg-slate-950 px-2 py-1 text-xs text-white shadow-lg"
        data-tooltip-demo=""
        mix={tooltip.tooltip()}
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
        class="w-48 rounded-lg border border-slate-300 bg-white p-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
        data-listbox-demo=""
        mix={listbox.root()}
      >
        {demoFruits.map((fruit) => (
          <div
            class="rounded px-3 py-1.5 text-sm data-[highlighted]:bg-slate-100 data-[selected]:font-semibold data-[selected]:text-teal-800"
            data-listbox-demo-option={fruit}
            mix={listbox.option(fruit)}
          >
            {fruit}
          </div>
        ))}
      </div>
      <span class="pt-2 text-sm text-slate-500" data-listbox-demo-value="">
        {listbox.values.join(", ") || "none"}
      </span>
    </div>
  );
}

function SelectExample(): FigNode {
  const select = useSelect<(typeof demoFruits)[number]>({
    defaultValue: "apple",
  });

  return (
    <div>
      <button
        class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
        data-select-demo-trigger=""
        mix={select.trigger()}
      >
        {select.value}
      </button>
      <div
        class="w-40 rounded-lg border border-slate-300 bg-white p-1 shadow-lg"
        data-select-demo=""
        mix={select.popup()}
      >
        {demoFruits.map((fruit) => (
          <div
            class="rounded px-3 py-1.5 text-sm data-[highlighted]:bg-slate-100"
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
  const matches = demoFruits.filter((fruit) =>
    fruit.startsWith(combobox.inputValue.toLowerCase()),
  );

  return (
    <div>
      <input
        aria-label="Find a fruit"
        class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
        data-combobox-demo-input=""
        mix={combobox.input()}
        placeholder="Find a fruit"
      />
      <div
        class="w-48 rounded-lg border border-slate-300 bg-white p-1 shadow-lg"
        data-combobox-demo=""
        mix={combobox.popup()}
      >
        {matches.map((fruit) => (
          <div
            class="rounded px-3 py-1.5 text-sm data-[highlighted]:bg-slate-100"
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
  const itemClass =
    "block w-full rounded px-3 py-1.5 text-left text-sm hover:bg-slate-100 focus:bg-slate-100 focus:outline-none";

  return (
    <div class="flex items-center gap-3">
      <button
        class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
        data-menu-demo-trigger=""
        mix={menu.trigger()}
      >
        Actions
      </button>
      <div
        class="w-44 rounded-lg border border-slate-300 bg-white p-1 shadow-lg"
        data-menu-demo=""
        mix={menu.menu()}
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
          mix={share.trigger()}
        >
          Share…
        </button>
        <div
          class="w-36 rounded-lg border border-slate-300 bg-white p-1 shadow-lg"
          data-menu-demo-submenu=""
          mix={share.menu()}
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
      <span class="text-sm text-slate-500" data-menu-demo-chosen="">
        {chosen}
      </span>
    </div>
  );
}

function ToolbarExample(): FigNode {
  const [lastCommand, setLastCommand] = useState("none");
  const toolbar = useToolbar<string>();
  const buttonClass =
    "rounded px-3 py-1.5 text-sm font-medium enabled:hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600";

  return (
    <div class="flex items-center gap-3">
      <div
        aria-label="Formatting"
        class="flex gap-1 rounded-lg border border-slate-300 bg-white p-1"
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
      <span class="text-sm text-slate-500" data-toolbar-demo-value="">
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
        class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
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
            class="flex items-center justify-between gap-4 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm"
            data-toast-demo={toast.id}
            mix={region.toast(toast.id, { duration: null })}
          >
            {toast.message}
            <button
              class="font-medium text-teal-700"
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
      class="space-y-3 rounded-lg border border-slate-300 bg-white p-4"
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
          class="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          data-form-demo-email=""
          name="email"
          type="email"
          mix={email.control()}
        />
        <p
          class="text-xs text-slate-500"
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
        class="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium"
        data-form-demo-reset=""
        type="reset"
      >
        Reset
      </button>
      <button
        class="rounded-md bg-teal-700 px-3 py-1.5 text-sm font-medium text-white"
        data-form-demo-submit=""
        type="submit"
      >
        Submit
      </button>
      <p class="text-xs text-slate-500" data-form-demo-result="">
        {submitted}
      </p>
    </form>
  );
}
