import { createComposite, sameValue } from "./composite.ts";

export interface ListboxOptionConfig {
  readonly disabled: boolean;
  readonly textValue: string | undefined;
  readonly value: unknown;
}

export interface ListboxOption extends ListboxOptionConfig {
  readonly node: HTMLElement;
}

/** Ordered option registration and active-descendant movement. */
export function createListbox(name: string, registrationChanged: () => void) {
  const composite = createComposite({
    container: '[role="listbox"]',
    item: '[role="option"]',
    name,
    registrationChanged,
  });
  const registrations = new Map<HTMLElement, ListboxOption>();
  let search = "";
  let searchTimer: ReturnType<typeof setTimeout> | undefined;

  function bindContainer(node: HTMLElement, signal: AbortSignal): void {
    composite.bindContainer(node, signal);
    signal.addEventListener(
      "abort",
      () => {
        if (searchTimer !== undefined) clearTimeout(searchTimer);
        searchTimer = undefined;
        search = "";
      },
      { once: true },
    );
  }

  function bindOption(
    node: HTMLElement,
    signal: AbortSignal,
    config: ListboxOptionConfig,
  ): void {
    const option = { ...config, node };
    registrations.set(node, option);
    composite.bindItem(node, signal, config.value, config.disabled);
    signal.addEventListener(
      "abort",
      () => {
        if (registrations.get(node) === option) registrations.delete(node);
      },
      { once: true },
    );
  }

  function options(): readonly ListboxOption[] {
    return composite
      .items()
      .flatMap((item) => registrations.get(item.node) ?? []);
  }

  function option(value: unknown): ListboxOption | undefined {
    return options().find((entry) => sameValue(entry.value, value));
  }

  function optionAt(target: EventTarget | null): ListboxOption | undefined {
    const item = composite.itemAt(target);
    return item === undefined ? undefined : registrations.get(item.node);
  }

  function move(current: unknown, key: string): ListboxOption | undefined {
    const enabled = options().filter((entry) => !entry.disabled);
    if (enabled.length === 0) return undefined;
    if (key === "Home") return enabled[0];
    if (key === "End") return enabled.at(-1);
    if (key !== "ArrowDown" && key !== "ArrowUp") return undefined;
    const currentIndex = enabled.findIndex((entry) =>
      sameValue(entry.value, current),
    );
    if (currentIndex === -1) {
      return key === "ArrowDown" ? enabled[0] : enabled.at(-1);
    }
    const delta = key === "ArrowDown" ? 1 : -1;
    return enabled[(currentIndex + delta + enabled.length) % enabled.length];
  }

  function typeahead(current: unknown, key: string): ListboxOption | undefined {
    if (key.length !== 1 || key === " ") return undefined;
    if (searchTimer !== undefined) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      search = "";
    }, 500);
    const normalized = key.toLocaleLowerCase();
    const repeated = search.length === 1 && search === normalized;
    search = repeated ? search : search + normalized;
    const enabled = options().filter((entry) => !entry.disabled);
    const currentIndex = enabled.findIndex((entry) =>
      sameValue(entry.value, current),
    );
    const start = currentIndex === -1 ? 0 : currentIndex + (repeated ? 1 : 0);
    for (let offset = 0; offset < enabled.length; offset += 1) {
      const candidate = enabled[(start + offset) % enabled.length];
      const text =
        candidate?.textValue ?? candidate?.node.textContent?.trim() ?? "";
      if (
        candidate !== undefined &&
        text.toLocaleLowerCase().startsWith(search)
      ) {
        return candidate;
      }
    }
    return undefined;
  }

  return {
    ...composite,
    bindContainer,
    bindOption,
    move,
    option,
    optionAt,
    options,
    typeahead,
  };
}
