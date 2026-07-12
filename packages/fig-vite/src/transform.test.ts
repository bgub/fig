import { describe, expect, it } from "vitest";
import { transformModule } from "./transform.ts";

describe("@bgub/fig-vite transform", () => {
  it("injects registration, signature, and an HMR boundary for a component", async () => {
    const source = `import { useState } from "@bgub/fig";
export function Counter() {
  const [n, setN] = useState(0);
  return <div>{n}</div>;
}`;

    const out = await transformModule(source, "/app/Counter.tsx");
    expect(out).not.toBeNull();
    const code = out!.code;

    expect(code).toContain("virtual:fig-refresh");
    expect(code).toContain("__figReg(Counter,");
    expect(code).toContain("/app/Counter.tsx#Counter");
    // hook signature captured
    expect(code).toContain('__figSig(Counter, "useState")');
    // self-accepting HMR boundary
    expect(code).toContain("import.meta.hot.accept()");
    expect(code).toContain("__figRefresh()");
  });

  it("handles arrow-function components", async () => {
    const source = `import { useState } from "@bgub/fig";
export const Panel = () => {
  const [open, setOpen] = useState(false);
  return <section>{open ? "y" : "n"}</section>;
};`;

    const out = await transformModule(source, "/app/Panel.tsx");
    expect(out?.code).toContain("__figReg(Panel,");
    expect(out?.code).toContain('__figSig(Panel, "useState")');
  });

  it("includes top-level custom hook internals in component signatures", async () => {
    const source = `import { useMemo, useState } from "@bgub/fig";
function useCounter() {
  useState(0);
  useMemo(() => 1, []);
}
export function Counter() {
  useCounter();
  return <button />;
}`;

    const out = await transformModule(source, "/app/Counter.tsx");
    expect(out).not.toBeNull();
    const code = out!.code;

    expect(code).toContain("__figReg(Counter,");
    expect(code).not.toContain("__figReg(useCounter,");
    expect(code).toContain(
      '__figSig(Counter, "useCounter\\n>useState\\n>useMemo")',
    );
  });

  it("includes namespace hook calls in component signatures", async () => {
    const source = `import * as Fig from "@bgub/fig";
export function Counter() {
  const [n, setN] = Fig.useState(0);
  Fig.useMemo(() => n, [n]);
  return <button>{n}</button>;
}`;

    const out = await transformModule(source, "/app/Counter.tsx");
    expect(out).not.toBeNull();
    expect(out!.code).toContain('__figSig(Counter, "useState\\nuseMemo")');
  });

  it("force-resets components that call imported custom hooks", async () => {
    const source = `import { useThing } from "./hooks";
export function Counter() {
  useThing();
  return <button />;
}`;

    const out = await transformModule(source, "/app/Counter.tsx");
    expect(out).not.toBeNull();
    expect(out!.code).toContain('__figSig(Counter, "useThing", true)');
  });

  it("does not self-accept modules that export non-component values", async () => {
    const source = `export const answer = 42;
export function Counter() {
  return <div />;
}`;

    const out = await transformModule(source, "/app/mixed.tsx");
    expect(out).not.toBeNull();
    expect(out?.code).toContain("__figReg(Counter,");
    expect(out?.code).not.toContain("import.meta.hot.accept()");
    expect(out?.code).not.toContain("__figRefresh()");
  });

  it("strips TypeScript types while preserving JSX", async () => {
    const source = `type Props = { label: string };
export function Badge(props: Props) {
  return <span>{props.label}</span>;
}`;

    const out = await transformModule(source, "/app/Badge.tsx");
    expect(out?.code).not.toContain("type Props");
    expect(out?.code).toContain("<span>");
    expect(out?.code).toContain("__figReg(Badge,");
  });

  it("returns null for modules with no components", async () => {
    const source = `export const value = 42;
export function helper() {
  return value + 1;
}`;
    expect(await transformModule(source, "/app/util.ts")).toBeNull();
  });
});
