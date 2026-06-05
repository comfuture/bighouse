import { chessGamePlugin, chessDefinition } from "@bighouse/chess/server";
import { gomokuGamePlugin, gomokuDefinition } from "@bighouse/gomoku/server";
import { oneCardGamePlugin, oneCardDefinition } from "@bighouse/onecard/server";
import { registerGamePlugins } from "./registry";

export function registerBuiltInGamePlugins(): void {
  registerGamePlugins([gomokuGamePlugin, oneCardGamePlugin, chessGamePlugin]);
}

export { chessDefinition, gomokuDefinition, oneCardDefinition };
export { cardDemoDefinition } from "./card-demo";
