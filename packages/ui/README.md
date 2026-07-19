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

The components expose `waiting-overlay`, `game-controls`, `chat-overlay`, and `result-dialog` parts for limited host-level styling. Player names and chat messages are rendered through `textContent`.
