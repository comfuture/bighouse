import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: "./wrangler.jsonc"
      }
    })
  ],
  test: {
    exclude: [...configDefaults.exclude, "packages/ui/test/**"],
    setupFiles: ["./test/setup.ts"],
    provide: {
      d1Migrations: await readD1Migrations("./migrations")
    }
  }
});
