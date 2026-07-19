export const baseStyles = `
  :host {
    --bh-ui-font: Inter, Pretendard, ui-rounded, "Arial Rounded MT Bold", system-ui, sans-serif;
    --bh-ui-ink: #07132f;
    --bh-ui-paper: #f8fbff;
    --bh-ui-blue: #0a67e8;
    --bh-ui-blue-deep: #063d9d;
    --bh-ui-violet: #7047f5;
    --bh-ui-yellow: #ffcb3d;
    --bh-ui-red: #ef4f46;
    --bh-ui-green: #29c977;
    --bh-ui-shadow: 0 7px 0 rgba(3, 16, 47, .92), 0 16px 32px rgba(2, 10, 34, .3);
    --bh-room-backdrop-image:
      radial-gradient(circle at 18% 18%, rgba(255,255,255,.18) 0 3px, transparent 4px),
      radial-gradient(circle at 82% 72%, rgba(255,255,255,.11) 0 6px, transparent 7px),
      linear-gradient(145deg, var(--bh-ui-blue) 0%, var(--bh-ui-violet) 100%);
    --bh-room-backdrop-size: 44px 44px, 72px 72px, auto;
    box-sizing: border-box;
    color: var(--bh-ui-paper);
    font-family: var(--bh-ui-font);
  }
  *, *::before, *::after { box-sizing: inherit; }
  button, input, select { font: inherit; }
  button { -webkit-tap-highlight-color: transparent; }
  button:focus-visible, input:focus-visible, select:focus-visible {
    outline: 4px solid #fff;
    outline-offset: 3px;
  }
  .bh-button {
    min-height: 44px;
    border: 2px solid var(--bh-ui-ink);
    border-radius: 14px;
    padding: 10px 16px;
    color: var(--bh-ui-paper);
    background: linear-gradient(180deg, #2588ff 0%, var(--bh-ui-blue) 58%, var(--bh-ui-blue-deep) 100%);
    box-shadow: 0 4px 0 var(--bh-ui-ink), inset 0 2px 0 rgba(255,255,255,.35);
    font-weight: 900;
    letter-spacing: .01em;
    cursor: pointer;
    transition: transform 120ms ease, filter 120ms ease, box-shadow 120ms ease;
  }
  .bh-button:hover:not(:disabled) { filter: brightness(1.1) saturate(1.05); transform: translateY(-1px); }
  .bh-button:active:not(:disabled) { transform: translateY(3px); box-shadow: 0 1px 0 var(--bh-ui-ink), inset 0 2px 0 rgba(255,255,255,.2); }
  .bh-button:disabled { cursor: not-allowed; filter: grayscale(.65); opacity: .48; }
  .bh-button.is-primary { color: var(--bh-ui-ink); background: linear-gradient(180deg, #ffe36e 0%, var(--bh-ui-yellow) 62%, #efa916 100%); }
  .bh-button.is-danger { background: linear-gradient(180deg, #ff7269, var(--bh-ui-red) 65%, #b5262d); }
  .bh-button.is-quiet { background: rgba(10, 28, 63, .86); }
  .bh-icon { display: inline-grid; width: 22px; height: 22px; place-items: center; }
  .bh-icon svg { width: 100%; height: 100%; display: block; }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; }
  }
`;

export const roomStyles = `
  :host { position:fixed; inset:0; z-index:40; pointer-events:none; }
  .bh-room {
    position: absolute;
    inset: 0;
    z-index: 40;
    display: grid;
    place-items: center;
    overflow: auto;
    padding: max(24px, env(safe-area-inset-top)) max(18px, env(safe-area-inset-right)) max(24px, env(safe-area-inset-bottom)) max(18px, env(safe-area-inset-left));
    background-image: var(--bh-room-backdrop-image);
    background-size: var(--bh-room-backdrop-size);
    pointer-events: auto;
  }
  .bh-room-panel {
    position: relative;
    width: min(760px, 100%);
    border: 3px solid var(--bh-ui-ink);
    border-radius: 26px;
    padding: clamp(18px, 4vw, 32px);
    background: linear-gradient(180deg, rgba(17,61,144,.98), rgba(8,34,91,.98));
    box-shadow: var(--bh-ui-shadow), inset 0 3px 0 rgba(255,255,255,.22);
  }
  .bh-room-navigation { position:absolute; inset:18px 18px auto; display:flex; align-items:center; justify-content:space-between; gap:12px; }
  .bh-icon-command { display:inline-flex; min-width:44px; min-height:44px; align-items:center; justify-content:center; gap:8px; border:2px solid var(--bh-ui-ink); border-radius:14px; padding:9px; color:#fff; background:rgba(10,28,63,.9); box-shadow:0 4px 0 var(--bh-ui-ink),inset 0 2px 0 rgba(255,255,255,.18); font-weight:900; cursor:pointer; transition:transform 120ms ease,filter 120ms ease,box-shadow 120ms ease; }
  .bh-icon-command:hover { filter:brightness(1.1); transform:translateY(-1px); }
  .bh-icon-command:active { transform:translateY(2px); box-shadow:0 2px 0 var(--bh-ui-ink),inset 0 2px 0 rgba(255,255,255,.18); }
  .bh-room-leave { padding-inline:12px 14px; background:linear-gradient(180deg,#ff7269,var(--bh-ui-red) 65%,#b5262d); }
  .bh-room-share { margin-left:auto; }
  .bh-room-heading { display: flex; align-items: end; justify-content: space-between; gap: 20px; margin-bottom: 18px; padding-top:54px; }
  .bh-room-kicker { color: #8fe5ff; font-size: 12px; font-weight: 900; letter-spacing: .16em; text-transform: uppercase; }
  .bh-room h2 { margin: 4px 0 0; font-size: clamp(28px, 5vw, 44px); line-height: .98; letter-spacing: -.04em; text-shadow: 0 3px 0 var(--bh-ui-ink); }
  .bh-capacity { flex: 0 0 auto; border: 2px solid var(--bh-ui-ink); border-radius: 14px; padding: 9px 12px; color: var(--bh-ui-ink); background: var(--bh-ui-yellow); box-shadow: 0 4px 0 var(--bh-ui-ink); font-weight: 950; }
  .bh-room-copy { margin: -6px 0 18px; color: #cfe5ff; font-weight: 700; }
  .bh-player-list { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
  .bh-player {
    display: grid;
    grid-template-columns: 42px minmax(0,1fr) auto;
    align-items: center;
    gap: 12px;
    min-height: 66px;
    border: 2px solid var(--bh-ui-ink);
    border-radius: 17px;
    padding: 9px 10px;
    color: var(--bh-ui-ink);
    background: linear-gradient(180deg, #f8fbff, #dce9ff);
    box-shadow: 0 4px 0 var(--bh-ui-ink), inset 0 2px 0 #fff;
  }
  .bh-seat { display:grid; width: 38px; height: 38px; place-items:center; border-radius: 12px; color:#fff; background:var(--bh-ui-violet); font-weight:950; }
  .bh-player-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:950; }
  .bh-player-meta { margin-top: 2px; color:#53627d; font-size:12px; font-weight:800; }
  .bh-badges { display:flex; flex-wrap:wrap; align-items:center; justify-content:flex-end; gap:6px; }
  .bh-badge { border:1px solid rgba(7,19,47,.35); border-radius:999px; padding:5px 8px; color:#30405f; background:#eef5ff; font-size:11px; font-weight:900; text-transform:uppercase; }
  .bh-badge.is-ready { color:#075d37; background:#c9f6df; }
  .bh-badge.is-waiting { color:#81510a; background:#fff0bc; }
  .bh-badge.is-offline { color:#6c3340; background:#ffe0e4; }
  .bh-remove { flex:0 0 44px; width:44px; min-height:44px; border-radius:12px; color:#fff; background:linear-gradient(180deg,#f04c5b,#c92136); }
  .bh-room-footer { display:grid; grid-template-columns:minmax(0,1fr) auto minmax(0,1fr); gap:14px; align-items:end; margin-top:22px; }
  .bh-primary-actions { display:flex; grid-column:2; flex-wrap:wrap; justify-content:center; gap:10px; }
  .bh-start-game { min-height:58px; border-width:3px; border-radius:17px; padding:14px 30px; font-size:18px; box-shadow:0 6px 0 var(--bh-ui-ink),inset 0 2px 0 rgba(255,255,255,.48); }
  .bh-bot-manager { position:relative; grid-column:3; justify-self:end; }
  .bh-add-bots-trigger { min-height:48px; padding-inline:14px 16px; background:linear-gradient(180deg,#2588ff,var(--bh-ui-blue) 62%,var(--bh-ui-blue-deep)); white-space:nowrap; }
  .bh-bot-panel { position:absolute; right:0; bottom:calc(100% + 12px); z-index:3; display:grid; width:min(380px,calc(100vw - 68px)); gap:14px; border:3px solid var(--bh-ui-ink); border-radius:18px; padding:16px; color:var(--bh-ui-ink); background:linear-gradient(180deg,#f8fbff,#dce9ff); box-shadow:0 8px 0 var(--bh-ui-ink),0 22px 42px rgba(2,10,34,.38),inset 0 2px 0 #fff; }
  .bh-bot-panel-heading { display:flex; align-items:start; justify-content:space-between; gap:12px; }
  .bh-bot-panel-heading > div > strong { display:block; font-size:17px; }
  .bh-bot-panel-heading > div > span { display:block; margin-top:2px; color:#53627d; font-size:12px; font-weight:800; }
  .bh-bot-panel-close { width:38px; min-width:38px; min-height:38px; padding:7px; color:var(--bh-ui-ink); background:#eef5ff; box-shadow:0 3px 0 var(--bh-ui-ink); }
  .bh-bot-fields { display:grid; grid-template-columns:minmax(0,1fr) minmax(92px,.55fr); gap:10px; }
  .bh-bot-fields label { display:grid; gap:5px; color:#53627d; font-size:11px; font-weight:900; letter-spacing:.04em; text-transform:uppercase; }
  .bh-bot-fields select { width:100%; min-height:44px; border:2px solid var(--bh-ui-ink); border-radius:12px; padding:8px 30px 8px 10px; color:var(--bh-ui-ink); background:#fff; font-weight:850; }
  .bh-confirm-bots { width:100%; }
  .bh-interruption { margin: 0 0 16px; border:2px solid var(--bh-ui-ink); border-radius:16px; padding:12px; color:#5f3900; background:#fff1b8; box-shadow:0 4px 0 var(--bh-ui-ink); font-weight:800; }
  @media (max-width: 620px) {
    .bh-room { place-items:start center; }
    .bh-room-panel { border-radius:22px; padding:16px; }
    .bh-room-navigation { inset:12px 12px auto; }
    .bh-room-heading { align-items:start; padding-top:50px; }
    .bh-room-footer { grid-template-columns:1fr; }
    .bh-primary-actions, .bh-bot-manager { grid-column:1; width:100%; }
    .bh-primary-actions { display:grid; grid-template-columns:1fr; }
    .bh-bot-manager { justify-self:stretch; }
    .bh-add-bots-trigger { width:100%; }
    .bh-bot-panel { width:100%; }
    .bh-button { width:100%; }
    .bh-player { grid-template-columns:36px minmax(0,1fr); }
    .bh-seat { width:34px; height:34px; }
    .bh-badges { grid-column:1 / -1; justify-content:flex-start; padding-left:48px; margin-top:-4px; }
  }
  @media (orientation:landscape) and (max-height:520px) {
    .bh-room { place-items:start center; padding:max(8px,env(safe-area-inset-top)) max(8px,env(safe-area-inset-right)) max(8px,env(safe-area-inset-bottom)) max(8px,env(safe-area-inset-left)); }
    .bh-room-panel {
      display:grid;
      width:min(920px,100%);
      grid-template-columns:minmax(176px,.68fr) minmax(310px,1.32fr);
      grid-template-areas:"navigation players" "heading players" "copy players" "interruption players" "footer players";
      column-gap:14px;
      align-items:start;
      border-radius:18px;
      padding:10px 12px;
    }
    .bh-room-navigation { position:static; grid-area:navigation; width:100%; }
    .bh-room-navigation.has-fullscreen { gap:6px; }
    .bh-room-navigation.has-fullscreen .bh-room-leave { width:44px; min-width:44px; padding:9px; }
    .bh-room-navigation.has-fullscreen .bh-room-leave .bh-command-label { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
    .bh-room-heading { grid-area:heading; align-items:start; gap:8px; margin:4px 0 6px; padding-top:0; }
    .bh-room h2 { font-size:clamp(22px,5.6vh,30px); }
    .bh-capacity { border-radius:10px; padding:6px 8px; font-size:12px; }
    .bh-room-copy { grid-area:copy; margin:0 0 8px; font-size:12px; line-height:1.3; }
    .bh-interruption { grid-area:interruption; margin:0 0 8px; padding:8px; font-size:12px; }
    .bh-player-list { grid-area:players; align-self:center; gap:7px; }
    .bh-player { min-height:52px; grid-template-columns:34px minmax(0,1fr) auto; gap:8px; border-radius:13px; padding:6px 8px; }
    .bh-seat { width:32px; height:32px; border-radius:9px; }
    .bh-badges { grid-column:auto; justify-content:flex-end; padding-left:0; margin-top:0; }
    .bh-badge { padding:4px 6px; font-size:10px; }
    .bh-remove { flex-basis:40px; width:40px; min-height:40px; }
    .bh-room-footer { grid-area:footer; grid-template-columns:1fr; gap:8px; align-self:end; margin-top:4px; }
    .bh-primary-actions,.bh-bot-manager { grid-column:1; width:100%; }
    .bh-primary-actions { display:grid; grid-template-columns:1fr; }
    .bh-bot-manager { justify-self:stretch; }
    .bh-start-game { min-height:48px; padding:10px 14px; font-size:15px; }
    .bh-add-bots-trigger { width:100%; min-height:44px; }
    .bh-bot-panel { right:auto; left:0; width:min(360px,calc(100vw - 32px)); max-block-size:calc(100svh - 24px); overflow:auto; }
  }
`;

export const gameControlsStyles = `
  :host { position:fixed; inset:0; z-index:60; pointer-events:none; }
  :host([hidden]) { display:none; }
  .bh-game-controls { position:absolute; inset:0; pointer-events:none; }
  .bh-game-utilities {
    position:absolute;
    inset-block-start:var(--bh-game-ui-utilities-block-start,var(--bh-game-ui-block-start,max(10px,env(safe-area-inset-top))));
    inset-block-end:var(--bh-game-ui-utilities-block-end,auto);
    inset-inline-end:var(--bh-game-ui-utilities-inline-end,var(--bh-game-ui-inline-end,max(10px,env(safe-area-inset-right))));
    display:flex;
    gap:var(--bh-game-ui-gap,8px);
  }
  .bh-game-control {
    position:relative;
    display:grid;
    width:var(--bh-game-ui-control-size,46px);
    min-width:var(--bh-game-ui-control-size,46px);
    min-height:var(--bh-game-ui-control-size,46px);
    place-items:center;
    border-color:rgba(166,220,255,.34);
    border-radius:14px;
    padding:10px;
    color:#fff;
    background:rgba(3,18,48,.78);
    box-shadow:0 3px 0 rgba(0,7,24,.78),inset 0 1px 0 rgba(255,255,255,.14);
    backdrop-filter:blur(12px);
    opacity:.76;
    pointer-events:auto;
  }
  .bh-game-control:hover:not(:disabled),
  .bh-game-control:focus-visible { opacity:1; }
  .bh-leave-control { color:#ffaaa5; }
  .bh-chat-control {
    position:absolute;
    inset-inline-end:var(--bh-game-ui-chat-inline-end,var(--bh-game-ui-inline-end,max(10px,env(safe-area-inset-right))));
    inset-block-end:var(--bh-game-ui-chat-block-end,var(--bh-game-ui-block-end,max(12px,env(safe-area-inset-bottom))));
    color:#fff;
    background:linear-gradient(180deg,rgba(139,98,255,.9),rgba(88,52,207,.9));
  }
  .bh-chat-control[hidden] { display:none; }
  .bh-unread { position:absolute; right:-7px; top:-8px; display:grid; min-width:23px; height:23px; place-items:center; border:2px solid var(--bh-ui-ink); border-radius:999px; padding:0 5px; color:#fff; background:var(--bh-ui-red); font-size:11px; font-weight:950; }
  @media (max-width:620px), (hover:none), (pointer:coarse) {
    .bh-game-control { width:var(--bh-game-ui-control-size,48px); min-width:var(--bh-game-ui-control-size,48px); min-height:var(--bh-game-ui-control-size,48px); opacity:.88; }
  }
`;

export const chatStyles = `
  :host { position:fixed; inset:0; z-index:60; pointer-events:none; }
  :host([hidden]) { display:none; }
  .bh-chat { position:absolute; inset:0; pointer-events:none; }
  .bh-chat-log {
    position:absolute;
    left:max(16px,env(safe-area-inset-left));
    bottom:max(22px,env(safe-area-inset-bottom));
    width:min(540px,calc(100% - 32px));
    max-height:min(48vh,420px);
    overflow:hidden;
    padding:18px 16px 12px;
    pointer-events:none;
    mask-image:linear-gradient(to bottom,transparent 0,#000 18%,#000 100%);
    opacity:0;
    visibility:hidden;
    transform:translateY(8px);
    transition:opacity 280ms ease,transform 280ms ease,visibility 0s linear 280ms;
  }
  .bh-chat.is-visible .bh-chat-log { opacity:1; visibility:visible; transform:translateY(0); transition-delay:0s; }
  .bh-chat:not(.is-open) .bh-message:nth-last-child(n+5) { display:none; }
  .bh-message { margin:8px 0; color:#fff; font-size:clamp(14px,2vw,17px); line-height:1.32; font-weight:850; text-shadow:0 2px 1px #020617, 1px 0 1px #020617, -1px 0 1px #020617, 0 0 7px rgba(2,6,23,.9); overflow-wrap:anywhere; }
  .bh-message strong { color:#8fe5ff; }
  .bh-message.is-private strong { color:#ffd86d; }
  .bh-chat-composer {
    position:absolute;
    left:max(16px,env(safe-area-inset-left));
    bottom:max(16px,env(safe-area-inset-bottom));
    display:grid;
    width:min(560px,calc(100% - 32px));
    grid-template-columns:minmax(0,1fr) auto auto;
    gap:8px;
    padding:9px;
    border:2px solid rgba(255,255,255,.72);
    border-radius:18px;
    background:rgba(4,15,38,.82);
    box-shadow:0 8px 0 rgba(2,6,23,.7),0 18px 36px rgba(2,6,23,.35);
    backdrop-filter:blur(12px);
    opacity:0;
    visibility:hidden;
    transform:translateY(8px);
    pointer-events:none;
    transition:opacity 280ms ease,transform 280ms ease,visibility 0s linear 280ms;
  }
  .bh-chat.is-open .bh-chat-log { bottom:88px; overflow-y:auto; pointer-events:auto; }
  .bh-chat.is-open .bh-chat-composer { opacity:1; visibility:visible; transform:translateY(0); pointer-events:auto; transition-delay:0s; }
  .bh-chat.is-fading .bh-chat-log, .bh-chat.is-fading .bh-chat-composer { opacity:0; transform:translateY(8px); pointer-events:none; }
  .bh-chat-input { min-width:0; min-height:46px; border:0; border-radius:12px; padding:10px 12px; color:#fff; background:rgba(255,255,255,.12); font-weight:800; }
  .bh-chat-input::placeholder { color:#cbd5e1; }
  .bh-chat-send { min-width:50px; padding:8px 12px; }
  .bh-chat-close { display:grid; width:46px; min-height:46px; place-items:center; border:2px solid var(--bh-ui-ink); border-radius:12px; padding:10px; color:#fff; background:rgba(10,28,63,.9); box-shadow:0 4px 0 var(--bh-ui-ink),inset 0 2px 0 rgba(255,255,255,.18); cursor:pointer; }
  .bh-chat-close:hover { filter:brightness(1.14); }
  .bh-chat-close:active { transform:translateY(2px); box-shadow:0 2px 0 var(--bh-ui-ink),inset 0 2px 0 rgba(255,255,255,.18); }
  @media (max-width:720px), (hover:none), (pointer:coarse) {
    .bh-chat:not(.is-open) .bh-chat-log { left:max(10px,env(safe-area-inset-left)); right:calc(max(10px,env(safe-area-inset-right)) + var(--bh-game-ui-control-size,48px) + 10px); bottom:max(18px,env(safe-area-inset-bottom)); width:auto; padding-left:0; padding-right:0; }
    .bh-chat-composer { left:max(10px,env(safe-area-inset-left)); right:max(10px,env(safe-area-inset-right)); bottom:max(10px,env(safe-area-inset-bottom)); width:auto; }
    .bh-chat.is-open .bh-chat-log { left:max(10px,env(safe-area-inset-left)); right:max(10px,env(safe-area-inset-right)); bottom:86px; width:auto; }
  }
  @media (orientation:landscape) and (max-height:520px) {
    .bh-chat:not(.is-open) .bh-chat-log { right:calc(var(--bh-game-ui-inline-end,max(8px,env(safe-area-inset-right))) + var(--bh-game-ui-control-size,48px) + 10px); max-block-size:52svh; }
    .bh-chat-composer { left:max(8px,env(safe-area-inset-left)); bottom:max(8px,env(safe-area-inset-bottom)); width:min(560px,calc(100% - 104px)); padding:7px; }
    .bh-chat.is-open .bh-chat-log { left:max(8px,env(safe-area-inset-left)); bottom:76px; width:min(560px,calc(100% - 104px)); max-block-size:calc(100svh - 92px); }
  }
`;

export const modalStyles = `
  :host { position:fixed; inset:0; z-index:80; pointer-events:none; }
  .bh-modal { position:absolute; inset:0; display:none; place-items:center; padding:24px; background:rgba(2,8,24,.68); backdrop-filter:blur(6px); pointer-events:auto; }
  .bh-modal.is-open { display:grid; }
  .bh-modal-panel { width:min(480px,100%); border:3px solid var(--bh-ui-ink); border-radius:25px; padding:28px; color:var(--bh-ui-ink); background:linear-gradient(180deg,#fff,#e9f1ff); box-shadow:var(--bh-ui-shadow),inset 0 3px 0 #fff; text-align:center; }
  .bh-modal-kicker { color:var(--bh-ui-blue); font-size:12px; font-weight:950; letter-spacing:.14em; text-transform:uppercase; }
  .bh-modal h2 { margin:8px 0 10px; font-size:clamp(28px,6vw,42px); line-height:1; letter-spacing:-.04em; }
  .bh-modal p { margin:0; color:#52617b; line-height:1.55; font-weight:750; }
  .bh-modal-actions { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:24px; }
  @media (max-width:480px) { .bh-modal { padding:16px; } .bh-modal-panel { padding:22px 16px; } .bh-modal-actions { grid-template-columns:1fr; } }
  @media (orientation:landscape) and (max-height:520px) {
    .bh-modal { padding:max(8px,env(safe-area-inset-top)) max(8px,env(safe-area-inset-right)) max(8px,env(safe-area-inset-bottom)) max(8px,env(safe-area-inset-left)); }
    .bh-modal-panel { width:min(620px,100%); border-radius:18px; padding:16px 20px; }
    .bh-modal h2 { margin:5px 0 7px; font-size:clamp(23px,8vh,34px); }
    .bh-modal p { font-size:13px; line-height:1.35; }
    .bh-modal-actions { grid-template-columns:1fr 1fr; gap:8px; margin-top:13px; }
  }
`;
