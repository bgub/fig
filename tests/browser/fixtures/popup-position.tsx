/** @jsxImportSource @bgub/fig-dom */
import { createRoot, flushSync } from "@bgub/fig-dom";
import { usePopover } from "@bgub/fig-headless/popover";
import {
  type PopupPositionOptions,
  usePopupPosition,
} from "@bgub/fig-headless/popup/position";

function PositionFixture({ options }: { options: PopupPositionOptions }) {
  const popover = usePopover({ open: options.open });
  const position = usePopupPosition(options);
  return (
    <div data-container="">
      <button data-anchor="" mix={[popover.trigger(), position.anchor()]}>
        Anchor
      </button>
      <div data-popup="" mix={[popover.popover(), position.popup()]}>
        <div data-content="">Popup content</div>
      </div>
    </div>
  );
}
const host = document.getElementById("fixture");
if (host === null) throw new Error("Missing fixture host");
const root = createRoot(host);
flushSync(() => root.render(<PositionFixture options={{ open: false }} />));
document.addEventListener("position-options", (event) => {
  if (event instanceof CustomEvent) {
    flushSync(() => root.render(<PositionFixture options={event.detail} />));
  }
});
document.addEventListener("position-unmount", () =>
  flushSync(() => root.unmount()),
);
