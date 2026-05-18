# Bighouse

Bighouse is a Cloudflare Workers multiplayer game server prototype using D1 for cross-room indexes and Durable Objects for live coordinated state.

## Architecture

- `RoomDO` is the authoritative owner for one game room. It stores compact room snapshots, processed action ids, event logs, and timers in SQLite-backed Durable Object storage.
- `LobbyDO` owns joinable room discovery for a game/mode shard and routes lobby joins to a room.
- `MatchmakerDO` owns pending tickets for a game/mode/region/skill shard and creates rooms when enough players are queued.
- D1 stores queryable metadata only: games, room index rows, match tickets, and match result summaries.

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

The frontend package lives in `packages/frontend`. Per-game browser code lives in packages such as `packages/gomoku` and is loaded dynamically after entering a room, so the lobby does not download every game's bundle up front.

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

Join a lobby room:

```sh
curl -X POST http://localhost:8787/games/gomoku/lobbies/default/join \
  -H 'content-type: application/json' \
  -d '{"playerId":"p1","displayName":"Alice"}'
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

Client messages:

- `hello`: `{ "type": "hello", "playerId": "p1", "displayName": "Alice" }`
- `joinRoom`: `{ "type": "joinRoom", "playerId": "p1" }`
- `leaveRoom`: `{ "type": "leaveRoom", "playerId": "p1" }`
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

`playerId` can be any stable unique value for the player. A human-readable `displayName` is recommended so chat messages and presence UI can show a friendly label without treating it as identity.

## Built-In Games

`gomoku`

- Two-player board game.
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
pnpm deploy
```
