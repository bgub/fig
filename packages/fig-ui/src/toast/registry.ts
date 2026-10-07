import { onAbort, sameValue } from "../internal/composite.ts";
import {
  assertAccessibleName,
  assertSinglePart,
  assertUniqueValues,
} from "../internal/diagnostics.ts";
import { createPartCollection } from "../internal/registration.ts";

export interface ToastRegistration {
  readonly duration: number | null;
  readonly node: HTMLElement;
  readonly value: unknown;
}

interface TimerRegistration {
  duration: number | null;
  value: unknown;
  readonly node: HTMLElement;
  readonly signal: AbortSignal;
  remaining: number;
  started: number;
  timer: ReturnType<typeof setTimeout> | undefined;
}

type PauseReason = "document" | "focus" | "pointer";

/** Mounted toast lifetimes and pause state, independent of rendered markup. */
export function createToastRegistry(
  registrationChanged: () => void,
  onTimeout: (registration: ToastRegistration) => void,
) {
  const toasts = new Map<HTMLElement, TimerRegistration>();
  const paused = new Set<PauseReason>();
  let hoveredRegion: HTMLElement | undefined;
  const regions = createPartCollection<Document>(registrationChanged);

  function bindRegion(node: HTMLElement, signal: AbortSignal): void {
    const ownerDocument = node.ownerDocument;
    if (!regions.bind(node, signal, ownerDocument)) return;
    const syncVisibility = () =>
      setPaused(
        "document",
        regions.items().some((entry) => entry.value.hidden),
      );
    ownerDocument.addEventListener("visibilitychange", syncVisibility, {
      signal,
    });
    syncVisibility();
    onAbort(signal, () => {
      syncVisibility();
      const mounted = regions.items();
      if (!mounted.some((entry) => entry.node === node)) {
        setPointerPaused(node, false);
        setPaused(
          "focus",
          mounted.some((entry) =>
            entry.node.contains(entry.node.ownerDocument.activeElement),
          ),
        );
      }
    });
  }

  function bindToast(
    node: HTMLElement,
    signal: AbortSignal,
    config: { readonly duration: number | null; readonly value: unknown },
  ): void {
    const previous = toasts.get(node);
    const preserve =
      previous?.signal === signal &&
      previous.duration === config.duration &&
      sameValue(previous.value, config.value);
    if (preserve) return;
    clear(previous);
    const sameLifetime = previous?.signal === signal;
    const registration: TimerRegistration = sameLifetime
      ? previous
      : {
          ...config,
          node,
          signal,
          remaining: 0,
          started: 0,
          timer: undefined,
        };
    registration.duration = config.duration;
    registration.value = config.value;
    registration.remaining = config.duration ?? 0;
    registration.timer = undefined;
    toasts.set(node, registration);
    if (paused.size === 0) start(registration);
    registrationChanged();
    if (!sameLifetime)
      onAbort(signal, () => {
        if (toasts.get(node) !== registration) return;
        toasts.delete(node);
        clear(registration);
        registrationChanged();
      });
  }

  function setPointerPaused(node: HTMLElement, pause: boolean): void {
    if (pause) hoveredRegion = node;
    else if (hoveredRegion === node) hoveredRegion = undefined;
    setPaused("pointer", hoveredRegion !== undefined);
  }

  function setPaused(reason: PauseReason, pause: boolean): void {
    const wasPaused = paused.size > 0;
    if (pause) paused.add(reason);
    else paused.delete(reason);
    const isPaused = paused.size > 0;
    if (wasPaused === isPaused) return;
    for (const toast of toasts.values()) {
      if (isPaused) stop(toast);
      else start(toast);
    }
  }

  function start(toast: TimerRegistration): void {
    if (
      toast.duration === null ||
      toast.timer !== undefined ||
      toast.remaining < 0
    ) {
      return;
    }
    toast.started = Date.now();
    const timer = setTimeout(() => {
      const current = toasts.get(toast.node);
      if (current?.timer !== timer) return;
      current.timer = undefined;
      current.remaining = -1;
      onTimeout(current);
    }, toast.remaining);
    toast.timer = timer;
  }

  function stop(toast: TimerRegistration): void {
    if (toast.timer === undefined) return;
    clearTimeout(toast.timer);
    toast.timer = undefined;
    toast.remaining = Math.max(
      0,
      toast.remaining - (Date.now() - toast.started),
    );
  }

  function clear(toast: TimerRegistration | undefined): void {
    if (toast?.timer !== undefined) clearTimeout(toast.timer);
  }

  function validate(): void {
    const mountedRegions = regions.items();
    assertSinglePart(mountedRegions, "toast region");
    for (const mountedRegion of mountedRegions) {
      assertAccessibleName(mountedRegion.node, "toast region");
    }
    assertUniqueValues([...toasts.values()], "toast");
  }

  return {
    bindRegion,
    bindToast,
    setPaused,
    setPointerPaused,
    validate,
  };
}
