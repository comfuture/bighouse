# Design QA

## Scope and references

- Source references: `/home/ubuntu/.codex/attachments/efa4e06e-f16a-462a-9792-2b5ac51029b6/image-1.png` through `image-6.png`.
- Current-state issue reference: `/home/ubuntu/.codex/attachments/33bc3fb4-82a1-4312-a062-ca7fd1cf4084/codex-clipboard-00440881-8ced-4a6c-882b-0018fce1b693.png`.
- Implemented captures: `/tmp/bighouse-qa/home-desktop.png`, `home-mobile.png`, `lobby-desktop.png`, `room-waiting-desktop.png`, `game-active-desktop.png`, `game-active-mobile.png`, `game-chat-desktop.png`, and `game-chat-mobile.png`.
- Final focused captures: `/tmp/bighouse-waiting-desktop-final.png`, `/tmp/bighouse-waiting-landscape-nav-final.png`, `/tmp/bighouse-chess-landscape-844.png`, `/tmp/bighouse-gomoku-landscape-844.png`, `/tmp/bighouse-onecard-landscape-844.png`, and `/tmp/bighouse-tank-landscape-568-final.png`.
- Desktop viewport: 1440 x 1000. Mobile viewport: 390 x 844.
- Final comparison viewports: 1576 x 1030 waiting room; 844 x 390 and 667 x 375 active games; 568 x 320 compact Tank Battle.
- The comparison intentionally carries over the references' dense game-shell hierarchy, saturated blue/violet surfaces, heavy outlines, inset highlights, large primary actions, and over-game chat treatment. Reference names, characters, logos, and proprietary artwork were not copied; the existing Bighouse hero and game thumbnails remain the product assets.

## Visual comparison

The reference and implementation captures were reviewed together at matching desktop and mobile states.

- Main entry: the hero establishes one dominant play destination, the game directory reads as a secondary but substantial selection surface, and mobile stacking preserves the same hierarchy without horizontal overflow.
- Lobby: the game identity and create-room action are visually dominant, while the live-room directory and lobby chat use distinct framed surfaces. Empty-state copy and controls remain legible at the captured viewport.
- Waiting room: the player list, capacity, ready/start actions, bot difficulty, bot addition, share, and leave controls are grouped into one centered game-native panel with strong foreground/background separation.
- Waiting-room control hierarchy: Start Game is the dominant primary action; Share is an icon action at the section top-right; Leave is a labeled icon action at the top-left; bot removal is a contained forced-removal icon; and Add Bot Players opens one batch setup surface instead of competing with Start Game.
- In-game UI: the room lifecycle shell no longer wraps the package-owned game surface. Only the compact leave control, game-owned shared chat, and shared modal layers remain over the game.
- Landscape in-game UI: Chess and Gomoku use an information rail beside the board, Onecard moves opponents/status/turn information into a compact side column while retaining a full-width hand area, and Tank Battle keeps the battlefield left with angle/items/power/fire controls in a dedicated right panel.
- The active-game Leave, fullscreen, and chat controls occupy a reserved 84 px rail outside the game surface. The final 568 x 320 Tank capture keeps the full battlefield and all controls visible; scaled Tank touch controls remain approximately 45 px or larger.
- Chat: log text uses a multi-direction dark text shadow over the game, the composer uses a translucent blurred surface, desktop Enter opens and focuses it, and the mobile trigger is a real Lucide icon in a floating button.
- Type, spacing, color, borders, radii, shadows, image crops, and control density were inspected at full-page and focused game/chat views. No reference artwork is stretched or substituted with placeholder graphics.

## Interaction and responsive checks

- Desktop: game card navigation, room creation, bot addition, game start, Enter-to-open, automatic input focus, and chat send passed.
- Mobile: home layout, room creation, bot addition, game start, floating chat trigger, and composer opening passed.
- Landscape rotation: live portrait-to-landscape relayout passed for all four games. Tank recreates only the Phaser runtime from the current authoritative snapshot when the media query changes; shared game UI remains mounted.
- Fullscreen: enter/exit state, icon/label change, document-root fullscreen targeting, mobile `landscape` lock request, unsupported-lock fallback, and unmount cleanup passed in a browser API stub test.
- Horizontal overflow: none at 1440 px or 390 px on the home, lobby, or game views.
- Horizontal/vertical overflow: none at 844 x 390, 667 x 375, or 568 x 320; measured document dimensions matched each viewport.
- Active game document height matches the viewport at both sizes (1000 px desktop, 844 px mobile).
- Browser console errors and uncaught page errors: none.

## Comparison history

1. First browser comparison exposed a high-severity layout regression: the first package-owned game child inherited a full viewport minimum height, pushing the chess board, waiting panel, and desktop chat composer below the visible viewport.
2. Removed that selector and anchored shared room, chat, and modal Web Components to the viewport. Re-ran the entire desktop/mobile path and re-captured every state.
3. Final comparison confirmed centered waiting controls, visible package-owned game content, fixed chat placement, readable over-game history, working mobile trigger placement, and zero game-route overflow.
4. The current-state waiting-room reference exposed overflowing Remove labels and equal visual weight across Start, Share, and Leave. Replaced removal labels with icon controls, moved Share/Leave to navigation positions, enlarged Start, and converted bot creation to a batch setup panel.
5. Landscape browser comparison exposed the waiting-room Share button over the first player row and Onecard opponent labels above the shared waiting overlay. Moved waiting navigation into its own left-column grid row and isolated each game surface into its own stacking context.
6. Final active-game comparison confirmed dedicated horizontal layouts, an overlap-free right control rail, live Tank relayout from 1000 x 800 to 1500 x 800, 44 px fullscreen control sizing, and zero console/page errors.

final result: passed
