/** @jsxImportSource @bgub/fig-dom */
import { type FigNode, useState } from "@bgub/fig";
import { createRoot, flushSync, on } from "@bgub/fig-dom";
import { useCombobox } from "@bgub/fig-ui/combobox";
import { useMenu } from "@bgub/fig-ui/menu";
import { usePopover } from "@bgub/fig-ui/popover";
import { useTooltip } from "@bgub/fig-ui/tooltip";

function PopupPeers({ controlled }: { controlled: boolean }): FigNode {
  // Peer hooks reconcile in the same commit, in declaration order.
  const first = useMenu();
  const second = useMenu();
  const popover = usePopover({ open: controlled ? true : undefined });
  const combobox = useCombobox();
  const tooltip = useTooltip();
  const [version, setVersion] = useState(0);
  return (
    <>
      <button data-first-trigger="" mix={first.trigger()}>
        First menu
      </button>
      <div data-first-menu="" mix={first.menu()}>
        <button data-first-item="" mix={first.item("first")}>
          First action
        </button>
      </div>
      <button data-second-trigger="" mix={second.trigger()}>
        Second menu
      </button>
      <div data-second-menu="" mix={second.menu()}>
        <button data-second-item="" mix={second.item("second")}>
          Second action
        </button>
      </div>
      <button data-popover-trigger="" mix={popover.trigger()}>
        Popover
      </button>
      <div key={version} data-popover="" mix={popover.popover()}>
        Popover content
      </div>
      <button
        data-replace=""
        mix={on("click", () => setVersion((value) => value + 1))}
      >
        Replace popup
      </button>
      <input
        aria-label="Fruit"
        data-combobox-trigger=""
        mix={combobox.input()}
      />
      <div data-combobox="" mix={combobox.popup()}>
        <div mix={combobox.option("apple")}>Apple</div>
      </div>
      <button mix={tooltip.trigger()}>Tooltip anchor</button>
      <button
        data-tooltip-trigger=""
        mix={on("click", () => tooltip.setOpen(true))}
      >
        Open tooltip
      </button>
      <div data-tooltip="" mix={tooltip.tooltip()}>
        Tooltip content
      </div>
    </>
  );
}

const host = document.getElementById("fixture");
if (host === null) throw new Error("Missing popup fixture host.");
flushSync(() =>
  createRoot(host).render(
    <PopupPeers controlled={host.dataset.controlled === "true"} />,
  ),
);
