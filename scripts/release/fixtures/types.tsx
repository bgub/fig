import { useTabs } from "@bgub/fig-headless/tabs";

export function Example() {
  const tabs = useTabs({ defaultValue: "a" });
  return (
    <>
      <div aria-label="Tabs" mix={tabs.list()}>
        <button mix={tabs.tab("a")}>A</button>
      </div>
      <section mix={tabs.panel("a")}>Panel</section>
    </>
  );
}
