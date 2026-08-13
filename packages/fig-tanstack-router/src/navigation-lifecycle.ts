import type { BlockerFnArgs, NavigationBlocker } from "@tanstack/history";
import type { AnyRouter } from "@tanstack/router-core";

type RegisteredNavigationBlocker = {
  blockerFn: NavigationBlocker["blockerFn"];
  enableBeforeUnload: () => boolean;
};

type NavigationAttempt = {
  blockersPending: boolean;
  onBlocked: () => void;
};

type NavigationAttemptHandle = {
  isBlockerPending: () => boolean;
};

type NavigationBroker = {
  blockers: Set<RegisteredNavigationBlocker>;
  pendingAttempt?: NavigationAttempt;
  runAttempt: (
    onBlocked: () => void,
    navigate: () => void,
  ) => NavigationAttemptHandle;
  unregisterHistoryBlocker: () => void;
};

const navigationBrokers = new WeakMap<AnyRouter, NavigationBroker>();

export function registerNavigationBlocker(
  router: AnyRouter,
  blocker: RegisteredNavigationBlocker,
): () => void {
  const broker =
    navigationBrokers.get(router) ?? createNavigationBroker(router);
  broker.blockers.add(blocker);

  return () => {
    if (!broker.blockers.delete(blocker) || broker.blockers.size > 0) return;
    broker.unregisterHistoryBlocker();
    navigationBrokers.delete(router);
  };
}

export function runNavigationAttempt(
  router: AnyRouter,
  onBlocked: () => void,
  navigate: () => void,
): NavigationAttemptHandle {
  const broker = navigationBrokers.get(router);
  if (broker === undefined) {
    navigate();
    return settledNavigationAttempt;
  }
  return broker.runAttempt(onBlocked, navigate);
}

function createNavigationBroker(router: AnyRouter): NavigationBroker {
  const broker: NavigationBroker = {
    blockers: new Set(),
    runAttempt: (onBlocked, navigate) =>
      runBrokerAttempt(broker, onBlocked, navigate),
    unregisterHistoryBlocker: router.history.block({
      blockerFn: (args: BlockerFnArgs) => runNavigationBlockers(broker, args),
      enableBeforeUnload: () =>
        Array.from(broker.blockers).some((blocker) =>
          blocker.enableBeforeUnload(),
        ),
    }),
  };
  navigationBrokers.set(router, broker);
  return broker;
}

function runBrokerAttempt(
  broker: NavigationBroker,
  onBlocked: () => void,
  navigate: () => void,
): NavigationAttemptHandle {
  const attempt = { blockersPending: true, onBlocked };
  broker.pendingAttempt = attempt;
  try {
    navigate();
  } finally {
    if (broker.pendingAttempt === attempt) {
      broker.pendingAttempt = undefined;
      attempt.blockersPending = false;
    }
  }
  return { isBlockerPending: () => attempt.blockersPending };
}

async function runNavigationBlockers(
  broker: NavigationBroker,
  args: BlockerFnArgs,
): Promise<boolean> {
  const attempt = broker.pendingAttempt;
  broker.pendingAttempt = undefined;
  try {
    const blockers = Array.from(broker.blockers);
    for (const blocker of blockers) {
      if (await blocker.blockerFn(args)) {
        attempt?.onBlocked();
        return true;
      }
    }
    return false;
  } finally {
    if (attempt !== undefined) attempt.blockersPending = false;
  }
}

const settledNavigationAttempt: NavigationAttemptHandle = {
  isBlockerPending: () => false,
};
