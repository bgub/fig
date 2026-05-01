export interface HtmlSink {
  write(chunk: string): void;
}

export interface ServerPayloadChunk {
  type: string;
  data?: unknown;
}

export interface ServerPayloadSink {
  write(chunk: ServerPayloadChunk): void;
}

export interface ServerRenderSinks {
  html: HtmlSink;
  payload: ServerPayloadSink;
}

export interface ServerRenderBuffer extends ServerRenderSinks {
  readHtml(): string;
  readPayload(): ServerPayloadChunk[];
  flushTo(target: ServerRenderSinks): void;
}

export function createServerRenderBuffer(): ServerRenderBuffer {
  const htmlChunks: string[] = [];
  const payloadChunks: ServerPayloadChunk[] = [];

  return {
    html: {
      write(chunk) {
        htmlChunks.push(chunk);
      },
    },
    payload: {
      write(chunk) {
        payloadChunks.push(chunk);
      },
    },
    readHtml() {
      return htmlChunks.join("");
    },
    readPayload() {
      return [...payloadChunks];
    },
    flushTo(target) {
      const html = htmlChunks.join("");
      if (html !== "") target.html.write(html);

      for (const chunk of payloadChunks) {
        target.payload.write(chunk);
      }
    },
  };
}
