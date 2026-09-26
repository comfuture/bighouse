# Building Online Games with Bighouse

This guide explains how to build online multiplayer games on top of Bighouse. Bighouse keeps the network flow consistent across games, while each game implements its own rules, state visibility, validation, and winner logic through a `GameDefinition` adapter.

## 1. Basic Flow

The client flow is the same for every game.

1. Call `GET /games` to list games registered in the current Worker build.
2. Enter a game lobby route in the SPA: `/game/:gameId/:mode`.
3. If no saved `playerId` exists, collect player information in the modal before any lobby or room WebSocket is opened.
4. List waiting rooms with `GET /games/:gameId/lobbies/:mode/rooms`.
5. Create a room or join a waiting room.
6. Connect to the room WebSocket and render the current `snapshot`.
7. Non-host players send `ready`.
8. When the selected mode's player limits are satisfied and every non-host player is ready, the host sends `startGame`. Fixed-size modes require exactly their advertised player count.
9. Send game input as `action` messages after the room becomes `active`.
10. Apply `ack`, `event`, `privateEvent`, `chat`, `presence`, and `error` messages from the server.

Create a lobby room:

```sh
curl -X POST https://bighouse.comfuture.workers.dev/games/gomoku/lobbies/default/rooms \
  -H 'content-type: application/json' \
  -d '{"playerId":"p1","displayName":"Alice"}'
```

List lobby rooms:

```sh
curl https://bighouse.comfuture.workers.dev/games/gomoku/lobbies/default/rooms
```

Join a room:

```sh
curl -X POST https://bighouse.comfuture.workers.dev/rooms/room_id/join \
  -H 'content-type: application/json' \
  -d '{"playerId":"p2","displayName":"Bob"}'
```

Matchmaking ticket:

```sh
curl -X POST https://bighouse.comfuture.workers.dev/games/gomoku/matchmaking/tickets \
  -H 'content-type: application/json' \
  -d '{"playerId":"p1","mode":"ranked","region":"apac","skill":"beginner"}'
```

If the first player is queued, poll the ticket until `ticket.status` becomes `matched`. The response includes `wsUrl` after the room is ready:

```sh
curl https://bighouse.comfuture.workers.dev/matchmaking/tickets/ticket_id
```

Room WebSocket URL:

```text
wss://bighouse.comfuture.workers.dev/rooms/room_id/ws?playerId=p1
```

Room SPA URL:

```text
https://bighouse.comfuture.workers.dev/game/gomoku/room_id
```

Lobby WebSocket URL:

```text
wss://bighouse.comfuture.workers.dev/games/gomoku/lobbies/default/ws?playerId=p1&displayName=Alice
```

`playerId` only needs to be a stable unique value for the player. It can be an internal account id, anonymous session id, wallet address, device-scoped id, or any other stable identifier. For UI and chat, also send a human-readable `displayName`. Do not use `displayName` as identity or authorization data; it is only a display label.

The SPA stores `playerId`, `displayName`, and lobby `mode` locally after the player information modal is submitted. If a user opens a shared room URL such as `/game/gomoku/room_abc` without saved player information, the modal is shown first and the room WebSocket is not opened until `playerId` is available.

## 2. Durable Object WebSocket Contract

Bighouse room and lobby sockets use Cloudflare Durable Objects WebSocket Hibernation. A hibernated room or lobby can be evicted from memory while clients stay connected, then rebuilt when a message, close, error, request, or alarm arrives.

Client rules:

- Include `playerId` in the WebSocket URL whenever it is known. The server uses it to attach a player tag at `ctx.acceptWebSocket()` time for efficient targeted snapshots, private chat, and presence.
- Send `displayName` in the URL when available, or in `hello` / `joinRoom` after opening.
- Treat every `snapshot` as authoritative. After reconnect or hibernation wakeup, replace local room state from the latest snapshot instead of replaying local assumptions.
- Use `hello` for lobby identity refresh or reconnect when the URL did not include identity.
- Use `joinRoom` for room identity refresh, reconnect, or direct shared-room entry.
- Send either a raw string `ping` for automatic hibernation-friendly `pong`, or a JSON `ping` when the client needs a typed `pong` with a `nonce`.

Server rules:

- Only WebSocket attachment data and Durable Object storage survive hibernation. Do not depend on in-memory socket maps in game code.
- WebSocket tags are assigned only when the socket is accepted. If identity arrives later through `hello` or `joinRoom`, Bighouse falls back to attachment-based socket lookup.
- Room state, processed action ids, events, timers, chat, and result summaries are persisted before broadcasting derived messages.

## 3. Client Message Contract

Clients send JSON messages after opening a WebSocket.

Initial identity or reconnect:

```json
{
  "type": "hello",
  "playerId": "p1",
  "displayName": "Alice"
}
```

Game action:

```json
{
  "type": "action",
  "playerId": "p1",
  "clientActionId": "move-1",
  "expectedVersion": 2,
  "action": {
    "type": "placeStone",
    "payload": { "x": 0, "y": 0 }
  }
}
```

Ready:

```json
{
  "type": "ready",
  "playerId": "p2",
  "ready": true
}
```

Transfer host authority:

```json
{
  "type": "transferHost",
  "playerId": "p1",
  "targetPlayerId": "p2"
}
```

Start game:

```json
{
  "type": "startGame",
  "playerId": "p1"
}
```

Public chat:

```json
{
  "type": "chat",
  "playerId": "p1",
  "body": "hello"
}
```

Private chat:

```json
{
  "type": "chat",
  "playerId": "p1",
  "targetPlayerId": "p2",
  "body": "I will leave after this turn"
}
```

Important fields:

- `clientActionId`: makes retries idempotent for the same player.
- `expectedVersion`: the room version the client based the action on. If it does not match the current server version, the server rejects the action as stale.
- `action.type`: the game-specific command interpreted by the adapter.
- `action.payload`: the game-specific command data.
- `ready`: only changes state while a room is waiting. The host does not need a Ready control; readiness is required from the non-host players.
- `startGame`: only the current host can start, and only after the selected mode's player limits are satisfied and every non-host player is ready.
- `transferHost`: only the current host can delegate host authority to another room player.
- `targetPlayerId`: used only for individual private chat. Without it, chat defaults to public unless `channel: "team"` is explicitly selected. Team chat additionally requires `expectedTeam` and cannot combine with an individual target; see section 13.

Every server message includes `roomId`, `version`, and `serverTime`. Clients should replace their local room model on `snapshot`, then incrementally apply `event`, `privateEvent`, and `chat`.

## 4. Frontend Package Layout

The browser frontend is split by responsibility.

`packages/frontend`

- Owns the game list, identity inputs, lobby room list, room creation/join, lobby chat, room WebSocket lifecycle, QR sharing, reconnect, and guarded room navigation.
- It should not import every game package statically.
- It maps `gameId` to a dynamic import and loads a game bundle only after the player enters a matching room.
- SPA screen routes are intentionally separate from API routes: `/`, `/game/:gameId/:mode`, and `/game/:gameId/:roomId`. The room route opts out of the centered portal shell and mounts the selected package as an immersive surface. Room ids currently use the `room_` prefix, so `/game/gomoku/default` is the default gomoku lobby while `/game/gomoku/room_abc` is a gomoku room.

`packages/ui`

- Exports framework-free Web Components for waiting/start/bot controls, in-game chat, and lifecycle dialogs.
- Uses DOM events and CSS custom properties so plain DOM games and canvas-backed games can share behavior without depending on Vue or Nuxt UI.
- Is consumed inside each game package's `mountGame()` implementation; it does not impose one shared board or canvas layout.

`packages/gomoku`

- Owns the gomoku board renderer and client-side move blocking.
- It consumes `snapshot.payload.publicView` and `snapshot.payload.privateView`.
- It sends user input back as `action` messages; it never mutates authoritative state directly.

The deployment uses Worker static assets from `packages/frontend/dist`, while API and WebSocket paths still run through the Worker first:

```jsonc
{
  "assets": {
    "directory": "./packages/frontend/dist",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/games", "/games/*", "/rooms/*", "/matchmaking/*"]
  }
}
```

Use this pattern for new games: create a package under `packages/<game-id>`, export a `mountGame()` implementation that accepts the complete `GameClientContext`, consume `@bighouse/ui` inside the package-owned surface, and add a dynamic loader entry in `packages/frontend/src/game-plugins.ts`.

## 5. Lobby Chat and Room Chat

Bighouse has two chat scopes.

`lobby` chat:

- URL: `/games/:gameId/lobbies/:mode/ws`
- Use this when players are in the same game/mode lobby but not necessarily in the same room.
- `LobbyDO` owns the WebSocket connections and chat broadcast for that `gameId` and `mode`.
- Public chat is delivered to every connected socket in the lobby.
- Private chat is delivered only to `targetPlayerId` and the sender.

`room` chat:

- URL: `/rooms/:roomId/ws`
- Use this during actual gameplay inside a room.
- `RoomDO` handles chat on the same WebSocket as game actions.
- Public chat is delivered to every room participant.
- Private chat is delivered only to `targetPlayerId` and the sender.
- A room private chat target must be a player in the same room.

Server chat message:

```json
{
  "type": "chat",
  "roomId": "room_abc",
  "version": 2,
  "serverTime": 1779090000000,
  "payload": {
    "message": {
      "id": "chat_abc",
      "scope": "room",
      "scopeId": "room_abc",
      "visibility": "private",
      "playerId": "p1",
      "displayName": "Alice",
      "targetPlayerId": "p2",
      "body": "private message",
      "createdAt": 1779090000000
    }
  }
}
```

Keep chat separate from game events. `event` and `privateEvent` are consequences of game rules. `chat` is player communication. For example, playing `"AS"` in a card game is a `card.played` public event; saying "I will play AS" is a chat message.

## 6. Public State and Private State

Bighouse room state has three major layers.

`stageState`

- Room-level state such as board, current turn, round, timer, deck count, or discard pile.
- It does not have to be fully public.
- `getPublicView()` selects the safe public projection sent to clients.

`playerStates`

- Per-player state.
- Use this for hands, secret objectives, hidden resources, private buffs, or anything other players must not see.
- `getPrivateView(context, playerId)` returns only that player's private projection.

`events`

- Messages that tell clients what changed.
- Each event has `visibility: "public" | "private" | "system"`.
- `public` and `system` events go to all players. `private` events go only to the specified `playerId`.

This separation is the most important rule when implementing online games. The server may hold complete authoritative state internally, but every view and event sent to clients must be filtered according to the game rules.

## 7. Gomoku: Public Global State

Games like gomoku, go, chess, and checkers usually show the same board to every player. Most of their `stageState` can be public.

Current `gomoku` public view:

```json
{
  "boardSize": 15,
  "board": [[null, "black", null]],
  "currentPlayerId": "p2",
  "turnDeadline": 1779089650000,
  "moveCount": 1,
  "lastMove": {
    "playerId": "p1",
    "x": 7,
    "y": 7,
    "stone": "black"
  },
  "winnerPlayerId": null
}
```

The player's private view is small:

```json
{
  "stone": "black"
}
```

Use these rules for this game type:

- Store the authoritative board state in `stageState`.
- Include board, current turn, deadline, and winner in `getPublicView()`.
- Store only player-specific labels, seat-derived roles, or personal settings in `playerStates`.
- Broadcast moves, captures, score changes, and winner declarations as public or system events.
- Validate occupied cells, turn ownership, stale versions, and double-three moves on the server before applying a move.
- Mirror safe validation in the browser to disable blocked cells immediately, but treat this only as UX. The server remains authoritative.
- Expose `lastMove` in the public view so both players can see the latest stone highlight.
- Compute the winner on the server by scanning horizontal, vertical, and diagonal five-in-a-row lines after every accepted move.

Gomoku action:

```json
{
  "type": "action",
  "playerId": "p1",
  "clientActionId": "gomoku-1",
  "expectedVersion": 2,
  "action": {
    "type": "placeStone",
    "payload": { "x": 7, "y": 7 }
  }
}
```

Public event:

```json
{
  "type": "event",
  "payload": {
    "event": {
      "type": "gomoku.stonePlaced",
      "visibility": "public",
      "payload": {
        "playerId": "p1",
        "x": 7,
        "y": 7,
        "stone": "black"
      }
    }
  }
}
```

The client implementation can be simple: render `snapshot.payload.publicView.board`, disable illegal empty cells, highlight `snapshot.payload.publicView.lastMove`, then update from the next `snapshot` or `gomoku.stonePlaced` event.

## 8. Card Games: Hidden Player State

Games like poker, one-card, rummy, or board games with secret objectives must strictly separate `stageState` and `playerStates`.

Current `card-demo` public view:

```json
{
  "discardPile": ["AS"],
  "deckCount": 39,
  "currentPlayerId": "p2",
  "round": 1,
  "hands": {
    "p1": { "count": 2 },
    "p2": { "count": 3 }
  }
}
```

Private view for player `p1`:

```json
{
  "hand": ["7H", "3C"]
}
```

Other players never receive `p1`'s real `hand`. The public view exposes only hand counts.

Use these rules for this game type:

- Put only public table state in `stageState`: discard pile, deck count, current turn, round, visible stacks, public bets, or table cards.
- Put hidden state in `playerStates[playerId]`: hand, secret picks, hidden score, private resources, or private effects.
- Never return raw private state from `getPublicView()`.
- Return only the requesting player's private projection from `getPrivateView()`.
- Broadcast actions everyone can observe, such as playing a card, as public events.
- Send hidden outcomes, such as drawn card values, as private events.

Play-card action:

```json
{
  "type": "action",
  "playerId": "p1",
  "clientActionId": "play-as",
  "expectedVersion": 2,
  "action": {
    "type": "playCard",
    "payload": { "card": "AS" }
  }
}
```

Public event:

```json
{
  "type": "event",
  "payload": {
    "event": {
      "type": "card.played",
      "visibility": "public",
      "payload": {
        "playerId": "p1",
        "card": "AS"
      }
    }
  }
}
```

A draw-card action should use `privateEvent` for the actual card value:

```json
{
  "type": "privateEvent",
  "payload": {
    "event": {
      "type": "card.drawn",
      "visibility": "private",
      "playerId": "p1",
      "payload": {
        "card": "D39"
      }
    }
  }
}
```

The client should render shared table UI from `publicView`, and update the player's hand UI only from `snapshot.payload.privateView` and `privateEvent`.

### Inverted Visibility: Indian Poker

`indian-poker` is the mirror image of `card-demo`. The secret is the player's *own* card, and every opponent card is public knowledge to everyone except its owner. Private view for player `p1`:

```json
{
  "opponentPlayerId": "p2",
  "opponentCard": "QH",
  "myCard": "hidden",
  "myCardRevealed": false
}
```

Two platform constraints shape that adapter, and both apply to any game with a similar shape:

- **Deal-time state cannot live in `playerStates`.** `RoomDO` builds `stageState` from `initialStageState()` before it builds `playerStates` from `initialPlayerState()`, so a deal that happens at stage-init time has nowhere private to write. `indian-poker` keeps the cards in `stageState.cards`, withholds them from `getPublicView()` until the round is revealed, and masks the requesting player's own entry in `getPrivateView()`. Storing secrets in `stageState` is only acceptable with that filtering in place.
- **`getPublicView().currentPlayerId` drives bot scheduling.** `RoomDO` only schedules a `bot_turn` when that field names a bot, so any sub-phase that waits on player input has to advertise a pending player. `indian-poker` has a round-over handshake where both players must send `nextRound`, so its public `currentPlayerId` points at whoever still owes a request. Without that, a bot would never acknowledge a finished round and the table would stall. A bot's `selectBotAction()` must also return `null` once it has already acted in that sub-phase, or the timer reschedules forever.

## 9. Adding a New Game

Add a game as a package-owned plugin. A game package should export server rules from a Worker-safe entrypoint, browser UI from a browser-only entrypoint, and fixed-name metadata as `gameMetadata`.

Minimum server entrypoint:

```ts
import { defineGameDefinition } from "@bighouse/game-sdk/server";

export const gameMetadata = {
  gameId: "my-game",
  adapterKey: "my-game",
  displayName: "My Game",
  description: "Short game-list description.",
  minPlayers: 2,
  maxPlayers: 4
};

export const gameDefinition = defineGameDefinition(gameMetadata, {
  initialStageState(context) {
    return {};
  },
  initialPlayerState(player, context) {
    return {};
  },
  validateAction(context, action) {
    return { ok: true };
  },
  applyAction(context, action) {
    return { state: context.state, events: [] };
  },
  getPublicView(context) {
    return {};
  },
  getPrivateView(context, playerId) {
    return {};
  },
  nextTimers(context) {
    return [];
  }
});

export const myGamePlugin = {
  gameMetadata,
  gameDefinition
};
```

Minimum browser entrypoint:

```ts
import type { GameClientContext, MountedGameClient } from "@bighouse/game-sdk/client";
import thumbnailUrl from "./assets/thumbnail.png?url";
import { baseGameMetadata } from "./metadata";

export const gameMetadata = {
  ...baseGameMetadata,
  thumbnail: {
    src: thumbnailUrl,
    alt: "My game thumbnail"
  }
};

export function mountGame(container: HTMLElement, context: GameClientContext): MountedGameClient {
  container.textContent = `Version ${context.version}`;
  return {
    update(nextContext) {
      container.textContent = `Version ${nextContext.version}`;
    },
    destroy() {
      container.innerHTML = "";
    }
  };
}
```

Register the server plugin from the Worker build:

```ts
import { myGamePlugin } from "@bighouse/my-game/server";
import { registerGamePlugins } from "./registry";

registerGamePlugins([myGamePlugin]);
```

Register the browser client in the frontend plugin registry:

```ts
const clientGamePlugins = {
  [myGameMetadata.gameId]: {
    metadata: myGameMetadata,
    load: () => import("@bighouse/my-game/client")
  }
};
```

`GET /games` returns the server plugins registered in the current Worker build. D1 does not own the public game list; the frontend may merge matching client metadata, such as a Vite asset URL for `thumbnail.src`, before rendering the game list.

## 10. Adapter Design Checklist

Answer these questions before implementing a game:

- Can every player see the complete global state?
- Does any player have private state?
- Which outputs are public events, private events, and system events?
- What must be checked before applying an action: turn, resources, hand ownership, position, timer, phase, or status?
- What should the client do when `expectedVersion` is stale?
- Can a reconnecting player fully restore their UI from `publicView` plus their own `privateView`?
- What result should be persisted to D1 `room_index` and `match_results` when the game ends?

State placement:

| Information | Location | Exposure |
| --- | --- | --- |
| Gomoku board, current turn, winner | `stageState` | Include in `getPublicView()` |
| Card discard pile, deck count, round | `stageState` | Include in `getPublicView()` |
| Hand, secret objective, hidden resources | `playerStates[playerId]` | Include only in `getPrivateView()` |
| Move, visible card play, winner declaration | `GameEvent` | `visibility: "public"` or `"system"` |
| Drawn card value, private reward | `GameEvent` | `visibility: "private"` plus `playerId` |

## 11. Recommended Client Model

Keep room state split on the client:

```ts
type ClientRoomModel = {
  roomId: string;
  version: number;
  players: Array<{ playerId: string; seat: number; connected: boolean }>;
  publicView: Record<string, unknown>;
  privateView: Record<string, unknown>;
  chat: Array<{
    scope: "lobby" | "room";
    visibility: "public" | "private" | "team";
    teamId?: string;
    playerId: string;
    displayName?: string;
    targetPlayerId?: string;
    body: string;
  }>;
};
```

Handling rules:

- `snapshot`: replace the local room model.
- `event`: apply to public game UI or append to an event log.
- `privateEvent`: apply only to the current player's private UI.
- `chat`: append to lobby or room chat UI based on `scope` and `visibility`.
- `ack`: confirm optimistic UI.
- `error` with `stale_action`: wait for or request a fresh snapshot.
- `presence`: update connected state.

Use server `version` as the synchronization point. When sending an action, set `expectedVersion` to the version that the player actually saw when choosing the action.

## 12. Practical Test Scenarios

Operational cleanup:

- The deployed Worker runs a cron trigger every five minutes.
- The cleanup scan starts from D1 `room_index` rows that are still `open`, `matching`, or `active`.
- A candidate is closed only after its authoritative `RoomDO` verifies that no live WebSocket clients remain and the room has been idle long enough.
- Waiting and matching rooms use a short stale threshold; active rooms use a longer grace period to allow reconnects.
- Closed stale rooms are removed from lobby lists and direct `/rooms/:roomId/join` or `/rooms/:roomId/ws` attempts are rejected.

Check the deployed game list:

```sh
curl https://bighouse.comfuture.workers.dev/games
```

For gomoku:

- Join two players into the same room.
- Send a `placeStone` action.
- Expect every player to receive the same `gomoku.stonePlaced` public event.

For card games:

- Join two players into the same room.
- Compare their snapshots.
- `publicView.hands.p1.count` should be visible.
- `publicView` must not contain real hand values like `"AS"`.
- `p1.privateView.hand` should contain only `p1`'s hand.
- If `p1` plays `"AS"`, the card value becomes visible through the public `card.played` event.

For chat:

- Connect multiple players to the same lobby WebSocket.
- A `chat` message without `targetPlayerId` must arrive at every lobby connection.
- A `chat` message with `targetPlayerId` must arrive only at the sender and target player.
- Repeat the same checks on room WebSockets.
- Connect lobby and room WebSockets without URL identity, bind with `hello` or `joinRoom`, then verify private chat and targeted events still reach that socket.
- Send lobby chat with a `playerId` that does not match the socket attachment and verify the server returns `forbidden`.
- Send a raw string `ping` to lobby and room sockets and verify a `pong` is returned without requiring a JSON handler.
- Room private chat targets must be players in the same room.


## 13. Modes, Teams, and Transient Game Signals

`packages/yutnori` demonstrates a public board game with team-only communication. Its exact Korean rules and UI behavior are documented in [Yutnori](yutnori.md). The reusable contracts live in `packages/game-sdk/src/server.ts` and `packages/game-sdk/src/client.ts`.

### Fixed-size modes and bots

Metadata may declare modes and bot support:

```ts
{
  gameId: "yutnori",
  minPlayers: 2,
  maxPlayers: 4,
  modes: [
    { id: "solo", displayName: "2인 개인전", minPlayers: 2, maxPlayers: 2 },
    { id: "team-2v2", displayName: "2:2 팀전", minPlayers: 4, maxPlayers: 4 }
  ],
  supportsBots: false
}
```

The portal and lobby offer explicit mode links. `resolvePlayerLimits()` rejects unrecognized modes and forged limits that differ from the selected mode. Lobby creation, direct room initialization, and matchmaking use these limits; start/restart/rematch cannot start a partially populated fixed-size game. Games without `modes` retain their existing mode handling. `supportsBots: false` suppresses the shared bot controls and rejects bot creation on the server.

### Server-owned team membership

A team game supplies the optional adapter hook:

```ts
getTeams(context): Array<{
  teamId: string;
  displayName: string;
  playerIds: string[];
}>;
```

The server includes sanitized `teams` in room snapshots, mapped to `GameClientRoom.teams` in the browser. `roomTeams()` excludes departed players and fails closed on duplicate team ids or ambiguous membership. Clients use these teams for labels and channel availability; client payloads do not assign team membership. For Yutnori, waiting-room membership is derived from current seat order, and starting a new game fixes the active teams.

### Structured move suggestions

The optional `GameClientActions.sendSignal()` sends a `gameSignal` envelope:

```json
{
  "type": "gameSignal",
  "playerId": "p3",
  "signal": {
    "type": "suggestMove",
    "payload": {
      "matchId": "match-id",
      "turnId": 1,
      "rollId": "roll-id",
      "pieceId": "A1",
      "pathId": "outer"
    }
  }
}
```

The adapter's optional `handleSignal(context, playerId, signal)` returns `{ recipientPlayerIds, type, payload }` only when the signal is valid. It receives a cloned state and must not mutate authoritative state. RoomDO independently checks that every recipient belongs to the sender's current server-owned team. It accepts suggestions only during uninterrupted active play, rejects malformed payloads over 2,048 serialized characters, and limits accepted signals to one per player per 500 ms.

Yutnori additionally requires the sender to be the current controller's teammate, the match/turn to be current, the throw animation to have ended, and the roll/piece/path to remain legal. The result is delivered separately to each approved recipient as `privateEvent` with `event.type: "yutnori.suggestion"` and `event.visibility: "private"`. Signals do not advance `version`, alter the board, or enter persisted public event history or snapshots. Reconnection does not replay previous suggestions. The client discards suggestions after 30 seconds, on a turn/match change, or when the move is no longer legal. Choosing a suggestion previews it; the controller must still explicitly confirm the completed placement sequence. Suggestions are unavailable while an earned throw or movement sequence is pending. No result category takes priority over another.

### Free result order and board placement

Yut/mo grant another throw; all remaining throws must be taken before movement. Once throwing ends, every pending result can be used in any order. The optional persisted `YutRoll.disposition` field is retained for compatibility but no longer restricts play. A mo followed by gae can reach a corner and then enter a shortcut; reversing their order can produce a different route.

Players select a piece and tap a labeled destination directly on the board. Each placement automatically previews the next state, without an Add-to-plan button. Undo and a single final confirmation submit the chosen order as one versioned/idempotent action:

```json
{
  "type": "action",
  "playerId": "p1",
  "clientActionId": "plan-1",
  "expectedVersion": 12,
  "action": {
    "type": "commitMoves",
    "payload": {
      "matchId": "match-id",
      "turnId": 1,
      "moves": [
        { "rollId": "mo-id", "pieceId": "A1", "pathId": "outer" },
        { "rollId": "yut-id", "pieceId": "A1", "pathId": "diagonalA" }
      ]
    }
  }
}
```

`simulateMovePlan()` in the shared pure `rules.ts` applies each choice to a clone, recalculating legal paths, stacks, captures, and exits after every move. The browser uses it for previews; the server repeats validation against authoritative state. Invalid plans do not partially mutate the room. A valid prefix may be previewed, but a plan can be committed only after all results are spent or it reaches a capture/victory. A no-legal-move result may be represented as `{ "rollId": "back-do-id", "discard": true }` within the same sequence; it is legal only at that exact simulated board state. Do not automatically discard BackDo before another result can make it useful. The original authoritative `turnId` belongs in the request even if a capture in the preview starts a new turn.

A capture ends the sequence at that move and starts a **new turn for the same team and controller**. `turnId` increments; all unused results remain, including ordinary results. `mandatoryThrows` forces the capture's new throw before any further movement. A plan containing moves after the capture is rejected. Normal A/B and teammate alternation uses `normalTurnIndex`, so capture turns do not skip a teammate's next normal turn.

Accepted moves expose `lastMoveSequence: { sequenceId, startedAt, durationMs, moves }`; each move records its own start time. The authoritative snapshot already contains the final board. Clients reconstruct intermediate poses and play the confirmed path, stacked-piece movement, and capture return in order. Actions/signals are blocked until the sequence ends. The winner dialog waits for the last animation rather than covering it. Reconnection uses the server timeline without replaying an expired sequence.

### Private placement previews

The controller sends `previewPlan {matchId, turnId, expectedVersion, revision, moves}` through `gameSignal`. The adapter validates a legal prefix on a clone and emits `yutnori.preview` only to the active team. Empty `moves` clears the preview. Preview events never change the authoritative board/version or enter public history.

A teammate can suggest the next step with `suggestMove {matchId, turnId, expectedVersion, planRevision, moves, move}`. The server validates the prefix and next move; the client additionally requires the same current prefix and revision before displaying or accepting it. Outdated versions, turns, actors, and illegal prefixes fail closed. Clients coalesce previews to honor the engine's 500 ms signal limit. Reconnection has no preview history; stale drafts and proposals are cleared.

### Public, individual, and team chat

Room chat supports an explicit team channel using the same socket and shared chat UI:

```json
{
  "type": "chat",
  "playerId": "p1",
  "channel": "team",
  "expectedTeam": { "teamId": "A", "playerIds": ["p1", "p3"] },
  "body": "A1을 중앙으로 옮겨요"
}
```

`expectedTeam` is a concurrency guard containing the team and complete recipient membership shown to the sender. The server compares it with the current team, ignoring member order, then computes recipients from its own team state. A missing or stale guard is rejected. A client cannot choose an opposing team or add recipients by forging this field. `channel: "team"` plus `targetPlayerId` is rejected. Team chat is available in uninterrupted active/finished rooms with at least two current members in the sender's team; it is unavailable in lobbies, waiting rooms, and solo games.

The delivered message has `visibility: "team"` and `teamId`, inside a normal `chat` envelope. The sender and current teammates receive it; opposing players do not. Chat does not change the game's version. RoomDO records the message's original recipients in `team_chat_audiences` for audience provenance, but provides no chat-history replay on reconnect, replacement joins, or a new team assignment. Never infer a historical message's audience from the current occupants of a team id.

`GameClientActions.sendTeamChat?(body)` is separate from `sendChat(body, targetPlayerId?)`. The shared chat keeps public and team drafts separate and switches explicitly between the two channels. Changing room/team/membership discards the old team draft and pending IME composition, then returns to the public channel with its own draft. This prevents text composed for an old team from being sent to a new team or published accidentally. The server's `expectedTeam` check also blocks an in-flight message based on an old membership snapshot.

### Events, reconnects, and presentation feedback

`RoomView` retains up to 32 received game events, deduplicated by `event.id`, and forwards them as optional `GameClientSnapshot.events`. `uiRevision` changes on events/chat/presence even when the authoritative version stays constant. This buffer is local to the mounted room; it is not an event-history replay protocol. The board must always be recoverable from the current snapshot.

Optional `connected` and `actionError: { revision, message }` let a package release a pending interaction after connection loss or a rejected command. Game code must not treat a chat-only update as a fresh server clock sample. Yutnori keeps the server/client time offset until `serverTime` changes so its throw lock expires even while chat is active.

Yutnori presents each shared throw in a centered full-screen overlay, followed by an 800 ms result reveal. Optional synthesized wood-impact audio is unlocked by a user gesture and follows only upcoming impact times, with a persistent mute setting. Its pastel toy-like board frame and rounded tactile pieces use team-specific shapes, visible stacked layers, fork arrows, and server-confirmed movement/capture animations. Round stick faces carry three X marks; flat faces are blank except the first marked stick's small filled red circle. The server continues to define `faces[i] === true` as flat-side-up.

The Yutnori scene uses `lastThrow` (`matchId`, `rollId`, `faces`, `startedAt`, `durationMs`, `visualSeed`) to restore a synchronized current or settled pose. The server supplies the result; Three.js is presentation only. WebGL failure/context loss retains a static four-face result; reduced motion, hidden tabs, and an offscreen scene skip to the settled pose. `destroy()` stops the animation loop and observers and disposes geometry, materials, shadows, and renderer resources.

Turn vibration is optional. The key includes match, turn, and player, is remembered in session storage, and is independent of `uiRevision`. Unsupported vibration or denied browser activation does not affect play. A visual turn banner and live status text remain available.

### Team-game verification

- Check that solo/team rooms require 2/4 players at every entry and lifecycle path; reject forged counts and unknown modes.
- Send the same action id twice and verify the throw/result is not regenerated. Reject stale versions, reused results, non-controller actions, and actions during the 1,800 ms throw plus 800 ms result reveal and during confirmed movement sequences.
- Verify yut/mo require another throw, mo/gae can be used in either order, and a complete placement sequence commits atomically. Captures must increment the same controller's turn, keep all unused results, and require the next throw before movement.
- Send a legal suggestion from a teammate: only that team receives private events and the board/version remain unchanged. Reject stale match/turn/path and opposing recipients.
- Send public and team chat from four connected players; check each socket's deliveries. Change team membership and verify old `expectedTeam` guards are rejected and old drafts/IME text are cleared.
- Reconnect or replace a player: restore the board from snapshots without replaying old private suggestions or chat history.
- Check all four server faces, low-motion/static fallback, repeat turn-notification suppression, explicit move confirmation, keyboard focus, and phone layouts.

### 윷놀이 완성안 제안

윷놀이 팀원은 조작자와 같은 말판 입력 UI에서 남은 이동 순서를 완성하고 `suggestPlan`으로 제안한다. 이 신호는 조작자 초안 `moves`와 전체 `proposal`, 버전·차례·초안 revision을 포함한다. 어댑터는 완결된 합법 계획만 같은 팀에 `yutnori.planSuggestion`으로 전달한다. 조작자 하단의 **팀 구성원의 제안 → 적용**은 현재 문맥을 재검증한 후 일반 `commitMoves`를 즉시 제출한다. 제안자의 로컬 조작과 신호 전달은 공개 말판·버전을 변경하지 않으며, 실제 이동 권한은 윷을 던진 현재 조작자에게 유지된다. 상세 계약은 `docs/yutnori.md`를 따른다.
