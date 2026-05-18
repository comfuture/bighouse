# Building Online Games with Bighouse

This guide explains how to build online multiplayer games on top of Bighouse. Bighouse keeps the network flow consistent across games, while each game implements its own rules, state visibility, validation, and winner logic through a `GameDefinition` adapter.

## 1. Basic Flow

The client flow is the same for every game.

1. Call `GET /games` to list enabled games.
2. Choose either direct lobby join or matchmaking ticket creation.
3. Use the returned `roomId` and `wsUrl` to connect to the room WebSocket.
4. If lobby chat is needed, connect to `lobbyWsUrl` or the lobby WebSocket URL.
5. Render the current room from the server `snapshot` message.
6. Send player input as `action` messages.
7. Apply `ack`, `event`, `privateEvent`, `chat`, `presence`, and `error` messages from the server.

Direct lobby join:

```sh
curl -X POST https://bighouse.comfuture.workers.dev/games/gomoku/lobbies/default/join \
  -H 'content-type: application/json' \
  -d '{"playerId":"p1","displayName":"Alice"}'
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

Lobby WebSocket URL:

```text
wss://bighouse.comfuture.workers.dev/games/gomoku/lobbies/default/ws?playerId=p1&displayName=Alice
```

`playerId` only needs to be a stable unique value for the player. It can be an internal account id, anonymous session id, wallet address, device-scoped id, or any other stable identifier. For UI and chat, also send a human-readable `displayName`. Do not use `displayName` as identity or authorization data; it is only a display label.

## 2. Client Message Contract

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
- `targetPlayerId`: used only for chat. If omitted, the chat is public. If present, the chat is private to that player and the sender.

Every server message includes `roomId`, `version`, and `serverTime`. Clients should replace their local room model on `snapshot`, then incrementally apply `event`, `privateEvent`, and `chat`.

## 3. Frontend Package Layout

The browser frontend is split by responsibility.

`packages/frontend`

- Owns the game list, identity inputs, lobby join, matchmaking, lobby chat, room chat, and room WebSocket lifecycle.
- It should not import every game package statically.
- It maps `gameId` to a dynamic import and loads a game bundle only after the player enters a matching room.

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
    "run_worker_first": ["/games/*", "/rooms/*", "/matchmaking/*"]
  }
}
```

Use this pattern for new games: create a package under `packages/<game-id>`, export a small mount/update API, and add a dynamic loader entry in `packages/frontend/src/main.ts`.

## 4. Lobby Chat and Room Chat

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

## 5. Public State and Private State

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

## 6. Gomoku: Public Global State

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

## 7. Card Games: Hidden Player State

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

## 8. Adding a New Game

Add a new game in `src/games/<game>.ts`, then register it in `src/games/index.ts`.

Minimum adapter shape:

```ts
export const myGameDefinition: GameDefinition = {
  gameId: "my-game",
  adapterKey: "my-game",
  displayName: "My Game",
  minPlayers: 2,
  maxPlayers: 4,
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
};
```

Register it:

```ts
import { myGameDefinition } from "./my-game";
import { registerGame } from "./registry";

registerGame(myGameDefinition);
```

`GET /games` seeds registered built-in adapters into the D1 `games` table, so a registered adapter appears in the game list.

## 9. Adapter Design Checklist

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

## 10. Recommended Client Model

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
    visibility: "public" | "private";
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

## 11. Practical Test Scenarios

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
- Room private chat targets must be players in the same room.
