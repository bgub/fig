// @vitest-environment happy-dom
import {
  Activity,
  type FigNode,
  useState,
  useTransition,
  ViewTransition,
} from "@bgub/fig";
import { createRoot, on, type FigRoot } from "@bgub/fig-dom";
import { act } from "@bgub/fig-dom/test-utils";
import { enableViewTransitions } from "@bgub/fig-dom/view-transitions";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTabsRegistry } from "./registry.ts";
import { useTabsIndicator } from "./indicator.ts";
import {
  Tabs,
  type TabsOrientation,
  type TabsParts,
  type TabsValueChangeDetails,
  type TabsValueChangeHandler,
  useTabs,
} from "./tabs.tsx";

const roots: FigRoot[] = [];

enableViewTransitions();

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) await act(() => root.unmount());
  }
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Tabs", () => {
  it("connects tabs and panels and reports cancellable change details", async () => {
    const changes: Array<{
      details: TabsValueChangeDetails;
      signal: AbortSignal;
      value: string | null;
    }> = [];
    const container = await renderTabs({
      activateOnFocus: true,
      onValueChange: (value, details, signal) => {
        changes.push({ details, signal, value });
      },
    });

    const root = requiredElement(container, "[data-tabs-root]");
    const list = requiredElement(container, '[role="tablist"]');
    const tabs = tabElements(container);
    const panels = panelElements(container);
    tabs.forEach((tab, index) => mockRect(tab, index * 100, 0, 100, 40));

    expect(root.hasAttribute("data-orientation")).toBe(false);
    expect(list.getAttribute("data-orientation")).toBe("horizontal");
    expect(list.getAttribute("aria-orientation")).toBe("horizontal");
    expect(tabs[0].type).toBe("button");
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(tabs[0].hasAttribute("data-active")).toBe(true);
    expect(tabs[0].tabIndex).toBe(0);
    expect(tabs[1].getAttribute("aria-selected")).toBe("false");
    expect(tabs[1].tabIndex).toBe(-1);
    expect(tabs[0].getAttribute("aria-controls")).toBe(panels[0].id);
    expect(panels[0].getAttribute("aria-labelledby")).toBe(tabs[0].id);
    expect(panels[0].hidden).toBe(false);
    expect(panels[0].tabIndex).toBe(0);
    expect(panels[1].hidden).toBe(true);
    expect(panels[1].tabIndex).toBe(-1);
    expect(panels[1].hasAttribute("inert")).toBe(true);

    await click(tabs[1]);

    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(panels[1].hidden).toBe(false);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.value).toBe("security");
    expect(changes[0]?.details.event?.type).toBe("click");
    expect(changes[0]?.details.trigger).toBe(tabs[1]);
    expect(changes[0]?.signal.aborted).toBe(false);

    await click(tabs[2]);
    expect(changes).toHaveLength(2);
    expect(changes[0]?.signal.aborted).toBe(true);
    expect(changes[1]?.signal.aborted).toBe(false);

    await click(tabs[0]);
    expect(changes[2]?.details.trigger).toBe(tabs[0]);
  });

  it("keeps focus and selection separate in manual mode", async () => {
    const container = await renderTabs({ activateOnFocus: false });
    const [account, security] = tabElements(container);
    const panels = panelElements(container);

    account.focus();
    await keydown(account, "ArrowRight");

    expect(document.activeElement).toBe(security);
    expect(account.getAttribute("aria-selected")).toBe("true");
    expect(account.tabIndex).toBe(-1);
    expect(security.getAttribute("aria-selected")).toBe("false");
    expect(security.tabIndex).toBe(0);
    expect(panels[0].hidden).toBe(false);

    await keydown(security, " ");

    expect(security.getAttribute("aria-selected")).toBe("true");
    expect(panels[1].hidden).toBe(false);
  });

  it("restores the selected tab as the roving stop when focus leaves", async () => {
    const container = await renderTabs({ activateOnFocus: false });
    const [account, security] = tabElements(container);
    const [accountPanel] = panelElements(container);

    account.focus();
    await keydown(account, "ArrowRight");
    expect(security.tabIndex).toBe(0);
    expect(security.getAttribute("aria-selected")).toBe("false");

    await act(() => accountPanel.focus());

    expect(account.tabIndex).toBe(0);
    expect(security.tabIndex).toBe(-1);
  });

  it("allows a list to opt into automatic activation", async () => {
    const container = await renderTabs({
      activateOnFocus: true,
    });
    const [account, security] = tabElements(container);

    account.focus();
    await keydown(account, "ArrowRight");

    expect(document.activeElement).toBe(security);
    expect(security.getAttribute("aria-selected")).toBe("true");
  });

  it("keeps disabled tabs focusable without activating them", async () => {
    const changes: Array<string | null> = [];
    const container = await renderTabs({
      activateOnFocus: true,
      disabledValue: "security",
      onValueChange: (value) => changes.push(value),
    });
    const [account, security, billing] = tabElements(container);

    account.focus();
    await keydown(account, "ArrowRight");

    expect(document.activeElement).toBe(security);
    expect(security.getAttribute("aria-disabled")).toBe("true");
    expect(security.hasAttribute("disabled")).toBe(false);
    expect(security.getAttribute("aria-selected")).toBe("false");
    expect(account.getAttribute("aria-selected")).toBe("true");

    const disabledClick = await click(security);
    expect(disabledClick.defaultPrevented).toBe(true);
    expect(changes).toEqual([]);

    await keydown(security, "ArrowRight");
    expect(document.activeElement).toBe(billing);
    expect(billing.getAttribute("aria-selected")).toBe("true");
  });

  it("does not automatically activate focus caused by a secondary pointer", async () => {
    const container = await renderTabs({ activateOnFocus: true });
    const [account, security] = tabElements(container);

    account.focus();
    await act(() => {
      security.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 2 }),
      );
      security.focus();
    });

    expect(document.activeElement).toBe(security);
    expect(account.getAttribute("aria-selected")).toBe("true");
    expect(security.getAttribute("aria-selected")).toBe("false");
  });

  it("lets click own primary-pointer activation", async () => {
    const eventTypes: string[] = [];
    const container = await renderTabs({
      activateOnFocus: true,
      onValueChange: (_value, details) => {
        eventTypes.push(details.event?.type ?? "");
      },
    });
    const [account, security] = tabElements(container);

    await act(() => {
      security.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
      );
      security.focus();
      security.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, button: 0 }),
      );
    });

    expect(account.getAttribute("aria-selected")).toBe("true");
    expect(security.getAttribute("aria-selected")).toBe("false");

    await click(security);

    expect(security.getAttribute("aria-selected")).toBe("true");
    expect(eventTypes).toEqual(["click"]);
  });

  it("supports orientation, Home, End, modifiers, and optional looping", async () => {
    const container = await renderTabs({
      activateOnFocus: false,
      loopFocus: false,
      orientation: "vertical",
    });
    const [account, security, billing] = tabElements(container);

    account.focus();
    await keydown(account, "ArrowUp");
    expect(document.activeElement).toBe(account);

    await keydown(account, "ArrowDown", { ctrlKey: true });
    expect(document.activeElement).toBe(account);

    await keydown(account, "ArrowDown");
    expect(document.activeElement).toBe(security);
    await keydown(security, "End");
    expect(document.activeElement).toBe(billing);
    await keydown(billing, "Home");
    expect(document.activeElement).toBe(account);

    await keydown(account, "ArrowRight");
    expect(document.activeElement).toBe(account);
  });

  it("follows right-to-left direction for horizontal navigation", async () => {
    const container = await renderTabs({
      activateOnFocus: false,
      direction: "rtl",
    });
    const [account, , billing] = tabElements(container);

    account.focus();
    await keydown(account, "ArrowRight");
    expect(document.activeElement).toBe(billing);

    await keydown(billing, "ArrowLeft");
    expect(document.activeElement).toBe(account);
  });

  it("lets controlled consumers cancel user changes", async () => {
    const changes: TabsValueChangeDetails[] = [];
    const container = await renderTabs({
      onValueChange: (_value, details) => {
        changes.push(details);
        details.cancel();
      },
      value: "account",
    });
    const [account, security] = tabElements(container);

    await click(security);

    expect(changes).toHaveLength(1);
    expect(changes[0]?.isCanceled).toBe(true);
    expect(account.getAttribute("aria-selected")).toBe("true");
    expect(security.getAttribute("aria-selected")).toBe("false");
  });

  it("preserves native activation propagation", async () => {
    let parentClicks = 0;

    function PropagationTabs(): FigNode {
      return (
        <Tabs defaultValue="account">
          {(tabs) => (
            <div mix={on("click", () => (parentClicks += 1))}>
              <div aria-label="Propagation" mix={tabs.list()}>
                <button mix={tabs.tab("account")}>Account</button>
                <button mix={tabs.tab("security")}>Security</button>
              </div>
              <section mix={tabs.panel("account")}>Account panel</section>
              <section mix={tabs.panel("security")}>Security panel</section>
            </div>
          )}
        </Tabs>
      );
    }

    const container = await render(<PropagationTabs />);
    const [account, security] = tabElements(container);

    await click(security);
    expect(parentClicks).toBe(1);
    await click(account);
    expect(parentClicks).toBe(2);
  });

  it("lets a controlled consumer retry an unaccepted change", async () => {
    const changes: Array<string | null> = [];
    const container = await renderTabs({
      onValueChange: (value) => changes.push(value),
      value: "account",
    });
    const [, security] = tabElements(container);

    await click(security);
    await click(security);

    expect(changes).toEqual(["security", "security"]);
    expect(security.getAttribute("aria-selected")).toBe("false");
  });

  it("moves the roving tab stop on controlled updates only when focus is outside", async () => {
    const rendered = await renderTabsWithUpdates({ value: "account" });
    let [account, security, billing] = tabElements(rendered.container);

    await rendered.update({ value: "billing" });
    [account, security, billing] = tabElements(rendered.container);
    expect(account.tabIndex).toBe(-1);
    expect(billing.tabIndex).toBe(0);

    billing.focus();
    await keydown(billing, "ArrowLeft");
    expect(document.activeElement).toBe(security);
    await rendered.update({ value: "account" });
    [account, security, billing] = tabElements(rendered.container);
    expect(security.tabIndex).toBe(0);
    expect(account.getAttribute("aria-selected")).toBe("true");
  });

  it("selects the first enabled tab when it is told nothing", async () => {
    const changes: Array<{
      automatic: boolean;
      value: string | null;
    }> = [];
    const signals: AbortSignal[] = [];
    const container = await renderImplicitTabs({
      disabled: ["account"],
      onValueChange: (value, details, signal) => {
        details.cancel();
        changes.push({ automatic: details.event === null, value });
        signals.push(signal);
      },
    });
    const [account, security] = tabElements(container);

    expect(account.getAttribute("aria-selected")).toBe("false");
    expect(security.getAttribute("aria-selected")).toBe("true");
    // A null event is what marks a change the widget made for itself.
    expect(changes).toEqual([{ automatic: true, value: "security" }]);

    await click(tabElements(container)[2]);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });

  it("falls back when an uncontrolled selection becomes disabled or missing", async () => {
    const changes: Array<{
      automatic: boolean;
      value: string | null;
    }> = [];
    const rendered = await renderDynamicTabs({
      disabled: [],
      onValueChange: (value, details) => {
        changes.push({ automatic: details.event === null, value });
      },
      values: ["account", "security", "billing"],
    });

    await rendered.update({
      disabled: ["account"],
      values: ["account", "security", "billing"],
    });
    expect(
      tabElements(rendered.container)[1]?.getAttribute("aria-selected"),
    ).toBe("true");
    expect(changes.at(-1)).toEqual({ automatic: true, value: "security" });
    await rendered.update({
      disabled: [],
      values: ["account", "billing"],
    });
    expect(
      tabElements(rendered.container)[0]?.getAttribute("aria-selected"),
    ).toBe("true");
    expect(changes.at(-1)).toEqual({ automatic: true, value: "account" });
  });

  it("owns state from the caller's own component without a wrapper", async () => {
    const changes: Array<string | null> = [];

    function HookTabs(): FigNode {
      const tabs = useTabs<string>({
        defaultValue: "account",
        onValueChange: (value) => changes.push(value),
      });
      return (
        <div data-tabs-root="">
          <div aria-label="Hook tabs" mix={tabs.list()}>
            <button mix={tabs.tab("account")}>Account</button>
            <button mix={tabs.tab("security")}>Security</button>
          </div>
          <section mix={tabs.panel("account")}>Account panel</section>
          <section mix={tabs.panel("security")}>Security panel</section>
        </div>
      );
    }

    const container = await render(<HookTabs />);
    const [account, security] = tabElements(container);
    const panels = panelElements(container);

    expect(account.getAttribute("aria-selected")).toBe("true");
    expect(account.getAttribute("aria-controls")).toBe(panels[0].id);
    expect(panels[0].hidden).toBe(false);
    expect(account.tabIndex).toBe(0);

    account.focus();
    await keydown(account, "ArrowRight");
    await keydown(security, " ");

    expect(security.getAttribute("aria-selected")).toBe("true");
    expect(panels[1].hidden).toBe(false);
    expect(changes).toEqual(["security"]);
  });

  it("hands its parts to descendant components", async () => {
    function HookRoot(): FigNode {
      const tabs = useTabs<string>({ defaultValue: "account" });
      return (
        <div>
          <TabStrip tabs={tabs} />
          <Panels tabs={tabs} />
        </div>
      );
    }

    function TabStrip({ tabs }: { tabs: TabsParts<string> }): FigNode {
      return (
        <div aria-label="Split tabs" mix={tabs.list()}>
          <button mix={tabs.tab("account")}>Account</button>
          <button mix={tabs.tab("security")}>Security</button>
        </div>
      );
    }

    function Panels({ tabs }: { tabs: TabsParts<string> }): FigNode {
      return (
        <>
          <section mix={tabs.panel("account")}>Account panel</section>
          <section mix={tabs.panel("security")}>Security panel</section>
        </>
      );
    }

    const container = await render(<HookRoot />);
    await click(tabElements(container)[1]);

    expect(tabElements(container)[1]?.getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(panelElements(container)[1]?.hidden).toBe(false);
    expect(panelElements(container)[0]?.hidden).toBe(true);
  });

  it("repairs selection when a descendant unmounts the selected tab", async () => {
    const changes: Array<{ automatic: boolean; value: string | null }> = [];
    const container = await render(
      <DescendantTabs
        onValueChange={(value, details) => {
          changes.push({ automatic: details.event === null, value });
        }}
      />,
    );
    expect(tabElements(container)).toHaveLength(2);

    // The tab list belongs to a descendant, so dropping a tab commits without
    // rendering the root.
    await click(requiredElement(container, "[data-drop]"));

    const [security] = tabElements(container);
    expect(tabElements(container)).toHaveLength(1);
    expect(security.getAttribute("aria-selected")).toBe("true");
    // The roving tab stop cannot stay on the tab that left, or the list stops
    // being reachable by keyboard at all.
    expect(security.tabIndex).toBe(0);
    expect(panelElements(container)[0]?.hidden).toBe(false);
    expect(changes.at(-1)).toEqual({ automatic: true, value: "security" });
  });

  it("does not repair selection while its bindings are suspended", async () => {
    const changes: Array<string | null> = [];

    function ActivityTabs({ hidden }: { hidden: boolean }): FigNode {
      return (
        <Tabs
          defaultValue="account"
          onValueChange={(value) => changes.push(value)}
        >
          {(tabs) => (
            <Activity mode={hidden ? "hidden" : "visible"}>
              <div aria-label="Activity tabs" mix={tabs.list()}>
                <button mix={tabs.tab("account")}>Account</button>
                <button mix={tabs.tab("security")}>Security</button>
              </div>
              <section mix={tabs.panel("account")}>Account panel</section>
              <section mix={tabs.panel("security")}>Security panel</section>
            </Activity>
          )}
        </Tabs>
      );
    }

    const rendered = await createTestRoot(<ActivityTabs hidden={false} />);
    await rendered.update(<ActivityTabs hidden={true} />);
    await rendered.update(<ActivityTabs hidden={false} />);

    expect(changes).toEqual([]);
    expect(
      tabElements(rendered.container)[0]?.getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("selects no tab when every implicit option is disabled", async () => {
    const changes: Array<string | null> = [];
    const container = await renderImplicitTabs({
      disabled: ["account", "security", "billing"],
      onValueChange: (value) => changes.push(value),
    });

    expect(
      tabElements(container).every(
        (tab) => tab.getAttribute("aria-selected") === "false",
      ),
    ).toBe(true);
    expect(panelElements(container).every((panel) => panel.hidden)).toBe(true);
    // Nothing changed, so nothing is reported; the caller reads tabs.value.
    expect(changes).toEqual([]);
  });

  it("honors an explicit disabled default value", async () => {
    const container = await renderTabs({
      defaultValue: "account",
      disabledValue: "account",
    });
    const [account] = tabElements(container);

    expect(account.getAttribute("aria-selected")).toBe("true");
  });

  it("supports values with reference identity", async () => {
    const account = { name: "account" };
    const security = { name: "security" };
    const changes: unknown[] = [];

    function ObjectTabs(): FigNode {
      return (
        <Tabs
          defaultValue={account}
          onValueChange={(value) => changes.push(value)}
        >
          {(tabs) => (
            <>
              <div aria-label="Object tabs" mix={tabs.list()}>
                <button mix={tabs.tab(account)}>Account</button>
                <button mix={tabs.tab(security)}>Security</button>
              </div>
              <section mix={tabs.panel(account)}>Account panel</section>
              <section mix={tabs.panel(security)}>Security panel</section>
            </>
          )}
        </Tabs>
      );
    }

    const container = await render(<ObjectTabs />);
    await click(tabElements(container)[1]);

    expect(changes).toEqual([security]);
    expect(tabElements(container)[1]?.getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("supports functions as uncontrolled values", async () => {
    const account = () => "account";
    const security = () => "security";
    const changes: unknown[] = [];

    function FunctionTabs(): FigNode {
      return (
        <Tabs
          defaultValue={account}
          onValueChange={(value) => changes.push(value)}
        >
          {(tabs) => (
            <>
              <div aria-label="Function tabs" mix={tabs.list()}>
                <button mix={tabs.tab(account)}>Account</button>
                <button mix={tabs.tab(security)}>Security</button>
              </div>
              <section mix={tabs.panel(account)}>Account panel</section>
              <section mix={tabs.panel(security)}>Security panel</section>
            </>
          )}
        </Tabs>
      );
    }

    const container = await render(<FunctionTabs />);
    await click(tabElements(container)[1]);

    expect(changes).toEqual([security]);
    expect(tabElements(container)[1]?.getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("supports undefined as a tab value", async () => {
    const changes: Array<string | undefined | null> = [];

    function UndefinedTabs(): FigNode {
      return (
        <Tabs<string | undefined>
          onValueChange={(value) => changes.push(value)}
        >
          {(tabs) => (
            <>
              <div aria-label="Undefined tabs" mix={tabs.list()}>
                <button mix={tabs.tab(undefined)}>Unspecified</button>
                <button mix={tabs.tab("security")}>Security</button>
              </div>
              <section mix={tabs.panel(undefined)}>Unspecified panel</section>
              <section mix={tabs.panel("security")}>Security panel</section>
            </>
          )}
        </Tabs>
      );
    }

    const container = await render(<UndefinedTabs />);
    expect(tabElements(container)[0]?.getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(changes).toEqual([undefined]);

    await click(tabElements(container)[1]);
    expect(changes).toEqual([undefined, "security"]);
  });

  it("composes with links and synchronizes explicit ids", async () => {
    function LinkTabs(): FigNode {
      return (
        <Tabs defaultValue="account">
          {(tabs) => (
            <>
              <nav aria-label="Pages" mix={tabs.list()}>
                <a href="/account" id="account-tab" mix={tabs.tab("account")}>
                  Account
                </a>
                <a
                  href="/security"
                  id="security-tab"
                  mix={tabs.tab("security", { disabled: true })}
                >
                  Security
                </a>
              </nav>
              <article id="account-panel" mix={tabs.panel("account")}>
                Account panel
              </article>
              <article id="security-panel" mix={tabs.panel("security")}>
                Security panel
              </article>
            </>
          )}
        </Tabs>
      );
    }

    const container = await render(<LinkTabs />);
    const [account, security] = tabElements(container);
    const panels = panelElements(container);

    expect(account.getAttribute("aria-controls")).toBe("account-panel");
    expect(panels[0]?.getAttribute("aria-labelledby")).toBe("account-tab");
    expect(security.getAttribute("aria-controls")).toBe("security-panel");
    const event = await click(security);
    expect(event.defaultPrevented).toBe(true);
  });

  it("unmounts inactive rendered panels", async () => {
    const container = await renderPresenceTabs();
    expect(panelElements(container).map((panel) => panel.textContent)).toEqual([
      "Account panel",
    ]);

    await click(tabElements(container)[1]);
    expect(panelElements(container).map((panel) => panel.textContent)).toEqual([
      "Security panel",
    ]);
  });

  it("never paints two panels when no panel transition is authored", async () => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    const container = await renderPresenceTabs();

    await click(tabElements(container)[1]);

    expect(
      panelElements(container)
        .filter((panel) => !panel.hidden)
        .map((panel) => panel.textContent),
    ).toEqual(["Security panel"]);
  });

  it("interrupts an active Fig view transition with the latest selection", async () => {
    const container = await render(<TransitionTabs />);
    const ownerDocument = document as unknown as TransitionDocument;
    const previousStart = ownerDocument.startViewTransition;
    const previousPending = ownerDocument.__figViewTransition;
    const types: string[][] = [];
    const updates: string[] = [];
    let skipped = 0;
    let finishFirst = (): void => undefined;
    const firstFinished = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    let started = 0;
    ownerDocument.startViewTransition = (input) => {
      const options = typeof input === "function" ? { update: input } : input;
      types.push(options.types ?? []);
      options.update();
      updates.push(panelElements(container)[0]?.textContent ?? "");
      started += 1;
      return {
        finished: started === 1 ? firstFinished : Promise.resolve(),
        ready: Promise.resolve(),
        skipTransition() {
          skipped += 1;
          finishFirst();
        },
      } as ViewTransition;
    };

    try {
      const [, security, billing] = tabElements(container);
      tabElements(container).forEach((tab, index) =>
        mockRect(tab, index * 100, 0, 100, 40),
      );
      await click(security);
      await click(billing);

      expect(skipped).toBe(1);
      expect(types).toEqual([["tabs-change"], ["tabs-change"]]);
      expect(updates).toEqual(["Security panel", "Billing panel"]);
      expect(billing.getAttribute("aria-selected")).toBe("true");
    } finally {
      finishFirst();
      await Promise.resolve();
      ownerDocument.startViewTransition = previousStart;
      ownerDocument.__figViewTransition = previousPending;
    }
  });

  it("captures the panel frame so its height animates with the content", async () => {
    const container = await render(<TransitionTabs />);
    const ownerDocument = document as unknown as TransitionDocument;
    const previousStart = ownerDocument.startViewTransition;
    const previousPending = ownerDocument.__figViewTransition;
    const captured: string[][] = [];
    ownerDocument.startViewTransition = (input) => {
      const options = typeof input === "function" ? { update: input } : input;
      options.update();
      captured.push(
        [...container.querySelectorAll<HTMLElement>("*")]
          .filter((element) => Boolean(element.style.viewTransitionName))
          .map(
            (element) =>
              `${element.tagName.toLowerCase()}:${element.style.viewTransitionName}`,
          ),
      );
      return {
        finished: Promise.resolve(),
        ready: Promise.resolve(),
        skipTransition() {},
      } as ViewTransition;
    };

    try {
      await click(tabElements(container)[1]);
      expect(captured).toEqual([["div:tabs-panel"]]);
    } finally {
      ownerDocument.startViewTransition = previousStart;
      ownerDocument.__figViewTransition = previousPending;
    }
  });

  it("positions an optional indicator and observes it only while mounted", async () => {
    const observers: FakeResizeObserver[] = [];
    class FakeResizeObserver {
      readonly callback: ResizeObserverCallback;
      readonly observed = new Set<Element>();

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
        observers.push(this);
      }

      disconnect(): void {
        this.observed.clear();
      }

      observe(node: Element): void {
        this.observed.add(node);
      }

      unobserve(node: Element): void {
        this.observed.delete(node);
      }

      trigger(): void {
        this.callback([], this as unknown as ResizeObserver);
      }
    }
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);

    const container = await render(<IndicatorTabs />);
    const list = requiredElement(container, '[role="tablist"]');
    const [account, security] = tabElements(container);
    const indicator = requiredElement(container, "[data-tabs-indicator]");
    mockRect(list, 0, 0, 240, 40);
    mockRect(account, 0, 0, 100, 40);
    mockRect(security, 100, 0, 140, 40);
    Object.defineProperties(list, {
      scrollHeight: { configurable: true, value: 40 },
      scrollWidth: { configurable: true, value: 240 },
    });

    observers.at(-1)?.trigger();
    expect(indicator.hidden).toBe(false);
    expect(indicator.style.getPropertyValue("--active-tab-left")).toBe("0px");
    expect(indicator.style.getPropertyValue("--active-tab-width")).toBe(
      "100px",
    );

    await click(security);
    expect(indicator.style.getPropertyValue("--active-tab-left")).toBe("100px");
    expect(observers.at(-1)?.observed.has(security)).toBe(true);
  });

  it("keeps replacement DOM bindings when superseded signals abort", () => {
    const registry = createTabsRegistry(() => undefined);
    const list = document.createElement("div");
    const tab = document.createElement("button");
    list.setAttribute("role", "tablist");
    tab.setAttribute("role", "tab");
    list.append(tab);

    const firstListBinding = new AbortController();
    const latestListBinding = new AbortController();
    registry.bindContainer(list, firstListBinding.signal);
    registry.bindContainer(list, latestListBinding.signal);
    firstListBinding.abort();

    const firstTabBinding = new AbortController();
    const latestTabBinding = new AbortController();
    registry.bindItem(tab, firstTabBinding.signal, "account", false);
    registry.bindItem(tab, latestTabBinding.signal, "security", false);
    firstTabBinding.abort();

    expect(registry.item("account")).toBeUndefined();
    expect(registry.item("security")?.node).toBe(tab);
    expect(registry.itemAt(tab)?.value).toBe("security");

    latestListBinding.abort();
    expect(registry.items()).toEqual([]);
  });
});

interface ExampleTabsProps {
  activateOnFocus?: boolean;
  defaultValue?: string;
  direction?: "ltr" | "rtl";
  disabledValue?: string;
  loopFocus?: boolean;
  onValueChange?: TabsValueChangeHandler<string>;
  orientation?: TabsOrientation;
  value?: string | null;
}

function ExampleTabs(props: ExampleTabsProps): FigNode {
  const rootProps =
    props.value === undefined
      ? { defaultValue: props.defaultValue ?? "account" }
      : { value: props.value };

  return (
    <Tabs
      {...rootProps}
      onValueChange={props.onValueChange}
      orientation={props.orientation}
    >
      {(tabs) => (
        <main data-tabs-root="">
          <div
            aria-label="Settings"
            dir={props.direction}
            mix={tabs.list({
              activateOnFocus: props.activateOnFocus,
              loopFocus: props.loopFocus,
            })}
          >
            {(["account", "security", "billing"] as const).map((value) => (
              <button
                mix={tabs.tab(value, {
                  disabled: props.disabledValue === value,
                })}
              >
                {capitalize(value)}
              </button>
            ))}
          </div>
          {(["account", "security", "billing"] as const).map((value) => (
            <section mix={tabs.panel(value)}>{capitalize(value)} panel</section>
          ))}
        </main>
      )}
    </Tabs>
  );
}

async function renderTabs(props: ExampleTabsProps): Promise<HTMLElement> {
  return render(<ExampleTabs {...props} />);
}

async function renderTabsWithUpdates(initial: ExampleTabsProps): Promise<{
  container: HTMLElement;
  update(props: ExampleTabsProps): Promise<void>;
}> {
  const rendered = await createTestRoot(<ExampleTabs {...initial} />);
  return {
    container: rendered.container,
    update: (props) => rendered.update(<ExampleTabs {...props} />),
  };
}

interface ImplicitTabsProps {
  disabled: readonly string[];
  onValueChange?: TabsValueChangeHandler<string>;
}

function ImplicitTabs(props: ImplicitTabsProps): FigNode {
  return (
    <Tabs onValueChange={props.onValueChange}>
      {(tabs) => (
        <>
          <div aria-label="Settings" mix={tabs.list()}>
            {(["account", "security", "billing"] as const).map((value) => (
              <button
                mix={tabs.tab(value, {
                  disabled: props.disabled.includes(value),
                })}
              >
                {capitalize(value)}
              </button>
            ))}
          </div>
          {(["account", "security", "billing"] as const).map((value) => (
            <section mix={tabs.panel(value)}>{capitalize(value)} panel</section>
          ))}
        </>
      )}
    </Tabs>
  );
}

async function renderImplicitTabs(
  props: ImplicitTabsProps,
): Promise<HTMLElement> {
  return render(<ImplicitTabs {...props} />);
}

interface DynamicTabsProps {
  disabled: readonly string[];
  onValueChange?: TabsValueChangeHandler<string>;
  values: readonly string[];
}

function DynamicTabs(props: DynamicTabsProps): FigNode {
  return (
    <Tabs defaultValue="account" onValueChange={props.onValueChange}>
      {(tabs) => (
        <>
          <div aria-label="Dynamic tabs" mix={tabs.list()}>
            {props.values.map((value) => (
              <button
                mix={tabs.tab(value, {
                  disabled: props.disabled.includes(value),
                })}
              >
                {capitalize(value)}
              </button>
            ))}
          </div>
          {props.values.map((value) => (
            <section mix={tabs.panel(value)}>{capitalize(value)} panel</section>
          ))}
        </>
      )}
    </Tabs>
  );
}

async function renderDynamicTabs(initial: DynamicTabsProps): Promise<{
  container: HTMLElement;
  update(props: Omit<DynamicTabsProps, "onValueChange">): Promise<void>;
}> {
  const rendered = await createTestRoot(<DynamicTabs {...initial} />);
  return {
    container: rendered.container,
    update: (props) =>
      rendered.update(
        <DynamicTabs {...props} onValueChange={initial.onValueChange} />,
      ),
  };
}

function DescendantTabs(props: {
  onValueChange?: TabsValueChangeHandler<string>;
}): FigNode {
  return (
    <Tabs defaultValue="account" onValueChange={props.onValueChange}>
      {(tabs) => <DescendantTabList tabs={tabs} />}
    </Tabs>
  );
}

function DescendantTabList({ tabs }: { tabs: TabsParts<string> }): FigNode {
  const [values, setValues] = useState<readonly string[]>([
    "account",
    "security",
  ]);
  return (
    <>
      <button data-drop="" mix={on("click", () => setValues(["security"]))}>
        Drop account
      </button>
      <div aria-label="Descendant tabs" mix={tabs.list()}>
        {values.map((value) => (
          <button mix={tabs.tab(value)}>{capitalize(value)}</button>
        ))}
      </div>
      {values.map((value) => (
        <section mix={tabs.panel(value)}>{capitalize(value)} panel</section>
      ))}
    </>
  );
}

function PresenceTabs(): FigNode {
  return (
    <Tabs defaultValue="account">
      {(tabs) => (
        <>
          <div aria-label="Presence tabs" mix={tabs.list()}>
            <button mix={tabs.tab("account")}>Account</button>
            <button mix={tabs.tab("security")}>Security</button>
          </div>
          {tabs.value === "account" ? (
            <section mix={tabs.panel("account")}>Account panel</section>
          ) : null}
          {tabs.value === "security" ? (
            <section mix={tabs.panel("security")}>Security panel</section>
          ) : null}
        </>
      )}
    </Tabs>
  );
}

async function renderPresenceTabs(): Promise<HTMLElement> {
  return render(<PresenceTabs />);
}

function TransitionTabs(): FigNode {
  type Value = "account" | "security" | "billing";
  const [value, setValue] = useState<Value | null>("account");
  const [, startTransition] = useTransition();
  const tabs = useTabs<Value>({
    onValueChange: (next) =>
      startTransition(() => setValue(next), {
        types: ["tabs-change"],
        viewTransition: "interrupt",
      }),
    value,
  });

  return (
    <>
      <div aria-label="Transition tabs" mix={tabs.list()}>
        <button mix={tabs.tab("account")}>Account</button>
        <button mix={tabs.tab("security")}>Security</button>
        <button mix={tabs.tab("billing")}>Billing</button>
      </div>
      <ViewTransition name="tabs-panel">
        <div data-tabs-frame="">
          {(["account", "security", "billing"] as const).map((tabValue) =>
            tabs.value === tabValue ? (
              <section mix={tabs.panel(tabValue)}>
                {capitalize(tabValue)} panel
              </section>
            ) : null,
          )}
        </div>
      </ViewTransition>
    </>
  );
}

function IndicatorTabs(): FigNode {
  return (
    <Tabs defaultValue="account">
      {(tabs) => <IndicatorTabsContent tabs={tabs} />}
    </Tabs>
  );
}

function IndicatorTabsContent(props: { tabs: TabsParts<string> }): FigNode {
  const indicator = useTabsIndicator();
  return (
    <>
      <div
        aria-label="Indicator tabs"
        style={{ height: "40px", width: "240px" }}
        mix={[props.tabs.list(), indicator.list()]}
      >
        <button
          style={{ height: "40px", width: "100px" }}
          mix={props.tabs.tab("account")}
        >
          Account
        </button>
        <button
          style={{ height: "40px", width: "140px" }}
          mix={props.tabs.tab("security")}
        >
          Security
        </button>
        <span data-tabs-indicator="" mix={indicator.indicator()} />
      </div>
      <section mix={props.tabs.panel("account")}>Account panel</section>
      <section mix={props.tabs.panel("security")}>Security panel</section>
    </>
  );
}

async function render(node: FigNode): Promise<HTMLElement> {
  return (await createTestRoot(node)).container;
}

async function createTestRoot(node: FigNode): Promise<{
  container: HTMLElement;
  update(next: FigNode): Promise<void>;
}> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(() => root.render(node));
  return {
    container,
    update: (next) => act(() => root.render(next)),
  };
}

function tabElements(container: Element): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
}

function panelElements(container: Element): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[role="tabpanel"]')];
}

function requiredElement(container: Element, selector: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(selector);
  if (element === null) throw new Error(`Expected ${selector}.`);
  return element;
}

async function click(element: HTMLElement): Promise<MouseEvent> {
  const event = new MouseEvent("click", {
    bubbles: true,
    button: 0,
    cancelable: true,
  });
  await act(() => element.dispatchEvent(event));
  return event;
}

async function keydown(
  element: HTMLElement,
  key: string,
  options: KeyboardEventInit = {},
): Promise<KeyboardEvent> {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key,
    ...options,
  });
  await act(() => element.dispatchEvent(event));
  return event;
}

function capitalize(value: string): string {
  return `${value[0]?.toUpperCase()}${value.slice(1)}`;
}

type TransitionInput = (() => void) | { types?: string[]; update: () => void };

interface TransitionDocument {
  __figViewTransition?: unknown;
  startViewTransition?: (input: TransitionInput) => ViewTransition;
}

function mockRect(
  element: HTMLElement,
  left: number,
  top: number,
  width: number,
  height: number,
): void {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    bottom: top + height,
    height,
    left,
    right: left + width,
    toJSON: () => ({}),
    top,
    width,
    x: left,
    y: top,
  });
}
