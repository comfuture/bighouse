import { yutnoriGamePlugin, yutnoriDefinition } from "@bighouse/yutnori/server";
import { chessGamePlugin, chessDefinition } from "@bighouse/chess/server";
import { gomokuGamePlugin, gomokuDefinition } from "@bighouse/gomoku/server";
import { indianPokerGamePlugin, indianPokerDefinition } from "@bighouse/indian-poker/server";
import { oneCardGamePlugin, oneCardDefinition } from "@bighouse/onecard/server";
import { sunnyMeadowGamePlugin, sunnyMeadowDefinition } from "@bighouse/sunny-meadow/server";
import { tankBattleGamePlugin, tankBattleDefinition } from "@bighouse/tank-battle/server";
import { registerGamePlugins } from "./registry";

export function registerBuiltInGamePlugins(): void {
  registerGamePlugins([
    sunnyMeadowGamePlugin,
    yutnoriGamePlugin,
    gomokuGamePlugin,
    oneCardGamePlugin,
    chessGamePlugin,
    tankBattleGamePlugin,
    indianPokerGamePlugin
  ]);
}

export {
  chessDefinition,
  gomokuDefinition,
  indianPokerDefinition,
  oneCardDefinition,
  sunnyMeadowDefinition,
  tankBattleDefinition
};
export { cardDemoDefinition } from "./card-demo";

export { yutnoriDefinition };
