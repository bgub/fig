// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { createFormReset } from "./form-reset.ts";
afterEach(() => document.body.replaceChildren());

it("delivers a reset across synchronous binding replacement", async () => {
  const form = document.createElement("form");
  const input = document.createElement("input");
  form.append(input);
  document.body.append(form);
  const reset = vi.fn();
  const registry = createFormReset(reset);
  const first = new AbortController();
  const second = new AbortController();
  registry.bind(input, first.signal);
  form.reset();
  first.abort();
  registry.bind(input, second.signal);
  await Promise.resolve();
  expect(reset).toHaveBeenCalledOnce();
  second.abort();
});

it("does not deliver a queued reset after the last input unmounts", async () => {
  const form = document.createElement("form");
  const input = document.createElement("input");
  form.append(input);
  document.body.append(form);
  const reset = vi.fn();
  const registry = createFormReset(reset);
  const binding = new AbortController();
  registry.bind(input, binding.signal);
  form.reset();
  binding.abort();
  input.remove();
  await Promise.resolve();
  expect(reset).not.toHaveBeenCalled();
});

it("follows a new form owner without replacing the host lifetime", async () => {
  const first = document.createElement("form"),
    second = document.createElement("form");
  first.id = "first";
  second.id = "second";
  const input = document.createElement("input");
  document.body.append(first, second, input);
  input.setAttribute("form", "first");
  const reset = vi.fn(),
    registry = createFormReset(reset),
    lifetime = new AbortController();
  registry.bind(input, lifetime.signal);
  input.setAttribute("form", "second");
  registry.bind(input, lifetime.signal);
  first.reset();
  await Promise.resolve();
  expect(reset).not.toHaveBeenCalled();
  second.reset();
  await Promise.resolve();
  expect(reset).toHaveBeenCalledOnce();
  lifetime.abort();
});

it("does not multiply reset callbacks when committed input configuration changes", async () => {
  const form = document.createElement("form"),
    input = document.createElement("input");
  form.append(input);
  document.body.append(form);
  const reset = vi.fn(),
    registry = createFormReset(reset),
    lifetime = new AbortController();
  for (let update = 0; update < 10; update++)
    registry.bind(input, lifetime.signal);
  form.reset();
  await Promise.resolve();
  expect(reset).toHaveBeenCalledOnce();
  lifetime.abort();
});

it("observes cancellation by later native reset listeners", async () => {
  const form = document.createElement("form"),
    input = document.createElement("input");
  form.append(input);
  document.body.append(form);
  const reset = vi.fn(),
    registry = createFormReset(reset),
    lifetime = new AbortController();
  registry.bind(input, lifetime.signal);
  form.addEventListener("reset", (event) => event.preventDefault());
  form.reset();
  await Promise.resolve();
  expect(reset).not.toHaveBeenCalled();
  lifetime.abort();
});
