import {
  createCsrfMiddleware,
  createMiddleware,
  createStart,
} from "@bgub/fig-tanstack-start";

const requestIdentity = createMiddleware({ type: "request" }).server(
  async ({ request, next }) => {
    const requestId =
      request.headers.get("x-fig-request-id") ?? crypto.randomUUID();
    const result = await next({ context: { requestId } });
    result.response.headers.set("x-fig-request-id", requestId);
    return result;
  },
);

const functionContext = createMiddleware({ type: "function" }).server(
  ({ next }) => next({ context: { functionMiddleware: true as const } }),
);

export const startInstance = createStart(() => ({
  functionMiddleware: [functionContext],
  requestMiddleware: [
    requestIdentity,
    createCsrfMiddleware({
      filter: (context) => context.handlerType === "serverFn",
    }),
  ],
}));
