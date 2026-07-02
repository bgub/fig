import { type FigResource, type Props } from "@bgub/fig";
import {
  figResourceKey,
  resourceDestination,
  resourceHostAttributes,
} from "@bgub/fig/internal";
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
          "data-fig-resource-key": resource.key,
        },
        sink,
      );
      return;
    default: {
      // The attribute set is shared with the client's head insertion; only
      // the server-side reveal-blocker id and nonce are appended here.
      const props: Props = Object.fromEntries(resourceHostAttributes(resource));
      if (resource.kind === "stylesheet" && id !== null) props.id = id;

      const tag = resource.kind === "script" ? "script" : "link";
      writeElementStart(tag, withNonce(sink, props), sink);
      if (tag === "script") writeElementEnd("script", sink);
    }
  }
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
    case "modulepreload":
      return signature(
        resource.kind,
        resource.href,
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
