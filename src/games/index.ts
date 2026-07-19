import { chessGamePlugin, chessDefinition } from "@bighouse/chess/server";
import { gomokuGamePlugin, gomokuDefinition } from "@bighouse/gomoku/server";
import { oneCardGamePlugin, oneCardDefinition } from "@bighouse/onecard/server";
import { tankBattleGamePlugin, tankBattleDefinition } from "@bighouse/tank-battle/server";
import { registerGamePlugins } from "./registry";

export function registerBuiltInGamePlugins(): void {
  registerGamePlugins([gomokuGamePlugin, oneCardGamePlugin, chessGamePlugin, tankBattleGamePlugin]);
}

export { chessDefinition, gomokuDefinition, oneCardDefinition, tankBattleDefinition };
export { cardDemoDefinition } from "./card-demo";
