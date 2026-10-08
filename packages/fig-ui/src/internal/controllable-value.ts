import { useBeforeLayout, useMemo, useStableEvent, useState } from "@bgub/fig";
import type { ChangeDetails } from "./changes.ts";

interface ValueOptions<Value> {
  value: Value | undefined;
  defaultValue: Value;
  onChange?: (
    value: Value,
    details: ChangeDetails,
    signal: AbortSignal,
  ) => void;
  equal?: (left: Value, right: Value) => boolean;
  reconcile: () => void;
}

interface Proposal {
  isCurrent(): boolean;
  notify(details: ChangeDetails): void;
  settle(accepted: boolean, details: ChangeDetails): void;
}

/** Notify all owners before accepting any of a compound change. */
export function requestChanges(
  details: ChangeDetails,
  ...proposals: Proposal[]
): boolean {
  const isCurrent = () => proposals.every((proposal) => proposal.isCurrent());
  for (const proposal of proposals) {
    // A callback may synchronously replace the entire request. Do not notify
    // remaining fields with stale values or abort newer callback work.
    if (!isCurrent()) break;
    proposal.notify(details);
  }
  const accepted = !details.isCanceled && isCurrent();
  for (const proposal of proposals) proposal.settle(accepted, details);
  return accepted;
}

/**
 * One owner publishes committed configuration and retains accepted intent.
 * Rendering only computes a snapshot. Notifications run in the request path,
 * never in state updaters that rendering can replay.
 */
export function useControllableValue<Value>(options: ValueOptions<Value>) {
  const [local, setLocal] = useState(() => ({ value: options.defaultValue }));
  const value = options.value === undefined ? local.value : options.value;
  const notify = useStableEvent(
    (next: Value, details: ChangeDetails, signal: AbortSignal) => {
      options.onChange?.(next, details, signal);
    },
  );
  const owner = useMemo(() => {
    const initial = options.defaultValue;
    let committed = options;
    let controlled = options.value !== undefined;
    let rendered = value;
    let pending = value;
    let sequence = 0;
    let proposal: { revision: number; value: Value } | undefined;

    const current = () => (controlled ? rendered : pending);
    function accept(next: Value): void {
      if (controlled) committed.reconcile();
      else {
        pending = next;
        // A fresh record also restores native controls on a no-op form reset.
        setLocal({ value: next });
      }
    }
    function propose(update: (current: Value) => Value): Proposal {
      const revision = ++sequence;
      const previous = current();
      const next = update(previous);
      const changed = !(committed.equal ?? Object.is)(previous, next);
      proposal = { revision, value: next };
      return {
        isCurrent: () => revision === sequence,
        notify: (details) => {
          if (changed) notify(next, details);
        },
        settle: (accepted, details) => {
          if (proposal?.revision === revision) proposal = undefined;
          if (revision !== sequence) return;
          if (accepted) {
            if (changed) accept(next);
          }
          // Native events may already have changed the DOM. An imperative or
          // automatic rejection changed nothing; reconciling it can endlessly
          // retry a canceled automatic repair.
          else if (details.event !== null) committed.reconcile();
        },
      };
    }
    function restore(next: Value, details: ChangeDetails | null): void {
      sequence++;
      proposal = undefined;
      accept(next);
      // Automatic repairs notify after acceptance and cannot be canceled.
      if (details !== null) notify(next, details);
    }
    return {
      current,
      propose,
      request: (update: (current: Value) => Value, details: ChangeDetails) =>
        requestChanges(details, propose(update)),
      reset: () => restore(controlled ? current() : initial, null),
      restore,
      commit(next: ValueOptions<Value>, nextRendered: Value): void {
        const nextControlled = next.value !== undefined;
        // A synchronous owner commit can acknowledge this proposal while its
        // notification is still running. Only a different value supersedes it.
        const acknowledged =
          proposal?.revision === sequence &&
          (next.equal ?? Object.is)(proposal.value, nextRendered);
        if (
          controlled !== nextControlled ||
          (nextControlled &&
            !Object.is(committed.value, next.value) &&
            !acknowledged)
        )
          sequence++;
        if (nextControlled || controlled !== nextControlled)
          pending = nextRendered;
        controlled = nextControlled;
        committed = next;
        rendered = nextRendered;
      },
    };
  }, []);
  useBeforeLayout(() => {
    owner.commit(options, value);
  });
  return {
    value,
    current: owner.current,
    propose: owner.propose,
    request: owner.request,
    reset: owner.reset,
    restore: owner.restore,
  };
}
