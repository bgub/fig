/** @jsxImportSource @bgub/fig-dom */
import { createRoot, flushSync } from "@bgub/fig-dom";
import { useMenu } from "@bgub/fig-headless/menu";
import { useMenuSubmenu } from "@bgub/fig-headless/menu/submenu";

function SubmenuFixture() {
  const parent = useMenu();
  const child = useMenuSubmenu(parent, "share", {
    onSelect: (value) => {
      if (value === "redirect")
        document.querySelector<HTMLInputElement>("[data-outside]")?.focus();
    },
  });
  return (
    <>
      <button data-root-trigger="" mix={parent.trigger()}>
        Actions
      </button>
      <div data-parent="" mix={parent.menu()}>
        <button data-trigger="" mix={child.trigger()}>
          Share
        </button>
        <button data-sibling="" mix={parent.item("rename")}>
          Rename
        </button>
        <div data-child="" mix={child.menu()}>
          <button data-item="" mix={child.item("email")}>
            Email
          </button>
          <button data-redirect="" mix={child.item("redirect")}>
            Redirect focus
          </button>
        </div>
      </div>
      <input data-outside="" aria-label="Outside" />
    </>
  );
}
const host = document.getElementById("fixture");
if (host === null) throw new Error("Missing fixture host");
flushSync(() => createRoot(host).render(<SubmenuFixture />));
