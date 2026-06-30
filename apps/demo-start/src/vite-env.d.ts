declare module "virtual:fig-start/client-manifest" {
  export function loadClientReference(metadata: {
    id: string;
  }): Promise<unknown>;
}
