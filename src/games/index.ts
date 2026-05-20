import { gomokuGamePlugin, gomokuDefinition } from "@bighouse/gomoku/server";
import { oneCardGamePlugin, oneCardDefinition } from "@bighouse/onecard/server";
import { cardDemoDefinition, cardDemoGamePlugin } from "./card-demo";
import { registerGamePlugins } from "./registry";

export function registerBuiltInGamePlugins(): void {
  registerGamePlugins([gomokuGamePlugin, cardDemoGamePlugin, oneCardGamePlugin]);
}

export { cardDemoDefinition, gomokuDefinition, oneCardDefinition };
