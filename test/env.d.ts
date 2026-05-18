import type { Env as AppEnv } from "../src/types";

declare module "cloudflare:test" {
  interface ProvidedEnv extends AppEnv {}
}

declare global {
  namespace Cloudflare {
    interface Env extends AppEnv {}
  }
}

declare module "vitest" {
  export interface ProvidedContext {
    d1Migrations: Array<{ name: string; queries: string[] }>;
  }
}

export {};
