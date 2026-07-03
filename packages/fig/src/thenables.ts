export type Thenable<T = unknown> = PromiseLike<T> & object;

interface ThenableRecord<T> {
  status: "pending" | "fulfilled" | "rejected";
  value?: T;
  reason?: unknown;
}

// One process-wide registry keyed by thenable identity: the reconciler's
// readPromise, the server renderers' dispatchers, and preloaders all share
// it, so suspend/settle semantics cannot drift between client and server.
const thenableRecords = new WeakMap<object, ThenableRecord<unknown>>();

function recordFor<T>(thenable: PromiseLike<T>): ThenableRecord<T> {
  const key = thenable as Thenable<T>;
  let record = thenableRecords.get(key) as ThenableRecord<T> | undefined;

  if (record === undefined) {
    const pendingRecord: ThenableRecord<T> = { status: "pending" };
    record = pendingRecord;
    thenableRecords.set(key, pendingRecord);
    thenable.then(
      (value) => {
        pendingRecord.status = "fulfilled";
        pendingRecord.value = value;
      },
      (reason: unknown) => {
        pendingRecord.status = "rejected";
        pendingRecord.reason = reason;
      },
    );
  }

  return record;
}

// Starts tracking without reading. Preloaders call this when they begin a
// load so that a thenable settled before its first render read resolves
// synchronously instead of suspending for one retry beat.
export function trackThenable<T>(thenable: PromiseLike<T>): void {
  recordFor(thenable);
}

export function readThenable<T>(thenable: PromiseLike<T>): T {
  const record = recordFor(thenable);
  if (record.status === "fulfilled") return record.value as T;
  if (record.status === "rejected") throw record.reason;
  throw thenable;
}

export function isThenable(value: unknown): value is Thenable {
  if (
    (typeof value !== "object" && typeof value !== "function") ||
    value === null
  ) {
    return false;
  }

  return typeof (value as PromiseLike<unknown>).then === "function";
}
