---
name: create-bighouse-game
description: Create or update Bighouse game adapters in this repository. Use when adding a new online game, defining game actions/state, implementing validation and winner logic, or writing tests for Bighouse GameDefinition adapters.
---

# Create Bighouse Game

## Purpose

Use this skill to add a new Bighouse game adapter without breaking the server's core guarantees:

- `RoomDO` owns live authoritative state.
- `GameDefinition` owns game rules, state projection, action validation, and timer intents.
- Each game package exports fixed-name `gameMetadata`; server plugins also export a `gameDefinition`, and browser client entrypoints export `mountGame()`.
- Public state and private player state must be intentionally separated.
- Every action must be validated before mutation.
- Winner and terminal-state logic must be deterministic and test-covered.

## Workflow

### 1) Identify the game shape

Before editing code, classify the game:

- **Public global-state game**: games like gomoku, chess, checkers, go. Most board/table state can be returned from `getPublicView()`.
- **Hidden player-state game**: games like poker, one-card, rummy, secret-role games. Public table state belongs in `stageState`; hidden hands/roles/resources belong in `playerStates[playerId]`.
- **Mixed game**: public board plus hidden hands, secret objectives, or simultaneous choices. Treat hidden state as private by default.

If the user does not specify visibility, default to the safest model: keep per-player data private and expose only derived public summaries.

### 2) Read the required references

Open these files before implementation:

- `references/game-definition-contract.md`
- `references/state-visibility.md`
- `references/action-validation-and-winners.md`
- `references/testing-checklist.md`

Also inspect the existing plugins:

- `packages/gomoku/src/server.ts` for public global-state game rules.
- `packages/gomoku/src/client.ts` for browser mount/update/destroy behavior.
- `src/games/card-demo.ts` for a server-only hidden player-state sample.

### 3) Scaffold the adapter

Prefer the script when adding a server-only adapter. For full games, create a package-owned plugin with separate Worker-safe server and browser client entrypoints:

```sh
python3 .agents/skills/create-bighouse-game/scripts/scaffold_game.py <game-id> "Display Name"
```

The script creates:

- `src/games/<game-id>.ts`
- `test/<game-id>.test.ts`

Then move the adapter into a package plugin or register it as an explicit server-only plugin in `src/games/index.ts`.

If the script is not appropriate, use:

- `skeletons/game-definition.ts`
- `skeletons/game-test.ts`

### 4) Implement the game definition

Implement all `GameDefinition` methods:

- `initialStageState()`
- `initialPlayerState()`
- `validateAction()`
- `applyAction()`
- `getPublicView()`
- `getPrivateView()`
- `nextTimers()`

Rules:

- Never mutate `context.state` in `validateAction()`.
- Mutate only inside `applyAction()`.
- Return `ValidationResult` errors with stable `code` values such as `invalid_action` or `invalid_turn`.
- Do not increment `state.version`; `RoomDO` does that after a valid transition.
- If the game ends, set `state.phase = "closed"` and `state.closedAt = context.now`.
- Emit public/system/private events that match the visibility rules.

### 5) Register and seed

Add the server plugin to `src/games/index.ts`:

```ts
import { myGamePlugin } from "@bighouse/my-game/server";
registerGamePlugins([myGamePlugin]);
```

Add the browser client loader to `packages/frontend/src/game-plugins.ts`. `GET /games` returns the plugins registered in the current Worker build, so no D1 migration is needed for a built-in game unless room/result storage changes.

### 6) Test the adapter

Write focused tests for:

- Initial stage/player state.
- Valid action transition.
- Invalid action rejection.
- Invalid turn rejection.
- Stale version behavior if tested through `RoomDO`.
- Duplicate action id behavior if tested through `RoomDO`.
- Public view never leaking private data.
- Private view containing only the requesting player's data.
- Winner/terminal state.
- Events using correct visibility.

Run:

```sh
pnpm typecheck
pnpm test
```

## Resources

### references/

- `game-definition-contract.md`: required `GameDefinition` API and implementation rules.
- `state-visibility.md`: how to split `stageState`, `playerStates`, public views, private views, and events.
- `action-validation-and-winners.md`: validation, mutation, turn order, timer, and winner patterns.
- `testing-checklist.md`: required tests for new game adapters.

### skeletons/

- `game-definition.ts`: starting adapter template.
- `game-test.ts`: starting Vitest template.

### scripts/

- `scaffold_game.py`: creates adapter and test files from the skeletons.
