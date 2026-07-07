import type {} from "@bgub/fig/jsx-runtime";
import type { HostIntrinsicElements } from "./jsx.ts";

declare module "@bgub/fig/jsx-runtime" {
  namespace JSX {
    interface IntrinsicElements extends HostIntrinsicElements {}
  }
}
