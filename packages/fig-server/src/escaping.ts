export function escapeText(value: string): string {
  return value.replace(/[&<>]/g, (character) => {
    if (character === "&") return "&amp;";
    if (character === "<") return "&lt;";
    return "&gt;";
  });
}

export function escapeAttribute(value: string): string {
  return value.replace(/[&"<>]/g, (character) => {
    if (character === "&") return "&amp;";
    if (character === '"') return "&quot;";
    if (character === "<") return "&lt;";
    return "&gt;";
  });
}

// Script elements are raw-text elements: HTML entities are not decoded in
// their contents, so escape only characters that can terminate the element
// or executable source.
export function escapeScriptText(value: string): string {
  return value
    .replaceAll("<", "\\u003C")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

export function escapeScriptJson(value: unknown): string {
  return escapeScriptText(JSON.stringify(value));
}
