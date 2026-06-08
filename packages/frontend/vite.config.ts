import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import ui from "@nuxt/ui/vite";

export default defineConfig({
  plugins: [
    vue(),
    ui({
      ui: {
        colors: {
          primary: "blue",
          secondary: "yellow",
          success: "green",
          info: "sky",
          warning: "amber",
          error: "red",
          neutral: "slate"
        },
        button: {
          slots: {
            base: "game-plastic-button rounded-2xl ring-2 ring-inset ring-default/80 font-bold transition-[transform,box-shadow,background-color] duration-150 hover:-translate-y-0.5 active:translate-y-0.5"
          }
        },
        card: {
          slots: {
            root: "game-plastic-surface rounded-3xl ring-2 ring-default/80",
            header: "p-4 sm:px-6 border-b-2 border-default/70",
            body: "p-4 sm:p-6",
            footer: "p-4 sm:px-6 border-t-2 border-default/70"
          }
        },
        pageCard: {
          slots: {
            root: "game-plastic-card rounded-3xl ring-2 ring-default/80 overflow-hidden",
            container: "p-4 sm:p-5",
            title: "text-lg font-black tracking-normal text-highlighted",
            description: "text-sm font-medium text-toned",
            footer: "pt-5 mt-auto"
          }
        },
        pageHeader: {
          slots: {
            root: "game-portal-hero rounded-[2rem] border-2 border-default/80 px-5 py-6 sm:px-7 sm:py-8",
            title: "text-3xl sm:text-4xl font-black tracking-normal text-highlighted",
            description: "text-base sm:text-lg font-semibold text-toned"
          }
        },
        badge: {
          slots: {
            base: "game-plastic-badge rounded-full ring-2 ring-inset font-black uppercase tracking-normal"
          }
        },
        input: {
          slots: {
            base: "game-plastic-input rounded-2xl ring-2 ring-inset ring-default/80 font-semibold"
          }
        },
        modal: {
          slots: {
            content: "game-plastic-surface rounded-[1.75rem] ring-2 ring-default/80",
            header: "border-b-2 border-default/70",
            footer: "border-t-2 border-default/70"
          }
        },
        alert: {
          slots: {
            root: "game-plastic-surface rounded-3xl ring-2 ring-default/80"
          }
        }
      }
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
