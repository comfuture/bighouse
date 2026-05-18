import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: "./wrangler.jsonc"
      }
    })
  ],
  test: {
    setupFiles: ["./test/setup.ts"],
    provide: {
      d1Migrations: await readD1Migrations("./migrations")
    }
  }
});
