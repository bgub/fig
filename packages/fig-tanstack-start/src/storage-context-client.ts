// Browser imports never create or publish a server request store.
export { getStartContext } from "./start-context.ts";

export async function runWithStartContext<T>(
  _context: unknown,
  callback: () => T | Promise<T>,
): Promise<T> {
  return callback();
}
