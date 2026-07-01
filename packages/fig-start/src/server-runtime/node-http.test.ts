import { Effect } from "effect";
import type { Server } from "node:http";
import { describe, expect, it } from "vite-plus/test";
import { listenNodeHttpServer } from "./node-http.ts";

describe("listenNodeHttpServer", () => {
  it("serves requests and closes when the scope exits", async () => {
    let scopedServer: Server | undefined;

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* listenNodeHttpServer({
            listener(_request, response) {
              response.end("ok");
            },
            port: 0,
          });
          scopedServer = server;
          const address = server.address();

          if (typeof address !== "object" || address === null) {
            throw new Error("Expected TCP server address.");
          }

          const response = yield* Effect.tryPromise(() =>
            fetch(`http://127.0.0.1:${address.port}/health`),
          );
          const body = yield* Effect.tryPromise(() => response.text());

          expect(response.status).toBe(200);
          expect(body).toBe("ok");
        }),
      ),
    );

    expect(scopedServer?.listening).toBe(false);
  });
});
