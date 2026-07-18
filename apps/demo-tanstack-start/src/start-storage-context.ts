export function getStartContext(): never {
  throw new Error("Server storage context is unavailable in the browser demo.");
}

export function runWithStartContext<T>(
  _context: unknown,
  callback: () => T,
): T {
  return callback();
}
