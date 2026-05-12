export type Thenable<T = unknown> = PromiseLike<T> & object;

interface ThenableRecord<T> {
  status: "pending" | "fulfilled" | "rejected";
  value?: T;
  reason?: unknown;
}

const thenableRecords = new WeakMap<object, ThenableRecord<unknown>>();

export function readThenable<T>(thenable: PromiseLike<T>): T {
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
