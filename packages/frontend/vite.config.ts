import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import ui from "@nuxt/ui/vite";

export default defineConfig({
  plugins: [
    vue(),
    ui({
      ui: { colors: { primary: "green", neutral: "zinc" } }
    })
  ],
  server: {
    proxy: {
      "/games": "http://localhost:8787",
      "/rooms": "http://localhost:8787",
      "/matchmaking": "http://localhost:8787"
    }
  },
  build: {
    target: "es2022",
    sourcemap: true
  }
});
