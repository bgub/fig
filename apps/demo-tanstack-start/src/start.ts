import {
  createCsrfMiddleware,
  createMiddleware,
  createStart,
} from "@bgub/fig-tanstack-start";
import { themeFromCookie } from "./theme.ts";

const requestContext = createMiddleware({ type: "request" }).server(
  ({ request, next }) =>
    next({
      context: {
        serverTheme: themeFromCookie(request.headers.get("cookie")),
      },
    }),
);

export const startInstance = createStart(() => ({
  requestMiddleware: [
    requestContext,
    createCsrfMiddleware({
      filter: (context) => context.handlerType === "serverFn",
    }),
  ],
}));
