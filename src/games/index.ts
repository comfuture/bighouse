import { gomokuGamePlugin, gomokuDefinition } from "@bighouse/gomoku/server";
import { cardDemoDefinition, cardDemoGamePlugin } from "./card-demo";
import { registerGamePlugins } from "./registry";

export function registerBuiltInGamePlugins(): void {
  registerGamePlugins([gomokuGamePlugin, cardDemoGamePlugin]);
}

export { cardDemoDefinition, gomokuDefinition };
