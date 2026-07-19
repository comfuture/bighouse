# Bighouse

Bighouse is a Cloudflare Workers multiplayer game server prototype using D1 for cross-room indexes and Durable Objects for live coordinated state.

## Architecture

- `RoomDO` is the authoritative owner for one game room. It stores compact room snapshots, processed action ids, event logs, and timers in SQLite-backed Durable Object storage.
- `LobbyDO` owns joinable room discovery for a game/mode shard and routes lobby joins to a room.
- `MatchmakerDO` owns pending tickets for a game/mode/region/skill shard and creates rooms when enough players are queued.
- D1 stores queryable metadata only: games, room index rows, match tickets, and match result summaries.
- Room and lobby WebSockets use the Durable Objects WebSocket Hibernation API. The DO accepts sockets with `ctx.acceptWebSocket()`, persists per-socket identity in `serializeAttachment()`, and reconstructs live socket routing from `ctx.getWebSockets()` after hibernation instead of relying on in-memory connection maps.

## Local Development

Install dependencies:

```sh
pnpm install
```

Run checks:

```sh
pnpm typecheck
pnpm test
```

Start the local Worker with the built frontend assets:

```sh
pnpm dev
```

For frontend-only iteration, run the Vite dev server:

```sh
pnpm dev:frontend
```

The frontend package lives in `packages/frontend`. It is a Vue SPA built with Nuxt UI and uses separate routes for the portal, game lobbies, and immersive room play:

- `/`: game list
- `/game/:gameId/:mode`: game lobby with waiting room cards and lobby chat
- `/game/:gameId/:roomId`: immersive room host that owns networking, identity, QR sharing, reconnect, and guarded navigation while a lazy-loaded game package renders its own waiting and play experience. Room ids currently use the `room_` prefix, which keeps the room route distinct from lobby modes such as `default`.

The frontend opens a player information modal when no saved `playerId` exists. Direct room URLs do not open the room WebSocket or send `joinRoom` until the player submits that modal, which keeps shared room links from joining anonymous empty identities.

Per-game browser code lives in packages such as `packages/gomoku` and is loaded dynamically after entering a room, so the lobby does not download every game's bundle up front. Game packages consume the framework-free `@bighouse/ui` Web Components for player readiness, bot controls, chat, and lifecycle dialogs while keeping their board, table, or canvas layout independent.

The Worker has a cron trigger that runs every five minutes. It scans D1 room index rows for stale non-closed rooms, asks the authoritative `RoomDO` to verify that no live WebSocket clients remain, and closes abandoned rooms so they disappear from lobby lists and reject direct joins.

Apply D1 migrations for a local database when using Wrangler directly:

```sh
pnpm wrangler d1 migrations apply bighouse --local
```

The test suite applies migrations automatically through `@cloudflare/vitest-pool-workers`.

## HTTP API

List enabled games:

```sh
curl http://localhost:8787/games
```

Create a lobby room and automatically join it as host:

```sh
curl -X POST http://localhost:8787/games/gomoku/lobbies/default/rooms \
  -H 'content-type: application/json' \
  -d '{"playerId":"p1","displayName":"Alice"}'
```

List waiting lobby rooms:

```sh
curl http://localhost:8787/games/gomoku/lobbies/default/rooms
```

Join a specific room:

```sh
curl -X POST http://localhost:8787/rooms/room_id/join \
  -H 'content-type: application/json' \
  -d '{"playerId":"p2","displayName":"Bob"}'
```

Connect to a lobby WebSocket for lobby chat:

```text
ws://localhost:8787/games/gomoku/lobbies/default/ws?playerId=p1&displayName=Alice
```

Create a matchmaking ticket:

```sh
curl -X POST http://localhost:8787/games/gomoku/matchmaking/tickets \
  -H 'content-type: application/json' \
  -d '{"playerId":"p1","mode":"default","region":"apac","skill":"beginner"}'
```

Poll a queued ticket until it is matched:

```sh
curl http://localhost:8787/matchmaking/tickets/ticket_id
```

Cancel a matchmaking ticket:

```sh
curl -X DELETE http://localhost:8787/matchmaking/tickets/ticket_id
```

Inspect a room:

```sh
curl http://localhost:8787/rooms/room_id
```

Connect to a room WebSocket:

```text
ws://localhost:8787/rooms/room_id/ws?playerId=p1
```

## WebSocket Messages

Pass `playerId` in the WebSocket URL whenever it is known. That lets the Durable Object attach player tags at accept time, which is the fastest path for targeted snapshots, private chat, and presence. `displayName` may also be supplied in the URL.

`hello` and room `joinRoom` still bind identity after the socket is open for reconnect and legacy clients. This path is supported through the socket attachment that survives hibernation, but URL identity is preferred because WebSocket tags cannot be added after `ctx.acceptWebSocket()`.

Client messages:

- `hello`: `{ "type": "hello", "playerId": "p1", "displayName": "Alice" }`
- `joinRoom`: `{ "type": "joinRoom", "playerId": "p1" }`
- `leaveRoom`: `{ "type": "leaveRoom", "playerId": "p1" }`
- `ready`: `{ "type": "ready", "playerId": "p2", "ready": true }`
- `transferHost`: `{ "type": "transferHost", "playerId": "p1", "targetPlayerId": "p2" }`
- `startGame`: `{ "type": "startGame", "playerId": "p1" }`
- `action`: `{ "type": "action", "playerId": "p1", "clientActionId": "a1", "expectedVersion": 2, "action": { "type": "placeStone", "payload": { "x": 0, "y": 0 } } }`
- `chat`: `{ "type": "chat", "playerId": "p1", "body": "hello" }`
- `chat` private: `{ "type": "chat", "playerId": "p1", "targetPlayerId": "p2", "body": "secret" }`
- `ping`: `{ "type": "ping", "nonce": "n1" }`

Server messages include `roomId`, `version`, and `serverTime` and use these types:

- `snapshot`
- `event`
- `privateEvent`
- `chat`
- `ack`
- `error`
- `presence`
- `roomClosed`
- `pong`

The application-level string message `ping` receives an automatic `pong` response in room and lobby Durable Objects without waking a hibernated object. JSON `ping` messages are also accepted and return typed `pong` messages.

`playerId` can be any stable unique value for the player. A human-readable `displayName` is recommended so chat messages and presence UI can show a friendly label without treating it as identity.

## Built-In Games

`gomoku`

- Two-player board game.
- Lobby-created rooms stay `waiting` until every non-host player is ready and the host starts the game.
- Public state includes board, turn, move count, last move, and winner.
- Private state contains the player's stone color.
- Server validation rejects stale turns, occupied cells, and double-three moves, then computes the winner. The browser also disables occupied and double-three cells for immediate feedback.

`card-demo`

- Two to four players.
- Public state includes discard pile, deck count, current turn, round, and each hand count.
- Private state contains the player's hand.
- Played cards are public events; drawn cards are private events.

## Deployment Notes

Before deploying to a real Cloudflare account:

1. Replace the placeholder `database_id` in `wrangler.jsonc`.
2. Apply D1 migrations remotely:

```sh
pnpm wrangler d1 migrations apply bighouse --remote
```

3. Deploy:

```sh
pnpm run deploy
```
