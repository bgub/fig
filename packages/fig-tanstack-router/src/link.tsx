import {
  createElement,
  type FigNode,
  useBeforePaint,
  useCallback,
  useMemo,
  useReactive,
  useState,
} from "@bgub/fig";
import { composeBind, type HostIntrinsicElements, on } from "@bgub/fig-dom";
import {
  deepEqual,
  exactPathTest,
  isDangerousProtocol,
  type LinkOptions,
  type RegisteredRouter,
  removeTrailingSlash,
} from "@tanstack/router-core";
import { useRouter } from "./hooks.tsx";
import { useReadableStore } from "./store.ts";

type AnchorProps = HostIntrinsicElements["a"];
type LinkStateProps = Partial<
  Omit<AnchorProps, "children" | "href" | "target">
>;

export type LinkRenderState = {
  isActive: boolean;
  isTransitioning: boolean;
};

export type LinkProps<
  TFrom extends string = string,
  TTo extends string | undefined = ".",
  TMaskFrom extends string = TFrom,
  TMaskTo extends string = ".",
> = Omit<AnchorProps, "children"> &
  LinkOptions<RegisteredRouter, TFrom, TTo, TMaskFrom, TMaskTo> & {
    activeProps?: LinkStateProps | (() => LinkStateProps);
    children?: FigNode | ((state: LinkRenderState) => FigNode);
    inactiveProps?: LinkStateProps | (() => LinkStateProps);
    preloadIntentProximity?: never;
  };

export function Link<
  const TFrom extends string = string,
  const TTo extends string | undefined = undefined,
  const TMaskFrom extends string = TFrom,
  const TMaskTo extends string = "",
>(props: LinkProps<TFrom, TTo, TMaskFrom, TMaskTo>): FigNode {
  const router = useRouter<RegisteredRouter>();
  const resolvedLocation = useReadableStore(router.stores.resolvedLocation);
  const currentLocation = resolvedLocation ?? router.stores.location.get();
  const [isTransitioning, setIsTransitioning] = useState(false);
  const state = useMemo<{
    preloadTimeout?: ReturnType<typeof setTimeout>;
    unsubscribe?: () => void;
  }>(() => ({}), []);
  useBeforePaint(
    (signal) => {
      signal.addEventListener(
        "abort",
        () => {
          state.unsubscribe?.();
          if (state.preloadTimeout !== undefined) {
            clearTimeout(state.preloadTimeout);
          }
        },
        { once: true },
      );
      return undefined;
    },
    [state],
  );
  const {
    _fromLocation,
    activeOptions,
    activeProps,
    children,
    disabled,
    from: _from,
    hash: _hash,
    hashScrollIntoView: _hashScrollIntoView,
    href: explicitHref,
    ignoreBlocker: _ignoreBlocker,
    inactiveProps,
    mask: _mask,
    mix,
    params: _params,
    preload: requestedPreload,
    preloadDelay: requestedPreloadDelay,
    reloadDocument,
    replace: _replace,
    resetScroll: _resetScroll,
    search: _search,
    startTransition: _startTransition,
    state: _state,
    target,
    to,
    unsafeRelative: _unsafeRelative,
    viewTransition: _viewTransition,
    ...anchorProps
  } = props;
  const absolute = isAbsoluteLinkTarget(to, router.origin);
  const next = !absolute
    ? router.buildLocation<RegisteredRouter, TTo, TFrom, TMaskFrom, TMaskTo>({
        ...props,
        _isNavigate: false,
      })
    : undefined;
  const displayedLocation = next?.maskedLocation ?? next;
  const href = disabled
    ? undefined
    : (explicitHref ??
      (absolute ? to : undefined) ??
      (displayedLocation === undefined
        ? undefined
        : router.history.createHref(displayedLocation.publicHref) || "/"));
  const external =
    absolute ||
    displayedLocation?.external === true ||
    (explicitHref !== undefined &&
      isAbsoluteLinkTarget(explicitHref, router.origin));
  const dangerous =
    href !== undefined
      ? isDangerousProtocol(href, router.protocolAllowlist)
      : false;
  const preload =
    reloadDocument || external || dangerous || explicitHref !== undefined
      ? false
      : (requestedPreload ?? router.options.defaultPreload);
  const preloadDelay =
    requestedPreloadDelay ?? router.options.defaultPreloadDelay ?? 0;
  const isActive =
    next !== undefined &&
    !external &&
    linkPathIsActive(
      currentLocation.pathname,
      next.pathname,
      router.basepath,
      activeOptions?.exact ?? false,
    ) &&
    (!(activeOptions?.includeSearch ?? true) ||
      deepEqual(currentLocation.search, next.search, {
        ignoreUndefined: !activeOptions?.explicitUndefined,
        partial: !(activeOptions?.exact ?? false),
      })) &&
    (!activeOptions?.includeHash || currentLocation.hash === next.hash);
  const selectedStateProps = isActive ? activeProps : inactiveProps;
  const stateProps =
    (typeof selectedStateProps === "function"
      ? selectedStateProps()
      : selectedStateProps) ?? {};
  const {
    bind: stateBind,
    class: stateClass,
    mix: stateMix,
    style: stateStyle,
    ...stateAnchorProps
  } = stateProps;
  const linkBind = composeBind(anchorProps.bind, stateBind);
  const linkClass =
    typeof anchorProps.class === "string" && typeof stateClass === "string"
      ? `${anchorProps.class} ${stateClass}`
      : (stateClass ?? anchorProps.class);
  const linkStyle =
    typeof anchorProps.style === "object" &&
    anchorProps.style !== null &&
    typeof stateStyle === "object" &&
    stateStyle !== null
      ? { ...anchorProps.style, ...stateStyle }
      : (stateStyle ?? anchorProps.style);
  const renderedChildren =
    typeof children === "function"
      ? children({ isActive, isTransitioning })
      : children;

  const preloadRoute = useCallback(() => {
    void router
      .preloadRoute<TFrom, TTo, TMaskFrom, TMaskTo>(props)
      .catch((error: unknown) => {
        console.warn("Error preloading route", error);
      });
  }, [href, router]);

  useReactive(() => {
    if (!disabled && preload === "render") preloadRoute();
  }, [disabled, preload, preloadRoute]);

  const viewportBind = useCallback(
    (element: HTMLAnchorElement, signal: AbortSignal): undefined => {
      if (disabled || preload !== "viewport") return undefined;
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          preloadRoute();
        }
      });
      observer.observe(element);
      signal.addEventListener("abort", () => observer.disconnect(), {
        once: true,
      });
      return undefined;
    },
    [disabled, preload, preloadRoute],
  );

  const beginIntentPreload = () => {
    if (disabled || preload !== "intent") return;
    if (preloadDelay === 0) {
      preloadRoute();
      return;
    }
    if (state.preloadTimeout !== undefined) return;
    state.preloadTimeout = setTimeout(() => {
      state.preloadTimeout = undefined;
      preloadRoute();
    }, preloadDelay);
  };
  const cancelIntentPreload = () => {
    if (state.preloadTimeout === undefined) return;
    clearTimeout(state.preloadTimeout);
    state.preloadTimeout = undefined;
  };

  return createElement(
    "a",
    {
      ...anchorProps,
      ...stateAnchorProps,
      "aria-current": isActive ? "page" : undefined,
      "aria-disabled": disabled ? true : undefined,
      "data-status": isActive ? "active" : undefined,
      "data-transitioning": isTransitioning ? "transitioning" : undefined,
      bind:
        preload === "viewport" ? composeBind(linkBind, viewportBind) : linkBind,
      class: linkClass,
      href: dangerous ? undefined : href,
      mix: [
        mix,
        stateMix,
        on("click", (event) => {
          const elementTarget =
            event.currentTarget instanceof Element
              ? event.currentTarget.getAttribute("target")
              : null;
          const effectiveTarget = target ?? elementTarget;
          if (
            disabled ||
            dangerous ||
            external ||
            reloadDocument ||
            event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.altKey ||
            event.ctrlKey ||
            event.shiftKey ||
            (effectiveTarget !== null &&
              effectiveTarget !== "" &&
              effectiveTarget !== "_self") ||
            anchorProps.download !== undefined
          ) {
            return;
          }
          event.preventDefault();
          state.unsubscribe?.();
          setIsTransitioning(true);
          const unsubscribe = router.subscribe("onResolved", () => {
            unsubscribe();
            state.unsubscribe = undefined;
            setIsTransitioning(false);
          });
          state.unsubscribe = unsubscribe;
          void router.navigate<
            RegisteredRouter,
            TTo,
            TFrom,
            TMaskFrom,
            TMaskTo
          >(props);
        }),
        preload === "intent" && on("mouseenter", beginIntentPreload),
        preload === "intent" && on("mouseleave", cancelIntentPreload),
        preload === "intent" && on("focus", beginIntentPreload),
        preload === "intent" && on("blur", cancelIntentPreload),
        preload === "intent" &&
          on("touchstart", () => {
            if (!disabled) preloadRoute();
          }),
      ],
      role: disabled ? "link" : (stateAnchorProps.role ?? anchorProps.role),
      style: linkStyle,
      target,
    },
    renderedChildren,
  );
}

function linkPathIsActive(
  currentPathname: string,
  nextPathname: string,
  basepath: string,
  exact: boolean,
): boolean {
  if (exact) return exactPathTest(currentPathname, nextPathname, basepath);
  const current = removeTrailingSlash(currentPathname, basepath);
  const next = removeTrailingSlash(nextPathname, basepath);
  return (
    current.startsWith(next) &&
    (current.length === next.length || current[next.length] === "/")
  );
}

function isAbsoluteLinkTarget(
  value: unknown,
  origin: string | undefined,
): value is string {
  if (typeof value !== "string") return false;
  if (!value.startsWith("//") && !value.includes(":")) return false;
  try {
    new URL(value, origin);
    return true;
  } catch {
    return false;
  }
}
