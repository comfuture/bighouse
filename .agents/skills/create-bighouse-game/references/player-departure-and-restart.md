# Player Departure And Restart

Active-game departure is a core room lifecycle concern owned by `RoomDO`, not by individual `GameDefinition` adapters. New games should cooperate with this protocol by keeping their state reset-safe and by not duplicating leave/restart logic in game rules.

## Protocol Surface

Client messages:

- `leaveRoom`: explicit player leave. In an active room this removes the player from the active game and starts the interruption flow.
- `restartGame`: host-only command that resets the game after an active-game interruption.

Snapshot payload:

```ts
activeInterruption?: {
  reason: "player_left";
  playerId: string;
  displayName?: string;
  hostPlayerId: string;
  createdAt: number;
};
```

Error code:

- `game_interrupted`: returned when a client submits a game action while the room is waiting for the host to restart after a player left.

Room index behavior:

- Interrupted active rooms are indexed as `open` when below `minPlayers`.
- Interrupted active rooms are indexed as `matching` when they have at least `minPlayers`.
- Replacement players may join an interrupted active room before the host restarts it.

## Server Implementation Rules

When `RoomDO.leave(playerId)` is called during `phase === "active"`:

1. Clear any pending disconnect timer for the player.
2. Remove the player from `state.players`.
3. Delete `state.playerStates[playerId]`.
4. Reset seat numbers for the remaining players.
5. If the leaving player was host, delegate host first to a remaining connected player, falling back to the first remaining player.
6. If no players remain, close the room and clear `activeInterruption`.
7. Otherwise set `state.activeInterruption` with the leaving player and the current host.
8. Increment `state.version`, persist state and room index, clear scheduled game timers, broadcast presence, and broadcast fresh snapshots.

`submitAction()` must reject all game actions while `state.activeInterruption` is present. This prevents stale hands, turns, timers, or board state from continuing after a participant disappears.

`restartGame(playerId)` must:

1. Require `state.activeInterruption`.
2. Require `playerId === state.room.hostPlayerId`.
3. Require `state.players.length >= state.room.minPlayers`.
4. Call the same reset path used for a fresh game start.
5. Set `phase = "active"`, increment `version`, persist state, re-index the room, reschedule game timers, and broadcast snapshots.

## Disconnect vs Explicit Leave

Transient WebSocket close/error should not immediately interrupt the active game. `RoomDO` schedules a `disconnect_grace` timer. If the player reconnects before the timer fires, the timer is cleared and the game continues.

When the grace timer fires, `confirmDisconnect()` checks for any active sibling socket for that player. If none exists and the player is still marked connected, it calls `leave(playerId)`, which uses the same active-game interruption flow as explicit `leaveRoom`.

## Frontend Behavior

Room UI should treat `activeInterruption` as authoritative server state:

- Host sees a modal asking whether to reset and start a new game.
- Non-host players see a waiting message that the host is deciding whether to restart.
- The restart button is disabled until the room has at least `minPlayers`.
- `restartGame` closes the prompt only after a new snapshot clears `activeInterruption`.
- `leaveRoom` should wait for server acknowledgement when possible, with a route fallback for navigation resilience.

Do not infer interruption state from chat messages or presence alone. Presence is advisory; snapshots own the game state.

## GameDefinition Responsibilities

Game adapters do not own player departure. They should not:

- Add custom `leave` actions for active-game lifecycle.
- Mutate `activeInterruption`.
- Continue turn timers while `activeInterruption` is present.
- Try to repair missing private state inside `validateAction()` or `applyAction()`.

Adapters should:

- Make `initialStageState()` and `initialPlayerState()` deterministic for a restarted game with the remaining players.
- Avoid storing irreversible per-player assumptions outside `stageState` and `playerStates`.
- Derive public/private views from the current `RoomState` players instead of cached player counts when possible.
- Tolerate player order and seat numbers being compacted before restart.

## Tests To Add When Touching This Flow

Use `RoomDO` integration tests for departure behavior. Cover:

- A non-host leaves an active game, `activeInterruption` is set, and actions are rejected with `game_interrupted`.
- Host leaves an active game, host is delegated before `activeInterruption` is emitted, and only the new host can restart.
- Restart clears `activeInterruption`, resets public/private state, and reschedules timers.
- If the room drops below `minPlayers`, restart is rejected with `not_enough_players`.
- A replacement player can join an interrupted active room and the host can restart after the room reaches `minPlayers`.
- Disconnect grace does not interrupt while the player reconnects in time, but calls the same interruption flow after timeout.
