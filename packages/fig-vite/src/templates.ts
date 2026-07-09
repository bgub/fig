import babel, {
  type NodePath,
  type PluginObj,
  type types as T,
} from "@babel/core";

export interface TemplateTransformResult {
  code: string;
  map: unknown;
}

// Experimental (bet-2 template project): compile static JSX subtrees into
// hoisted template descriptors plus per-render slot arrays.
//
//   <li class="row" data-id={id}><span>{label}</span><button events={h}>Go</button></li>
//     ⇒ const _figTmpl$0 = _figTemplate("<li class=\"row\"><span> </span><button>Go</button></li>", [...slots], [...segments]);
//       _figElement(_figTmpl$0, { slots: [id, label, h] })
//
// Eligibility (v0 — every rule exists to keep slot paths stable or the
// semantics identical to fiber rendering; anything else bails to normal JSX):
// - every element is a lowercase intrinsic; no components, fragments,
//   spreads, namespaces, bind, or unsafeHTML anywhere in the subtree
// - a dynamic {expression} child must be its element's only child (adjacent
//   text nodes merge when the browser parses HTML, which would shift paths)
// - `key` is allowed on the root only and forwards to the element props
// - at least two elements (a lone element gains nothing over createElement)

type Segment = string | number;

interface SlotSpec {
  kind: "text" | "attr" | "events";
  name?: string;
  path: number[];
}

interface TemplateBuild {
  html: string;
  segments: Segment[];
  slots: SlotSpec[];
  values: T.Expression[];
  elementCount: number;
  key: T.Expression | null;
}

// Tags a template must never swallow: document-shell structure (the server
// tracks html/head/body for doctype and shell validation), hoisted asset
// resources (title/meta/link/script/style route through the asset system,
// not the DOM position they appear at), and parser-special containers.
const blockedElements = new Set([
  "base",
  "body",
  "head",
  "html",
  "link",
  "meta",
  "noscript",
  "script",
  "slot",
  "style",
  "template",
  "title",
]);

const voidElements = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

function escapeTemplateText(value: string): string {
  return value.replace(/[&<>]/g, (character) =>
    character === "&" ? "&amp;" : character === "<" ? "&lt;" : "&gt;",
  );
}

function escapeTemplateAttribute(value: string): string {
  return value.replace(/[&"<>]/g, (character) =>
    character === "&"
      ? "&amp;"
      : character === '"'
        ? "&quot;"
        : character === "<"
          ? "&lt;"
          : "&gt;",
  );
}

// JSX text semantics: whitespace-only lines disappear; interior newlines
// (plus surrounding indentation) collapse to a single space.
function cleanJsxText(raw: string): string {
  const lines = raw.split(/\r?\n/);
  if (lines.length === 1) return raw;
  const kept: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line =
      index === 0
        ? lines[index].trimEnd()
        : index === lines.length - 1
          ? lines[index].trimStart()
          : lines[index].trim();
    if (line !== "") kept.push(line.trim() === "" ? "" : line);
  }
  return kept.join(" ");
}

function isTextualExpression(
  t: typeof babel.types,
  node: T.Expression,
): boolean {
  if (
    t.isStringLiteral(node) ||
    t.isNumericLiteral(node) ||
    t.isTemplateLiteral(node)
  ) {
    return true;
  }
  // `+` always yields a primitive (string or number), never an element.
  if (t.isBinaryExpression(node) && node.operator === "+") return true;
  return false;
}

function templatesBabelPlugin(api: typeof babel): PluginObj {
  const t = api.types;
  let counter = 0;

  function writeStatic(build: TemplateBuild, chunk: string): void {
    build.html += chunk;
    const last = build.segments.length - 1;
    if (last >= 0 && typeof build.segments[last] === "string") {
      build.segments[last] = (build.segments[last] as string) + chunk;
    } else {
      build.segments.push(chunk);
    }
  }

  function buildElement(
    element: T.JSXElement,
    path: number[],
    build: TemplateBuild,
  ): boolean {
    const opening = element.openingElement;
    if (!t.isJSXIdentifier(opening.name)) return false;
    const name = opening.name.name;
    if (!/^[a-z][\w-]*$/.test(name)) return false;
    if (blockedElements.has(name)) return false;

    build.elementCount += 1;
    writeStatic(build, `<${name}`);

    for (const attribute of opening.attributes) {
      if (!t.isJSXAttribute(attribute)) return false;
      if (!t.isJSXIdentifier(attribute.name)) return false;
      const attrName = attribute.name.name;

      if (attrName === "key") {
        if (path.length !== 0 || attribute.value === null) return false;
        if (t.isStringLiteral(attribute.value)) {
          build.key = attribute.value;
          continue;
        }
        if (
          t.isJSXExpressionContainer(attribute.value) &&
          t.isExpression(attribute.value.expression)
        ) {
          build.key = attribute.value.expression;
          continue;
        }
        return false;
      }

      if (attrName === "bind" || attrName === "unsafeHTML") return false;

      if (attrName === "events") {
        if (
          !t.isJSXExpressionContainer(attribute.value) ||
          !t.isExpression(attribute.value.expression)
        ) {
          return false;
        }
        build.slots.push({ kind: "events", path: [...path] });
        build.values.push(attribute.value.expression);
        continue;
      }

      if (attribute.value === null) {
        writeStatic(build, ` ${attrName}=""`);
        continue;
      }

      if (t.isStringLiteral(attribute.value)) {
        writeStatic(
          build,
          ` ${attrName}="${escapeTemplateAttribute(attribute.value.value)}"`,
        );
        continue;
      }

      if (
        t.isJSXExpressionContainer(attribute.value) &&
        t.isExpression(attribute.value.expression)
      ) {
        build.slots.push({ kind: "attr", name: attrName, path: [...path] });
        build.values.push(attribute.value.expression);
        // The attribute exists only in the server projection; the client
        // applies it as an initial slot after cloning.
        build.html += "";
        build.segments.push(` ${attrName}="`);
        build.segments.push(build.slots.length - 1);
        build.segments.push('"');
        continue;
      }

      return false;
    }

    writeStatic(build, ">");

    type Child =
      | { kind: "text"; value: string }
      | { kind: "expr"; expression: T.Expression }
      | { kind: "element"; element: T.JSXElement };
    const children: Child[] = [];

    for (const child of element.children) {
      if (t.isJSXText(child)) {
        const value = cleanJsxText(child.value);
        if (value !== "") children.push({ kind: "text", value });
        continue;
      }
      if (t.isJSXExpressionContainer(child)) {
        if (t.isJSXEmptyExpression(child.expression)) continue;
        // A text slot stringifies its value, so only expressions that are
        // provably textual may become one — an identifier or call could
        // evaluate to elements, which have no place inside a template.
        if (
          !t.isExpression(child.expression) ||
          !isTextualExpression(t, child.expression)
        ) {
          return false;
        }
        children.push({ kind: "expr", expression: child.expression });
        continue;
      }
      if (t.isJSXElement(child)) {
        children.push({ kind: "element", element: child });
        continue;
      }
      return false;
    }

    if (voidElements.has(name)) {
      return children.length === 0;
    }

    const hasExpression = children.some((child) => child.kind === "expr");
    if (hasExpression && children.length !== 1) return false;

    let childIndex = 0;
    for (const child of children) {
      if (child.kind === "text") {
        writeStatic(build, escapeTemplateText(child.value));
        childIndex += 1;
        continue;
      }
      if (child.kind === "expr") {
        build.slots.push({ kind: "text", path: [...path, childIndex] });
        build.values.push(child.expression);
        build.html += " ";
        build.segments.push(build.slots.length - 1);
        childIndex += 1;
        continue;
      }
      if (!buildElement(child.element, [...path, childIndex], build)) {
        return false;
      }
      childIndex += 1;
    }

    writeStatic(build, `</${name}>`);
    return true;
  }

  function slotSpecExpression(slot: SlotSpec): T.Expression {
    const properties: T.ObjectProperty[] = [
      t.objectProperty(t.identifier("kind"), t.stringLiteral(slot.kind)),
    ];
    if (slot.name !== undefined) {
      properties.push(
        t.objectProperty(t.identifier("name"), t.stringLiteral(slot.name)),
      );
    }
    properties.push(
      t.objectProperty(
        t.identifier("path"),
        t.arrayExpression(slot.path.map((index) => t.numericLiteral(index))),
      ),
    );
    return t.objectExpression(properties);
  }

  return {
    name: "fig-templates",
    visitor: {
      Program: {
        enter() {
          counter = 0;
        },
        exit(path, state) {
          const templates = (state as { figTemplates?: T.Statement[] })
            .figTemplates;
          if (templates === undefined || templates.length === 0) return;
          path.node.body.unshift(
            t.importDeclaration(
              [
                t.importSpecifier(
                  t.identifier("_figTemplate"),
                  t.identifier("template"),
                ),
                t.importSpecifier(
                  t.identifier("_figElement"),
                  t.identifier("createElement"),
                ),
              ],
              t.stringLiteral("@bgub/fig"),
            ),
            ...templates,
          );
        },
      },
      JSXElement(path: NodePath<T.JSXElement>, state) {
        const build: TemplateBuild = {
          elementCount: 0,
          html: "",
          key: null,
          segments: [],
          slots: [],
          values: [],
        };

        if (!buildElement(path.node, [], build)) return;
        if (build.elementCount < 2) return;

        const id = t.identifier(`_figTmpl$${counter}`);
        counter += 1;

        const declaration = t.variableDeclaration("const", [
          t.variableDeclarator(
            id,
            t.callExpression(t.identifier("_figTemplate"), [
              t.stringLiteral(build.html),
              t.arrayExpression(build.slots.map(slotSpecExpression)),
              t.arrayExpression(
                build.segments.map((segment) =>
                  typeof segment === "string"
                    ? t.stringLiteral(segment)
                    : t.numericLiteral(segment),
                ),
              ),
            ]),
          ),
        ]);

        const holder = state as { figTemplates?: T.Statement[] };
        (holder.figTemplates ??= []).push(declaration);

        const properties: T.ObjectProperty[] = [];
        if (build.key !== null) {
          properties.push(t.objectProperty(t.identifier("key"), build.key));
        }
        properties.push(
          t.objectProperty(
            t.identifier("slots"),
            t.arrayExpression(build.values),
          ),
        );

        const call = t.callExpression(t.identifier("_figElement"), [
          t.cloneNode(id),
          t.objectExpression(properties),
        ]);
        // A template replacing a JSX child of an ineligible JSX parent must
        // stay a valid JSX child: wrap the call in an expression container.
        path.replaceWith(
          t.isJSXElement(path.parent) || t.isJSXFragment(path.parent)
            ? t.jsxExpressionContainer(call)
            : call,
        );
        path.skip();
      },
    },
  };
}

export async function transformTemplates(
  code: string,
  id: string,
): Promise<TemplateTransformResult | null> {
  if (!code.includes("<")) return null;

  const result = await babel.transformAsync(code, {
    babelrc: false,
    configFile: false,
    filename: id,
    sourceMaps: true,
    parserOpts: {
      plugins: ["jsx", "typescript"],
    },
    plugins: [[templatesBabelPlugin, {}]],
  });

  if (result?.code == null || !result.code.includes("_figTemplate")) {
    return null;
  }
  return { code: result.code, map: result.map };
}
