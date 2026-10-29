/** @jsxImportSource @bgub/fig-dom */
import type { FigNode, MixinDescriptor } from "@bgub/fig";
import { useMenu } from "@bgub/fig-headless/menu";
import { useTabs } from "@bgub/fig-headless/tabs";

interface FocusFixtureOptions {
  readonly kind: string;
  readonly constraint: string;
  readonly disabled: string;
  readonly selectedDisabled: boolean;
}

function focusItems(
  options: FocusFixtureOptions,
  part: (value: string, options: { disabled: boolean }) => MixinDescriptor,
): FigNode {
  return ["first", "middle", "last"].map((value) => {
    const disabled =
      options.disabled === "all" ||
      (options.disabled === "edges" ? value !== "middle" : value === "middle");
    const node = (
      <button
        key={value}
        data-focus-item={value}
        disabled={disabled && options.constraint === "native"}
        mix={part(value, {
          disabled: disabled && options.constraint === "aria",
        })}
      >
        {value === "middle" ? "Later" : value === "last" ? "Last" : "First"}
      </button>
    );
    return options.constraint === "fieldset" && disabled ? (
      <fieldset key={value} disabled>
        {node}
      </fieldset>
    ) : (
      node
    );
  });
}

function MenuFocus(options: FocusFixtureOptions): FigNode {
  const menu = useMenu();
  return (
    <>
      <button data-focus-trigger="" mix={menu.trigger()}>
        Actions
      </button>
      <div data-focus-menu="" mix={menu.menu()}>
        {focusItems(options, (value, own) => menu.item(value, own))}
      </div>
    </>
  );
}

function TabsFocus(options: FocusFixtureOptions): FigNode {
  const tabs = useTabs({
    defaultValue: options.selectedDisabled ? "middle" : "first",
  });
  return (
    <>
      <div aria-label="Views" mix={tabs.list()}>
        {focusItems(options, (value, own) => tabs.tab(value, own))}
      </div>
      <button data-outside="">Outside</button>
    </>
  );
}

export function CompositeFocusFixture(options: FocusFixtureOptions): FigNode {
  return options.kind === "tabs" ? (
    <TabsFocus {...options} />
  ) : (
    <MenuFocus {...options} />
  );
}
