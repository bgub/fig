// @vitest-environment happy-dom
import type { FigNode } from "@bgub/fig";
import { type FigRoot, hydrateRoot } from "@bgub/fig-dom";
import { act } from "@bgub/fig-dom/test-utils";
import { renderToHtml } from "@bgub/fig-server";
import { afterEach, expect, it, vi } from "vitest";
import { useAccordion } from "../accordion/accordion.tsx";
import { useCheckbox } from "../checkbox/checkbox.tsx";
import { useCombobox } from "../combobox/combobox.tsx";
import { useDialog } from "../dialog/dialog.tsx";
import { useField } from "../field/field.tsx";
import { useListbox } from "../listbox/listbox.tsx";
import { useMenu } from "../menu/menu.tsx";
import { usePopover } from "../popover/popover.tsx";
import { useRadioGroup } from "../radio-group/radio-group.tsx";
import { useSelect } from "../select/select.tsx";
import { useSwitch } from "../switch/switch.tsx";
import { useTabs } from "../tabs/tabs.tsx";
import { useToastRegion } from "../toast/toast.tsx";
import { useToolbar } from "../toolbar/toolbar.tsx";
import { useTooltip } from "../tooltip/tooltip.tsx";

const roots: FigRoot[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(() => root.unmount());
  document.body.replaceChildren();
});
const examples: [string, () => FigNode][] = [
  [
    "accordion",
    () => {
      const w = useAccordion({ defaultValue: ["a"] });
      return (
        <div mix={w.root()}>
          <button mix={w.trigger("a")}>A</button>
          <section mix={w.panel("a")}>Panel</section>
        </div>
      );
    },
  ],
  [
    "checkbox",
    () => {
      const w = useCheckbox({ defaultChecked: true });
      return <input aria-label="Accept" mix={w.control()} />;
    },
  ],
  [
    "switch",
    () => {
      const w = useSwitch({ defaultChecked: true });
      return <input aria-label="Enable" mix={w.control()} />;
    },
  ],
  [
    "combobox",
    () => {
      const w = useCombobox({ defaultInputValue: "Alpha", defaultValue: "a" });
      return (
        <>
          <input aria-label="Search" mix={w.input()} />
          <div mix={w.popup()}>
            <div mix={w.option("a")}>Alpha</div>
          </div>
          <input mix={w.hiddenInput()} />
        </>
      );
    },
  ],
  [
    "inline combobox",
    () => {
      const w = useCombobox({ inline: true });
      return (
        <>
          <input aria-label="Choices" mix={w.input()} />
          <div mix={w.popup()}>
            <button mix={w.option("a")}>Alpha</button>
          </div>
        </>
      );
    },
  ],
  [
    "dialog",
    () => {
      const w = useDialog();
      return (
        <>
          <button mix={w.trigger()}>Open</button>
          <dialog mix={w.dialog()}>
            <h2 mix={w.title()}>Settings</h2>
            <p mix={w.description()}>Preferences</p>
          </dialog>
        </>
      );
    },
  ],
  [
    "lazy dialog",
    () => {
      const w = useDialog();
      return (
        <>
          <button mix={w.trigger()}>Open</button>
          <dialog mix={w.dialog()}>
            {w.open ? <h2 mix={w.title()}>Settings</h2> : null}
          </dialog>
        </>
      );
    },
  ],
  [
    "field",
    () => {
      const w = useField();
      return (
        <>
          <label mix={w.label()}>Name</label>
          <input mix={w.control()} />
          <p mix={w.description()}>Your name</p>
        </>
      );
    },
  ],
  [
    "listbox",
    () => {
      const w = useListbox({ defaultValue: ["a"] });
      return (
        <div aria-label="Choices" mix={w.root()}>
          <div mix={w.option("a")}>Alpha</div>
          <div mix={w.option("b")}>Beta</div>
        </div>
      );
    },
  ],
  [
    "menu",
    () => {
      const w = useMenu();
      return (
        <>
          <button mix={w.trigger()}>Actions</button>
          <div mix={w.menu()}>
            <button mix={w.item("a")}>Action</button>
          </div>
        </>
      );
    },
  ],
  [
    "popover",
    () => {
      const w = usePopover();
      return (
        <>
          <button mix={w.trigger()}>Open</button>
          <div mix={w.popover()}>Contents</div>
        </>
      );
    },
  ],
  [
    "radio group",
    () => {
      const w = useRadioGroup({ defaultValue: "a" });
      return (
        <div aria-label="Choices" mix={w.root()}>
          <input aria-label="Alpha" mix={w.radio("a")} />
          <input aria-label="Beta" mix={w.radio("b")} />
        </div>
      );
    },
  ],
  [
    "select",
    () => {
      const w = useSelect({ defaultValue: "a" });
      return (
        <>
          <button mix={w.trigger()}>Choose</button>
          <div mix={w.popup()}>
            <div mix={w.option("a")}>Alpha</div>
          </div>
          <input mix={w.hiddenInput()} />
        </>
      );
    },
  ],
  [
    "tabs",
    () => {
      const w = useTabs({ defaultValue: "a" });
      return (
        <>
          <div aria-label="Sections" mix={w.list()}>
            <button mix={w.tab("a")}>Alpha</button>
            <button mix={w.tab("b")}>Beta</button>
          </div>
          <section mix={w.panel("a")}>First</section>
          <section mix={w.panel("b")}>Second</section>
        </>
      );
    },
  ],
  [
    "toast",
    () => {
      const w = useToastRegion({ onDismiss: () => {} });
      return (
        <div mix={w.region()}>
          <div mix={w.toast("a", { duration: null })}>
            Saved<button mix={w.dismiss("a")}>Dismiss</button>
          </div>
        </div>
      );
    },
  ],
  [
    "toolbar",
    () => {
      const w = useToolbar();
      return (
        <div aria-label="Tools" mix={w.root()}>
          <button mix={w.item("a")}>Alpha</button>
          <button mix={w.item("b")}>Beta</button>
        </div>
      );
    },
  ],
  [
    "tooltip",
    () => {
      const w = useTooltip();
      return (
        <>
          <button mix={w.trigger()}>Help</button>
          <div mix={w.tooltip()}>Hint</div>
        </>
      );
    },
  ],
];
it.each(examples)(
  "hydrates %s without replacing hosts or breaking ID relationships",
  async (_name, Example) => {
    const container = document.createElement("div");
    container.innerHTML = await renderToHtml(<Example />);
    document.body.append(container);
    const before = [...container.querySelectorAll("*")];
    const ids = before.map((node) => node.id);
    const recover = vi.fn();
    await act(() => {
      roots.push(
        hydrateRoot(container, <Example />, { onRecoverableError: recover }),
      );
    });
    const after = [...container.querySelectorAll("*")];
    expect(after).toEqual(before);
    expect(after.map((node) => node.id)).toEqual(ids);
    expect(recover).not.toHaveBeenCalled();
    for (const node of after) {
      for (const attr of [
        "aria-controls",
        "aria-labelledby",
        "aria-describedby",
        "aria-activedescendant",
      ]) {
        const refs = node.getAttribute(attr)?.trim().split(/\s+/) ?? [];
        for (const id of refs)
          expect(document.getElementById(id), `${attr}=${id}`).not.toBeNull();
      }
    }
  },
);
