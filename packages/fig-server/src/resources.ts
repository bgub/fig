import { type FigResource, type Props } from "@bgub/fig";
import { figResourceKey, resourceDestination } from "@bgub/fig/internal";
import { writeElementEnd, writeElementStart, writeText } from "./html.ts";

export class ResourceRegistry {
  private readonly emittedResources = new Set<string>();
  private readonly resources = new Map<string, FigResource>();
  private readonly stylesheetIds = new Map<string, string>();
  private nextStylesheetId = 0;

  constructor(private readonly identifierPrefix: string) {}

  register(resource: FigResource): boolean {
    return this.canonical(resource).added;
  }

  write(resource: FigResource, sink: ResourceSink): string | null {
    const { key, resource: current } = this.canonical(resource);
    const id = this.revealBlockerId(key, current);

    if (resourceDestination(current) === "head") return id;
    if (this.emittedResources.has(key)) return id;

    this.emittedResources.add(key);
    writeResourceTag(sink, current, id);
    return id;
  }

  headHtml(nonce?: string): string {
    let html = "";
    const sink = {
      nonce,
      write(chunk: string) {
        html += chunk;
      },
    };

    for (const resource of this.resources.values()) {
      if (resourceDestination(resource) === "head") {
        writeResourceTag(sink, resource, null);
      }
    }

    return html;
  }

  private canonical(resource: FigResource): {
    added: boolean;
    key: string;
    resource: FigResource;
  } {
    const key = figResourceKey(resource);
    const current = this.resources.get(key);

    if (current !== undefined) {
      if (resourceSignature(current) !== resourceSignature(resource)) {
        throw new ResourceConflictError(key, current, resource);
      }

      return { added: false, key, resource: current };
    }

    this.resources.set(key, resource);
    return { added: true, key, resource };
  }

  private revealBlockerId(key: string, resource: FigResource): string | null {
    if (resource.kind !== "stylesheet") return null;
    if (resource.blocking === "none") return null;

    return this.stylesheetIdFor(key);
  }

  private stylesheetIdFor(key: string): string {
    const current = this.stylesheetIds.get(key);
    if (current !== undefined) return current;

    const id =
      this.identifierPrefix === ""
        ? `r-${this.nextStylesheetId}`
        : `${this.identifierPrefix}-r-${this.nextStylesheetId}`;
    this.nextStylesheetId += 1;
    this.stylesheetIds.set(key, id);
    return id;
  }
}

export class ResourceConflictError extends Error {
  constructor(key: string, current: FigResource, incoming: FigResource) {
    super(
      `Conflicting Fig resource for key "${key}". Existing: ${JSON.stringify(
        current,
      )}. Incoming: ${JSON.stringify(incoming)}.`,
    );
  }
}

interface ResourceSink {
  nonce?: string;
  write(chunk: string): void;
}

function writeResourceTag(
  sink: ResourceSink,
  resource: FigResource,
  id: string | null,
): void {
  switch (resource.kind) {
    case "stylesheet":
      writeLink(sink, {
        rel: "stylesheet",
        href: resource.href,
        id: id ?? undefined,
        "data-precedence": resource.precedence,
        media: resource.media,
        crossorigin: resource.crossOrigin,
      });
      return;
    case "preload":
      writeLink(sink, {
        rel: "preload",
        href: resource.href,
        as: resource.as,
        type: resource.type,
        crossorigin: resource.crossOrigin,
        fetchpriority: resource.fetchPriority,
      });
      return;
    case "font":
      writeLink(sink, {
        rel: "preload",
        href: resource.href,
        as: "font",
        type: resource.type,
        crossorigin: resource.crossOrigin ?? "anonymous",
        fetchpriority: resource.fetchPriority,
      });
      return;
    case "preconnect":
      writeLink(sink, {
        rel: "preconnect",
        href: resource.href,
        crossorigin: resource.crossOrigin,
      });
      return;
    case "script":
      writeElementStart(
        "script",
        withNonce(sink, {
          src: resource.src,
          type: resource.module === true ? "module" : undefined,
          // Hoisted scripts default to async, but an explicit defer opts into
          // ordered execution and must not be overridden (async wins over
          // defer in browsers).
          async: (resource.async ?? resource.defer !== true) ? true : undefined,
          defer: resource.defer === true ? true : undefined,
          crossorigin: resource.crossOrigin,
        }),
        sink,
      );
      writeElementEnd("script", sink);
      return;
    case "title":
      writeElementStart("title", {}, sink);
      writeText(resource.value, sink);
      writeElementEnd("title", sink);
      return;
    case "meta":
      writeElementStart(
        "meta",
        {
          charset: resource.charset,
          name: resource.name,
          property: resource.property,
          "http-equiv": resource.httpEquiv,
          content: resource.content,
        },
        sink,
      );
  }
}

function writeLink(sink: ResourceSink, props: Props): void {
  writeElementStart("link", withNonce(sink, props), sink);
}

function withNonce(sink: ResourceSink, props: Props): Props {
  return sink.nonce === undefined ? props : { ...props, nonce: sink.nonce };
}

function resourceSignature(resource: FigResource): string {
  switch (resource.kind) {
    case "stylesheet":
      return signature(
        resource.kind,
        resource.href,
        resource.media ?? "",
        resource.precedence ?? "",
        resource.crossOrigin ?? "",
        resource.blocking ?? "reveal",
      );
    case "preload":
      return signature(
        resource.kind,
        resource.href,
        resource.as,
        resource.type ?? "",
        resource.crossOrigin ?? "",
        resource.fetchPriority ?? "",
      );
    case "font":
      // Mirror the preload-as-font signature: a font shares the preload-font key
      // space (see figResourceKey), so an equivalent preload(href, "font") must
      // produce the same signature and dedupe rather than raising a conflict.
      return signature(
        "preload",
        resource.href,
        "font",
        resource.type,
        resource.crossOrigin ?? "anonymous",
        resource.fetchPriority ?? "",
      );
    case "preconnect":
      return signature(
        resource.kind,
        resource.href,
        resource.crossOrigin ?? "",
      );
    case "script":
      return signature(
        resource.kind,
        resource.src,
        resource.module === true,
        resource.async !== false,
        resource.defer === true,
        resource.crossOrigin ?? "",
      );
    case "title":
      return signature(resource.kind, resource.value);
    case "meta":
      return signature(
        resource.kind,
        resource.charset ?? "",
        resource.name ?? "",
        resource.property ?? "",
        resource.httpEquiv ?? "",
        resource.content ?? "",
      );
  }
}

function signature(...values: Array<string | boolean>): string {
  return JSON.stringify(values);
}
