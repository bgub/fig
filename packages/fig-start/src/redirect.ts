// A redirect is thrown from beforeLoad/loader and caught by the router (client
// navigation) or the server handler (302 response).
const REDIRECT = Symbol.for("fig-start.redirect");

export interface RedirectOptions {
  replace?: boolean;
  to: string;
}

export interface Redirect extends RedirectOptions {
  readonly [REDIRECT]: true;
}

export function redirect(options: RedirectOptions): Redirect {
  return { ...options, [REDIRECT]: true };
}

export function isRedirect(value: unknown): value is Redirect {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[REDIRECT] === true
  );
}
