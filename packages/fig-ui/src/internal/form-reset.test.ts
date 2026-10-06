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
