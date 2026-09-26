# @bighouse/ui

Browser-only, framework-independent game UI for Bighouse game packages. It is implemented with Custom Elements, Shadow DOM, and plain CSS; it must not be imported by Worker/server entrypoints.

## Game integration

```ts
import { createGameUi } from "@bighouse/ui";

export function mountGame(container, context) {
  const ui = createGameUi(container, context, context);
  return {
    update(snapshot) {
      ui.update(snapshot);
    },
    destroy() {
      ui.destroy();
    }
  };
}
```

`createGameUi()` mounts:

- `<bighouse-room-controls>` for waiting, ready/start, host transfer, atomic multi-bot management, interruption/restart, share, and leave actions.
- `<bighouse-game-controls>` for compact in-game leave, fullscreen, and always-available chat entry controls without reserving a fixed rail beside the game.
- `<bighouse-game-chat>` for the transparent in-game log, desktop Enter shortcut, IME-safe input, unread state, explicit close control, and a one-minute inactivity fade after the latest send, receive, or input activity.
- `<bighouse-game-result-dialog>` and `<bighouse-game-modal>` for result/rematch and lifecycle notices.

Call `setResult()` with the game-specific winner/result copy. The controller connects component events to the stable `GameClientActions` supplied at mount time.

### Team chat

Games exposing `room.teams` use the shared chat's **전체 / 우리 팀** selector. `createGameUi()` enables it when the current player belongs to a team with at least two members, the room is active or finished without an interruption, and `GameClientActions.sendTeamChat` is available. The server remains responsible for validating team membership and limiting delivery to teammates.

Public messages continue through `sendChat(body, targetPlayerId)`; team messages use `sendTeamChat(body)` exclusively. Team messages carry `visibility: "team"` and `teamId`, and display `[우리 팀]` beside their author. Private messages retain their existing styling and label. Names and message bodies always use text nodes.

Channel selection, focus and IME composition survive ordinary snapshots. Public and team drafts are separate. A changed or removed team clears the old team draft and resets to the public channel; an unfinished IME commit from that team is discarded until a new edit. Team sends never fall back to public chat.

For direct element integration, assign `chat.teamChannel = { teamId, playerIds, scopeId }` (use the room ID for `scopeId`), or `undefined` to remove the channel. Listen for `bighouse-team-chat-send` with `{ body, teamId }` and revalidate the current capability before forwarding. The existing `bighouse-chat-send` event retains its `{ body }` payload.

## Direct Custom Element use

Call `registerBighouseUi()` from `@bighouse/ui/register` before creating elements. Registration is idempotent and safe under dynamic imports and HMR.

Room-control events are bubbling and composed:

- `bighouse-ready-change`
- `bighouse-start-game`
- `bighouse-restart-game`
- `bighouse-add-bot`
- `bighouse-remove-bot`
- `bighouse-transfer-host`
- `bighouse-share-room`
- `bighouse-leave-room`
- `bighouse-chat-open` (while the room is waiting)
- `bighouse-toggle-fullscreen` (on an interrupted game so fullscreen remains dismissible)

Game controls emit `bighouse-leave-room`, `bighouse-chat-open`, and `bighouse-toggle-fullscreen`. Chat emits `bighouse-chat-send` and `bighouse-chat-open-change`. Result dialogs emit `bighouse-rematch` and `bighouse-leave-finished`.

`bighouse-add-bot` carries `{ difficulty, count }`. The default controller forwards the batch as one `GameClientActions.addBot(difficulty, count)` command so room capacity is validated atomically.

## Theme hooks

Set these CSS custom properties on the game container or Custom Element host:

- `--bh-ui-font`
- `--bh-ui-ink`
- `--bh-ui-paper`
- `--bh-ui-blue`
- `--bh-ui-blue-deep`
- `--bh-ui-violet`
- `--bh-ui-yellow`
- `--bh-ui-red`
- `--bh-ui-green`

Game packages can integrate the fixed controls with their own safe areas without reserving a global rail:

- `--bh-game-ui-utilities-block-start`
- `--bh-game-ui-utilities-block-end`
- `--bh-game-ui-utilities-inline-end`
- `--bh-game-ui-chat-block-end`
- `--bh-game-ui-chat-inline-end`

Unset game-specific properties fall back to the shared `--bh-game-ui-block-start`, `--bh-game-ui-block-end`, and `--bh-game-ui-inline-end` positions.

The components expose `waiting-overlay`, `game-controls`, `chat-overlay`, and `result-dialog` parts for limited host-level styling. Player names and chat messages are rendered through `textContent`.
