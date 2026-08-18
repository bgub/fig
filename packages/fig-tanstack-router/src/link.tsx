import {
  createElement,
  type FigNode,
  transition,
  useBeforePaint,
  useCallback,
  useMemo,
  useReactive,
  useStableEvent,
  useState,
} from "@bgub/fig";
import { markClientOnlyHostProps } from "@bgub/fig/internal";
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
import { runNavigationAttempt } from "./navigation-lifecycle.ts";
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

type LinkImplementationProps<
  TFrom extends string,
  TTo extends string | undefined,
  TMaskFrom extends string,
  TMaskTo extends string,
> = {
  linkProps: LinkProps<TFrom, TTo, TMaskFrom, TMaskTo>;
  router: RegisteredRouter;
};

type ClientLinkLifecycle = {
  finishNavigation?: () => void;
  preloadTimeout?: ReturnType<typeof setTimeout>;
};

export function Link<
  const TFrom extends string = string,
  const TTo extends string | undefined = undefined,
  const TMaskFrom extends string = TFrom,
  const TMaskTo extends string = "",
>(props: LinkProps<TFrom, TTo, TMaskFrom, TMaskTo>): FigNode {
  const router = useRouter<RegisteredRouter>();
  return router.isServer ? (
    <ServerLink linkProps={props} router={router} />
  ) : (
    <ClientLink linkProps={props} router={router} />
  );
}

function ClientLink<
  TFrom extends string,
  TTo extends string | undefined,
  TMaskFrom extends string,
  TMaskTo extends string,
>({
  linkProps: props,
  router,
}: LinkImplementationProps<TFrom, TTo, TMaskFrom, TMaskTo>): FigNode {
  const resolvedLocation = useReadableStore(router.stores.resolvedLocation);
  const currentLocation = resolvedLocation ?? router.stores.location.get();
  const [isTransitioning, setIsTransitioning] = useState(false);
  const lifecycle = useMemo<ClientLinkLifecycle>(() => ({}), []);
  useBeforePaint(
    (signal) => {
      signal.addEventListener(
        "abort",
        () => {
          lifecycle.finishNavigation?.();
          cancelPendingPreload(lifecycle);
        },
        { once: true },
      );
      return undefined;
    },
    [lifecycle, router],
  );
  const {
    anchorProps,
    children,
    dangerous,
    disabled,
    external,
    isActive,
    mix,
    stateMix,
    toHref,
  } = resolveLinkState(router, currentLocation, props);
  const preload =
    props.reloadDocument || external || dangerous || props.href !== undefined
      ? false
      : (props.preload ?? router.options.defaultPreload);
  const preloadDelay =
    props.preloadDelay ?? router.options.defaultPreloadDelay ?? 0;
  const intentPreload = preload === "intent";
  const renderedChildren =
    typeof children === "function"
      ? children({ isActive, isTransitioning })
      : children;

  const preloadRoute = useStableEvent(() => {
    void router
      .preloadRoute<TFrom, TTo, TMaskFrom, TMaskTo>(props)
      .catch((error: unknown) => {
        console.warn("Error preloading route", error);
      });
  });
  useReactive(() => {
    if (!disabled && preload === "render") preloadRoute();
  }, [disabled, preload, preloadRoute, router, toHref]);

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
    if (disabled || !intentPreload) return;
    if (preloadDelay === 0) {
      preloadRoute();
    } else if (lifecycle.preloadTimeout === undefined) {
      lifecycle.preloadTimeout = setTimeout(() => {
        lifecycle.preloadTimeout = undefined;
        preloadRoute();
      }, preloadDelay);
    }
  };
  const cancelIntentPreload = () => {
    cancelPendingPreload(lifecycle);
  };
  useBeforePaint(() => {
    if (disabled || !intentPreload) cancelPendingPreload(lifecycle);
    return undefined;
  }, [disabled, intentPreload, lifecycle]);

  return createElement(
    "a",
    {
      ...anchorProps,
      "data-transitioning": isTransitioning ? "transitioning" : undefined,
      bind:
        preload === "viewport"
          ? composeBind(anchorProps.bind, viewportBind)
          : anchorProps.bind,
      mix: [
        mix,
        stateMix,
        on("click", (event) => {
          const elementTarget =
            event.currentTarget instanceof Element
              ? event.currentTarget.getAttribute("target")
              : null;
          const effectiveTarget = anchorProps.target ?? elementTarget;
          if (
            disabled ||
            dangerous ||
            external ||
            props.reloadDocument ||
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
          void transition(() => {
            lifecycle.finishNavigation?.();
            setIsTransitioning(true);
            let navigationAttempt:
              | ReturnType<typeof runNavigationAttempt>
              | undefined;
            let finishTransition!: () => void;
            const transitionFinished = new Promise<void>((resolve) => {
              finishTransition = resolve;
            });
            let cancelNavigation!: () => void;
            const unsubscribe = router.subscribe("onResolved", () => {
              if (navigationAttempt?.isBlockerPending() !== true) {
                cancelNavigation();
              }
            });
            cancelNavigation = () => {
              unsubscribe();
              finishTransition();
              if (lifecycle.finishNavigation !== cancelNavigation) return;
              lifecycle.finishNavigation = undefined;
              setIsTransitioning(false);
            };
            lifecycle.finishNavigation = cancelNavigation;
            navigationAttempt = runNavigationAttempt(
              router,
              cancelNavigation,
              () =>
                router.navigate<
                  RegisteredRouter,
                  TTo,
                  TFrom,
                  TMaskFrom,
                  TMaskTo
                >(props),
            );
            return Promise.race([navigationAttempt.result, transitionFinished]);
          });
        }),
        intentPreload && on("mouseenter", beginIntentPreload),
        intentPreload && on("mouseleave", cancelIntentPreload),
        intentPreload && on("focus", beginIntentPreload),
        intentPreload && on("blur", cancelIntentPreload),
        intentPreload &&
          on("touchstart", () => {
            if (!disabled) preloadRoute();
          }),
      ],
    },
    renderedChildren,
  );
}

function ServerLink<
  TFrom extends string,
  TTo extends string | undefined,
  TMaskFrom extends string,
  TMaskTo extends string,
>({
  linkProps: props,
  router,
}: LinkImplementationProps<TFrom, TTo, TMaskFrom, TMaskTo>): FigNode {
  const currentLocation =
    router.stores.resolvedLocation.get() ?? router.stores.location.get();
  const { anchorProps, children, isActive, mix, stateMix } = resolveLinkState(
    router,
    currentLocation,
    props,
  );
  const renderedChildren =
    typeof children === "function"
      ? children({ isActive, isTransitioning: false })
      : children;

  const serverMix = combineServerLinkMixins(mix, stateMix);
  if (serverMix !== undefined) anchorProps.mix = serverMix;

  const element = createElement("a", anchorProps, renderedChildren);
  markClientOnlyHostProps(element.props, "on()");
  return element;
}

function resolveLinkState<
  TFrom extends string,
  TTo extends string | undefined,
  TMaskFrom extends string,
  TMaskTo extends string,
>(
  router: RegisteredRouter,
  currentLocation: ReturnType<RegisteredRouter["stores"]["location"]["get"]>,
  props: LinkProps<TFrom, TTo, TMaskFrom, TMaskTo>,
) {
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
    preload: _preload,
    preloadDelay: _preloadDelay,
    reloadDocument: _reloadDocument,
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
    href !== undefined && (external || explicitHref !== undefined)
      ? isDangerousProtocol(href, router.protocolAllowlist)
      : false;
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
    typeof selectedStateProps === "function"
      ? selectedStateProps()
      : selectedStateProps;
  let bind: LinkStateProps["bind"];
  let stateAnchorProps: LinkStateProps | undefined;
  let stateClass: LinkStateProps["class"];
  let stateMix: LinkStateProps["mix"];
  let stateStyle: LinkStateProps["style"];
  if (stateProps !== undefined) {
    const {
      bind: nextBind,
      class: nextClass,
      mix: nextMix,
      style: nextStyle,
      ...nextAnchorProps
    } = stateProps;
    bind = nextBind;
    stateAnchorProps = nextAnchorProps;
    stateClass = nextClass;
    stateMix = nextMix;
    stateStyle = nextStyle;
  }
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
  const resolvedAnchorProps: AnchorProps = anchorProps;
  if (stateAnchorProps !== undefined) {
    Object.assign(resolvedAnchorProps, stateAnchorProps);
  }
  resolvedAnchorProps["aria-current"] = isActive ? "page" : undefined;
  resolvedAnchorProps["aria-disabled"] = disabled ? true : undefined;
  resolvedAnchorProps["data-status"] = isActive ? "active" : undefined;
  resolvedAnchorProps.bind = combineLinkBinds(anchorProps.bind, bind);
  resolvedAnchorProps.class = linkClass;
  resolvedAnchorProps.href = dangerous ? undefined : href;
  resolvedAnchorProps.role = disabled ? "link" : resolvedAnchorProps.role;
  resolvedAnchorProps.style = linkStyle;
  resolvedAnchorProps.target = target;

  return {
    anchorProps: resolvedAnchorProps,
    children,
    dangerous,
    disabled,
    external,
    isActive,
    mix,
    stateMix,
    toHref: next?.href,
  };
}

function combineServerLinkMixins(
  first: LinkStateProps["mix"],
  second: LinkStateProps["mix"],
): LinkStateProps["mix"] {
  if (first) return second ? [first, second] : first;
  return second;
}

function cancelPendingPreload(lifecycle: ClientLinkLifecycle): void {
  if (lifecycle.preloadTimeout === undefined) return;
  clearTimeout(lifecycle.preloadTimeout);
  lifecycle.preloadTimeout = undefined;
}

function combineLinkBinds(
  first: LinkStateProps["bind"],
  second: LinkStateProps["bind"],
): LinkStateProps["bind"] {
  const firstBind = typeof first === "function" ? first : undefined;
  const secondBind = typeof second === "function" ? second : undefined;
  return firstBind && secondBind
    ? composeBind(firstBind, secondBind)
    : (firstBind ?? secondBind);
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
