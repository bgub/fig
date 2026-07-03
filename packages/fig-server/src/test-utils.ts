// Shared scaffolding for this package's test files. Deferreds come from
// shared.ts (the production helper); stream helpers live here because only
// tests consume byte streams as whole strings.

export async function readStream(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) return output + decoder.decode();
    output += decoder.decode(value, { stream: true });
  }
}

export function streamFromString(input: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(input));
      controller.close();
    },
  });
}

export function controlledTextStream(): {
  close(): void;
  stream: ReadableStream<Uint8Array>;
  write(chunk: string): void;
} {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;

  return {
    close() {
      controller?.close();
    },
    stream: new ReadableStream<Uint8Array>({
      start(innerController) {
        controller = innerController;
      },
    }),
    write(chunk) {
      controller?.enqueue(encoder.encode(chunk));
    },
  };
}
