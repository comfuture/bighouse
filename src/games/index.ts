import { cardDemoDefinition } from "./card-demo";
import { gomokuDefinition } from "./gomoku";
import { registerGame } from "./registry";

registerGame(gomokuDefinition);
registerGame(cardDemoDefinition);

export { cardDemoDefinition, gomokuDefinition };
