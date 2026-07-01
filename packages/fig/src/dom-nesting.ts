const phrasingContainers = "|a|button|p|";

// HTML parser auto-close rules are scoped: these tags reset the "is there an
// open <a>/<button>/<p>?" checks, so e.g. <a><table><td><a> and
// <p><button><div> parse without re-parenting and must not be flagged.
// <button> additionally terminates button scope (the <p> auto-close check).
const scopeTerminators =
  "|applet|caption|desc|foreignobject|html|marquee|object|table|td|template|th|title|";

const pAutoClosingTags =
  "|address|article|aside|blockquote|center|details|dialog|dir|div|dl|fieldset|figcaption|figure|footer|form|h1|h2|h3|h4|h5|h6|header|hgroup|hr|main|menu|nav|ol|p|pre|section|table|ul|";

const headChildren =
  "|base|basefont|bgsound|link|meta|title|noscript|noframes|script|style|template|";

export function validateInstanceNesting(
  type: string,
  ancestors: readonly string[],
): void {
  const child = normalizedTag(type);
  const parent =
    ancestors[0] === undefined ? null : normalizedTag(ancestors[0]);

  if (parent !== null && !validWithParent(child, parent)) {
    throw invalidNestingError(
      `<${child}> cannot be a child of <${parent}>.${hintFor(child, parent)}`,
    );
  }

  const invalidAncestor = invalidAncestorFor(child, ancestors);
  if (invalidAncestor !== null) {
    throw invalidNestingError(
      `<${child}> cannot appear inside <${invalidAncestor}>.`,
    );
  }
}

export function validateTextNesting(
  text: string,
  ancestors: readonly string[],
): void {
  // Whitespace-only text is inserted in place even inside tables ("in table
  // text" mode only foster-parents non-whitespace), so it is harmless.
  if (!/[^ \t\n\r\f]/.test(text)) return;

  const parent =
    ancestors[0] === undefined ? null : normalizedTag(ancestors[0]);
  if (parent === null || validTextWithParent(parent)) return;

  throw invalidNestingError(`text cannot be a child of <${parent}>.`);
}

function validWithParent(child: string, parent: string): boolean {
  switch (parent) {
    case "select":
      return (
        child === "hr" ||
        child === "option" ||
        child === "optgroup" ||
        child === "script" ||
        child === "template"
      );
    case "optgroup":
      return child === "option";
    case "option":
      return false;
    case "tr":
      return child === "th" || child === "td" || scriptLike(child);
    case "tbody":
    case "thead":
    case "tfoot":
      return child === "tr" || scriptLike(child);
    case "colgroup":
      return child === "col" || child === "template";
    case "table":
      return (
        child === "caption" ||
        child === "colgroup" ||
        child === "tbody" ||
        child === "tfoot" ||
        child === "thead" ||
        scriptLike(child)
      );
    case "head":
      return headChild(child);
    case "html":
      return child === "head" || child === "body";
    case "frameset":
      return child === "frame";
  }

  switch (child) {
    case "caption":
    case "col":
    case "colgroup":
    case "tbody":
    case "tfoot":
    case "thead":
    case "tr":
      return parent === "template";
    case "td":
    case "th":
      return parent === "tr" || parent === "template";
    case "option":
      return parent === "datalist" || parent === "template";
    case "optgroup":
      return parent === "template";
    case "head":
    case "body":
    case "frameset":
      return parent === "html" || parent === "template";
    case "frame":
      return parent === "template";
    case "html":
      return false;
  }

  return true;
}

function validTextWithParent(parent: string): boolean {
  // <option> rejects element children but legally contains text.
  return parent === "option" || validWithParent("#text", parent);
}

function invalidAncestorFor(
  child: string,
  ancestors: readonly string[],
): string | null {
  let inScope = true;
  let inButtonScope = true;
  let inListScope = true;
  let inTemplate = false;

  for (const ancestorType of ancestors) {
    const ancestor = normalizedTag(ancestorType);

    if (child === ancestor && tagIn(phrasingContainers, child)) {
      if (child === "p" ? inButtonScope : inScope) return ancestor;
    }
    if (inButtonScope && ancestor === "p" && tagIn(pAutoClosingTags, child)) {
      return ancestor;
    }
    if (inListScope && listItemAncestor(child, ancestor)) return ancestor;
    // The parser's form element pointer ignores scope but resets in templates.
    if (!inTemplate && ancestor === "form" && child === "form") return ancestor;

    if (tagIn(scopeTerminators, ancestor)) {
      if (ancestor === "template") inTemplate = true;
      inScope = false;
      inButtonScope = false;
    } else if (ancestor === "button") {
      inButtonScope = false;
    }
    // li/dd/dt auto-closing sees through address, div, and p only.
    if (ancestor !== "address" && ancestor !== "div" && ancestor !== "p") {
      inListScope = false;
    }
  }

  return null;
}

function listItemAncestor(child: string, ancestor: string): boolean {
  if (child === "li") return ancestor === "li";
  if (child === "dd" || child === "dt") {
    return ancestor === "dd" || ancestor === "dt";
  }
  return false;
}

function normalizedTag(type: string): string {
  return type.toLowerCase();
}

function scriptLike(tag: string): boolean {
  return tag === "script" || tag === "style" || tag === "template";
}

function headChild(tag: string): boolean {
  return tagIn(headChildren, tag);
}

function hintFor(child: string, parent: string): string {
  if (parent === "table" && child === "tr") {
    return " Add a <tbody>, <thead>, or <tfoot>.";
  }

  return "";
}

function invalidNestingError(message: string): Error {
  return new Error(`Invalid DOM nesting: ${message}`);
}

function tagIn(tags: string, tag: string): boolean {
  return tags.includes(`|${tag}|`);
}
