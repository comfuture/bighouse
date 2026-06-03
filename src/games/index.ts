import { chessGamePlugin, chessDefinition } from "@bighouse/chess/server";
import { gomokuGamePlugin, gomokuDefinition } from "@bighouse/gomoku/server";
import { oneCardGamePlugin, oneCardDefinition } from "@bighouse/onecard/server";
import { cardDemoDefinition, cardDemoGamePlugin } from "./card-demo";
import { registerGamePlugins } from "./registry";

export function registerBuiltInGamePlugins(): void {
  registerGamePlugins([gomokuGamePlugin, cardDemoGamePlugin, oneCardGamePlugin, chessGamePlugin]);
}

export { cardDemoDefinition, chessDefinition, gomokuDefinition, oneCardDefinition };
