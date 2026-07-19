# Design QA

## Scope and references

- Source references: `/home/ubuntu/.codex/attachments/efa4e06e-f16a-462a-9792-2b5ac51029b6/image-1.png` through `image-6.png`.
- Implemented captures: `/tmp/bighouse-qa/home-desktop.png`, `home-mobile.png`, `lobby-desktop.png`, `room-waiting-desktop.png`, `game-active-desktop.png`, `game-active-mobile.png`, `game-chat-desktop.png`, and `game-chat-mobile.png`.
- Desktop viewport: 1440 x 1000. Mobile viewport: 390 x 844.
- The comparison intentionally carries over the references' dense game-shell hierarchy, saturated blue/violet surfaces, heavy outlines, inset highlights, large primary actions, and over-game chat treatment. Reference names, characters, logos, and proprietary artwork were not copied; the existing Bighouse hero and game thumbnails remain the product assets.

## Visual comparison

The reference and implementation captures were reviewed together at matching desktop and mobile states.

- Main entry: the hero establishes one dominant play destination, the game directory reads as a secondary but substantial selection surface, and mobile stacking preserves the same hierarchy without horizontal overflow.
- Lobby: the game identity and create-room action are visually dominant, while the live-room directory and lobby chat use distinct framed surfaces. Empty-state copy and controls remain legible at the captured viewport.
- Waiting room: the player list, capacity, ready/start actions, bot difficulty, bot addition, share, and leave controls are grouped into one centered game-native panel with strong foreground/background separation.
- In-game UI: the room lifecycle shell no longer wraps the package-owned game surface. Only the compact leave control, game-owned shared chat, and shared modal layers remain over the game.
- Chat: log text uses a multi-direction dark text shadow over the game, the composer uses a translucent blurred surface, desktop Enter opens and focuses it, and the mobile trigger is a real Lucide icon in a floating button.
- Type, spacing, color, borders, radii, shadows, image crops, and control density were inspected at full-page and focused game/chat views. No reference artwork is stretched or substituted with placeholder graphics.

## Interaction and responsive checks

- Desktop: game card navigation, room creation, bot addition, game start, Enter-to-open, automatic input focus, and chat send passed.
- Mobile: home layout, room creation, bot addition, game start, floating chat trigger, and composer opening passed.
- Horizontal overflow: none at 1440 px or 390 px on the home, lobby, or game views.
- Active game document height matches the viewport at both sizes (1000 px desktop, 844 px mobile).
- Browser console errors and uncaught page errors: none.

## Comparison history

1. First browser comparison exposed a high-severity layout regression: the first package-owned game child inherited a full viewport minimum height, pushing the chess board, waiting panel, and desktop chat composer below the visible viewport.
2. Removed that selector and anchored shared room, chat, and modal Web Components to the viewport. Re-ran the entire desktop/mobile path and re-captured every state.
3. Final comparison confirmed centered waiting controls, visible package-owned game content, fixed chat placement, readable over-game history, working mobile trigger placement, and zero game-route overflow.

final result: passed
