import "./assets/main.css";
import { createApp } from "vue";
import ui from "@nuxt/ui/vue-plugin";
import App from "./App.vue";
import { installElasticPointerFeedback } from "./elastic-hover";
import { router } from "./router";

installElasticPointerFeedback();
createApp(App).use(router).use(ui).mount("#app");
