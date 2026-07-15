export interface PropagationState {
  immediateStopped: boolean;
  stopped: boolean;
}

export function withCurrentTarget<T>(
  event: Event,
  currentTarget: Element,
  callback: (event: Event) => T,
): T {
  const restore = patchProperty(event, "currentTarget", {
    value: currentTarget,
  });

  try {
    return callback(event);
  } finally {
    restore();
  }
}

// Runs one logical dispatch with isolated propagation state. Live dispatches
// honor a stop made by an earlier native listener; replays ignore stale state
// left on the spent native event.
export function withPropagationState<T>(
  event: Event,
  replay: boolean,
  callback: (state: PropagationState) => T,
): T {
  const state: PropagationState = {
    immediateStopped: false,
    stopped: !replay && event.cancelBubble === true,
  };

  const restoreStop = patchEventMethod(event, "stopPropagation", () => {
    state.stopped = true;
  });
  const restoreImmediate = patchEventMethod(
    event,
    "stopImmediatePropagation",
    () => {
      state.stopped = true;
      state.immediateStopped = true;
    },
  );
  const restoreCancelBubble = patchProperty(event, "cancelBubble", {
    get: () => state.stopped,
    set(value: unknown) {
      // Per spec, assigning false does nothing.
      if (value === true) state.stopped = true;
    },
  });

  try {
    return callback(state);
  } finally {
    restoreCancelBubble();
    restoreImmediate();
    restoreStop();
    // Reflect a logical stop onto the native event after removing the patches.
    if (state.stopped) event.cancelBubble = true;
  }
}

function patchEventMethod(
  event: Event,
  name: "stopImmediatePropagation" | "stopPropagation",
  onCall: () => void,
): () => void {
  const native = Reflect.get(event, name);
  if (typeof native !== "function") return noop;

  return patchProperty(event, name, {
    value() {
      onCall();
      native.call(event);
    },
  });
}

function patchProperty(
  target: object,
  name: PropertyKey,
  descriptor: PropertyDescriptor,
): () => void {
  const previous = Object.getOwnPropertyDescriptor(target, name);
  const changed = Reflect.defineProperty(target, name, {
    configurable: true,
    ...descriptor,
  });
  if (!changed) return noop;

  return previous === undefined
    ? () => {
        Reflect.deleteProperty(target, name);
      }
    : () => {
        Reflect.defineProperty(target, name, previous);
      };
}

function noop(): void {}
