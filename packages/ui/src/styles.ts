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
    background:
      radial-gradient(circle at 18% 18%, rgba(255,255,255,.18) 0 3px, transparent 4px),
      radial-gradient(circle at 82% 72%, rgba(255,255,255,.11) 0 6px, transparent 7px),
      linear-gradient(145deg, var(--bh-ui-blue) 0%, var(--bh-ui-violet) 100%);
    background-size: 44px 44px, 72px 72px, auto;
    pointer-events: auto;
  }
  .bh-room.is-rail {
    inset: max(10px, env(safe-area-inset-top)) max(10px, env(safe-area-inset-right)) auto auto;
    display: flex;
    width: auto;
    min-width: 0;
    overflow: visible;
    padding: 0;
    background: none;
    pointer-events: none;
  }
  .bh-room-panel {
    width: min(760px, 100%);
    border: 3px solid var(--bh-ui-ink);
    border-radius: 26px;
    padding: clamp(18px, 4vw, 32px);
    background: linear-gradient(180deg, rgba(17,61,144,.98), rgba(8,34,91,.98));
    box-shadow: var(--bh-ui-shadow), inset 0 3px 0 rgba(255,255,255,.22);
  }
  .bh-room.is-rail .bh-room-panel { width: auto; padding: 7px; border-radius: 16px; pointer-events: auto; box-shadow: 0 4px 0 rgba(3,16,47,.9), 0 10px 22px rgba(2,10,34,.25); }
  .bh-room.is-rail .bh-room-heading, .bh-room.is-rail .bh-room-copy, .bh-room.is-rail .bh-player-list, .bh-room.is-rail .bh-room-footer { display: none; }
  .bh-room-heading { display: flex; align-items: end; justify-content: space-between; gap: 20px; margin-bottom: 18px; }
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
  .bh-badges { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:6px; }
  .bh-badge { border:1px solid rgba(7,19,47,.35); border-radius:999px; padding:5px 8px; color:#30405f; background:#eef5ff; font-size:11px; font-weight:900; text-transform:uppercase; }
  .bh-badge.is-ready { color:#075d37; background:#c9f6df; }
  .bh-badge.is-waiting { color:#81510a; background:#fff0bc; }
  .bh-badge.is-offline { color:#6c3340; background:#ffe0e4; }
  .bh-remove { width:32px; min-height:32px; border:0; border-radius:10px; color:#fff; background:#d72f40; font-weight:950; cursor:pointer; }
  .bh-room-footer { display:grid; grid-template-columns:1fr auto; gap:12px; align-items:end; margin-top:20px; }
  .bh-actions { display:flex; flex-wrap:wrap; gap:10px; }
  .bh-bot-controls { display:grid; grid-template-columns:auto auto; gap:8px; align-items:end; }
  .bh-bot-controls label { display:grid; gap:5px; color:#bcd8ff; font-size:11px; font-weight:900; text-transform:uppercase; }
  .bh-bot-controls select { min-height:42px; border:2px solid var(--bh-ui-ink); border-radius:12px; padding:7px 30px 7px 10px; color:var(--bh-ui-ink); background:#fff; font-weight:850; }
  .bh-interruption { margin: 0 0 16px; border:2px solid var(--bh-ui-ink); border-radius:16px; padding:12px; color:#5f3900; background:#fff1b8; box-shadow:0 4px 0 var(--bh-ui-ink); font-weight:800; }
  .bh-rail-actions { display:flex; gap:7px; }
  .bh-room.is-rail .bh-button { min-height:38px; padding:7px 10px; font-size:12px; }
  @media (max-width: 620px) {
    .bh-room { place-items:start center; }
    .bh-room-panel { border-radius:22px; padding:16px; }
    .bh-room-heading { align-items:start; }
    .bh-room-footer { grid-template-columns:1fr; }
    .bh-actions, .bh-bot-controls { display:grid; grid-template-columns:1fr; }
    .bh-button { width:100%; }
    .bh-player { grid-template-columns:36px minmax(0,1fr); }
    .bh-seat { width:34px; height:34px; }
    .bh-badges { grid-column:1 / -1; justify-content:flex-start; padding-left:48px; margin-top:-4px; }
    .bh-room.is-rail { inset:max(8px,env(safe-area-inset-top)) max(8px,env(safe-area-inset-right)) auto auto; }
    .bh-room.is-rail .bh-button { width:auto; }
  }
`;

export const chatStyles = `
  :host { position:fixed; inset:0; z-index:60; pointer-events:none; }
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
  }
  .bh-chat:not(.is-open) .bh-message:nth-last-child(n+5) { display:none; }
  .bh-message { margin:8px 0; color:#fff; font-size:clamp(14px,2vw,17px); line-height:1.32; font-weight:850; text-shadow:0 2px 1px #020617, 1px 0 1px #020617, -1px 0 1px #020617, 0 0 7px rgba(2,6,23,.9); overflow-wrap:anywhere; }
  .bh-message strong { color:#8fe5ff; }
  .bh-message.is-private strong { color:#ffd86d; }
  .bh-chat-composer {
    position:absolute;
    left:max(16px,env(safe-area-inset-left));
    bottom:max(16px,env(safe-area-inset-bottom));
    display:none;
    width:min(560px,calc(100% - 32px));
    grid-template-columns:minmax(0,1fr) auto;
    gap:8px;
    padding:9px;
    border:2px solid rgba(255,255,255,.72);
    border-radius:18px;
    background:rgba(4,15,38,.82);
    box-shadow:0 8px 0 rgba(2,6,23,.7),0 18px 36px rgba(2,6,23,.35);
    backdrop-filter:blur(12px);
    pointer-events:auto;
  }
  .bh-chat.is-open .bh-chat-log { bottom:88px; overflow-y:auto; pointer-events:auto; }
  .bh-chat.is-open .bh-chat-composer { display:grid; }
  .bh-chat-input { min-width:0; min-height:46px; border:0; border-radius:12px; padding:10px 12px; color:#fff; background:rgba(255,255,255,.12); font-weight:800; }
  .bh-chat-input::placeholder { color:#cbd5e1; }
  .bh-chat-send { min-width:50px; padding:8px 12px; }
  .bh-chat-trigger {
    position:absolute;
    right:max(16px,env(safe-area-inset-right));
    bottom:max(18px,env(safe-area-inset-bottom));
    display:none;
    width:58px;
    height:58px;
    border:3px solid var(--bh-ui-ink);
    border-radius:20px;
    padding:14px;
    color:#fff;
    background:linear-gradient(180deg,#8b62ff,var(--bh-ui-violet));
    box-shadow:0 5px 0 var(--bh-ui-ink),0 12px 24px rgba(2,6,23,.38),inset 0 2px 0 rgba(255,255,255,.35);
    pointer-events:auto;
    cursor:pointer;
  }
  .bh-unread { position:absolute; right:-7px; top:-8px; display:grid; min-width:23px; height:23px; place-items:center; border:2px solid var(--bh-ui-ink); border-radius:999px; padding:0 5px; color:#fff; background:var(--bh-ui-red); font-size:11px; font-weight:950; }
  .bh-chat.is-open .bh-chat-trigger { display:none; }
  @media (max-width:720px), (hover:none), (pointer:coarse) {
    .bh-chat:not(.is-open) .bh-chat-log { left:12px; right:76px; bottom:max(18px,env(safe-area-inset-bottom)); width:auto; padding-left:0; padding-right:0; }
    .bh-chat-trigger { display:grid; place-items:center; }
    .bh-chat-composer { left:10px; bottom:max(10px,env(safe-area-inset-bottom)); width:calc(100% - 20px); }
    .bh-chat.is-open .bh-chat-log { left:10px; bottom:86px; width:calc(100% - 20px); }
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
`;
