// Application-owned adapter, safe only with serialized full-response renders.
export class AsyncLocalStorage<T> {
  #store: T | undefined;
  getStore(): T | undefined {
    return this.#store;
  }
  run<R>(store: T, callback: () => R): R {
    this.#store = store;
    return callback();
  }
}
