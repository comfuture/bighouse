# Bighouse Multiplayer Game Server PRD

## 1. Purpose

Bighouse is a general-purpose multiplayer game server for small real-time and turn-based games on Cloudflare Workers. It uses Durable Objects for coordinated live state and D1 for global configuration, searchable indexes, and completed-game summaries.

The first version proves the architecture with two sample game adapters:

- `gomoku`: a public-state board game similar to omok/gomoku.
- `card-demo`: a card-game style adapter where public stage state and private player state must be separated.

## 2. Goals

- Provide a reusable game adapter API for different game genres.
- Route each game id to its configured server behavior from D1-backed metadata.
- Support lobby, matchmaking, and room communication as separate coordination atoms.
- Keep room state authoritative inside `RoomDO` and its SQLite-backed Durable Object storage.
- Use D1 only for cross-room data: game configuration, room directory, match tickets, and result indexes.
- Support min/max player constraints per room.
- Deliver public events to all room participants and private events only to the intended player.
- Support reconnectable WebSocket clients with typed snapshot/action/event messages.
- Validate stale actions, duplicate client action ids, turn ownership, and player capacity.
- Cover room lifecycle, event visibility, sample games, D1 indexing, and alarm behavior with tests.

## 3. Non-Goals

- Full OAuth or account integration.
- Strict regional data residency guarantees.
- Large spectator fan-out or broadcast optimization.
- Binary protocol design.
- Complete production rules for poker, one-card, or other complex card games.
- Replay export storage in R2 or long-term analytics pipelines.

## 4. Architecture

### 4.1 Durable Object Responsibilities

`LobbyDO`

- Owns lobby-level room discovery for a game/mode shard.
- Keeps a compact list of open rooms.
- Routes quick-join requests to a joinable room or creates one through `RoomDO`.
- Updates room counts/status through explicit room lifecycle calls.

`MatchmakerDO`

- Owns a matchmaking queue for a game/mode/region/skill bucket shard.
- Creates and cancels tickets.
- Matches queued players into a room when enough compatible players are available.
- Avoids a single global matchmaker bottleneck by using deterministic shard names.

`RoomDO`

- Owns the authoritative state of a game room.
- Persists compact room state, stage state, player state, processed action ids, event log, and scheduled timers in DO SQLite.
- Maintains only connection/socket cache in memory.
- Validates and applies player actions through a game adapter.
- Broadcasts public events and sends private events to only the intended player.
- Uses one alarm with an internal timer table for turn timeouts and room cleanup.

### 4.2 D1 Responsibilities

D1 stores queryable cross-room data only:

- `games`: game id, adapter key, display metadata, enabled flag, default min/max players, and config JSON.
- `room_index`: room id, game id, mode, status, player counts, DO name, and lifecycle timestamps.
- `match_tickets`: ticket id, player id, game id, mode, status, and matched room id.
- `match_results`: completed-room summaries, winner/result payloads, and optional replay/checkpoint pointers.

D1 is not the source of truth for live room state.

## 5. Public API

### 5.1 HTTP

- `GET /games`
  - Returns enabled games from D1, seeded by built-in adapters when D1 is empty.
- `POST /games/:gameId/lobbies/:mode/join`
  - Body: `{ "playerId": "p1", "displayName": "Alice", "minPlayers"?: 2, "maxPlayers"?: 4 }`
  - Returns room id, player id, and WebSocket URL.
- `POST /games/:gameId/matchmaking/tickets`
  - Body: `{ "playerId": "p1", "displayName": "Alice", "mode": "default", "region"?: "apac", "skill"?: "default" }`
  - Returns a ticket and matched room id when a match is formed.
- `DELETE /matchmaking/tickets/:ticketId`
  - Cancels a pending ticket.
- `GET /rooms/:roomId`
  - Returns indexed room metadata and a room snapshot summary.
- `GET /rooms/:roomId/ws`
  - Upgrades to WebSocket and proxies the socket to `RoomDO`.

### 5.2 WebSocket Client Messages

- `hello`: identify player/session for reconnect.
- `joinRoom`: join or rejoin a room.
- `leaveRoom`: mark this socket as leaving.
- `action`: submit a game action with `clientActionId` and `expectedVersion`.
- `ping`: application heartbeat.

### 5.3 WebSocket Server Messages

- `snapshot`: full public view plus this player's private view.
- `event`: public/system event.
- `privateEvent`: player-targeted private event.
- `ack`: successful command/action acknowledgement.
- `error`: structured error with a stable code.
- `presence`: joined/left/reconnected updates.
- `roomClosed`: terminal room state.

All server messages include `roomId`, `version`, and `serverTime`.

## 6. Game Adapter Contract

Each adapter provides:

- `gameId`
- `adapterKey`
- `minPlayers`
- `maxPlayers`
- `initialStageState(context)`
- `initialPlayerState(player, context)`
- `validateAction(context, action)`
- `applyAction(context, action)`
- `getPublicView(context)`
- `getPrivateView(context, playerId)`
- `nextTimers(context)`

Rules:

- The room increments `version` only after a valid state transition.
- `expectedVersion` mismatch returns a stale-action error.
- Reused `clientActionId` from the same player returns the original acknowledgement without applying twice.
- Adapter output events declare `visibility: "public" | "private" | "system"`.
- Private state never appears in public snapshots or public events.

## 7. Sample Game Requirements

### 7.1 Gomoku

- Board size defaults to 15x15.
- Players receive stone colors in join order: black, white.
- Public stage state includes board, current turn, turn deadline, and move count.
- A move is valid only for the current player and an empty board cell.
- Move events are public.
- The sample declares a win after five contiguous stones when implemented; if not complete in the first pass, tests must still cover valid moves, invalid turns, and occupied-cell rejection.

### 7.2 Card Demo

- Stage state includes discard pile, deck count, current turn, and round status.
- Player state includes private hand cards.
- Public snapshot never includes another player's hand.
- Play-card actions reveal the submitted card as a public event.
- Draw-card output is private to the drawing player.

## 8. Testing Checklist

- Game adapter validation and apply logic.
- Event visibility filtering.
- Room min/max player lifecycle.
- Duplicate action id handling.
- Stale version rejection.
- Invalid turn rejection.
- `RoomDO` join/reconnect/action/snapshot.
- `LobbyDO` room route/update behavior.
- `MatchmakerDO` ticket enqueue/cancel/match behavior.
- Alarm-driven timeout/cleanup behavior.
- WebSocket integration for two-player gomoku action flow.
- Card demo privacy: player hand is never broadcast publicly.
- D1 room/result index synchronization.

## 9. Atomic Commit Plan

1. `docs: add multiplayer game server PRD`
2. `chore: scaffold cloudflare worker project`
3. `feat: add D1 schema and repository layer`
4. `feat: add game adapter core contracts`
5. `feat: add room durable object`
6. `feat: add lobby and matchmaker durable objects`
7. `feat: add HTTP and WebSocket API routes`
8. `feat: add gomoku and card demo adapters`
9. `test: cover room lifecycle and event visibility`
10. `docs: add local development and API usage notes`

## 10. Success Criteria

- `pnpm typecheck` passes.
- `pnpm test` passes.
- D1 migrations define all planned index tables.
- Wrangler config defines SQLite-backed DO classes.
- The implementation can create a room, join two players, exchange WebSocket messages, apply a gomoku move, and keep card hands private.
- API and development usage are documented.
