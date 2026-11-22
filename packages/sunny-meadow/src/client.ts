import type {
  GameClientContext,
  GameClientSnapshot,
  GameEvent,
  MountedGameClient
} from "@bighouse/game-sdk/client";
import {
  computeIdleRegenAmount,
  isActiveMobAi,
  ITEM_CATALOG,
  MOB_ALERT_TELEGRAPH_SEC,
  MOB_CATALOG,
  PLAYER_CONFIG,
  STATUS_METADATA,
  stepIdleRegen,
  VIEWPORT,
  WEAPON_CATALOG,
  WEAPON_ORDER,
  type IdleRegenState
} from "./catalogs";
import { SunnyAudioManager } from "./audio";
import {
  canDismantleItem,
  computeDismantleYield,
  computeEffectiveCombatStats,
  computePlayerBaseDex,
  computeUpgradePreview,
  countItemInInventory,
  createEmptyInventory,
  getWeaponUpgrade,
  INVENTORY_ITEMS,
  MAX_WEAPON_UPGRADE_LEVEL,
  normalizeInventory,
  normalizeWeaponUpgrades,
  SHOP_OFFERS,
  SHOP_OFFERS_BY_ID,
  SMELTING_RECIPES,
  SMELTING_RECIPES_BY_ID,
  STONE_POWDER_ITEM_ID,
  UPGRADE_STONE_TIER_LABELS
} from "./economy";
import { gameMetadata } from "./client-metadata";
import {
  clientPointToCanvasLogical,
  createHudClickController,
  hitTestHudPoint,
  type HudActionTarget
} from "./hud-interactions";
import { createMenuModeSync } from "./menu-mode-sync";
import { createWeaponSwitchSequence } from "./weapon-switch-sequence";
import { compileStageForRuntime, type CompiledStage, type RuntimeLadder } from "./map-schema";
import {
  aabbOverlap,
  applyMovingPlatformCarry,
  findOverlappingLadder,
  findOverlappingPortal,
  resolvePlatformLanding,
  stepOnLadder,
  updateMovingPlatforms
} from "./physics";
import {
  economySheetUrl,
  heroUrl,
  itemsSheetUrl,
  loadSunnyImages,
  SunnyRenderer,
  type ClientDamageText,
  type ClientHitEffect,
  type ClientItemRender,
  type ClientLootDrop,
  type ClientMobRender,
  type ClientParticle,
  type ClientProjectileRender,
  type LocalPlayerRender
} from "./renderer";
import { ALL_STAGES, getStageById } from "./stages/index";
import { computeDeterministicHit, deathPenaltyOf } from "./server";
import { registerBighouseUi, type BighouseGameChatElement } from "@bighouse/ui";
import "./style.css";
import type {
  ActiveStatusEffect,
  InventorySlot,
  MobTemplate,
  RemotePlayerView,
  ServerItemState,
  ServerMobState,
  StatusEffectKind,
  UpgradeStoneTier,
  WeaponStatusSpec,
  WeaponUpgradeStat,
  WorldPlayerState
} from "./types";

export { gameMetadata };

type ClientMobEntity = ClientMobRender & {
  tpl: MobTemplate;
  homeX: number;
  homeY: number;
  patrolMinX: number;
  patrolMaxX: number;
  aiTimer: number;
  aiPhase: string;
  shootTimer: number;
  teleportTimer: number;
  alerted: boolean;
  alertResetTimer: number;
  authX: number;
  authY: number;
  authVx: number;
  authVy: number;
  authFacing: number;
  lastAuthAt: number;
};

type ClientProjectile = ClientProjectileRender & {
  vx: number;
  vy: number;
  traveled: number;
  maxDistance: number;
  alive: boolean;
  atk: number;
  pierceLeft: number;
  hitIds: Set<string>;
  slowEffect?: boolean;
};

type RemotePlayerSmooth = RemotePlayerView & {
  targetX: number;
  targetY: number;
  lastSeenAt: number;
};

const ACTION_KEYS: Record<string, string[]> = {
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  up: ["ArrowUp", "KeyW"],
  down: ["ArrowDown", "KeyS"],
  jump: ["Space", "KeyC", "KeyK", "AltLeft"],
  attack: ["KeyX", "KeyZ", "KeyJ", "ControlLeft"],
  potion: ["KeyF", "KeyV"],
  weaponPrev: ["KeyQ"],
  weaponNext: ["KeyE"]
};

const PREVENT_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"]);

export function mountGame(container: HTMLElement, initialContext: GameClientContext): MountedGameClient {
  let ctx = initialContext;
  const actions = {
    sendAction: initialContext.sendAction,
    sendSignal: initialContext.sendSignal,
    sendChat: initialContext.sendChat,
    shareRoom: initialContext.shareRoom,
    leaveRoom: initialContext.leaveRoom
  };

  container.innerHTML = "";
  const root = document.createElement("div");
  root.className = "sm-root";
  root.innerHTML = `
    <header class="sm-topbar">
      <div class="sm-brand">
        <span class="sm-badge" data-el="stage-badge">STAGE 1</span>
        <h1 class="sm-title" data-el="stage-title">햇살 초원 모험</h1>
      </div>
      <div class="sm-actions">
        <button type="button" class="sm-btn sm-btn-primary" data-act="map">🗺 스테이지</button>
        <button type="button" class="sm-btn" data-act="chat">💬 채팅</button>
        <button type="button" class="sm-btn" data-act="mute">🔊 사운드</button>
        <button type="button" class="sm-btn" data-act="help">📖 가이드</button>
        <button type="button" class="sm-btn" data-act="share">🔗 초대</button>
        <button type="button" class="sm-btn" data-act="fullscreen">⛶ 전체화면</button>
        <button type="button" class="sm-btn" data-act="leave">🚪 나가기</button>
      </div>
    </header>
    <section class="sm-stage-frame" data-el="stage-frame" aria-label="햇살 초원 모험 게임 화면">
      <canvas class="sm-canvas" width="960" height="576" data-el="canvas"></canvas>
    </section>
    <div class="sm-touch-pad" aria-label="터치 조작 패드">
      <div class="sm-touch-group">
        <button type="button" class="sm-touch-btn" data-touch="left">◀</button>
        <button type="button" class="sm-touch-btn" data-touch="up">▲</button>
        <button type="button" class="sm-touch-btn" data-touch="down">▼</button>
        <button type="button" class="sm-touch-btn" data-touch="right">▶</button>
      </div>
      <div class="sm-touch-group">
        <button type="button" class="sm-touch-btn" data-touch="potion">🧪</button>
        <button type="button" class="sm-touch-btn" data-touch="attack">⚔️</button>
        <button type="button" class="sm-touch-btn" data-touch="jump">JUMP</button>
      </div>
    </div>
    <footer class="sm-footer">
      <span><strong>이동</strong> ←→</span>
      <span><strong>점프</strong> Space</span>
      <span><strong>하강</strong> ↓+Space</span>
      <span><strong>포털·사다리</strong> ↑</span>
      <span><strong>공격</strong> X/Z</span>
      <span><strong>포션</strong> F</span>
      <span><strong>무기</strong> Q/E·1~0</span>
      <span><strong>인벤토리</strong> I</span>
      <span><strong>상점</strong> B</span>
    </footer>
    <dialog class="sm-dialog sm-dialog-wide" closedby="any" data-el="inventory-dialog" aria-labelledby="sm-inv-title">
      <div class="sm-modal-header">
        <h2 id="sm-inv-title">🎒 인벤토리</h2>
        <span class="sm-coin-pill" data-el="inv-coins">0</span>
      </div>
      <div class="sm-split sm-split-inv">
        <div class="sm-panel">
          <div class="sm-hero-strip">
            <img data-el="inv-hero-img" alt="캐릭터" />
            <div class="sm-hero-meta" data-el="inv-hero-meta"></div>
          </div>
          <div class="sm-stat-grid" data-el="inv-stats"></div>
          <div class="sm-section-head">
            <h3>무기</h3>
            <span class="sm-count-badge" data-el="inv-weapon-count">1/10</span>
          </div>
          <div class="sm-weapon-list" data-el="inv-weapons"></div>
          <div class="sm-upgrade-box" data-el="inv-upgrade-panel"></div>
        </div>
        <div class="sm-panel">
          <div class="sm-section-head">
            <div class="sm-tab-group" role="tablist" aria-label="가방 및 제련">
              <button type="button" class="sm-tab-btn is-active" role="tab" aria-selected="true" data-inv-tab="bag">
                가방 <span class="sm-tab-count" data-el="inv-slot-count">0/24</span>
              </button>
              <button type="button" class="sm-tab-btn" role="tab" aria-selected="false" data-inv-tab="smelt">
                제련 <span class="sm-tab-count" data-el="inv-powder-count">가루 0</span>
              </button>
            </div>
          </div>
          <div class="sm-tab-pane" data-el="inv-bag-pane">
            <div class="sm-inv-grid" data-el="inv-grid"></div>
            <div class="sm-detail-box" data-el="inv-item-detail"></div>
          </div>
          <div class="sm-tab-pane is-hidden" data-el="inv-smelt-pane">
            <div class="sm-tier-tabs" data-el="inv-smelt-tiers">
              <button type="button" class="sm-tier-btn" data-smelt-tier="1">초급</button>
              <button type="button" class="sm-tier-btn is-active" data-smelt-tier="2">중급</button>
              <button type="button" class="sm-tier-btn" data-smelt-tier="3">고급</button>
            </div>
            <div class="sm-smelt-grid" data-el="inv-smelt-grid"></div>
            <div class="sm-detail-box" data-el="inv-smelt-detail"></div>
          </div>
        </div>
      </div>
      <form method="dialog" class="sm-dialog-footer">
        <span class="sm-feedback" data-el="inv-feedback" role="status" aria-live="polite"></span>
        <button value="close" class="sm-btn sm-btn-primary" autofocus>닫기</button>
      </form>
    </dialog>
    <dialog class="sm-dialog sm-dialog-wide" closedby="any" data-el="shop-dialog" aria-labelledby="sm-shop-title">
      <div class="sm-modal-header">
        <h2 id="sm-shop-title">🏪 상점</h2>
        <span class="sm-coin-pill" data-el="shop-coins">0</span>
      </div>
      <div class="sm-split">
        <div class="sm-panel">
          <div class="sm-section-head">
            <h3>판매</h3>
            <span class="sm-count-badge" data-el="shop-slot-count">0/24</span>
          </div>
          <div class="sm-inv-grid" data-el="shop-my-grid"></div>
          <div class="sm-detail-box" data-el="shop-sell-detail"></div>
        </div>
        <div class="sm-panel">
          <div class="sm-section-head">
            <h3>구매</h3>
          </div>
          <div class="sm-shop-list" data-el="shop-offers"></div>
          <div class="sm-detail-box" data-el="shop-buy-detail"></div>
        </div>
      </div>
      <form method="dialog" class="sm-dialog-footer">
        <span class="sm-feedback" data-el="shop-feedback" role="status" aria-live="polite"></span>
        <button value="close" class="sm-btn sm-btn-primary" autofocus>닫기</button>
      </form>
    </dialog>
    <dialog class="sm-dialog" closedby="any" data-el="map-dialog" aria-labelledby="sm-map-title">
      <h2 id="sm-map-title">🗺 스테이지</h2>
      <div class="sm-stage-grid" data-el="stage-grid"></div>
      <form method="dialog" class="sm-dialog-footer">
        <button value="close" class="sm-btn sm-btn-primary" autofocus>닫기</button>
      </form>
    </dialog>
    <dialog class="sm-dialog" closedby="any" data-el="help-dialog" aria-labelledby="sm-help-title">
      <h2 id="sm-help-title">📖 가이드</h2>
      <ul class="sm-help-list">
        <li><strong>이동·하강</strong> ←→ 이동, <kbd>Space</kbd> 점프, <kbd>↓</kbd>+<kbd>Space</kbd> 한 층 하강</li>
        <li><strong>지형·함정</strong> 탄성·빙판·컨베이어·진흙 활용, 바닥 함정 주의</li>
        <li><strong>인벤토리</strong> <kbd>I</kbd> 또는 좌상단 상태창 클릭 (무기 장착·강화)</li>
        <li><strong>상점</strong> <kbd>B</kbd> 또는 우상단 코인 클릭 (강화석·포션 거래)</li>
        <li><strong>성장·저장</strong> 권장 레벨 스테이지 이동, 진행 자동 저장</li>
      </ul>
      <form method="dialog" class="sm-dialog-footer">
        <button value="close" class="sm-btn sm-btn-primary" autofocus>확인</button>
      </form>
    </dialog>
    <dialog class="sm-dialog sm-death-dialog" closedby="none" data-el="death-dialog" aria-labelledby="sm-death-title">
      <h2 id="sm-death-title">쓰러졌습니다</h2>
      <p>체력 60%로 시작 지점에서 부활합니다.</p>
      <ul class="sm-death-penalty">
        <li><span>경험치</span><strong data-el="death-xp">0</strong></li>
        <li><span>코인</span><strong data-el="death-coins">0</strong></li>
      </ul>
      <p class="sm-death-note">레벨·무기·포션 유지</p>
      <div class="sm-dialog-footer">
        <button type="button" class="sm-btn sm-btn-primary" data-act="revive">부활</button>
      </div>
    </dialog>
  `;
  container.appendChild(root);

  const canvas = root.querySelector<HTMLCanvasElement>('[data-el="canvas"]')!;
  const stageFrame = root.querySelector<HTMLElement>('[data-el="stage-frame"]')!;
  const stageBadge = root.querySelector<HTMLElement>('[data-el="stage-badge"]')!;
  const stageTitle = root.querySelector<HTMLElement>('[data-el="stage-title"]')!;
  const mapDialog = root.querySelector<HTMLDialogElement>('[data-el="map-dialog"]')!;
  const helpDialog = root.querySelector<HTMLDialogElement>('[data-el="help-dialog"]')!;
  const inventoryDialog = root.querySelector<HTMLDialogElement>('[data-el="inventory-dialog"]')!;
  const shopDialog = root.querySelector<HTMLDialogElement>('[data-el="shop-dialog"]')!;
  const invCoinsEl = root.querySelector<HTMLElement>('[data-el="inv-coins"]')!;
  const invFeedbackEl = root.querySelector<HTMLElement>('[data-el="inv-feedback"]')!;
  const invHeroImg = root.querySelector<HTMLImageElement>('[data-el="inv-hero-img"]')!;
  invHeroImg.src = heroUrl;
  const invHeroMetaEl = root.querySelector<HTMLElement>('[data-el="inv-hero-meta"]')!;
  const invStatsEl = root.querySelector<HTMLElement>('[data-el="inv-stats"]')!;
  const invWeaponCountEl = root.querySelector<HTMLElement>('[data-el="inv-weapon-count"]')!;
  const invWeaponsEl = root.querySelector<HTMLElement>('[data-el="inv-weapons"]')!;
  const invUpgradePanelEl = root.querySelector<HTMLElement>('[data-el="inv-upgrade-panel"]')!;
  const invSlotCountEl = root.querySelector<HTMLElement>('[data-el="inv-slot-count"]')!;
  const invPowderCountEl = root.querySelector<HTMLElement>('[data-el="inv-powder-count"]')!;
  const invBagPaneEl = root.querySelector<HTMLElement>('[data-el="inv-bag-pane"]')!;
  const invSmeltPaneEl = root.querySelector<HTMLElement>('[data-el="inv-smelt-pane"]')!;
  const invGridEl = root.querySelector<HTMLElement>('[data-el="inv-grid"]')!;
  const invItemDetailEl = root.querySelector<HTMLElement>('[data-el="inv-item-detail"]')!;
  const invSmeltGridEl = root.querySelector<HTMLElement>('[data-el="inv-smelt-grid"]')!;
  const invSmeltDetailEl = root.querySelector<HTMLElement>('[data-el="inv-smelt-detail"]')!;
  const shopCoinsEl = root.querySelector<HTMLElement>('[data-el="shop-coins"]')!;
  const shopFeedbackEl = root.querySelector<HTMLElement>('[data-el="shop-feedback"]')!;
  const shopSlotCountEl = root.querySelector<HTMLElement>('[data-el="shop-slot-count"]')!;
  const shopMyGridEl = root.querySelector<HTMLElement>('[data-el="shop-my-grid"]')!;
  const shopSellDetailEl = root.querySelector<HTMLElement>('[data-el="shop-sell-detail"]')!;
  const shopOffersEl = root.querySelector<HTMLElement>('[data-el="shop-offers"]')!;
  const shopBuyDetailEl = root.querySelector<HTMLElement>('[data-el="shop-buy-detail"]')!;
  const stageGrid = root.querySelector<HTMLElement>('[data-el="stage-grid"]')!;
  const deathDialog = root.querySelector<HTMLDialogElement>('[data-el="death-dialog"]')!;
  const deathXp = root.querySelector<HTMLElement>('[data-el="death-xp"]')!;
  const deathCoins = root.querySelector<HTMLElement>('[data-el="death-coins"]')!;
  const reviveBtn = root.querySelector<HTMLButtonElement>('[data-act="revive"]')!;

  // World chat is the shared in-game chat every other game uses: it sits over the
  // scene, and Enter opens and closes it.
  registerBighouseUi();
  const chat = document.createElement("bighouse-game-chat") as BighouseGameChatElement;
  stageFrame.append(chat);
  let chatOpen = false;
  chat.addEventListener("bighouse-chat-send", ((event: CustomEvent<{ body: string }>) => {
    actions.sendChat(event.detail.body);
  }) as EventListener);
  chat.addEventListener("bighouse-chat-open-change", ((event: CustomEvent<{ open: boolean }>) => {
    chatOpen = event.detail.open;
    // Typing must not move the character, and held keys must not stick.
    keysDown.clear();
    virtualDown.clear();
  }) as EventListener);

  /** While a dialog is up its buttons own Enter, so the chat shortcut stands down. */
  function syncChatAvailability(): void {
    chat.enabled = !(
      mapDialog.open ||
      helpDialog.open ||
      deathDialog.open ||
      inventoryDialog.open ||
      shopDialog.open
    );
  }
  const muteBtn = root.querySelector<HTMLButtonElement>('[data-act="mute"]')!;

  // Fallback for closedby="any" light-dismiss when unsupported
  if (!("closedBy" in HTMLDialogElement.prototype)) {
    const isOutside = (e: PointerEvent, dlg: HTMLDialogElement) => {
      const r = dlg.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    for (const dlg of [mapDialog, helpDialog, inventoryDialog, shopDialog]) {
      let downOut = false;
      dlg.addEventListener("pointerdown", (e) => {
        downOut = isOutside(e, dlg);
      });
      dlg.addEventListener("pointerup", (e) => {
        const shouldClose = downOut && isOutside(e, dlg);
        downOut = false;
        if (shouldClose) dlg.close();
      });
      dlg.addEventListener("close", () => {
        downOut = false;
      });
    }
  }
  for (const dialog of [mapDialog, helpDialog, deathDialog, inventoryDialog, shopDialog]) {
    dialog.addEventListener("close", () => {
      dialog.returnValue = "";
      syncChatAvailability();
      if (dialog === inventoryDialog || dialog === shopDialog) {
        syncMenuMode();
      }
    });
  }

  const audio = new SunnyAudioManager();
  let renderer: SunnyRenderer | null = null;
  let destroyed = false;
  let renderSuspended = false;
  let rafId: number | null = null;
  let lastFrameTime = performance.now();
  let accumulator = 0;

  // Input state
  const keysDown = new Set<string>();
  const virtualDown = new Set<string>();
  const curInput: Record<string, boolean> = {};
  const prevInput: Record<string, boolean> = {};
  const justPressed = (act: string) => Boolean(curInput[act]) && !prevInput[act];
  const justReleased = (act: string) => !curInput[act] && Boolean(prevInput[act]);
  const isDown = (act: string) => Boolean(curInput[act]);

  // World runtime state
  let currentStageId = "";
  let compiledStage: CompiledStage = compileStageForRuntime(getStageById("stage-1"));
  let stagePlayerCounts: Record<string, number> = { "stage-1": 1 };
  let stagePlayerCount = 1;
  let totalPlayersOnline = 1;
  let highestStageNumber = 1;

  const localPlayer: LocalPlayerRender = {
    playerId: ctx.playerId,
    displayName: "모험가",
    x: 160,
    y: 660,
    w: PLAYER_CONFIG.hitboxWidth,
    h: PLAYER_CONFIG.hitboxHeight,
    vx: 0,
    vy: 0,
    facing: 1,
    grounded: false,
    onLadder: false,
    level: 1,
    xp: 0,
    xpToNext: 100,
    hp: 100,
    maxHp: 100,
    baseAtk: 6,
    baseDex: 4,
    potions: 2,
    coins: 0,
    score: 0,
    mobsDefeated: 0,
    unlockedWeapons: ["wooden_sword"],
    equippedWeaponId: "wooden_sword",
    weaponUpgrades: {},
    inMenu: false,
    invulnTimer: 0,
    slowTimer: 0,
    statuses: {},
    idleRegenActive: false,
    attackAnimTimer: 0,
    attackAnimDuration: 0.22,
    animTimer: 0,
    squashX: 1,
    squashY: 1,
    nearbyPortal: null,
    nearbySign: null
  };

  let standingPlatform: CompiledStage["platforms"][number] | CompiledStage["movingPlatforms"][number] | null = null;
  let currentLadder: RuntimeLadder | null = null;
  let coyoteTimer = 0;
  let jumpBufferTimer = 0;
  let dropThroughTimer = 0;
  let portalCooldown = 0;
  let attackCooldown = 0;
  let hurtStunTimer = 0;
  let ladderStepTimer = 0;
  let ladderGrabCooldown = 0;
  let runDustTimer = 0;
  let idleRegenState: IdleRegenState = { idleTimer: 0, tickTimer: 0 };
  const resetIdleRegen = () => {
    idleRegenState = { idleTimer: 0, tickTimer: 0 };
    localPlayer.idleRegenActive = false;
  };
  let lastSafeX = 160;
  let lastSafeY = 660;
  let poseSendTimer = 0;
  let checkpointTimer = 0;
  let lastSavedPosX = 0;
  let lastSavedPosY = 0;
  let stageTransitionPending = false;
  // Death is the server's call. Until it confirms, a player at 0 HP is merely "downed":
  // frozen and untouchable, so nothing they do can race the server's decision.
  let dead = false;
  let reviveRetryTimer: number | undefined;
  const downed = (): boolean => dead || localPlayer.hp <= 0;

  function enterDeath(lostXp: number, lostCoins: number): void {
    const xpVal = Math.max(0, Math.round(lostXp));
    const coinVal = Math.max(0, Math.round(lostCoins));
    deathXp.textContent =
      xpVal === 0 ? (localPlayer.level <= 3 ? "초반 보호 (0)" : "잃을 것 없음") : `-${xpVal.toLocaleString()}`;
    deathCoins.textContent = coinVal === 0 ? "잃을 것 없음" : `-${coinVal.toLocaleString()}`;
    if (dead) return;
    dead = true;
    localPlayer.hp = 0;
    localPlayer.vx = 0;
    localPlayer.vy = 0;
    localPlayer.statuses = {};
    localPlayer.slowTimer = 0;
    resetIdleRegen();
    keysDown.clear();
    virtualDown.clear();
    stageFrame.classList.add("is-dead");
    reviveBtn.disabled = false;
    if (chat.open) chat.open = false;
    if (mapDialog.open) mapDialog.close();
    if (helpDialog.open) helpDialog.close();
    if (inventoryDialog.open) inventoryDialog.close();
    if (shopDialog.open) shopDialog.close();
    if (localPlayer.inMenu) syncMenuMode();
    if (!deathDialog.open) deathDialog.showModal();
    syncChatAvailability();
  }

  function leaveDeath(): void {
    if (!dead) return;
    dead = false;
    window.clearTimeout(reviveRetryTimer);
    stageFrame.classList.remove("is-dead");
    if (deathDialog.open) deathDialog.close();
    syncChatAvailability();
  }

  // The dialog is the only way back: Escape must not dismiss it.
  deathDialog.addEventListener("cancel", (event) => event.preventDefault());
  reviveBtn.addEventListener("click", () => {
    if (!dead || reviveBtn.disabled) return;
    reviveBtn.disabled = true;
    actions.sendAction({ type: "revive", payload: {} });
    // If the request is lost, let the player try again.
    window.clearTimeout(reviveRetryTimer);
    reviveRetryTimer = window.setTimeout(() => {
      reviveBtn.disabled = false;
    }, 4_000);
  });
  let hitStopTimer = 0;
  let shakeTimer = 0;
  let shakeMag = 0;
  let shakeX = 0;
  let shakeY = 0;
  let warpFlash = 0;

  const camera = { x: 0, y: 280, maxX: 0, maxY: 0 };
  let mobs: ClientMobEntity[] = [];
  const mobsById = new Map<string, ClientMobEntity>();
  let items: ClientItemRender[] = [];
  const itemsById = new Map<string, ClientItemRender>();
  const remotePlayers = new Map<string, RemotePlayerSmooth>();
  const projectiles: ClientProjectile[] = [];
  const lootDrops: ClientLootDrop[] = [];
  const damageTexts: ClientDamageText[] = [];
  const hitEffects: ClientHitEffect[] = [];
  const particles: ClientParticle[] = [];

  // Economy, 4x6 Inventory & Shop UI state
  let localInventory: InventorySlot[] = createEmptyInventory();
  let selectedInvSlot = -1;
  let selectedShopInvSlot = -1;
  let selectedShopOfferId: string = SHOP_OFFERS[0]!.id;
  let selectedUpgradeWeaponId = "wooden_sword";
  let invRightTab: "bag" | "smelt" = "bag";
  let selectedSmeltTier: UpgradeStoneTier = 2;
  let selectedSmeltRecipeId: string = "smelt_red_t2";
  let coinHover = false;
  let statusHover = false;
  const hudClickController = createHudClickController();

  const menuModeSync = createMenuModeSync();

  const desiredMenuMode = (): boolean => !downed() && (inventoryDialog.open || shopDialog.open);

  function syncMenuMode(forceSend = false): void {
    const nextInMenu = desiredMenuMode();
    const changed = nextInMenu !== localPlayer.inMenu;
    if (!changed && !forceSend) return;
    if (changed) {
      localPlayer.inMenu = nextInMenu;
      if (nextInMenu) {
        localPlayer.vx = 0;
        localPlayer.vy = 0;
        keysDown.clear();
        virtualDown.clear();
        resetIdleRegen();
      } else {
        localPlayer.invulnTimer = Math.max(localPlayer.invulnTimer, 0.85);
      }
    }
    if (ctx.connected !== false) {
      menuModeSync.markSent(Date.now());
      actions.sendAction({ type: "setMenuMode", payload: { inMenu: nextInMenu } });
    }
  }

  function reconcileMenuModeWithServer(force = false, minIntervalMs = 250): void {
    if (
      menuModeSync.shouldResync({
        connected: ctx.connected !== false,
        desired: desiredMenuMode(),
        now: Date.now(),
        force,
        minIntervalMs
      })
    ) {
      syncMenuMode(true);
    }
  }

  function setFeedback(el: HTMLElement, text: string, tone: "neutral" | "success" | "error" = "neutral"): void {
    el.textContent = text;
    el.classList.remove("is-success", "is-error");
    if (tone === "success") el.classList.add("is-success");
    if (tone === "error") el.classList.add("is-error");
  }

  function makeSpriteIcon(sheet: "economy" | "items", iconIndex: number, sizePx = 36): HTMLElement {
    const span = document.createElement("span");
    span.className = sizePx <= 24 ? "sm-sprite-icon sm-sprite-icon-sm" : "sm-sprite-icon";
    const totalCols = sheet === "economy" ? 6 : 14;
    span.style.width = `${sizePx}px`;
    span.style.height = `${sizePx}px`;
    span.style.backgroundImage = `url("${sheet === "economy" ? economySheetUrl : itemsSheetUrl}")`;
    span.style.backgroundSize = `${totalCols * sizePx}px ${sizePx}px`;
    span.style.backgroundPosition = `${-iconIndex * sizePx}px 0px`;
    return span;
  }

  function makeInventoryItemIcon(itemId: string, sizePx = 32): HTMLElement {
    const spec = INVENTORY_ITEMS[itemId];
    if (!spec) return makeSpriteIcon("economy", 5, sizePx);
    if (spec.kind === "powder") {
      const wrap = document.createElement("span");
      wrap.className = "sm-powder-icon";
      wrap.style.width = `${sizePx}px`;
      wrap.style.height = `${sizePx}px`;
      wrap.textContent = "✦";
      wrap.setAttribute("aria-hidden", "true");
      return wrap;
    }
    const base = makeSpriteIcon(spec.sheet, spec.iconIndex, sizePx);
    if (spec.tier && spec.tier > 1) {
      const wrap = document.createElement("span");
      wrap.className = `sm-tiered-icon is-t${spec.tier}`;
      wrap.style.width = `${sizePx}px`;
      wrap.style.height = `${sizePx}px`;
      const badge = document.createElement("span");
      badge.className = `sm-tier-badge is-t${spec.tier}`;
      badge.textContent = spec.tier === 2 ? "중" : "고";
      wrap.append(base, badge);
      return wrap;
    }
    return base;
  }

  function spawnLootDropArc(
    x: number,
    y: number,
    opts: { sheet: "economy" | "items"; iconIndex: number; color: string; label?: string; vxSpread?: number }
  ): void {
    lootDrops.push({
      id: nextPredId("drop"),
      x,
      y,
      vx: (Math.random() - 0.5) * (opts.vxSpread ?? 140),
      vy: -(240 + Math.random() * 110),
      sheet: opts.sheet,
      iconIndex: opts.iconIndex,
      color: opts.color,
      ...(opts.label ? { label: opts.label } : {}),
      age: 0,
      arcDuration: 0.42 + Math.random() * 0.14,
      collected: false
    });
  }

  function stepLootDrops(dt: number): void {
    const tx = localPlayer.x + localPlayer.w * 0.5;
    const ty = localPlayer.y + localPlayer.h * 0.45;
    for (let i = lootDrops.length - 1; i >= 0; i--) {
      const d = lootDrops[i]!;
      d.age += dt;
      if (d.age < d.arcDuration) {
        d.vy += 760 * dt;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
      } else {
        const dx = tx - d.x;
        const dy = ty - d.y;
        const dist = Math.hypot(dx, dy);
        const speed = 520 + (d.age - d.arcDuration) * 760;
        if (dist <= Math.max(18, speed * dt)) {
          spawnSparkles(tx, ty, d.color, 8);
          lootDrops.splice(i, 1);
          continue;
        }
        d.x += (dx / dist) * speed * dt;
        d.y += (dy / dist) * speed * dt;
      }
      if (d.age > 3.0) {
        lootDrops.splice(i, 1);
      }
    }
  }
  const seenEventIds = new Set<string>();
  const pendingItemPickups = new Map<string, number>();
  // Client-side optimistic prediction tracking (0ms local responsiveness + deduplication)
  const predictedHitIds = new Set<string>();
  const predictedPickupIds = new Set<string>();
  const predictedPotionIds = new Set<string>();
  const predictedRegenIds = new Set<string>();
  const optimisticMobLocks = new Map<string, { hp: number; alive: boolean; expiresAt: number }>();
  const optimisticItemLocks = new Map<string, number>();
  let localPredSeq = 0;
  const nextPredId = (prefix: string) => `${prefix}_${++localPredSeq}_${Date.now().toString(36)}`;
  const weaponSwitchSequence = createWeaponSwitchSequence();
  let pendingWeaponSwitch: { weaponId: string; seq: number; expiresAt: number } | null = null;
  let serverClockOffset = 0;
  let clockSynced = false;

  function hashId(str: string): number {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 4294967296;
  }

  function selectWeaponLocal(wid: string): void {
    if (downed()) return;
    if (!localPlayer.unlockedWeapons.includes(wid) || localPlayer.equippedWeaponId === wid) return;
    const weaponSwitchSeq = weaponSwitchSequence.next();
    pendingWeaponSwitch = {
      weaponId: wid,
      seq: weaponSwitchSeq,
      expiresAt: Date.now() + 2500
    };
    localPlayer.equippedWeaponId = wid;
    actions.sendAction({ type: "switchWeapon", payload: { weaponId: wid, switchSeq: weaponSwitchSeq } });
  }

  function getMobAuthority(mob: ClientMobEntity, now: number): {
    targetX: number;
    targetY: number;
    hasTarget: boolean;
    isLocalAuthority: boolean;
    localDist: number;
  } {
    const mx = mob.x + mob.w * 0.5;
    const my = mob.y + mob.h * 0.5;
    let bestId = "";
    let bestDist = Infinity;
    let bestX = mx;
    let bestY = my;
    let localDist = Infinity;

    if (!downed() && !localPlayer.inMenu) {
      const lx = localPlayer.x + localPlayer.w * 0.5;
      const ly = localPlayer.y + localPlayer.h * 0.5;
      localDist = Math.hypot(lx - mx, ly - my);
      bestId = localPlayer.playerId;
      bestDist = localDist;
      bestX = lx;
      bestY = ly;
    }

    for (const rp of remotePlayers.values()) {
      if (rp.dead || rp.inMenu || now - rp.lastSeenAt > 12_000) continue;
      const rx = rp.x + 14;
      const ry = rp.y + 21;
      const dist = Math.hypot(rx - mx, ry - my);
      if (dist < bestDist - 1 || (Math.abs(dist - bestDist) <= 1 && rp.playerId < bestId)) {
        bestDist = dist;
        bestId = rp.playerId;
        bestX = rx;
        bestY = ry;
      }
    }

    return {
      targetX: bestX,
      targetY: bestY,
      hasTarget: bestId !== "",
      isLocalAuthority: bestId === localPlayer.playerId && bestDist <= 1400,
      localDist
    };
  }

  function spawnText(
    x: number,
    y: number,
    text: string,
    kind: ClientDamageText["kind"] = "normal",
    colorOverride?: string
  ): void {
    const colorMap: Record<ClientDamageText["kind"], [string, string, number]> = {
      normal: ["#FFF176", "#5D3A1A", 20],
      crit: ["#FFD740", "#B71C1C", 26],
      playerHurt: ["#FF5252", "#4A0000", 20],
      heal: ["#69F0AE", "#1B5E20", 19],
      exp: ["#CE93D8", "#311B92", 16],
      levelup: ["#FFD740", "#5D3A1A", 24],
      info: ["#FFF59D", "#5D3A1A", 16]
    };
    const [baseColor, stroke, fontSize] = colorMap[kind];
    damageTexts.push({
      x: x + (Math.random() - 0.5) * 14,
      y,
      vy: kind === "crit" || kind === "levelup" ? -80 : -62,
      text,
      kind,
      age: 0,
      duration: kind === "crit" || kind === "levelup" ? 1.15 : 0.9,
      color: colorOverride ?? baseColor,
      stroke,
      fontSize
    });
  }

  function applyStatusesToMob(
    mob: ClientMobEntity,
    specs: WeaponStatusSpec[] | undefined,
    totalAtk: number,
    sourcePlayerId?: string
  ): void {
    if (!specs || specs.length === 0 || !mob.alive) return;
    for (const spec of specs) {
      const prev = mob.statuses[spec.kind];
      const isFresh = !prev || prev.remaining <= 0.05;
      const tickDamage =
        typeof spec.dotRatio === "number" ? Math.max(1, Math.round(totalAtk * spec.dotRatio)) : prev?.tickDamage;
      const tickInterval = spec.tickIntervalSec ?? prev?.tickInterval ?? 0.8;
      mob.statuses[spec.kind] = {
        kind: spec.kind,
        duration: spec.durationSec,
        remaining: Math.max(prev?.remaining ?? 0, spec.durationSec),
        ...(typeof tickDamage === "number" ? { tickDamage, tickInterval, tickTimer: prev?.tickTimer ?? tickInterval } : {}),
        ...(typeof spec.speedMult === "number" ? { speedMult: spec.speedMult } : {}),
        ...(sourcePlayerId ? { sourcePlayerId } : prev?.sourcePlayerId ? { sourcePlayerId: prev.sourcePlayerId } : {})
      };
      if (spec.kind === "stun") {
        mob.alertTimer = 0;
        mob.alerted = false;
        if (isFresh) {
          spawnText(mob.x + mob.w * 0.5, mob.y - 30, "★ 기절!", "info", "#FFD740");
        }
      } else if (isFresh) {
        const meta = STATUS_METADATA[spec.kind];
        spawnText(mob.x + mob.w * 0.5, mob.y - 28, `${meta.label}!`, "info", meta.color);
      }
    }
  }

  function applyStatusToPlayer(
    kind: StatusEffectKind,
    durationSec: number,
    opts?: { tickDamage?: number; tickInterval?: number; speedMult?: number }
  ): void {
    const prev = localPlayer.statuses[kind];
    const isFresh = !prev || prev.remaining <= 0.05;
    const tickInterval = opts?.tickInterval ?? prev?.tickInterval;
    localPlayer.statuses[kind] = {
      kind,
      duration: durationSec,
      remaining: Math.max(prev?.remaining ?? 0, durationSec),
      ...(typeof opts?.tickDamage === "number"
        ? {
            tickDamage: opts.tickDamage,
            tickInterval: tickInterval ?? 1.0,
            tickTimer: prev?.tickTimer ?? (tickInterval ?? 1.0)
          }
        : {}),
      ...(typeof opts?.speedMult === "number" ? { speedMult: opts.speedMult } : {})
    };
    if (kind === "slow") {
      localPlayer.slowTimer = Math.max(localPlayer.slowTimer, durationSec);
    }
    if (isFresh) {
      const meta = STATUS_METADATA[kind];
      spawnText(localPlayer.x + localPlayer.w * 0.5, localPlayer.y - 34, `${meta.label}!`, "info", meta.color);
    }
  }

  function spawnHitBurst(x: number, y: number, color: string, isCrit: boolean): void {
    hitEffects.push({
      type: "starburst",
      x,
      y,
      color,
      isCrit,
      radius: isCrit ? 34 : 24,
      rotation: Math.random() * Math.PI,
      age: 0,
      duration: isCrit ? 0.28 : 0.2
    });
    const count = isCrit ? 12 : 7;
    for (let i = 0; i < count; i++) {
      const ang = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
      const spd = (isCrit ? 170 : 115) + Math.random() * 100;
      particles.push({
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 40,
        gravity: 400,
        size: isCrit ? 5 + Math.random() * 3 : 3.5 + Math.random() * 2.5,
        color: i % 2 === 0 ? color : "#FFFFFF",
        age: 0,
        duration: 0.32 + Math.random() * 0.16,
        shape: isCrit && i % 2 === 0 ? "star" : "circle"
      });
    }
  }

  function spawnLevelUpEffect(x: number, y: number, level: number): void {
    hitEffects.push({
      type: "levelup_pillar",
      x,
      y,
      level,
      age: 0,
      duration: 1.75
    });
    for (let i = 0; i < 28; i++) {
      const ang = (Math.PI * 2 * i) / 28;
      const spd = 85 + Math.random() * 170;
      particles.push({
        x,
        y: y - 24,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 120,
        gravity: 240,
        size: 5 + Math.random() * 4,
        color: i % 2 === 0 ? "#FFD740" : "#FFFFFF",
        age: 0,
        duration: 0.65 + Math.random() * 0.45,
        shape: "star"
      });
    }
  }

  function spawnSparkles(x: number, y: number, color: string, count = 10): void {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 50 + Math.random() * 95;
      particles.push({
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 45,
        gravity: 160,
        size: 4 + Math.random() * 3,
        color,
        age: 0,
        duration: 0.38 + Math.random() * 0.2,
        shape: "star"
      });
    }
  }

  function triggerShake(mag: number, dur: number): void {
    shakeMag = Math.max(shakeMag, mag);
    shakeTimer = Math.max(shakeTimer, dur);
  }

  function loadStageLocal(stageId: string, spawnX?: number, spawnY?: number): void {
    const norm = getStageById(stageId);
    compiledStage = compileStageForRuntime(norm);
    currentStageId = norm.meta.id;
    stageBadge.textContent = `STAGE ${norm.meta.stageNumber}`;
    stageTitle.textContent = ctx.room.roomName ? `${ctx.room.roomName} · ${norm.meta.name}` : norm.meta.name;

    mobs = [];
    mobsById.clear();
    for (const ms of compiledStage.mobSpawns) {
      const tpl = MOB_CATALOG[ms.templateId]!;
      const startX = ms.x - tpl.width * 0.5;
      const startY = tpl.flying ? ms.y - tpl.height - 76 : ms.y - tpl.height;
      const seed = hashId(ms.id);
      const mob: ClientMobEntity = {
        id: ms.id,
        tpl,
        name: tpl.name,
        level: tpl.level,
        spriteKey: tpl.spriteKey,
        primaryColor: tpl.primaryColor,
        w: tpl.width,
        h: tpl.height,
        x: startX,
        y: startY,
        homeX: startX,
        homeY: startY,
        vx: 0,
        vy: 0,
        facing: ms.facing,
        grounded: !tpl.flying,
        alive: true,
        hp: tpl.hp,
        maxHp: tpl.hp,
        displayHp: tpl.hp,
        inCombat: false,
        spawnProtectUntil: 0,
        alertTimer: 0,
        alerted: false,
        alertResetTimer: 0,
        hitFlashTimer: 0,
        hitStunTimer: 0,
        animTimer: seed * 10,
        drawScale: tpl.drawScale,
        hasCrown: Boolean(tpl.hasCrown),
        isElite: Boolean(tpl.isElite),
        squashX: 1,
        squashY: 1,
        statuses: {},
        patrolMinX: ms.patrolMinX,
        patrolMaxX: ms.patrolMaxX,
        aiTimer: 0.6 + seed * 0.9,
        aiPhase: "idle",
        shootTimer: 1.2 + seed * 1.2,
        teleportTimer: 2.2 + seed * 1.4,
        authX: startX,
        authY: startY,
        authVx: 0,
        authVy: 0,
        authFacing: ms.facing,
        lastAuthAt: 0
      };
      mobs.push(mob);
      mobsById.set(mob.id, mob);
    }

    items = [];
    itemsById.clear();
    for (const is of compiledStage.itemSpawns) {
      const item: ClientItemRender = {
        id: is.id,
        templateId: is.templateId,
        x: is.x,
        y: is.y,
        available: true,
        bobPhase: is.bobPhase
      };
      items.push(item);
      itemsById.set(item.id, item);
    }

    remotePlayers.clear();
    projectiles.length = 0;
    lootDrops.length = 0;
    pendingItemPickups.clear();
    optimisticMobLocks.clear();
    optimisticItemLocks.clear();

    if (spawnX !== undefined && spawnY !== undefined) {
      localPlayer.x = spawnX;
      localPlayer.y = spawnY;
      localPlayer.vx = 0;
      localPlayer.vy = 0;
      localPlayer.grounded = false;
      localPlayer.onLadder = false;
      localPlayer.statuses = {};
      localPlayer.slowTimer = 0;
      standingPlatform = null;
      currentLadder = null;
      lastSafeX = spawnX;
      lastSafeY = spawnY;
    }

    camera.maxX = Math.max(0, compiledStage.meta.worldWidth - VIEWPORT.width);
    camera.maxY = Math.max(0, compiledStage.meta.worldHeight - VIEWPORT.height);
    camera.x = Math.max(0, Math.min(camera.maxX, localPlayer.x - VIEWPORT.width * 0.42));
    camera.y = Math.max(0, Math.min(camera.maxY, localPlayer.y - VIEWPORT.height * 0.55));
    warpFlash = 0.25;
  }

  function reconcileSnapshot(snap: GameClientSnapshot): void {
    const priv = snap.privateView as Partial<WorldPlayerState>;
    const pub = snap.publicView as {
      stageId?: string;
      stagePlayerCount?: number;
      totalPlayersOnline?: number;
      stagePlayerCounts?: Record<string, number>;
      mobs?: Record<string, Omit<ServerMobState, "statuses"> & { statuses?: StatusEffectKind[] }>;
      items?: Record<string, ServerItemState>;
      nearbyPlayers?: RemotePlayerView[];
    };

    const nowClock = Date.now();
    const measuredOffset = snap.serverTime - nowClock;
    if (!clockSynced || Math.abs(measuredOffset - serverClockOffset) > 1500) {
      serverClockOffset = measuredOffset;
      clockSynced = true;
    } else {
      serverClockOffset += (measuredOffset - serverClockOffset) * 0.25;
    }

    const seat = snap.room.players.find((p) => p.playerId === snap.playerId);
    localPlayer.displayName = priv.displayName || seat?.displayName || localPlayer.displayName;
    if (typeof priv.level === "number") localPlayer.level = priv.level;
    if (typeof priv.xp === "number") localPlayer.xp = priv.xp;
    if (typeof priv.xpToNext === "number") localPlayer.xpToNext = priv.xpToNext;
    if (typeof priv.maxHp === "number") localPlayer.maxHp = priv.maxHp;
    if (typeof priv.hp === "number") localPlayer.hp = priv.hp;
    if (typeof priv.baseAtk === "number") localPlayer.baseAtk = priv.baseAtk;
    if (typeof priv.baseDex === "number") localPlayer.baseDex = priv.baseDex;
    else localPlayer.baseDex = computePlayerBaseDex(localPlayer.level);
    if (typeof priv.potions === "number") localPlayer.potions = priv.potions;
    if (typeof priv.coins === "number") localPlayer.coins = priv.coins;
    if (typeof priv.score === "number") localPlayer.score = priv.score;
    if (typeof priv.mobsDefeated === "number") localPlayer.mobsDefeated = priv.mobsDefeated;
    if (Array.isArray(priv.inventory)) localInventory = normalizeInventory(priv.inventory);
    if (priv.weaponUpgrades && typeof priv.weaponUpgrades === "object") {
      localPlayer.weaponUpgrades = normalizeWeaponUpgrades(priv.weaponUpgrades);
    }
    if (Array.isArray(priv.unlockedWeapons)) localPlayer.unlockedWeapons = [...priv.unlockedWeapons];
    const srvSeq = weaponSwitchSequence.observe(priv.weaponSwitchSeq);
    if (typeof priv.equippedWeaponId === "string") {
      if (pendingWeaponSwitch && nowClock < pendingWeaponSwitch.expiresAt) {
        const caughtUp =
          (pendingWeaponSwitch.seq > 0 && srvSeq >= pendingWeaponSwitch.seq) ||
          (pendingWeaponSwitch.seq === 0 && priv.equippedWeaponId === pendingWeaponSwitch.weaponId);
        if (caughtUp) {
          localPlayer.equippedWeaponId = priv.equippedWeaponId;
          pendingWeaponSwitch = null;
        } else if (localPlayer.unlockedWeapons.includes(pendingWeaponSwitch.weaponId)) {
          localPlayer.equippedWeaponId = pendingWeaponSwitch.weaponId;
        } else {
          localPlayer.equippedWeaponId = priv.equippedWeaponId;
          pendingWeaponSwitch = null;
        }
      } else {
        pendingWeaponSwitch = null;
        localPlayer.equippedWeaponId = priv.equippedWeaponId;
      }
    }
    if (typeof priv.highestStageNumber === "number") highestStageNumber = priv.highestStageNumber;
    const targetStageId = priv.stageId || pub.stageId || "stage-1";
    if (priv.dead === true) {
      const pen = deathPenaltyOf({
        xp: localPlayer.xp,
        coins: localPlayer.coins,
        level: localPlayer.level,
        stageId: targetStageId
      });
      enterDeath(pen.lostXp, pen.lostCoins);
    } else {
      leaveDeath();
    }
    menuModeSync.observeServer(Boolean(priv.inMenu));
    reconcileMenuModeWithServer(false);

    const stageChanged = targetStageId !== currentStageId;
    if (stageChanged) {
      stageTransitionPending = false;
      loadStageLocal(
        targetStageId,
        typeof priv.x === "number" ? priv.x : compiledStage.spawn.x,
        typeof priv.y === "number" ? priv.y : compiledStage.spawn.y - localPlayer.h
      );
      lastSavedPosX = localPlayer.x;
      lastSavedPosY = localPlayer.y;
    }

    if (typeof pub.stagePlayerCount === "number") stagePlayerCount = pub.stagePlayerCount;
    if (typeof pub.totalPlayersOnline === "number") totalPlayersOnline = pub.totalPlayersOnline;
    if (pub.stagePlayerCounts) stagePlayerCounts = pub.stagePlayerCounts;

    // Sync mobs from authoritative server stage view (respecting active optimistic hit locks)
    if (pub.mobs) {
      const nowLocal = Date.now();
      const serverTimeOffset = nowLocal - snap.serverTime;
      for (const [id, sm] of Object.entries(pub.mobs)) {
        const mob = mobsById.get(id);
        if (!mob) continue;
        const lock = optimisticMobLocks.get(id);
        if (lock && nowLocal < lock.expiresAt) {
          // Only accept lower HP or death from server while our hit is in-flight
          if (!sm.alive) {
            mob.alive = false;
            mob.hp = 0;
            mob.inCombat = false;
            optimisticMobLocks.delete(id);
          } else {
            mob.hp = Math.min(mob.hp, sm.hp);
            mob.alive = lock.alive;
            mob.inCombat = mob.inCombat || sm.inCombat;
          }
        } else {
          if (lock) optimisticMobLocks.delete(id);
          mob.alive = sm.alive;
          mob.hp = sm.hp;
          mob.maxHp = sm.maxHp;
          if (mob.displayHp < sm.hp) mob.displayHp = sm.hp;
          mob.inCombat = sm.inCombat;
        }
        mob.spawnProtectUntil = sm.spawnProtectUntil > 0 ? sm.spawnProtectUntil + serverTimeOffset : 0;
        if (!mob.alive) {
          mob.statuses = {};
        } else if (Array.isArray(sm.statuses)) {
          for (const stKind of sm.statuses) {
            if (!mob.statuses[stKind] || mob.statuses[stKind]!.remaining <= 0) {
              mob.statuses[stKind] = { kind: stKind, duration: 1.0, remaining: 1.0 };
            }
          }
        }

        // Apply server-stored mob position & kinematics on stage load or when not local authority
        if (typeof sm.x === "number" && typeof sm.y === "number") {
          mob.authX = sm.x;
          mob.authY = sm.y;
          mob.authVx = typeof sm.vx === "number" ? sm.vx : 0;
          mob.authVy = typeof sm.vy === "number" ? sm.vy : 0;
          mob.authFacing = typeof sm.facing === "number" ? (sm.facing < 0 ? -1 : 1) : mob.facing;
          mob.lastAuthAt = nowLocal;
          if (stageChanged) {
            mob.x = sm.x;
            mob.y = sm.y;
            mob.vx = mob.authVx;
            mob.vy = mob.authVy;
            mob.facing = mob.authFacing;
          }
        }
      }
    }

    // Sync items (respecting active optimistic pickup locks so items never flicker back)
    if (pub.items) {
      const nowLocal = Date.now();
      for (const [id, si] of Object.entries(pub.items)) {
        const item = itemsById.get(id);
        if (!item) continue;
        const lockUntil = optimisticItemLocks.get(id);
        if (lockUntil && nowLocal < lockUntil && si.available) {
          continue;
        }
        if (!si.available && lockUntil) optimisticItemLocks.delete(id);
        item.available = si.available;
      }
    }

    // Sync nearby players on the same stage
    if (Array.isArray(pub.nearbyPlayers)) {
      const present = new Set<string>();
      const now = Date.now();
      for (const rp of pub.nearbyPlayers) {
        if (rp.playerId === snap.playerId || rp.stageId !== currentStageId) continue;
        present.add(rp.playerId);
        const existing = remotePlayers.get(rp.playerId);
        if (existing) {
          existing.displayName = rp.displayName;
          existing.level = rp.level;
          existing.hp = rp.hp;
          existing.maxHp = rp.maxHp;
          existing.equippedWeaponId = rp.equippedWeaponId;
          existing.facing = rp.facing;
          existing.animState = rp.animState;
          existing.dead = Boolean(rp.dead);
          existing.inMenu = Boolean(rp.inMenu);
          existing.targetX = rp.x;
          existing.targetY = rp.y;
          existing.vx = rp.vx;
          existing.vy = rp.vy;
          existing.lastSeenAt = now;
        } else {
          remotePlayers.set(rp.playerId, {
            ...rp,
            dead: Boolean(rp.dead),
            inMenu: Boolean(rp.inMenu),
            targetX: rp.x,
            targetY: rp.y,
            lastSeenAt: now
          });
        }
      }
      if (stageChanged) {
        for (const pid of [...remotePlayers.keys()]) {
          if (!present.has(pid)) remotePlayers.delete(pid);
        }
      }
    }
  }

  /**
   * The host calls update() for chat, presence and event-only changes too,
   * passing the last snapshot again. Reconcile world state only when the
   * snapshot itself is new, otherwise it would undo what later events did.
   */
  let lastReconciledSnapshot = "";

  function applySnapshot(snap: GameClientSnapshot): void {
    const snapshotKey = `${snap.version}:${snap.serverTime}`;
    if (snapshotKey !== lastReconciledSnapshot) {
      lastReconciledSnapshot = snapshotKey;
      reconcileSnapshot(snap);
    }

    // Process recent events deduplicated by id
    if (snap.events) {
      for (const ev of snap.events) {
        if (seenEventIds.has(ev.id)) continue;
        seenEventIds.add(ev.id);
        if (seenEventIds.size > 1000) {
          const first = seenEventIds.values().next().value;
          if (first) seenEventIds.delete(first);
        }
        handleServerEvent(ev, snap.serverTime);
      }
    }

    chat.messages = snap.chatMessages;
    if (mapDialog.open) renderStageMapDialog();
    if (inventoryDialog.open) renderInventoryDialog();
    if (shopDialog.open) renderShopDialog();
  }

  function handleServerEvent(ev: GameEvent, serverTime: number): void {
    const p = ev.payload;
    if (typeof p.stageId === "string" && p.stageId !== currentStageId) return;
    const nowOffset = Date.now() - serverTime;

    if (ev.type === "sunny.actionIgnored") {
      // Lost an optimistic race (e.g. another player claimed a Golden Heart or killed a mob earlier);
      // clear optimistic locks so the fresh server snapshot reconciles immediately.
      if (p.action === "attackMob") optimisticMobLocks.clear();
      if (p.action === "collectItem") optimisticItemLocks.clear();
      if (p.reason === "in_menu") {
        menuModeSync.observeServer(true);
        reconcileMenuModeWithServer(true);
        return;
      }
      if (p.action === "shopBuy" || p.action === "shopSell") {
        const msgMap: Record<string, string> = {
          insufficient_coins: "코인 부족",
          inventory_full: "가방 가득 참",
          economy_cooldown: "잠시 후 재시도"
        };
        setFeedback(shopFeedbackEl, msgMap[String(p.reason ?? "")] ?? "거래 실패", "error");
      } else if (p.action === "upgradeWeapon") {
        const msgMap: Record<string, string> = {
          upgrade_maxed: "최대 강화(+10)",
          insufficient_coins: "코인 부족",
          insufficient_stones: "강화석 부족",
          economy_cooldown: "잠시 후 재시도"
        };
        setFeedback(invFeedbackEl, msgMap[String(p.reason ?? "")] ?? "강화 실패", "error");
      } else if (p.action === "dismantleItem") {
        const msgMap: Record<string, string> = {
          inventory_full: "가방 가득 참",
          undismantleable_item: "분해 불가 아이템",
          economy_cooldown: "잠시 후 재시도"
        };
        setFeedback(invFeedbackEl, msgMap[String(p.reason ?? "")] ?? "분해 실패", "error");
      } else if (p.action === "smeltStone") {
        const msgMap: Record<string, string> = {
          insufficient_coins: "코인 부족",
          insufficient_powder: "강화석 가루 부족",
          inventory_full: "가방 가득 참",
          economy_cooldown: "잠시 후 재시도"
        };
        setFeedback(invFeedbackEl, msgMap[String(p.reason ?? "")] ?? "제련 실패", "error");
      }
      return;
    }

    if (ev.type === "sunny.playerMenuMode") {
      const pid = String(p.playerId ?? "");
      if (pid === ctx.playerId) {
        menuModeSync.observeServer(Boolean(p.inMenu));
      } else if (pid) {
        const rp = remotePlayers.get(pid);
        if (rp) rp.inMenu = Boolean(p.inMenu);
      }
      return;
    }

    if (ev.type === "sunny.shopResult" && p.playerId === ctx.playerId) {
      const kind = String(p.kind ?? "");
      const itemName = String(p.itemName ?? "아이템");
      const qty = Number(p.quantity ?? 1);
      const delta = Number(p.coinsDelta ?? 0);
      if (kind === "buy") {
        setFeedback(shopFeedbackEl, `${itemName} ×${qty} 구매 (${delta.toLocaleString()})`, "success");
        audio.playSfx("sfx_item_pickup", 0.03);
      } else {
        setFeedback(shopFeedbackEl, `${itemName} ×${qty} 판매 (+${delta.toLocaleString()})`, "success");
        audio.playSfx("sfx_item_pickup", 0.03);
      }
      if (shopDialog.open) renderShopDialog();
      if (inventoryDialog.open) renderInventoryDialog();
      return;
    }

    if (ev.type === "sunny.weaponUpgraded" && p.playerId === ctx.playerId) {
      const wName = String(p.weaponName ?? "무기");
      const stat = p.stat === "dex" ? "공격속도" : "공격력";
      const ok = Boolean(p.success);
      const tot = Number(p.totalLevel ?? 0);
      if (ok) {
        setFeedback(invFeedbackEl, `★ ${wName} +${tot} (${stat}↑)`, "success");
        audio.playSfx("sfx_level_up", 0.04);
      } else {
        const failStreak = Number(p.failStreak ?? 0);
        setFeedback(invFeedbackEl, `강화 실패 · 보정 +${Math.min(25, failStreak * 5)}%`, "error");
        audio.playSfx("sfx_land", 0.04);
      }
      if (inventoryDialog.open) renderInventoryDialog();
      return;
    }

    if (ev.type === "sunny.itemDismantled" && p.playerId === ctx.playerId) {
      const itemName = String(p.itemName ?? "강화석");
      const qty = Number(p.quantity ?? 1);
      const powder = Number(p.powderGained ?? 0);
      setFeedback(invFeedbackEl, `${itemName} ×${qty} 분해 → 가루 +${powder}`, "success");
      audio.playSfx("sfx_item_pickup", 0.03);
      if (inventoryDialog.open) renderInventoryDialog();
      if (shopDialog.open) renderShopDialog();
      return;
    }

    if (ev.type === "sunny.stoneSmelted" && p.playerId === ctx.playerId) {
      const itemName = String(p.itemName ?? "강화석");
      const qty = Number(p.quantity ?? 1);
      setFeedback(invFeedbackEl, `★ ${itemName} ×${qty} 제련 완료`, "success");
      audio.playSfx("sfx_level_up", 0.04);
      if (inventoryDialog.open) renderInventoryDialog();
      if (shopDialog.open) renderShopDialog();
      return;
    }

    if (ev.type === "sunny.chestOpened") {
      const item = itemsById.get(String(p.itemId ?? ""));
      const openerId = String(p.openerId ?? "");
      const coinsWon = Number(p.coins ?? 0);
      const stone = p.droppedStone as
        | { itemId: string; name: string; quantity: number; overflow: number; color: string; iconIndex: number }
        | undefined;
      if (item) {
        item.available = false;
        item.openingTimer = 1.25;
        optimisticItemLocks.delete(item.id);
        spawnSparkles(item.x, item.y - 6, "#FFD740", 18);
        if (openerId === ctx.playerId) {
          audio.playSfx("sfx_potion", 0);
          spawnText(item.x, item.y - 26, `★ 보물 상자 +${coinsWon} 코인!`, "crit");
          // Burst of gleaming gold coins arcing out of the chest & flying into the player!
          const coinBurst = Math.min(7, Math.max(4, Math.floor(coinsWon / 40) + 4));
          for (let i = 0; i < coinBurst; i++) {
            spawnLootDropArc(item.x, item.y - 8, {
              sheet: "items",
              iconIndex: 3,
              color: "#FFD740",
              vxSpread: 190
            });
          }
          if (stone) {
            spawnLootDropArc(item.x, item.y - 14, {
              sheet: "economy",
              iconIndex: stone.iconIndex,
              color: stone.color,
              label: `★ ${stone.name} ×${stone.quantity}`,
              vxSpread: 120
            });
            const msg =
              stone.overflow > 0
                ? `${stone.name} 획득 (가방 가득 참!)`
                : `★ ${stone.name} ×${stone.quantity} 획득!`;
            spawnText(item.x, item.y - 52, msg, "info", stone.color);
          }
        }
      }
      return;
    }

    if (ev.type === "sunny.weaponChanged") {
      const pid = String(p.playerId ?? "");
      const wid = typeof p.weaponId === "string" ? p.weaponId : "";
      if (pid && pid !== ctx.playerId && wid) {
        const rp = remotePlayers.get(pid);
        if (rp) rp.equippedWeaponId = wid;
      }
      return;
    }

    if (ev.type === "sunny.playerPose") {
      const pid = String(p.playerId ?? "");
      if (!pid || pid === ctx.playerId) return;
      const existing = remotePlayers.get(pid);
      const now = Date.now();
      if (existing) {
        existing.targetX = Number(p.x ?? existing.targetX);
        existing.targetY = Number(p.y ?? existing.targetY);
        existing.vx = Number(p.vx ?? 0);
        existing.vy = Number(p.vy ?? 0);
        existing.facing = Number(p.facing ?? 1);
        existing.animState = (p.animState as RemotePlayerView["animState"]) ?? "idle";
        existing.level = Number(p.level ?? existing.level);
        existing.displayName = String(p.displayName ?? existing.displayName);
        existing.equippedWeaponId = String(p.equippedWeaponId ?? existing.equippedWeaponId);
        existing.dead = false;
        existing.lastSeenAt = now;
      } else {
        remotePlayers.set(pid, {
          playerId: pid,
          displayName: String(p.displayName ?? "모험가"),
          stageId: currentStageId,
          x: Number(p.x ?? 160),
          y: Number(p.y ?? 660),
          targetX: Number(p.x ?? 160),
          targetY: Number(p.y ?? 660),
          vx: Number(p.vx ?? 0),
          vy: Number(p.vy ?? 0),
          facing: Number(p.facing ?? 1),
          animState: (p.animState as RemotePlayerView["animState"]) ?? "idle",
          level: Number(p.level ?? 1),
          hp: Number(p.hp ?? 100),
          maxHp: Number(p.maxHp ?? 100),
          equippedWeaponId: String(p.equippedWeaponId ?? "wooden_sword"),
          dead: false,
          lastSeenAt: now
        });
      }

      // Apply nearest-player authoritative mob kinematics relayed by the server
      if (Array.isArray(p.mobs)) {
        for (const entry of p.mobs) {
          if (!Array.isArray(entry) || entry.length < 6) continue;
          const mob = mobsById.get(String(entry[0]));
          if (!mob || !mob.alive || now < mob.spawnProtectUntil) continue;
          const mx = Number(entry[1]);
          const my = Number(entry[2]);
          if (!Number.isFinite(mx) || !Number.isFinite(my)) continue;
          mob.authX = mx;
          mob.authY = my;
          mob.authVx = Number.isFinite(Number(entry[3])) ? Number(entry[3]) : 0;
          mob.authVy = Number.isFinite(Number(entry[4])) ? Number(entry[4]) : 0;
          mob.authFacing = Number(entry[5]) < 0 ? -1 : 1;
          mob.lastAuthAt = now;
        }
      }
      return;
    }

    if (ev.type === "sunny.playerJoined") {
      if (typeof p.stagePlayerCount === "number") stagePlayerCount = p.stagePlayerCount;
      const joined = p.player as RemotePlayerView | undefined;
      if (joined && joined.playerId !== ctx.playerId) {
        remotePlayers.set(joined.playerId, {
          ...joined,
          targetX: joined.x,
          targetY: joined.y,
          lastSeenAt: Date.now()
        });
        spawnSparkles(joined.x + 14, joined.y + 20, "#80DEEA", 10);
      }
      return;
    }

    if (ev.type === "sunny.playerLeft") {
      if (typeof p.stagePlayerCount === "number") stagePlayerCount = p.stagePlayerCount;
      const pid = String(p.playerId ?? "");
      remotePlayers.delete(pid);
      return;
    }

    if (ev.type === "sunny.mobHit") {
      const mob = mobsById.get(String(p.mobId ?? ""));
      if (!mob) return;
      const clientHitId = typeof p.clientHitId === "string" ? p.clientHitId : "";
      const wasPredictedByMe = p.attackerId === ctx.playerId && clientHitId !== "" && predictedHitIds.has(clientHitId);
      if (wasPredictedByMe) {
        predictedHitIds.delete(clientHitId);
        // Reconcile HP gently without replaying duplicate VFX/SFX/knockback
        const srvHp = Number(p.hp ?? mob.hp);
        if (srvHp < mob.hp) mob.hp = srvHp;
        if (srvHp <= 0) {
          mob.alive = false;
          mob.inCombat = false;
          optimisticMobLocks.delete(mob.id);
        }
        return;
      }

      const dmg = Number(p.damage ?? 0);
      const isCrit = Boolean(p.isCrit);
      const hitKind = p.hitKind === "splash" || p.hitKind === "dot" ? p.hitKind : "primary";
      const dotStatus =
        hitKind === "dot" && typeof p.dotStatus === "string" ? (p.dotStatus as StatusEffectKind) : undefined;
      const knockDir = hitKind === "dot" ? 0 : Number(p.knockDir ?? 1);
      const kbX = Number(p.knockbackX ?? 200) * (1 - mob.tpl.knockbackResist);
      const kbY = Number(p.knockbackY ?? -160) * (1 - mob.tpl.knockbackResist);

      if (typeof p.x === "number" && typeof p.y === "number" && Number.isFinite(p.x) && Number.isFinite(p.y)) {
        mob.x = p.x;
        mob.y = p.y;
        mob.authX = p.x;
        mob.authY = p.y;
        mob.lastAuthAt = Date.now();
      }
      mob.hp = Number(p.hp ?? mob.hp);
      mob.inCombat = true;
      mob.hitFlashTimer = hitKind === "dot" ? 0.08 : 0.14;

      if (hitKind !== "dot") {
        mob.hitStunTimer = isCrit ? 0.28 : 0.2;
        mob.vx = knockDir * kbX;
        mob.vy = kbY;
        mob.grounded = false;
        if (knockDir !== 0) mob.facing = -knockDir;
        mob.squashX = 1.24;
        mob.squashY = 0.78;
      }

      if (Array.isArray(p.appliedStatuses)) {
        applyStatusesToMob(
          mob,
          p.appliedStatuses as WeaponStatusSpec[],
          Math.max(10, dmg),
          typeof p.attackerId === "string" ? p.attackerId : undefined
        );
      }

      if (hitKind === "dot" && dotStatus) {
        const meta = STATUS_METADATA[dotStatus];
        spawnSparkles(mob.x + mob.w * 0.5, mob.y + mob.h * 0.45, meta.color, 5);
        spawnText(mob.x + mob.w * 0.5, mob.y - 10, `${dmg}`, "info", meta.color);
      } else {
        spawnHitBurst(mob.x + mob.w * 0.5, mob.y + mob.h * 0.45, isCrit ? "#FFD740" : "#FFE082", isCrit);
        spawnText(mob.x + mob.w * 0.5, mob.y - 12, isCrit ? `${dmg}!` : `${dmg}`, isCrit ? "crit" : "normal");
      }

      if (p.attackerId === ctx.playerId && hitKind !== "dot") {
        hitStopTimer = isCrit ? 0.05 : 0.032;
        triggerShake(isCrit ? 6 : 3, isCrit ? 0.15 : 0.09);
        audio.playSfx(isCrit ? "sfx_crit" : "sfx_hit", 0.06);
      }
      return;
    }

    if (ev.type === "sunny.mobDefeated") {
      const mob = mobsById.get(String(p.mobId ?? ""));
      if (mob) {
        const alreadyLocallyDead = !mob.alive;
        mob.alive = false;
        mob.hp = 0;
        mob.inCombat = false;
        mob.statuses = {};
        optimisticMobLocks.delete(mob.id);
        if (!alreadyLocallyDead) {
          spawnSparkles(mob.x + mob.w * 0.5, mob.y + mob.h * 0.5, mob.primaryColor, 16);
        }
        if (p.killerPlayerId === ctx.playerId) {
          const gainedXp = Number(p.gainedXp ?? 0);
          const eff = Number(p.xpEfficiency ?? 1);
          const effSuffix = eff < 0.5 ? " (효율↓)" : "";
          spawnText(mob.x + mob.w * 0.5, mob.y - 30, `+${gainedXp} EXP${effSuffix}`, "exp");
          if (!alreadyLocallyDead) {
            audio.playSfx("sfx_mob_defeat", 0.05);
          }
          const stone = p.droppedStone as
            | { itemId: string; name: string; quantity: number; overflow: number; color: string; iconIndex: number }
            | undefined;
          if (stone) {
            const dropX = typeof p.mobX === "number" ? p.mobX + mob.w * 0.5 : mob.x + mob.w * 0.5;
            const dropY = typeof p.mobY === "number" ? p.mobY + mob.h * 0.4 : mob.y + mob.h * 0.4;
            spawnLootDropArc(dropX, dropY, {
              sheet: "economy",
              iconIndex: stone.iconIndex,
              color: stone.color,
              label: `★ ${stone.name}`,
              vxSpread: 130
            });
            spawnText(
              dropX,
              dropY - 46,
              stone.overflow > 0 ? `${stone.name} 드롭 (인벤토리 가득 참!)` : `★ ${stone.name} 드롭!`,
              "info",
              stone.color
            );
            audio.playSfx("sfx_item_pickup", 0.02);
          }
        }
      }
      return;
    }

    if (ev.type === "sunny.mobsRespawned") {
      const list =
        (p.mobs as Array<{
          id: string;
          hp: number;
          maxHp: number;
          x?: number;
          y?: number;
          facing?: number;
          spawnProtectUntil: number;
        }>) ?? [];
      for (const rm of list) {
        const mob = mobsById.get(rm.id);
        if (!mob) continue;
        optimisticMobLocks.delete(rm.id);
        mob.alive = true;
        mob.hp = rm.hp;
        mob.maxHp = rm.maxHp;
        mob.displayHp = rm.hp;
        mob.inCombat = false;
        mob.x = typeof rm.x === "number" ? rm.x : mob.homeX;
        mob.y = typeof rm.y === "number" ? rm.y : mob.homeY;
        mob.vx = 0;
        mob.vy = 0;
        if (typeof rm.facing === "number") mob.facing = rm.facing < 0 ? -1 : 1;
        mob.authX = mob.x;
        mob.authY = mob.y;
        mob.authVx = 0;
        mob.authVy = 0;
        mob.authFacing = mob.facing;
        mob.lastAuthAt = 0;
        mob.hitStunTimer = 0;
        mob.alertTimer = 0;
        mob.alerted = false;
        mob.alertResetTimer = 0;
        mob.statuses = {};
        // Measure the protection from the event's own timestamp: `serverTime` is the last
        // snapshot's, which may be minutes old when an event arrives on its own.
        mob.spawnProtectUntil = Date.now() + Math.max(0, rm.spawnProtectUntil - ev.createdAt);
        spawnSparkles(mob.x + mob.w * 0.5, mob.y + mob.h * 0.5, "#80DEEA", 10);
      }
      return;
    }

    if (ev.type === "sunny.itemCollected") {
      const item = itemsById.get(String(p.itemId ?? ""));
      const clientPickupId = typeof p.clientPickupId === "string" ? p.clientPickupId : "";
      const wasPredicted = p.collectorId === ctx.playerId && clientPickupId !== "" && predictedPickupIds.has(clientPickupId);
      if (wasPredicted) predictedPickupIds.delete(clientPickupId);
      if (item) {
        item.available = false;
        optimisticItemLocks.delete(item.id);
        if (p.collectorId === ctx.playerId && !wasPredicted) {
          const tpl = ITEM_CATALOG[item.templateId];
          if (tpl) {
            spawnSparkles(item.x, item.y, tpl.glowColor, 10);
            audio.playSfx(tpl.sfx, 0.05);
            if (tpl.category === "potion") spawnText(item.x, item.y - 12, "포션 +1!", "info");
            else if (tpl.category === "max_hp") spawnText(item.x, item.y - 16, `최대체력 +${tpl.maxHpBonus}!`, "heal");
            else if (tpl.category === "heal") spawnText(item.x, item.y - 12, `+${tpl.healAmount} HP`, "heal");
          }
        }
      }
      return;
    }

    if (ev.type === "sunny.itemsRespawned") {
      const ids = (p.itemIds as string[]) ?? [];
      for (const id of ids) {
        optimisticItemLocks.delete(id);
        const item = itemsById.get(id);
        if (item) item.available = true;
      }
      return;
    }

    if (ev.type === "sunny.weaponUnlocked") {
      const clientPickupId = typeof p.clientPickupId === "string" ? p.clientPickupId : "";
      const wasPredicted = clientPickupId !== "" && predictedPickupIds.has(clientPickupId);
      if (wasPredicted) {
        predictedPickupIds.delete(clientPickupId);
        return;
      }
      const wName = String(p.weaponName ?? "새 무기");
      spawnText(localPlayer.x + 14, localPlayer.y - 24, `★ ${wName} 획득!`, "crit");
      spawnSparkles(localPlayer.x + 14, localPlayer.y + 12, "#FFD740", 16);
      audio.playSfx("sfx_potion", 0);
      return;
    }

    if (ev.type === "sunny.playerHealed" && p.playerId === ctx.playerId) {
      const clientPotionId = typeof p.clientPotionId === "string" ? p.clientPotionId : "";
      const clientRegenId = typeof p.clientRegenId === "string" ? p.clientRegenId : "";
      if (clientPotionId !== "" && predictedPotionIds.has(clientPotionId)) {
        predictedPotionIds.delete(clientPotionId);
        return;
      }
      if (clientRegenId !== "" && predictedRegenIds.has(clientRegenId)) {
        predictedRegenIds.delete(clientRegenId);
        return;
      }
      const amt = Number(p.amount ?? 0);
      if (amt > 0) {
        const isIdleRegen = p.reason === "idle_regen";
        spawnText(localPlayer.x + 14, localPlayer.y - 12, `+${amt} HP`, "heal");
        spawnSparkles(localPlayer.x + 14, localPlayer.y + 18, "#69F0AE", isIdleRegen ? 5 : 10);
        if (!isIdleRegen) audio.playSfx("sfx_potion", 0);
      }
      return;
    }

    if (ev.type === "sunny.playerDied") {
      const pid = String(p.playerId ?? "");
      if (pid === ctx.playerId) {
        const fallback = deathPenaltyOf({
          xp: localPlayer.xp,
          coins: localPlayer.coins,
          level: localPlayer.level,
          stageId: currentStageId
        });
        enterDeath(
          typeof p.lostXp === "number" ? p.lostXp : fallback.lostXp,
          typeof p.lostCoins === "number" ? p.lostCoins : fallback.lostCoins
        );
      } else if (pid) {
        const rp = remotePlayers.get(pid);
        if (rp) rp.dead = true;
      }
      return;
    }

    if (ev.type === "sunny.playerRespawned") {
      const pid = String(p.playerId ?? "");
      if (pid === ctx.playerId) {
        leaveDeath();
        if (typeof p.hp === "number") localPlayer.hp = p.hp;
        localPlayer.x = Number(p.x ?? compiledStage.spawn.x);
        localPlayer.y = Number(p.y ?? compiledStage.spawn.y - localPlayer.h);
        localPlayer.vx = 0;
        localPlayer.vy = 0;
        localPlayer.invulnTimer = 2.0;
        localPlayer.statuses = {};
        localPlayer.slowTimer = 0;
        spawnText(localPlayer.x + 14, localPlayer.y - 20, "부활!", "info");
        spawnSparkles(localPlayer.x + 14, localPlayer.y + 20, "#FFD740", 16);
      } else if (pid) {
        const rp = remotePlayers.get(pid);
        if (rp) {
          rp.dead = false;
          if (typeof p.x === "number") {
            rp.x = p.x;
            rp.targetX = p.x;
          }
          if (typeof p.y === "number") {
            rp.y = p.y;
            rp.targetY = p.y;
          }
        }
      }
      return;
    }

    if (ev.type === "sunny.levelUp") {
      const pid = String(p.playerId ?? "");
      const newLv = Number(p.level ?? 1);
      if (pid === ctx.playerId) {
        spawnLevelUpEffect(localPlayer.x + localPlayer.w * 0.5, localPlayer.y + localPlayer.h, newLv);
        spawnText(
          localPlayer.x + localPlayer.w * 0.5,
          localPlayer.y - 52,
          `최대체력 ${p.maxHp} · 공격력 ${p.baseAtk}`,
          "info"
        );
        triggerShake(5, 0.2);
        audio.playSfx("sfx_level_up", 0);
      } else {
        const rp = remotePlayers.get(pid);
        if (rp) {
          rp.level = newLv;
          spawnLevelUpEffect(rp.x + 14, rp.y + 42, newLv);
        }
      }
    }
  }

  function renderStageMapDialog(): void {
    stageGrid.textContent = "";
    for (const st of ALL_STAGES) {
      const btn = document.createElement("button");
      btn.type = "button";
      const isCurrent = st.meta.id === currentStageId;
      const unlocked =
        st.meta.stageNumber <= highestStageNumber + 1 || localPlayer.level >= st.meta.minEntryLevel;
      btn.className = `sm-stage-card${isCurrent ? " is-current" : ""}`;
      btn.disabled = !unlocked || isCurrent;
      const playersHere = stagePlayerCounts[st.meta.id] ?? 0;
      const tallTag = st.meta.heightTiles >= 24 ? " · 고층" : "";
      const title = document.createElement("strong");
      title.textContent = `${st.meta.name}${isCurrent ? " (현재)" : ""}`;
      const meta = document.createElement("span");
      meta.textContent = unlocked
        ? `Lv.${st.meta.recommendedMinLevel}~${st.meta.recommendedMaxLevel} · ${playersHere}명${tallTag}`
        : `🔒 Lv.${st.meta.minEntryLevel}+`;
      btn.append(title, meta);
      btn.addEventListener("click", () => {
        if (!unlocked || isCurrent) return;
        audio.playSfx("sfx_portal", 0);
        stageTransitionPending = true;
        actions.sendAction({ type: "changeStage", payload: { targetStageId: st.meta.id } });
        mapDialog.close();
      });
      stageGrid.appendChild(btn);
    }
  }

  function renderInventoryGrid(
    gridEl: HTMLElement,
    selectedIndex: number,
    onSelect: (idx: number) => void
  ): void {
    gridEl.textContent = "";
    localInventory.forEach((slot, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `sm-slot${slot ? "" : " is-empty"}${selectedIndex === idx ? " is-selected" : ""}`;
      if (slot) {
        const spec = INVENTORY_ITEMS[slot.itemId];
        if (spec) {
          btn.title = `${spec.name} (${slot.quantity}/${spec.maxStack})`;
          btn.append(makeInventoryItemIcon(slot.itemId, 32));
          if (spec.stackable && slot.quantity > 1) {
            const qty = document.createElement("span");
            qty.className = "sm-slot-qty";
            qty.textContent = String(slot.quantity);
            btn.append(qty);
          }
        }
        btn.addEventListener("click", () => onSelect(idx));
      } else {
        btn.disabled = true;
        btn.setAttribute("aria-label", "빈 칸");
      }
      gridEl.append(btn);
    });
  }

  function countUsedSlots(): number {
    let used = 0;
    for (const s of localInventory) {
      if (s) used++;
    }
    return used;
  }

  function renderInventoryDialog(): void {
    invCoinsEl.textContent = `🪙 ${localPlayer.coins.toLocaleString()}`;
    if (!localPlayer.unlockedWeapons.includes(selectedUpgradeWeaponId)) {
      selectedUpgradeWeaponId = localPlayer.equippedWeaponId;
    }

    const eqW = WEAPON_CATALOG[localPlayer.equippedWeaponId] ?? WEAPON_CATALOG.wooden_sword!;
    const eqUpg = getWeaponUpgrade(localPlayer.weaponUpgrades, eqW.id);
    const eqCombat = computeEffectiveCombatStats(eqW, localPlayer.baseAtk, localPlayer.baseDex, eqUpg);

    // Compact hero header with visual HP / EXP meters
    invHeroMetaEl.textContent = "";
    const topLine = document.createElement("div");
    topLine.className = "sm-hero-top";
    const nameEl = document.createElement("strong");
    nameEl.textContent = `Lv.${localPlayer.level} ${localPlayer.displayName}`;
    const eqBadge = document.createElement("span");
    eqBadge.className = "sm-equip-pill";
    eqBadge.textContent = `${eqW.name}${eqCombat.totalLevel > 0 ? ` +${eqCombat.totalLevel}` : ""}`;
    topLine.append(nameEl, eqBadge);

    const meters = document.createElement("div");
    meters.className = "sm-hero-meters";
    const makeMeter = (kind: "hp" | "exp", ratio: number, label: string) => {
      const track = document.createElement("div");
      track.className = `sm-meter sm-meter-${kind}`;
      const fill = document.createElement("span");
      fill.className = "sm-meter-fill";
      fill.style.width = `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
      const text = document.createElement("span");
      text.className = "sm-meter-label";
      text.textContent = label;
      track.append(fill, text);
      return track;
    };
    meters.append(
      makeMeter("hp", localPlayer.hp / Math.max(1, localPlayer.maxHp), `HP ${Math.ceil(localPlayer.hp)}/${localPlayer.maxHp}`),
      makeMeter(
        "exp",
        localPlayer.xp / Math.max(1, localPlayer.xpToNext),
        `EXP ${localPlayer.xp.toLocaleString()}/${localPlayer.xpToNext.toLocaleString()}`
      )
    );
    invHeroMetaEl.append(topLine, meters);

    invStatsEl.textContent = "";
    const attacksPerSec = (1 / eqCombat.cooldownSec).toFixed(1);
    const stats: Array<[string, string]> = [
      ["공격력", eqCombat.atkBonus > 0 ? `${eqCombat.totalAtk} (+${eqCombat.atkBonus})` : String(eqCombat.totalAtk)],
      ["공격속도", `${attacksPerSec}/초`],
      ["치명타", `${Math.round(eqCombat.critChance * 100)}%`],
      ["포션", `×${localPlayer.potions}`],
      ["처치", localPlayer.mobsDefeated.toLocaleString()],
      ["점수", localPlayer.score.toLocaleString()]
    ];
    for (const [label, val] of stats) {
      const card = document.createElement("div");
      card.className = "sm-stat-card";
      const k = document.createElement("span");
      k.textContent = label;
      const v = document.createElement("strong");
      v.textContent = val;
      card.append(k, v);
      invStatsEl.append(card);
    }

    // Owned Weapons compact 5-column tile grid (up to 10 weapons -> max 2 rows, zero scroll)
    invWeaponCountEl.textContent = `${localPlayer.unlockedWeapons.length}/${WEAPON_ORDER.length}`;
    invWeaponsEl.textContent = "";
    for (const wid of localPlayer.unlockedWeapons) {
      const w = WEAPON_CATALOG[wid];
      if (!w) continue;
      const upg = getWeaponUpgrade(localPlayer.weaponUpgrades, wid);
      const tot = upg.atkLevel + upg.dexLevel;
      const isEq = wid === localPlayer.equippedWeaponId;
      const isSel = wid === selectedUpgradeWeaponId;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `sm-weapon-tile${isEq ? " is-equipped" : ""}${isSel ? " is-selected" : ""}`;
      btn.title = `${w.name}${tot > 0 ? ` +${tot}` : ""} · 공격력 ${w.atk}${upg.atkLevel > 0 ? ` (+${upg.atkLevel}강)` : ""}${upg.dexLevel > 0 ? ` · 공격속도 +${upg.dexLevel}강` : ""}`;
      if (isEq) {
        const eqTag = document.createElement("span");
        eqTag.className = "sm-weapon-badge is-eq";
        eqTag.textContent = "E";
        btn.append(eqTag);
      }
      if (tot > 0) {
        const lvTag = document.createElement("span");
        lvTag.className = "sm-weapon-badge is-lv";
        lvTag.textContent = `+${tot}`;
        btn.append(lvTag);
      }
      btn.append(makeSpriteIcon("items", w.iconIndex, 26));
      const nm = document.createElement("span");
      nm.className = "sm-weapon-name";
      nm.textContent = w.name;
      btn.append(nm);
      btn.addEventListener("click", () => {
        selectedUpgradeWeaponId = wid;
        if (localPlayer.equippedWeaponId !== wid) {
          selectWeaponLocal(wid);
        }
        renderInventoryDialog();
      });
      invWeaponsEl.append(btn);
    }

    // Weapon Enhancement Station (Red Stone -> Attack Power, Green Stone -> Attack Speed & Crit)
    const selW = WEAPON_CATALOG[selectedUpgradeWeaponId] ?? eqW;
    const selUpg = getWeaponUpgrade(localPlayer.weaponUpgrades, selW.id);
    const selCombat = computeEffectiveCombatStats(selW, localPlayer.baseAtk, localPlayer.baseDex, selUpg);

    invUpgradePanelEl.textContent = "";
    const upgHead = document.createElement("div");
    upgHead.className = "sm-section-head";
    const upgTitle = document.createElement("h3");
    upgTitle.textContent = `${selW.name}${selCombat.totalLevel > 0 ? ` +${selCombat.totalLevel}` : ""}`;
    const upgCap = document.createElement("span");
    upgCap.className = "sm-count-badge";
    upgCap.textContent = `${selCombat.totalLevel}/${MAX_WEAPON_UPGRADE_LEVEL}`;
    upgHead.append(upgTitle, upgCap);
    invUpgradePanelEl.append(upgHead);

    const actionsWrap = document.createElement("div");
    actionsWrap.className = "sm-upgrade-actions";

    const buildUpgradeCard = (stat: WeaponUpgradeStat) => {
      const prev = computeUpgradePreview(selW, stat, selUpg);
      const ownedStones = countItemInInventory(localInventory, prev.stoneId);
      const tierLabel = UPGRADE_STONE_TIER_LABELS[prev.stoneTier];
      const card = document.createElement("div");
      card.className = "sm-upgrade-card";

      let statLabel: string;
      let btnLabel: string;
      if (stat === "atk") {
        statLabel = prev.atCap ? "공격력" : `공격력 +${prev.statGain}`;
        btnLabel = prev.atCap ? "MAX" : "공격력 강화";
      } else {
        const nextCombat = computeEffectiveCombatStats(selW, localPlayer.baseAtk, localPlayer.baseDex, {
          ...selUpg,
          dexLevel: selUpg.dexLevel + 1
        });
        const speedGainPct = Math.round(((selCombat.cooldownSec / nextCombat.cooldownSec) - 1) * 1000) / 10;
        const critGainPct = Math.round((nextCombat.critChance - selCombat.critChance) * 1000) / 10;
        if (prev.atCap) {
          statLabel = "공격속도";
        } else if (speedGainPct > 0) {
          statLabel = `공격속도 +${speedGainPct.toFixed(1)}%`;
        } else if (critGainPct > 0) {
          statLabel = `치명타 +${critGainPct.toFixed(1)}%`;
        } else {
          statLabel = "공격속도";
        }
        btnLabel = prev.atCap ? "MAX" : "공격속도 강화";
        card.title = "공격속도 및 치명타 확률 상승";
      }

      const head = document.createElement("div");
      head.className = "sm-upgrade-head";
      const headLeft = document.createElement("span");
      headLeft.className = "sm-inline-icon";
      headLeft.append(makeInventoryItemIcon(prev.stoneId, 20));
      const t = document.createElement("strong");
      t.textContent = statLabel;
      headLeft.append(t);
      const rate = document.createElement("span");
      rate.className = "sm-rate-pill";
      rate.textContent = prev.atCap ? "MAX" : `${Math.round(prev.successRate * 100)}%`;
      head.append(headLeft, rate);

      const costRow = document.createElement("div");
      costRow.className = "sm-upgrade-costs";
      if (!prev.atCap) {
        const stoneCost = document.createElement("span");
        stoneCost.className = ownedStones >= prev.stonesRequired ? "is-ok" : "is-short";
        stoneCost.textContent = `${tierLabel} 강화석 ${ownedStones}/${prev.stonesRequired}`;
        const coinCost = document.createElement("span");
        coinCost.className = localPlayer.coins >= prev.coinCost ? "is-ok" : "is-short";
        coinCost.textContent = `🪙 ${prev.coinCost.toLocaleString()}`;
        costRow.append(stoneCost, coinCost);
      }

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sm-btn sm-btn-primary sm-btn-compact";
      const canAfford = !prev.atCap && ownedStones >= prev.stonesRequired && localPlayer.coins >= prev.coinCost;
      btn.disabled = !canAfford;
      btn.textContent = btnLabel;
      btn.addEventListener("click", () => {
        if (!canAfford) return;
        actions.sendAction({
          type: "upgradeWeapon",
          payload: { weaponId: selW.id, stat }
        });
      });

      card.append(head, costRow, btn);
      return card;
    };

    actionsWrap.append(buildUpgradeCard("atk"), buildUpgradeCard("dex"));
    invUpgradePanelEl.append(actionsWrap);

    // Right Panel Tabs: Bag (4x6 + Dismantle) & Smelting (초급/중급/고급)
    const ownedPowder = countItemInInventory(localInventory, STONE_POWDER_ITEM_ID);
    invSlotCountEl.textContent = `${countUsedSlots()}/${localInventory.length}`;
    invPowderCountEl.textContent = `가루 ${ownedPowder.toLocaleString()}`;
    invBagPaneEl.classList.toggle("is-hidden", invRightTab !== "bag");
    invSmeltPaneEl.classList.toggle("is-hidden", invRightTab !== "smelt");
    for (const tabBtn of root.querySelectorAll<HTMLButtonElement>("[data-inv-tab]")) {
      const active = tabBtn.dataset.invTab === invRightTab;
      tabBtn.classList.toggle("is-active", active);
      tabBtn.setAttribute("aria-selected", String(active));
    }

    // 4x6 Inventory Grid & Selected Item Bar (with inline Dismantle for upgrade stones)
    if (selectedInvSlot >= 0 && !localInventory[selectedInvSlot]) {
      selectedInvSlot = localInventory.findIndex((s) => s !== null);
    }
    renderInventoryGrid(invGridEl, selectedInvSlot, (idx) => {
      selectedInvSlot = idx;
      renderInventoryDialog();
    });

    invItemDetailEl.textContent = "";
    const curSlot = selectedInvSlot >= 0 ? localInventory[selectedInvSlot] : null;
    if (curSlot && INVENTORY_ITEMS[curSlot.itemId]) {
      const spec = INVENTORY_ITEMS[curSlot.itemId]!;
      const topRow = document.createElement("div");
      topRow.className = "sm-detail-row";
      const left = document.createElement("div");
      left.className = "sm-inline-icon";
      left.append(makeInventoryItemIcon(curSlot.itemId, 24));
      const nm = document.createElement("strong");
      nm.textContent = spec.name;
      const qty = document.createElement("span");
      qty.className = "sm-count-badge";
      qty.textContent = `${curSlot.quantity}/${spec.maxStack}`;
      left.append(nm, qty);
      const price = document.createElement("span");
      price.className = "sm-price-tag";
      price.textContent = `🪙 ${spec.sellPrice}`;
      topRow.append(left, price);

      if (canDismantleItem(curSlot.itemId)) {
        const btns = document.createElement("div");
        btns.className = "sm-action-row";
        const makeDisBtn = (label: string, q: number) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "sm-btn sm-btn-compact";
          b.textContent = `${label} (+${computeDismantleYield(curSlot.itemId, q)} 가루)`;
          b.addEventListener("click", () => {
            actions.sendAction({ type: "dismantleItem", payload: { slotIndex: selectedInvSlot, quantity: q } });
          });
          return b;
        };
        btns.append(makeDisBtn("1개 분해", 1));
        if (curSlot.quantity > 1) {
          btns.append(makeDisBtn(`전체(${curSlot.quantity}) 분해`, curSlot.quantity));
        }
        invItemDetailEl.append(topRow, btns);
      } else if (curSlot.itemId === STONE_POWDER_ITEM_ID) {
        const actionRow = document.createElement("div");
        actionRow.className = "sm-detail-row";
        const desc = document.createElement("span");
        desc.className = "sm-detail-meta";
        desc.textContent = spec.description;
        const goBtn = document.createElement("button");
        goBtn.type = "button";
        goBtn.className = "sm-btn sm-btn-primary sm-btn-compact";
        goBtn.textContent = "제련하기 ▸";
        goBtn.addEventListener("click", () => {
          invRightTab = "smelt";
          renderInventoryDialog();
        });
        actionRow.append(desc, goBtn);
        invItemDetailEl.append(topRow, actionRow);
      } else {
        const desc = document.createElement("div");
        desc.className = "sm-detail-meta";
        desc.textContent = spec.description;
        invItemDetailEl.append(topRow, desc);
      }
    } else {
      const empty = document.createElement("span");
      empty.className = "sm-detail-empty";
      empty.textContent = "아이템 없음";
      invItemDetailEl.append(empty);
    }

    // Smelting Pane (초급 / 중급 / 고급 tier selector + 2x2 recipes + smelt buttons)
    for (const tierBtn of root.querySelectorAll<HTMLButtonElement>("[data-smelt-tier]")) {
      tierBtn.classList.toggle("is-active", Number(tierBtn.dataset.smeltTier) === selectedSmeltTier);
    }
    const tierRecipes = SMELTING_RECIPES.filter((r) => r.tier === selectedSmeltTier);
    if (!tierRecipes.some((r) => r.id === selectedSmeltRecipeId)) {
      selectedSmeltRecipeId = tierRecipes[0]!.id;
    }
    invSmeltGridEl.textContent = "";
    for (const recipe of tierRecipes) {
      const outSpec = INVENTORY_ITEMS[recipe.outputItemId]!;
      const card = document.createElement("button");
      card.type = "button";
      card.className = `sm-smelt-card${recipe.id === selectedSmeltRecipeId ? " is-selected" : ""}`;
      card.append(makeInventoryItemIcon(recipe.outputItemId, 30));
      const info = document.createElement("div");
      info.className = "sm-smelt-info";
      const nm = document.createElement("strong");
      nm.textContent = outSpec.name;
      const cost = document.createElement("span");
      cost.textContent = `가루 ${recipe.powderCost} · 🪙 ${recipe.coinCost}`;
      info.append(nm, cost);
      card.append(info);
      card.addEventListener("click", () => {
        selectedSmeltRecipeId = recipe.id;
        renderInventoryDialog();
      });
      invSmeltGridEl.append(card);
    }

    invSmeltDetailEl.textContent = "";
    const curRecipe = SMELTING_RECIPES_BY_ID[selectedSmeltRecipeId] ?? tierRecipes[0]!;
    const curOutSpec = INVENTORY_ITEMS[curRecipe.outputItemId]!;
    const ownedOut = countItemInInventory(localInventory, curRecipe.outputItemId);
    const smeltTop = document.createElement("div");
    smeltTop.className = "sm-detail-row";
    const smeltLeft = document.createElement("div");
    smeltLeft.className = "sm-inline-icon";
    smeltLeft.append(makeInventoryItemIcon(curRecipe.outputItemId, 24));
    const smeltNm = document.createElement("strong");
    smeltNm.textContent = curOutSpec.name;
    const smeltOwned = document.createElement("span");
    smeltOwned.className = "sm-count-badge";
    smeltOwned.textContent = `보유 ${ownedOut}`;
    smeltLeft.append(smeltNm, smeltOwned);
    const smeltNeed = document.createElement("span");
    smeltNeed.className = "sm-price-tag";
    smeltNeed.textContent = `가루 ${curRecipe.powderCost} + 🪙 ${curRecipe.coinCost}`;
    smeltTop.append(smeltLeft, smeltNeed);

    const smeltBtns = document.createElement("div");
    smeltBtns.className = "sm-action-row";
    const makeSmeltBtn = (qty: number) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "sm-btn sm-btn-primary sm-btn-compact";
      const pCost = curRecipe.powderCost * qty;
      const cCost = curRecipe.coinCost * qty;
      b.disabled = ownedPowder < pCost || localPlayer.coins < cCost;
      b.textContent = `${qty}개 제련 (가루 ${pCost} · 🪙 ${cCost.toLocaleString()})`;
      b.addEventListener("click", () => {
        actions.sendAction({ type: "smeltStone", payload: { recipeId: curRecipe.id, quantity: qty } });
      });
      return b;
    };
    smeltBtns.append(makeSmeltBtn(1), makeSmeltBtn(5));
    invSmeltDetailEl.append(smeltTop, smeltBtns);
  }

  function renderShopDialog(): void {
    shopCoinsEl.textContent = `🪙 ${localPlayer.coins.toLocaleString()}`;
    shopSlotCountEl.textContent = `${countUsedSlots()}/${localInventory.length}`;
    if (selectedShopInvSlot >= 0 && !localInventory[selectedShopInvSlot]) {
      selectedShopInvSlot = localInventory.findIndex((s) => s !== null);
    }

    // Left: My 4x6 Inventory + Sell Controls
    renderInventoryGrid(shopMyGridEl, selectedShopInvSlot, (idx) => {
      selectedShopInvSlot = idx;
      renderShopDialog();
    });

    shopSellDetailEl.textContent = "";
    const sellSlot = selectedShopInvSlot >= 0 ? localInventory[selectedShopInvSlot] : null;
    if (sellSlot && INVENTORY_ITEMS[sellSlot.itemId]) {
      const spec = INVENTORY_ITEMS[sellSlot.itemId]!;
      const row = document.createElement("div");
      row.className = "sm-detail-row";
      const left = document.createElement("div");
      left.className = "sm-inline-icon";
      left.append(makeInventoryItemIcon(sellSlot.itemId, 24));
      const title = document.createElement("strong");
      title.textContent = `${spec.name} ×${sellSlot.quantity}`;
      left.append(title);
      const price = document.createElement("span");
      price.className = "sm-price-tag";
      price.textContent = `🪙 ${spec.sellPrice}/개`;
      row.append(left, price);

      const btns = document.createElement("div");
      btns.className = "sm-action-row";
      const makeSellBtn = (label: string, qty: number) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "sm-btn sm-btn-danger sm-btn-compact";
        b.disabled = sellSlot.quantity < qty || qty <= 0;
        b.textContent = `${label} (+${(spec.sellPrice * qty).toLocaleString()})`;
        b.addEventListener("click", () => {
          actions.sendAction({ type: "shopSell", payload: { slotIndex: selectedShopInvSlot, quantity: qty } });
        });
        return b;
      };
      btns.append(makeSellBtn("1개", 1));
      if (sellSlot.quantity >= 5) btns.append(makeSellBtn("5개", 5));
      if (sellSlot.quantity > 1) btns.append(makeSellBtn("전체", sellSlot.quantity));

      shopSellDetailEl.append(row, btns);
    } else {
      const empty = document.createElement("span");
      empty.className = "sm-detail-empty";
      empty.textContent = "판매할 아이템 선택";
      shopSellDetailEl.append(empty);
    }

    // Right: Shop Offers + Buy Controls
    shopOffersEl.textContent = "";
    for (const offer of SHOP_OFFERS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `sm-shop-card${offer.id === selectedShopOfferId ? " is-selected" : ""}`;
      btn.append(makeSpriteIcon(offer.sheet, offer.iconIndex, 30));
      const info = document.createElement("div");
      info.className = "sm-shop-card-info";
      const nm = document.createElement("strong");
      nm.textContent = offer.name;
      const pr = document.createElement("span");
      pr.textContent = `🪙 ${offer.buyPrice.toLocaleString()}`;
      info.append(nm, pr);
      btn.append(info);
      btn.addEventListener("click", () => {
        selectedShopOfferId = offer.id;
        renderShopDialog();
      });
      shopOffersEl.append(btn);
    }

    shopBuyDetailEl.textContent = "";
    const selOffer = SHOP_OFFERS_BY_ID[selectedShopOfferId] ?? SHOP_OFFERS[0]!;
    const buyRow = document.createElement("div");
    buyRow.className = "sm-detail-row";
    const buyLeft = document.createElement("div");
    buyLeft.className = "sm-inline-icon";
    buyLeft.append(makeSpriteIcon(selOffer.sheet, selOffer.iconIndex, 24));
    const buyTitle = document.createElement("strong");
    buyTitle.textContent = selOffer.name;
    const buyMeta = document.createElement("span");
    buyMeta.className = "sm-detail-meta";
    buyMeta.textContent = selOffer.description;
    buyLeft.append(buyTitle, buyMeta);
    buyRow.append(buyLeft);

    const buyBtns = document.createElement("div");
    buyBtns.className = "sm-action-row";
    const makeBuyBtn = (qty: number) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "sm-btn sm-btn-primary sm-btn-compact";
      const cost = selOffer.buyPrice * qty;
      b.disabled = localPlayer.coins < cost;
      b.textContent = `${qty}개 구매 (-${cost.toLocaleString()})`;
      b.addEventListener("click", () => {
        actions.sendAction({ type: "shopBuy", payload: { offerId: selOffer.id, quantity: qty } });
      });
      return b;
    };
    buyBtns.append(makeBuyBtn(1), makeBuyBtn(5));
    shopBuyDetailEl.append(buyRow, buyBtns);
  }

  function openInventoryModal(): void {
    if (downed()) return;
    void audio.unlock();
    if (shopDialog.open) shopDialog.close();
    setFeedback(invFeedbackEl, "");
    selectedUpgradeWeaponId = localPlayer.equippedWeaponId;
    if (selectedInvSlot < 0) selectedInvSlot = localInventory.findIndex((s) => s !== null);
    renderInventoryDialog();
    if (!inventoryDialog.open) inventoryDialog.showModal();
    syncChatAvailability();
    syncMenuMode();
  }

  function openShopModal(): void {
    if (downed()) return;
    void audio.unlock();
    if (inventoryDialog.open) inventoryDialog.close();
    setFeedback(shopFeedbackEl, "");
    if (selectedShopInvSlot < 0) selectedShopInvSlot = localInventory.findIndex((s) => s !== null);
    renderShopDialog();
    if (!shopDialog.open) shopDialog.showModal();
    syncChatAvailability();
    syncMenuMode();
  }

  // Inventory right-panel tab & smelting tier selectors
  for (const tabBtn of root.querySelectorAll<HTMLButtonElement>("[data-inv-tab]")) {
    tabBtn.addEventListener("click", () => {
      const next = tabBtn.dataset.invTab === "smelt" ? "smelt" : "bag";
      if (invRightTab !== next) {
        invRightTab = next;
        renderInventoryDialog();
      }
    });
  }
  for (const tierBtn of root.querySelectorAll<HTMLButtonElement>("[data-smelt-tier]")) {
    tierBtn.addEventListener("click", () => {
      const t = Number(tierBtn.dataset.smeltTier);
      if (t === 1 || t === 2 || t === 3) {
        selectedSmeltTier = t;
        renderInventoryDialog();
      }
    });
  }

  // Toolbar event handlers
  root.querySelector('[data-act="map"]')?.addEventListener("click", () => {
    void audio.unlock();
    renderStageMapDialog();
    mapDialog.showModal();
    syncChatAvailability();
  });
  root.querySelector('[data-act="help"]')?.addEventListener("click", () => {
    void audio.unlock();
    helpDialog.showModal();
    syncChatAvailability();
  });
  muteBtn.addEventListener("click", async () => {
    await audio.unlock();
    const muted = audio.toggleMute();
    muteBtn.textContent = muted ? "🔇 음소거" : "🔊 사운드";
  });
  root.querySelector<HTMLElement>('[data-act="chat"]')?.addEventListener("click", (event) => {
    if (chat.open) chat.open = false;
    else chat.openFrom(event.currentTarget as HTMLElement);
  });
  root.querySelector('[data-act="share"]')?.addEventListener("click", () => actions.shareRoom());
  root.querySelector('[data-act="fullscreen"]')?.addEventListener("click", () => {
    container.dispatchEvent(new CustomEvent("bighouse-toggle-fullscreen", { bubbles: true }));
  });
  root.querySelector('[data-act="leave"]')?.addEventListener("click", () => {
    actions.sendAction({ type: "checkpoint", payload: { x: Math.round(localPlayer.x), y: Math.round(localPlayer.y) } });
    actions.leaveRoom();
  });

  // Separated Canvas HUD Entry Points:
  // - Top-Left Character Status Card -> Inventory
  // - Top-Right Coin Pill -> Shop
  // Activated on `click` (not `pointerdown`) so `closedby="any"` dialogs are never
  // light-dismissed by the matching `pointerup` release outside the centered modal.
  const getHudTargetAtEvent = (e: MouseEvent): HudActionTarget | null => {
    const pt = clientPointToCanvasLogical(e.clientX, e.clientY, canvas.getBoundingClientRect());
    return pt ? hitTestHudPoint(pt.x, pt.y) : null;
  };
  const onCanvasPointerMove = (e: PointerEvent) => {
    const blocked = downed() || inventoryDialog.open || shopDialog.open || mapDialog.open || helpDialog.open;
    const hit = blocked ? null : getHudTargetAtEvent(e);
    statusHover = hit === "inventory";
    coinHover = hit === "shop";
    canvas.style.cursor = hit ? "pointer" : "";
  };
  const onCanvasPointerLeave = () => {
    statusHover = false;
    coinHover = false;
    canvas.style.cursor = "";
    hudClickController.onPointerCancel();
  };
  const onCanvasPointerCancel = () => {
    statusHover = false;
    coinHover = false;
    canvas.style.cursor = "";
    hudClickController.onPointerCancel();
  };
  const onCanvasPointerDown = (e: PointerEvent) => {
    if (downed() || inventoryDialog.open || shopDialog.open || mapDialog.open || helpDialog.open) {
      hudClickController.onPointerCancel();
      return;
    }
    hudClickController.onPointerDown(getHudTargetAtEvent(e), e.button);
  };
  const onCanvasClick = (e: MouseEvent) => {
    if (downed() || inventoryDialog.open || shopDialog.open || mapDialog.open || helpDialog.open) {
      hudClickController.onPointerCancel();
      return;
    }
    const target = hudClickController.onClick(getHudTargetAtEvent(e));
    if (target === "inventory") {
      statusHover = false;
      canvas.style.cursor = "";
      openInventoryModal();
    } else if (target === "shop") {
      coinHover = false;
      canvas.style.cursor = "";
      openShopModal();
    }
  };
  canvas.addEventListener("pointermove", onCanvasPointerMove);
  canvas.addEventListener("pointerleave", onCanvasPointerLeave);
  canvas.addEventListener("pointercancel", onCanvasPointerCancel);
  canvas.addEventListener("pointerdown", onCanvasPointerDown);
  canvas.addEventListener("click", onCanvasClick);

  // Keyboard listeners
  const onKeyDown = (e: KeyboardEvent) => {
    if (!e.repeat && e.code === "KeyI" && inventoryDialog.open) {
      e.preventDefault();
      inventoryDialog.close();
      return;
    }
    if (!e.repeat && e.code === "KeyB" && shopDialog.open) {
      e.preventDefault();
      shopDialog.close();
      return;
    }
    if (chatOpen || mapDialog.open || helpDialog.open || deathDialog.open || inventoryDialog.open || shopDialog.open) {
      return;
    }
    if (!e.repeat && e.code === "KeyI") {
      e.preventDefault();
      openInventoryModal();
      return;
    }
    if (!e.repeat && e.code === "KeyB") {
      e.preventDefault();
      openShopModal();
      return;
    }
    if (PREVENT_KEYS.has(e.code)) e.preventDefault();
    void audio.unlock();
    keysDown.add(e.code);
    resetIdleRegen();

    // Quick weapon selection 1..9, 0 and rapid Q / E cycling (handled on keydown so fast taps never drop)
    if (e.code.startsWith("Digit") && !e.repeat) {
      const digit = Number(e.code.slice(5));
      const idx = digit === 0 ? 9 : digit - 1;
      const wid = WEAPON_ORDER[idx];
      if (wid) selectWeaponLocal(wid);
    } else if ((e.code === "KeyQ" || e.code === "KeyE") && !e.repeat) {
      if (localPlayer.unlockedWeapons.length > 1) {
        const delta = e.code === "KeyE" ? 1 : -1;
        const idx = localPlayer.unlockedWeapons.indexOf(localPlayer.equippedWeaponId);
        const nextWid =
          localPlayer.unlockedWeapons[(idx + delta + localPlayer.unlockedWeapons.length) % localPlayer.unlockedWeapons.length]!;
        selectWeaponLocal(nextWid);
      }
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    keysDown.delete(e.code);
  };
  const onBlur = () => {
    keysDown.clear();
    virtualDown.clear();
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);

  // Touch buttons
  for (const btn of root.querySelectorAll<HTMLButtonElement>("[data-touch]")) {
    const act = btn.dataset.touch!;
    const press = (e: Event) => {
      e.preventDefault();
      void audio.unlock();
      virtualDown.add(act);
    };
    const rel = (e: Event) => {
      e.preventDefault();
      virtualDown.delete(act);
    };
    btn.addEventListener("pointerdown", press);
    btn.addEventListener("pointerup", rel);
    btn.addEventListener("pointercancel", rel);
    btn.addEventListener("pointerleave", rel);
  }

  function pollInput(): void {
    for (const [act, codes] of Object.entries(ACTION_KEYS)) {
      prevInput[act] = Boolean(curInput[act]);
      let down = virtualDown.has(act);
      if (!down) {
        for (const c of codes) {
          if (keysDown.has(c)) {
            down = true;
            break;
          }
        }
      }
      curInput[act] = down;
    }
  }

  function stepSimulation(dt: number): void {
    const now = Date.now();
    pollInput();

    if (shakeTimer > 0) {
      shakeTimer = Math.max(0, shakeTimer - dt);
      const amp = shakeMag * (shakeTimer / 0.18);
      shakeX = (Math.random() * 2 - 1) * amp;
      shakeY = (Math.random() * 2 - 1) * amp;
    } else {
      shakeX = 0;
      shakeY = 0;
    }

    if (warpFlash > 0) warpFlash = Math.max(0, warpFlash - dt);
    if (hitStopTimer > 0) {
      hitStopTimer = Math.max(0, hitStopTimer - dt);
      updateEffects(dt * 0.35);
      return;
    }

    updateMovingPlatforms(compiledStage.movingPlatforms, dt, now + serverClockOffset);
    for (const item of items) {
      if (item.openingTimer && item.openingTimer > 0) {
        item.openingTimer = Math.max(0, item.openingTimer - dt);
      }
    }
    stepLocalPlayer(dt, now);
    stepLocalIdleRegen(dt);
    stepMobs(dt, now);
    stepProjectiles(dt, now);
    stepLootDrops(dt);
    stepRemotePlayers(dt, now);
    checkItemPickups(now);
    updateEffects(dt);
    updateCamera(dt);
    sendPeriodicSync(dt);
  }

  function stepLocalIdleRegen(dt: number): void {
    const p = localPlayer;
    const hasInput =
      keysDown.size > 0 ||
      virtualDown.size > 0 ||
      Object.values(curInput).some(Boolean) ||
      p.attackAnimTimer > 0;
    const isResting =
      !downed() &&
      hurtStunTimer <= 0 &&
      (p.grounded || p.onLadder) &&
      Math.abs(p.vx) < 8 &&
      Math.abs(p.vy) < 8 &&
      !Boolean(p.statuses.poison?.remaining) &&
      !Boolean(p.statuses.burn?.remaining);

    const res = stepIdleRegen(idleRegenState, {
      hasInput,
      isResting,
      hp: p.hp,
      maxHp: p.maxHp,
      dt
    });
    idleRegenState = { idleTimer: res.idleTimer, tickTimer: res.tickTimer };
    p.idleRegenActive = res.active;

    if (res.shouldHeal && p.hp < p.maxHp) {
      const healAmt = computeIdleRegenAmount(p.maxHp);
      const before = p.hp;
      p.hp = Math.min(p.maxHp, p.hp + healAmt);
      const actual = p.hp - before;
      if (actual > 0) {
        const clientRegenId = nextPredId("reg");
        predictedRegenIds.add(clientRegenId);
        if (predictedRegenIds.size > 60) {
          const first = predictedRegenIds.values().next().value;
          if (first) predictedRegenIds.delete(first);
        }
        spawnText(p.x + p.w * 0.5, p.y - 12, `+${actual} HP`, "heal");
        spawnSparkles(p.x + p.w * 0.5, p.y + p.h * 0.45, "#69F0AE", 5);
        actions.sendAction({ type: "idleRegen", payload: { clientRegenId } });
      }
      if (p.hp >= p.maxHp) {
        p.idleRegenActive = false;
      }
    }
  }

  function stepLocalPlayer(dt: number, now: number): void {
    const p = localPlayer;
    if (downed() || p.inMenu) {
      p.vx = 0;
      p.vy = 0;
      return;
    }
    p.animTimer += dt;
    if (p.invulnTimer > 0) p.invulnTimer = Math.max(0, p.invulnTimer - dt);
    if (p.slowTimer > 0) p.slowTimer = Math.max(0, p.slowTimer - dt);
    if (hurtStunTimer > 0) hurtStunTimer = Math.max(0, hurtStunTimer - dt);
    if (attackCooldown > 0) attackCooldown = Math.max(0, attackCooldown - dt);
    if (p.attackAnimTimer > 0) p.attackAnimTimer = Math.max(0, p.attackAnimTimer - dt);
    if (dropThroughTimer > 0) dropThroughTimer = Math.max(0, dropThroughTimer - dt);
    if (portalCooldown > 0) portalCooldown = Math.max(0, portalCooldown - dt);
    if (ladderGrabCooldown > 0) ladderGrabCooldown = Math.max(0, ladderGrabCooldown - dt);

    // Tick active player status effects (slow, poison, burn, stun, shock)
    let playerStatusSpeedMult = p.slowTimer > 0 ? 0.6 : 1.0;
    let playerStunned = false;
    for (const [key, st] of Object.entries(p.statuses) as Array<[StatusEffectKind, ActiveStatusEffect | undefined]>) {
      if (!st) continue;
      st.remaining -= dt;
      if (st.remaining <= 0) {
        delete p.statuses[key];
        continue;
      }
      if (st.kind === "stun") {
        playerStunned = true;
      }
      if (typeof st.speedMult === "number") {
        playerStatusSpeedMult = Math.min(playerStatusSpeedMult, st.speedMult);
      }
      if (typeof st.tickDamage === "number" && typeof st.tickInterval === "number") {
        st.tickTimer = (st.tickTimer ?? st.tickInterval) - dt;
        if (st.tickTimer <= 0) {
          st.tickTimer += st.tickInterval;
          if (!downed() && p.hp > 1) {
            const dotDmg = Math.min(p.hp - 1, Math.max(1, st.tickDamage));
            p.hp = Math.max(1, p.hp - dotDmg);
            const meta = STATUS_METADATA[st.kind];
            spawnText(p.x + p.w * 0.5, p.y - 12, `-${dotDmg}`, "info", meta.color);
            spawnSparkles(p.x + p.w * 0.5, p.y + p.h * 0.5, meta.color, 5);
            actions.sendAction({ type: "playerHurt", payload: { amount: dotDmg } });
          }
        }
      }
    }

    p.squashX += (1 - p.squashX) * Math.min(1, dt * 15);
    p.squashY += (1 - p.squashY) * Math.min(1, dt * 15);

    // Virtual touch weapon cycling (keyboard Q/E is handled directly in onKeyDown for zero missed rapid taps)
    if ((virtualDown.has("weaponPrev") && justPressed("weaponPrev")) || (virtualDown.has("weaponNext") && justPressed("weaponNext"))) {
      if (p.unlockedWeapons.length > 1) {
        const delta = justPressed("weaponNext") ? 1 : -1;
        const idx = p.unlockedWeapons.indexOf(p.equippedWeaponId);
        const nextWid = p.unlockedWeapons[(idx + delta + p.unlockedWeapons.length) % p.unlockedWeapons.length]!;
        selectWeaponLocal(nextWid);
      }
    }
    if (justPressed("potion") && p.potions > 0 && p.hp < p.maxHp) {
      // 0ms optimistic potion heal + server sync
      const clientPotionId = nextPredId("pot");
      predictedPotionIds.add(clientPotionId);
      const healAmt = Math.max(
        PLAYER_CONFIG.minPotionHeal,
        Math.round(p.maxHp * PLAYER_CONFIG.potionHealRatio)
      );
      const before = p.hp;
      p.potions = Math.max(0, p.potions - 1);
      p.hp = Math.min(p.maxHp, p.hp + healAmt);
      const actual = p.hp - before;
      if (actual > 0) {
        spawnText(p.x + p.w * 0.5, p.y - 12, `+${actual} HP`, "heal");
        spawnSparkles(p.x + p.w * 0.5, p.y + p.h * 0.4, "#69F0AE", 10);
        audio.playSfx("sfx_potion", 0);
      }
      actions.sendAction({ type: "usePotion", payload: { clientPotionId } });
    }

    if (p.grounded && !p.onLadder && standingPlatform) {
      applyMovingPlatformCarry({
        x: p.x,
        y: p.y,
        w: p.w,
        h: p.h,
        vx: p.vx,
        vy: p.vy,
        grounded: p.grounded,
        standingPlatform
      });
      const mp = standingPlatform as CompiledStage["movingPlatforms"][number];
      if (mp.dx || mp.dy) {
        p.x += mp.dx;
        p.y += mp.dy;
      }
    }

    p.nearbyPortal = findOverlappingPortal(p, compiledStage.portals);
    p.nearbySign = null;
    for (const d of compiledStage.decorations) {
      if (d.kind === "sign" && d.text) {
        if (Math.hypot(p.x + p.w * 0.5 - (d.x + 24), p.y + p.h * 0.5 - (d.y + 24)) < 68) {
          p.nearbySign = d;
          break;
        }
      }
    }

    // Portal interaction
    if (p.nearbyPortal && portalCooldown <= 0 && justPressed("up") && !p.onLadder && !stageTransitionPending) {
      const pt = p.nearbyPortal;
      if (pt.kind === "next_stage" || pt.kind === "prev_stage") {
        if (pt.requiredLevel !== undefined && p.level < pt.requiredLevel) {
          spawnText(p.x + p.w * 0.5, p.y - 24, `Lv.${pt.requiredLevel}+ 필요!`, "playerHurt");
        } else if (pt.targetStageId) {
          stageTransitionPending = true;
          portalCooldown = 1.0;
          audio.playSfx("sfx_portal", 0);
          spawnSparkles(p.x + p.w * 0.5, p.y + p.h * 0.5, pt.color, 18);
          actions.sendAction({ type: "changeStage", payload: { targetStageId: pt.targetStageId } });
          return;
        }
      } else if (pt.kind === "goal") {
        portalCooldown = 2.0;
        audio.playBgm("bgm_clear", false);
        spawnLevelUpEffect(p.x + p.w * 0.5, p.y + p.h, p.level);
        spawnText(p.x + p.w * 0.5, p.y - 60, "★ 별빛 정상 제패! ★", "levelup");
      } else if (pt.targetPortalId) {
        const target = compiledStage.portalsById.get(pt.targetPortalId);
        if (target) {
          spawnSparkles(p.x + p.w * 0.5, p.y + p.h * 0.5, pt.color, 14);
          p.x = target.x + target.w * 0.5 - p.w * 0.5;
          p.y = target.y + target.h - p.h - 2;
          p.vx = 0;
          p.vy = 0;
          p.grounded = false;
          standingPlatform = null;
          portalCooldown = PLAYER_CONFIG.portalCooldown;
          warpFlash = 0.25;
          spawnSparkles(p.x + p.w * 0.5, p.y + p.h * 0.5, target.color, 14);
          audio.playSfx("sfx_portal", 0.04);
          return;
        }
      }
    }

    // Ladder grab (skip while jump/dismount cooldown active or already standing cleanly on top platform)
    const overlapLad = findOverlappingLadder(p, compiledStage.ladders, 10);
    if (!p.onLadder && overlapLad && hurtStunTimer <= 0 && !playerStunned && ladderGrabCooldown <= 0) {
      const wantsUp = isDown("up") && !p.nearbyPortal && p.y + p.h > overlapLad.y + 4;
      const wantsDown = isDown("down") && p.y + p.h <= overlapLad.y + overlapLad.h - 6;
      if (wantsUp || wantsDown) {
        p.onLadder = true;
        currentLadder = overlapLad;
        p.grounded = false;
        standingPlatform = null;
        p.vx = 0;
        p.vy = 0;
        p.x = overlapLad.centerX - p.w * 0.5;
        // Nudge slightly down onto top rung when starting a downward climb from the top platform
        if (wantsDown && p.y + p.h <= overlapLad.y + 2) {
          p.y = overlapLad.y - p.h + 4;
        }
      }
    }

    if (p.onLadder && currentLadder) {
      const l = currentLadder;
      const moveY = playerStunned ? 0 : (isDown("down") ? 1 : 0) - (isDown("up") ? 1 : 0);
      const moveX = playerStunned ? 0 : (isDown("right") ? 1 : 0) - (isDown("left") ? 1 : 0);
      p.x += (l.centerX - p.w * 0.5 - p.x) * Math.min(1, dt * 18);

      const res = stepOnLadder(l, compiledStage.platforms, {
        y: p.y,
        h: p.h,
        moveY,
        moveX,
        jumpPressed: !playerStunned && justPressed("jump"),
        climbSpeed: PLAYER_CONFIG.climbSpeed,
        jumpVelocity: PLAYER_CONFIG.jumpVelocity,
        dt
      });

      p.y = res.y;
      p.vy = res.vy;

      if (res.state === "climbing") {
        p.vx = 0;
        if (moveY !== 0 && !res.atTop) {
          ladderStepTimer += dt;
          if (ladderStepTimer >= 0.24) {
            ladderStepTimer = 0;
            audio.playSfx("sfx_ladder", 0.06);
          }
        }
      } else if (res.state === "jumped") {
        p.onLadder = false;
        currentLadder = null;
        p.grounded = false;
        standingPlatform = null;
        ladderGrabCooldown = 0.22;
        if (moveX !== 0) {
          p.vx = moveX * PLAYER_CONFIG.moveSpeed * 0.88;
          p.facing = moveX;
        }
        p.squashX = 0.82;
        p.squashY = 1.22;
        audio.playSfx("sfx_jump", 0.05);
      } else if (res.state === "dismount_top") {
        p.onLadder = false;
        currentLadder = null;
        p.grounded = true;
        standingPlatform = res.platform;
        ladderGrabCooldown = 0.16;
        p.facing = moveX !== 0 ? moveX : p.facing;
        p.vx = moveX * PLAYER_CONFIG.moveSpeed * 0.6;
      } else if (res.state === "dismount_bottom") {
        p.onLadder = false;
        currentLadder = null;
        ladderGrabCooldown = 0.12;
      }
      handleLocalAttack(now);
      return;
    }

    // Horizontal run with special platform surfaces (ice, mud, conveyor) & status speed modifiers
    const standingSurface = p.grounded && standingPlatform ? standingPlatform.surface : "normal";
    const mudMult = standingSurface === "mud" ? 0.64 : 1.0;
    const speedMult = playerStatusSpeedMult * mudMult;
    const maxSpd = PLAYER_CONFIG.moveSpeed * speedMult;
    const moveDir = playerStunned ? 0 : (isDown("right") ? 1 : 0) - (isDown("left") ? 1 : 0);
    if (hurtStunTimer <= 0 && !playerStunned) {
      if (moveDir !== 0) {
        p.facing = moveDir;
        const baseAccel = p.grounded ? PLAYER_CONFIG.groundAccel : PLAYER_CONFIG.airAccel;
        const accel = standingSurface === "ice" ? baseAccel * 0.48 : baseAccel;
        p.vx += moveDir * accel * dt;
        if (Math.abs(p.vx) > maxSpd) p.vx = Math.sign(p.vx) * maxSpd;
      } else if (p.grounded) {
        const frictionMult = standingSurface === "ice" ? 0.14 : 1.0;
        const decel = PLAYER_CONFIG.groundFriction * frictionMult * dt;
        if (Math.abs(p.vx) <= decel) p.vx = 0;
        else p.vx -= Math.sign(p.vx) * decel;
      } else {
        p.vx *= Math.pow(0.25, dt);
      }
    }

    // Conveyor belt horizontal drift when standing on a conveyor platform
    if (p.grounded && (standingSurface === "conveyor_right" || standingSurface === "conveyor_left")) {
      const beltDir = standingSurface === "conveyor_right" ? 1 : -1;
      p.x += beltDir * 118 * dt;
    }

    // Subtle footstep dust puffs when sprinting across solid ground
    if (p.grounded && Math.abs(p.vx) > 95) {
      runDustTimer += dt;
      if (runDustTimer >= 0.22) {
        runDustTimer = 0;
        particles.push({
          x: p.x + p.w * 0.5 - p.facing * 8,
          y: p.y + p.h - 2,
          vx: -p.facing * (24 + Math.random() * 24),
          vy: -(16 + Math.random() * 18),
          gravity: 40,
          size: 3.2 + Math.random() * 2,
          color: standingSurface === "ice" ? "#E0F7FA" : standingSurface === "mud" ? "#8D6E63" : "#FFF8E1",
          age: 0,
          duration: 0.28 + Math.random() * 0.1,
          shape: "circle"
        });
      }
    } else {
      runDustTimer = 0.14;
    }

    if (p.grounded) coyoteTimer = PLAYER_CONFIG.coyoteTime;
    else coyoteTimer = Math.max(0, coyoteTimer - dt);

    if (justPressed("jump")) jumpBufferTimer = PLAYER_CONFIG.jumpBufferTime;
    else jumpBufferTimer = Math.max(0, jumpBufferTimer - dt);

    if (jumpBufferTimer > 0 && hurtStunTimer <= 0 && !playerStunned) {
      if (p.grounded && isDown("down") && standingPlatform && standingPlatform.oneWay) {
        dropThroughTimer = PLAYER_CONFIG.dropThroughDuration;
        p.grounded = false;
        standingPlatform = null;
        p.y += 4;
        p.vy = 60;
        jumpBufferTimer = 0;
        coyoteTimer = 0;
      } else if (coyoteTimer > 0) {
        p.vy = PLAYER_CONFIG.jumpVelocity;
        p.grounded = false;
        standingPlatform = null;
        jumpBufferTimer = 0;
        coyoteTimer = 0;
        p.squashX = 0.8;
        p.squashY = 1.24;
        audio.playSfx("sfx_jump", 0.05);
      }
    }

    if (justReleased("jump") && p.vy < -220) {
      p.vy *= PLAYER_CONFIG.jumpCutMultiplier;
    }

    const prevBottom = p.y + p.h;
    p.x += p.vx * dt;
    p.vy = Math.min(PLAYER_CONFIG.maxFallSpeed, p.vy + PLAYER_CONFIG.gravity * dt);
    p.y += p.vy * dt;

    if (p.x < 4) {
      p.x = 4;
      if (p.vx < 0) p.vx = 0;
    } else if (p.x + p.w > compiledStage.meta.worldWidth - 4) {
      p.x = compiledStage.meta.worldWidth - 4 - p.w;
      if (p.vx > 0) p.vx = 0;
    }

    const wasGrounded = p.grounded;
    const fallSpd = p.vy;
    const actor = {
      x: p.x,
      y: p.y,
      w: p.w,
      h: p.h,
      vx: p.vx,
      vy: p.vy,
      grounded: p.grounded,
      standingPlatform
    };
    const landed = resolvePlatformLanding(
      actor,
      prevBottom,
      compiledStage.platforms,
      compiledStage.movingPlatforms,
      dropThroughTimer > 0
    );
    p.y = actor.y;
    p.vy = actor.vy;
    p.grounded = actor.grounded;
    standingPlatform = actor.standingPlatform;

    // Bouncy spring pad: launches player high into the air immediately on landing!
    if (p.grounded && standingPlatform && standingPlatform.surface === "bouncy") {
      p.vy = -850;
      p.grounded = false;
      standingPlatform = null;
      p.squashX = 0.72;
      p.squashY = 1.34;
      spawnSparkles(p.x + p.w * 0.5, p.y + p.h, "#FF80AB", 10);
      audio.playSfx("sfx_jump", 0.04);
    } else if (landed && !wasGrounded) {
      p.squashX = 1.2;
      p.squashY = 0.82;
      if (fallSpd > 240) audio.playSfx("sfx_land", 0.06);
    }

    if (
      p.grounded &&
      standingPlatform &&
      !("waypoints" in standingPlatform) &&
      standingPlatform.surface !== "bouncy"
    ) {
      lastSafeX = Math.max(standingPlatform.x + 12, Math.min(standingPlatform.x + standingPlatform.w - p.w - 12, p.x));
      lastSafeY = p.y;
    }

    // Environmental hazards (water, spikes, lava, poison): damage + launch upward out of hazard!
    stepHazards();

    // Pit recovery
    if (p.y > compiledStage.meta.worldHeight + 80) {
      p.x = lastSafeX;
      p.y = lastSafeY - 12;
      p.vx = 0;
      p.vy = 0;
      hurtLocalPlayer(Math.max(15, Math.round(p.maxHp * 0.14)), p.x + p.w * 0.5);
    }

    handleLocalAttack(now);
  }

  function stepHazards(): void {
    const p = localPlayer;
    for (const hz of compiledStage.hazards) {
      if (!aabbOverlap(p, hz)) continue;
      const cx = p.x + p.w * 0.5;
      const cy = p.y + p.h * 0.75;
      const isDeepPit = hz.h >= 60;
      const toSafeDir = lastSafeX >= p.x ? 1 : -1;

      if (p.invulnTimer <= 0) {
        const dmg = Math.max(10, Math.round(p.maxHp * hz.damageRatio));
        hurtLocalPlayer(dmg, cx - toSafeDir * 24);
        const palette: Record<typeof hz.kind, { color: string; label: string }> = {
          water: { color: "#4FC3F7", label: "첨벙!" },
          spikes: { color: "#CFD8DC", label: "아야!" },
          lava: { color: "#FF6D00", label: "앗 뜨거!" },
          poison: { color: "#B2FF59", label: "독 늪!" }
        };
        const info = palette[hz.kind];
        spawnSparkles(cx, cy, info.color, 14);
        spawnText(cx, p.y - 26, info.label, "playerHurt");
        if (hz.kind === "poison") {
          applyStatusToPlayer("poison", 3.2, {
            tickDamage: Math.max(4, Math.round(p.maxHp * 0.035)),
            tickInterval: 1.1,
            speedMult: 0.78
          });
        } else if (hz.kind === "lava") {
          applyStatusToPlayer("burn", 2.2, {
            tickDamage: Math.max(5, Math.round(p.maxHp * 0.04)),
            tickInterval: 0.95
          });
        }
      }

      // Always spring player cleanly back up out of the hazard (even during invuln frames)
      p.y = Math.min(p.y, hz.y - p.h + 12);
      p.vy = Math.min(p.vy, hz.bounceVy);
      if (isDeepPit) {
        p.vx = toSafeDir * Math.max(Math.abs(p.vx), 165);
      }
      p.grounded = false;
      standingPlatform = null;
      p.squashX = 0.78;
      p.squashY = 1.26;
      break;
    }
  }

  function applyOptimisticMobHit(
    mob: ClientMobEntity,
    knockDir: number,
    now: number,
    hitKind: "primary" | "splash" | "dot" = "primary",
    dotStatus?: StatusEffectKind
  ): void {
    const p = localPlayer;
    const w = WEAPON_CATALOG[p.equippedWeaponId] ?? WEAPON_CATALOG.wooden_sword!;
    const clientHitId = nextPredId("hit");
    const damageRoll = Math.random();
    const combat = computeEffectiveCombatStats(
      w,
      p.baseAtk,
      p.baseDex,
      getWeaponUpgrade(p.weaponUpgrades, w.id)
    );
    const totalAtk = combat.totalAtk;
    const effCritChance = combat.critChance;

    let damage: number;
    let isCrit: boolean;
    let kbMult = 1;
    if (hitKind === "dot" && dotStatus) {
      let dotRatio = 0.15;
      const eqSpec = w.special?.statuses?.find((s) => s.kind === dotStatus);
      if (eqSpec?.dotRatio) {
        dotRatio = eqSpec.dotRatio;
      } else {
        for (const wid of p.unlockedWeapons) {
          const spec = WEAPON_CATALOG[wid]?.special?.statuses?.find((s) => s.kind === dotStatus);
          if (spec?.dotRatio) {
            dotRatio = spec.dotRatio;
            break;
          }
        }
      }
      damage = Math.max(1, Math.round(totalAtk * dotRatio));
      isCrit = false;
      kbMult = 0;
    } else if (hitKind === "splash" && w.special?.splash) {
      const base = computeDeterministicHit(totalAtk, effCritChance, w.critMult, damageRoll);
      damage = Math.max(1, Math.round(base.damage * w.special.splash.damageMult));
      isCrit = base.isCrit;
      kbMult = 0.7;
    } else {
      const base = computeDeterministicHit(totalAtk, effCritChance, w.critMult, damageRoll);
      damage = base.damage;
      isCrit = base.isCrit;
    }

    predictedHitIds.add(clientHitId);
    if (predictedHitIds.size > 120) {
      const first = predictedHitIds.values().next().value;
      if (first) predictedHitIds.delete(first);
    }

    // Immediate 0ms local visual & physical feedback!
    const resist = 1 - mob.tpl.knockbackResist;
    mob.hp = Math.max(0, mob.hp - damage);
    mob.inCombat = true;
    mob.hitFlashTimer = hitKind === "dot" ? 0.08 : 0.14;

    if (hitKind !== "dot") {
      mob.hitStunTimer = isCrit ? 0.28 : 0.2;
      mob.vx = knockDir * w.knockbackX * kbMult * resist;
      mob.vy = w.knockbackY * kbMult * resist;
      mob.grounded = false;
      if (knockDir !== 0) mob.facing = -knockDir;
      mob.squashX = 1.24;
      mob.squashY = 0.78;
      if (w.special?.statuses && mob.hp > 0) {
        applyStatusesToMob(mob, w.special.statuses, totalAtk, p.playerId);
      }
      const burstColor =
        hitKind === "splash" && w.special?.splash
          ? w.special.splash.waveColor
          : isCrit
            ? "#FFD740"
            : w.slashColor;
      spawnHitBurst(mob.x + mob.w * 0.5, mob.y + mob.h * 0.45, burstColor, isCrit);
      spawnText(
        mob.x + mob.w * 0.5,
        mob.y - 12,
        isCrit ? `${damage}!` : `${damage}`,
        isCrit ? "crit" : "normal",
        hitKind === "splash" && !isCrit && w.special?.splash ? w.special.splash.waveColor : undefined
      );
      if (hitKind === "primary") {
        hitStopTimer = isCrit ? 0.05 : 0.032;
        triggerShake(isCrit ? 6 : 3, isCrit ? 0.15 : 0.09);
      }
      audio.playSfx(isCrit ? "sfx_crit" : "sfx_hit", 0.06);
    } else if (dotStatus) {
      const meta = STATUS_METADATA[dotStatus];
      spawnSparkles(mob.x + mob.w * 0.5, mob.y + mob.h * 0.45, meta.color, 5);
      spawnText(mob.x + mob.w * 0.5, mob.y - 10, `${damage}`, "info", meta.color);
    }

    if (mob.hp <= 0) {
      mob.alive = false;
      mob.inCombat = false;
      mob.statuses = {};
      spawnSparkles(mob.x + mob.w * 0.5, mob.y + mob.h * 0.5, mob.primaryColor, 16);
      audio.playSfx("sfx_mob_defeat", 0.05);
    }

    optimisticMobLocks.set(mob.id, {
      hp: mob.hp,
      alive: mob.alive,
      expiresAt: now + 950
    });

    // Sync to server for authoritative XP, cooperative rewards, and multiplayer broadcast
    actions.sendAction({
      type: "attackMob",
      payload: {
        mobId: mob.id,
        knockDir: hitKind === "dot" ? 0 : knockDir,
        clientHitId,
        damageRoll,
        hitKind,
        ...(dotStatus ? { dotStatus } : {}),
        mobX: Math.round(mob.x),
        mobY: Math.round(mob.y)
      }
    });
  }

  function handleLocalAttack(now: number): void {
    const p = localPlayer;
    if (!justPressed("attack") || attackCooldown > 0 || hurtStunTimer > 0 || p.inMenu || Boolean(p.statuses.stun?.remaining)) return;
    const w = WEAPON_CATALOG[p.equippedWeaponId] ?? WEAPON_CATALOG.wooden_sword!;
    const combat = computeEffectiveCombatStats(w, p.baseAtk, p.baseDex, getWeaponUpgrade(p.weaponUpgrades, w.id));
    attackCooldown = combat.cooldownSec;
    p.attackAnimDuration = Math.min(0.24, combat.cooldownSec * 0.78);
    p.attackAnimTimer = p.attackAnimDuration;
    poseSendTimer = 0.085;
    p.squashX = 1.14;
    p.squashY = 0.9;
    audio.playSfx(w.sfx, 0.06);

    const slashX = p.facing > 0 ? p.x + p.w * 0.7 : p.x + p.w * 0.3;
    hitEffects.push({
      type: "slash",
      x: slashX,
      y: p.y + p.h * 0.48,
      facing: p.facing,
      reach: w.reach,
      color: w.slashColor,
      age: 0,
      duration: 0.16
    });

    const hitbox = {
      x: p.facing > 0 ? p.x + p.w * 0.35 : p.x + p.w * 0.65 - w.reach,
      y: p.y + p.h * 0.5 - w.height * 0.52,
      w: w.reach,
      h: w.height
    };

    const primaryHitIds = new Set<string>();
    for (const mob of mobs) {
      if (!mob.alive) continue;
      // 2-second spawn protection: cannot damage blinking newly respawned mobs!
      if (now < mob.spawnProtectUntil) continue;
      if (aabbOverlap(hitbox, mob)) {
        primaryHitIds.add(mob.id);
        applyOptimisticMobHit(mob, p.facing, now, "primary");
      }
    }

    // Upgraded weapon sword-energy / shockwave splash (e.g. Maple Greatsword 2-tile wave)
    if (w.special?.splash) {
      const sp = w.special.splash;
      const rangePx = Math.round(sp.rangeTiles * compiledStage.meta.tileSize) + 28;
      hitEffects.push({
        type: "wave",
        x: p.x + p.w * 0.5 + p.facing * 12,
        y: p.y + p.h * 0.46,
        facing: p.facing,
        rangePx,
        heightPx: sp.heightPx,
        color: sp.waveColor,
        accentColor: sp.accentColor,
        style: sp.style,
        age: 0,
        duration: 0.28
      });
      for (let i = 0; i < 8; i++) {
        particles.push({
          x: p.x + p.w * 0.5 + p.facing * (20 + Math.random() * rangePx * 0.75),
          y: p.y + p.h * 0.46 + (Math.random() - 0.5) * sp.heightPx * 0.75,
          vx: p.facing * (140 + Math.random() * 140),
          vy: (Math.random() - 0.5) * 90 - 20,
          gravity: 160,
          size: 3.5 + Math.random() * 2.5,
          color: i % 2 === 0 ? sp.waveColor : sp.accentColor,
          age: 0,
          duration: 0.3 + Math.random() * 0.18,
          shape: "star"
        });
      }
      const waveBox = {
        x: p.facing > 0 ? p.x + p.w * 0.5 : p.x + p.w * 0.5 - rangePx,
        y: p.y + p.h * 0.5 - sp.heightPx * 0.5,
        w: rangePx,
        h: sp.heightPx
      };
      for (const mob of mobs) {
        if (!mob.alive || now < mob.spawnProtectUntil || primaryHitIds.has(mob.id)) continue;
        if (aabbOverlap(waveBox, mob)) {
          applyOptimisticMobHit(mob, p.facing, now, "splash");
        }
      }
    }

    if (w.type === "ranged") {
      projectiles.push({
        x: p.x + p.w * 0.5 + p.facing * 18 - 11,
        y: p.y + p.h * 0.5 - 13,
        w: 22,
        h: 22,
        vx: p.facing * (w.projectileSpeed ?? 560),
        vy: 0,
        traveled: 0,
        maxDistance: w.projectileRange ?? 360,
        alive: true,
        atk: p.baseAtk + w.atk,
        pierceLeft: w.pierce ?? 1,
        hitIds: new Set(),
        color: w.slashColor,
        accentColor: w.accentColor,
        spin: 0,
        isEnemy: false
      });
    }
  }

  function hurtLocalPlayer(amount: number, sourceX: number): void {
    const p = localPlayer;
    if (p.invulnTimer > 0 || downed() || p.inMenu) return;
    resetIdleRegen();
    p.invulnTimer = PLAYER_CONFIG.invulnDuration;
    hurtStunTimer = 0.22;
    p.onLadder = false;
    currentLadder = null;
    const knockDir = p.x + p.w * 0.5 >= sourceX ? 1 : -1;
    p.vx = knockDir * PLAYER_CONFIG.knockbackVx;
    p.vy = PLAYER_CONFIG.knockbackVy;
    p.grounded = false;
    standingPlatform = null;
    p.hp = Math.max(0, p.hp - amount);
    spawnText(p.x + p.w * 0.5, p.y - 10, `-${amount}`, "playerHurt");
    spawnHitBurst(p.x + p.w * 0.5, p.y + p.h * 0.5, "#FF5252", false);
    audio.playSfx("sfx_player_hurt", 0.04);
    triggerShake(6, 0.16);
    actions.sendAction({ type: "playerHurt", payload: { amount } });
  }

  function spawnEnemyShot(mob: ClientMobEntity, targetX: number, targetY: number): void {
    const r = mob.tpl.rangedAttack;
    if (!r) return;
    const mx = mob.x + mob.w * 0.5;
    const my = mob.y + mob.h * 0.45;
    const baseAngle = Math.atan2(targetY - my, targetX - mx);
    const count = r.spreadCount ?? 1;
    const spreadStep = count === 3 ? 0.24 : count === 2 ? 0.18 : 0;
    for (let i = 0; i < count; i++) {
      const offset = (i - (count - 1) * 0.5) * spreadStep;
      const ang = baseAngle + offset;
      projectiles.push({
        x: mx - 8,
        y: my - 8,
        w: 16,
        h: 16,
        vx: Math.cos(ang) * r.speed,
        vy: Math.sin(ang) * r.speed,
        traveled: 0,
        maxDistance: 440,
        alive: true,
        atk: Math.round(mob.tpl.atk * 0.85),
        pierceLeft: 1,
        hitIds: new Set(),
        color: r.color,
        accentColor: mob.primaryColor,
        spin: 0,
        isEnemy: true,
        ...(r.slowEffect ? { slowEffect: true } : {})
      });
    }
  }

  function stepMobs(dt: number, now: number): void {
    for (const mob of mobs) {
      if (!mob.alive) continue;
      mob.animTimer += dt;
      if (mob.hitFlashTimer > 0) mob.hitFlashTimer = Math.max(0, mob.hitFlashTimer - dt);
      if (mob.hitStunTimer > 0) mob.hitStunTimer = Math.max(0, mob.hitStunTimer - dt);
      if (mob.displayHp > mob.hp) {
        mob.displayHp = Math.max(mob.hp, mob.displayHp - mob.maxHp * 1.4 * dt);
      }
      mob.squashX += (1 - mob.squashX) * Math.min(1, dt * 14);
      mob.squashY += (1 - mob.squashY) * Math.min(1, dt * 14);

      const isProtected = now < mob.spawnProtectUntil;

      // Tick mob status effects (stun freeze, DoT periodic ticks, slow/shock)
      let isStunned = false;
      let statusSpeedMult = 1.0;
      for (const [key, st] of Object.entries(mob.statuses) as Array<[StatusEffectKind, ActiveStatusEffect | undefined]>) {
        if (!st) continue;
        st.remaining -= dt;
        if (st.remaining <= 0) {
          delete mob.statuses[key];
          continue;
        }
        if (st.kind === "stun") {
          isStunned = true;
        }
        if (typeof st.speedMult === "number") {
          statusSpeedMult = Math.min(statusSpeedMult, st.speedMult);
        }
        if (STATUS_METADATA[st.kind]?.isDot && typeof st.tickInterval === "number") {
          st.tickTimer = (st.tickTimer ?? st.tickInterval) - dt;
          if (st.tickTimer <= 0) {
            st.tickTimer += st.tickInterval;
            if (st.sourcePlayerId === localPlayer.playerId && !isProtected && mob.alive) {
              applyOptimisticMobHit(mob, 0, now, "dot", st.kind);
              if (!mob.alive) break;
            }
          }
        }
      }
      if (!mob.alive) continue;

      const mx = mob.x + mob.w * 0.5;
      const my = mob.y + mob.h * 0.5;
      // Target the nearest alive player across ALL players on this stage (not only localPlayer!)
      const auth = getMobAuthority(mob, now);
      const px = auth.targetX;
      const py = auth.targetY;
      const dx = px - mx;
      const dy = py - my;
      const dist = Math.hypot(dx, dy);
      // Strict vertical aggro check: grounded mobs only detect players on the same floor (~44px),
      // while flying mobs keep vertical sight so they can dive from above.
      const vRange = mob.tpl.aggroVerticalRange ?? (mob.tpl.flying ? 220 : 44);
      const seesPlayer =
        auth.hasTarget &&
        !isProtected &&
        !isStunned &&
        Math.abs(dx) <= mob.tpl.aggroRange &&
        Math.abs(dy) <= vRange;

      if (seesPlayer && !mob.inCombat && dist <= mob.tpl.aggroRange * 0.9) {
        mob.inCombat = true;
      }

      // Active mob telegraph: show red '!' above head + startled hop and wait 0.5s before attacking!
      const isActive = isActiveMobAi(mob.tpl.ai);
      if (isActive && !isProtected && !isStunned && mob.hitStunTimer <= 0) {
        if (seesPlayer && !mob.alerted) {
          mob.alerted = true;
          mob.alertTimer = MOB_ALERT_TELEGRAPH_SEC;
          mob.alertResetTimer = 0;
          mob.inCombat = true;
          mob.facing = dx >= 0 ? 1 : -1;
          mob.vx = 0;
          mob.squashX = 0.82;
          mob.squashY = 1.26;
          if (!mob.tpl.flying && mob.grounded) {
            mob.vy = -175;
            mob.grounded = false;
          }
        } else if (mob.alerted) {
          if (seesPlayer) {
            mob.alertResetTimer = 0;
          } else if (mob.alertTimer <= 0) {
            mob.alertResetTimer += dt;
            if (mob.alertResetTimer >= 1.4) {
              mob.alerted = false;
              mob.alertResetTimer = 0;
            }
          }
        }
      }

      // Unique movement AI for all 16 monster patterns
      if (mob.hitStunTimer > 0) {
        mob.vx *= Math.pow(0.06, dt);
      } else if (isStunned) {
        // Stunned: frozen in place with golden star halo overhead!
        mob.vx *= Math.pow(0.05, dt);
        if (mob.tpl.flying) mob.vy *= Math.pow(0.05, dt);
        mob.alertTimer = 0;
      } else if (isProtected) {
        // Gentle idle bob while blinking in 2-second spawn protection (never attacks!)
        mob.vx = 0;
        mob.alertTimer = 0;
        mob.alerted = false;
        if (mob.tpl.flying) {
          mob.y = mob.homeY + Math.sin(mob.animTimer * 4) * 6;
        }
      } else if (mob.alertTimer > 0) {
        // 0.5s alert windup before launching active attack/chase
        mob.alertTimer = Math.max(0, mob.alertTimer - dt);
        mob.vx *= Math.pow(0.04, dt);
        if (auth.hasTarget && Math.abs(dx) > 8) {
          mob.facing = dx >= 0 ? 1 : -1;
        }
        if (mob.tpl.flying) {
          mob.vy = (mob.homeY - mob.y) * 3;
        }
        // Subtle tense pre-charge crouch right before lunging
        if (mob.alertTimer < 0.18) {
          mob.squashX = 1.14;
          mob.squashY = 0.88;
        }
      } else {
        updateMobAi(mob, dt, dx, dy, seesPlayer, px, py);
        if (statusSpeedMult < 1) {
          mob.vx *= statusSpeedMult;
          if (mob.tpl.flying) mob.vy *= statusSpeedMult;
        }
      }

      // Physics integration
      if (mob.tpl.flying) {
        mob.x += mob.vx * dt;
        mob.y += mob.vy * dt;
        mob.x = Math.max(mob.patrolMinX, Math.min(mob.patrolMaxX - mob.w, mob.x));
        mob.y = Math.max(48, Math.min(compiledStage.meta.worldHeight - 140, mob.y));
        mob.grounded = false;
      } else {
        const prevBottom = mob.y + mob.h;
        mob.x += mob.vx * dt;
        mob.vy = Math.min(PLAYER_CONFIG.maxFallSpeed, mob.vy + PLAYER_CONFIG.gravity * dt);
        mob.y += mob.vy * dt;
        const actor = {
          x: mob.x,
          y: mob.y,
          w: mob.w,
          h: mob.h,
          vx: mob.vx,
          vy: mob.vy,
          grounded: mob.grounded,
          standingPlatform: null as CompiledStage["platforms"][number] | null
        };
        resolvePlatformLanding(actor, prevBottom, compiledStage.platforms, compiledStage.movingPlatforms, false);
        mob.y = actor.y;
        mob.vy = actor.vy;
        mob.grounded = actor.grounded;
        if (mob.hitStunTimer <= 0 && mob.grounded) {
          if (mob.x < mob.patrolMinX) {
            mob.x = mob.patrolMinX;
            mob.facing = 1;
          } else if (mob.x + mob.w > mob.patrolMaxX) {
            mob.x = mob.patrolMaxX - mob.w;
            mob.facing = -1;
          }
        }
      }

      // Smooth reconciliation to nearest-player authoritative kinematics when another player is closer
      if (!isProtected && !auth.isLocalAuthority && mob.hitStunTimer <= 0 && now - mob.lastAuthAt < 1100) {
        const errX = mob.authX - mob.x;
        const errY = mob.authY - mob.y;
        const errDist = Math.hypot(errX, errY);
        if (errDist > 120) {
          mob.x = mob.authX;
          mob.y = mob.authY;
          mob.vx = mob.authVx;
          mob.vy = mob.authVy;
          mob.facing = mob.authFacing;
        } else if (errDist > 2) {
          const blend = 1 - Math.exp(-16 * dt);
          mob.x += errX * blend;
          mob.y += errY * blend;
          mob.vx += (mob.authVx - mob.vx) * blend;
          mob.vy += (mob.authVy - mob.vy) * blend;
          mob.facing = mob.authFacing;
        }
      }

      // Contact damage (blocked during 2-second spawn protection, stun, hitstun, or inventory safe mode!)
      if (!isProtected && !isStunned && mob.hitStunTimer <= 0 && localPlayer.invulnTimer <= 0 && !localPlayer.inMenu) {
        const box = { x: mob.x + 5, y: mob.y + 5, w: mob.w - 10, h: mob.h - 6 };
        if (aabbOverlap(localPlayer, box)) {
          mob.inCombat = true;
          hurtLocalPlayer(mob.tpl.atk, mob.x + mob.w * 0.5);
        }
      }
    }
  }

  function updateMobAi(
    mob: ClientMobEntity,
    dt: number,
    dx: number,
    dy: number,
    seesPlayer: boolean,
    px: number,
    py: number
  ): void {
    const ai = mob.tpl.ai;
    const spd = mob.tpl.speed;

    // Ranged monsters fire periodic projectiles when seeing player
    if (mob.tpl.rangedAttack && seesPlayer) {
      mob.shootTimer -= dt;
      if (mob.shootTimer <= 0) {
        mob.shootTimer = mob.tpl.rangedAttack.cooldownSec;
        mob.facing = dx >= 0 ? 1 : -1;
        spawnEnemyShot(mob, px, py);
      }
    }

    if (ai === "patrol") {
      mob.vx = mob.facing * spd;
    } else if (ai === "dash" || ai === "charge") {
      if (seesPlayer && Math.abs(dx) > 18) {
        mob.facing = dx >= 0 ? 1 : -1;
        mob.vx = mob.facing * (mob.tpl.dashSpeed ?? spd * 2);
      } else {
        mob.vx = mob.facing * spd;
      }
    } else if (ai === "hopper" || ai === "double_hop" || ai === "elastic_slime" || ai === "golem_stomp") {
      mob.aiTimer -= dt;
      if (seesPlayer && mob.grounded && Math.abs(dx) > 20) mob.facing = dx >= 0 ? 1 : -1;
      mob.vx = mob.facing * (mob.grounded ? spd * 0.72 : spd * 1.25);
      if (mob.grounded && mob.aiTimer <= 0) {
        mob.vy = mob.tpl.hopVelocity ?? -390;
        mob.grounded = false;
        mob.squashX = 0.8;
        mob.squashY = 1.24;
        mob.aiTimer = mob.tpl.hopInterval ?? 1.4;
        if (ai === "double_hop") mob.aiPhase = "can_double";
      } else if (ai === "double_hop" && !mob.grounded && mob.aiPhase === "can_double" && mob.vy > -40) {
        mob.vy = -340;
        mob.aiPhase = "done";
        mob.squashX = 0.84;
        mob.squashY = 1.2;
      }
    } else if (ai === "lunge" || ai === "backstep") {
      mob.aiTimer -= dt;
      if (mob.aiPhase === "windup") {
        mob.vx = ai === "backstep" ? -mob.facing * spd * 1.15 : 0;
        mob.squashX = 1.22;
        mob.squashY = 0.8;
        if (mob.aiTimer <= 0) {
          mob.aiPhase = "lunge";
          mob.aiTimer = 0.3;
          mob.vx = mob.facing * (mob.tpl.lungeSpeed ?? mob.tpl.dashSpeed ?? spd * 2.2);
        }
        return;
      }
      if (mob.aiPhase === "lunge") {
        if (mob.aiTimer <= 0) {
          mob.aiPhase = "recover";
          mob.aiTimer = 0.5;
        }
        return;
      }
      if (mob.aiPhase === "recover") {
        mob.vx *= Math.pow(0.08, dt);
        if (mob.aiTimer <= 0) mob.aiPhase = "idle";
        return;
      }
      if (seesPlayer && Math.abs(dx) < 175 && mob.grounded) {
        mob.facing = dx >= 0 ? 1 : -1;
        mob.aiPhase = "windup";
        mob.aiTimer = 0.28;
        return;
      }
      mob.vx = mob.facing * spd;
    } else if (ai === "web_spider" || ai === "fire_drake") {
      mob.aiTimer -= dt;
      if (seesPlayer && mob.grounded) mob.facing = dx >= 0 ? 1 : -1;
      mob.vx = mob.facing * spd;
      if (mob.grounded && mob.aiTimer <= 0 && seesPlayer) {
        mob.vy = mob.tpl.hopVelocity ?? -420;
        mob.grounded = false;
        mob.aiTimer = mob.tpl.hopInterval ?? 1.8;
      }
    } else if (ai === "swoop" || ai === "sonic_bat" || ai === "griffin_dive" || ai === "star_dragon") {
      // Airborne sinusoidal / figure-8 patrol + swooping dives!
      if (seesPlayer) {
        mob.facing = dx >= 0 ? 1 : -1;
        const targetY = ai === "sonic_bat" ? py - 90 + Math.sin(mob.animTimer * 5) * 35 : py - 32;
        const distNow = Math.max(1, Math.hypot(dx, targetY - mob.y));
        const diveMult = ai === "griffin_dive" || ai === "star_dragon" ? 1.35 : 1.15;
        mob.vx = (dx / distNow) * spd * diveMult;
        mob.vy = ((targetY - mob.y) / distNow) * spd * diveMult;
      } else {
        mob.vx = mob.facing * spd;
        if (mob.x <= mob.patrolMinX + 16) mob.facing = 1;
        if (mob.x + mob.w >= mob.patrolMaxX - 16) mob.facing = -1;
        const desiredY = mob.homeY + Math.sin(mob.animTimer * 3.2) * 32;
        mob.vy = (desiredY - mob.y) * 4;
      }
    } else if (ai === "teleport_wisp") {
      mob.teleportTimer -= dt;
      if (seesPlayer && mob.teleportTimer <= 0) {
        mob.teleportTimer = 3.0;
        spawnSparkles(mob.x + mob.w * 0.5, mob.y + mob.h * 0.5, "#8C9EFF", 10);
        const side = dx >= 0 ? -1 : 1;
        mob.x = Math.max(mob.patrolMinX, Math.min(mob.patrolMaxX - mob.w, px + side * 120));
        mob.y = Math.max(80, py - 68);
        mob.facing = -side;
        spawnSparkles(mob.x + mob.w * 0.5, mob.y + mob.h * 0.5, "#FFFFFF", 10);
      } else {
        mob.vx = mob.facing * spd * 0.65;
        if (mob.x <= mob.patrolMinX + 12) mob.facing = 1;
        if (mob.x + mob.w >= mob.patrolMaxX - 12) mob.facing = -1;
        mob.vy = (mob.homeY + Math.sin(mob.animTimer * 4) * 28 - mob.y) * 3;
      }
    }

    if (!mob.tpl.flying && mob.grounded) {
      if (mob.x + mob.w * 0.5 <= mob.patrolMinX + 12) mob.facing = 1;
      if (mob.x + mob.w * 0.5 >= mob.patrolMaxX - 12) mob.facing = -1;
    }
  }

  function stepProjectiles(dt: number, now: number): void {
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i]!;
      const dx = p.vx * dt;
      const dy = p.vy * dt;
      p.x += dx;
      p.y += dy;
      p.traveled += Math.hypot(dx, dy);
      p.spin += dt * 11 * (p.vx >= 0 ? 1 : -1);

      if (p.isEnemy) {
        if (!localPlayer.inMenu && aabbOverlap(p, localPlayer)) {
          if (p.slowEffect) {
            applyStatusToPlayer("slow", 2.2, { speedMult: 0.6 });
          }
          hurtLocalPlayer(p.atk, p.x + p.w * 0.5);
          p.alive = false;
        }
      } else {
        for (const mob of mobs) {
          if (!mob.alive || now < mob.spawnProtectUntil || p.hitIds.has(mob.id)) continue;
          if (aabbOverlap(p, mob)) {
            p.hitIds.add(mob.id);
            p.pierceLeft -= 1;
            applyOptimisticMobHit(mob, p.vx >= 0 ? 1 : -1, now);
            if (p.pierceLeft <= 0) {
              p.alive = false;
              break;
            }
          }
        }
      }

      if (!p.alive || p.traveled >= p.maxDistance) {
        projectiles.splice(i, 1);
      }
    }
  }

  function stepRemotePlayers(dt: number, now: number): void {
    const smooth = Math.min(1, dt * 14);
    for (const [pid, rp] of remotePlayers.entries()) {
      rp.x += (rp.targetX - rp.x) * smooth;
      rp.y += (rp.targetY - rp.y) * smooth;
      if (now - rp.lastSeenAt > 45_000) {
        remotePlayers.delete(pid);
      }
    }
  }

  function checkItemPickups(now: number): void {
    if (downed() || localPlayer.inMenu) return;
    const px = localPlayer.x + localPlayer.w * 0.5;
    const py = localPlayer.y + localPlayer.h * 0.5;
    for (const item of items) {
      const tpl = ITEM_CATALOG[item.templateId];
      if (!tpl) continue;
      if (tpl.category === "weapon") {
        if (tpl.weaponId && localPlayer.unlockedWeapons.includes(tpl.weaponId)) continue;
      } else if (!item.available) {
        continue;
      }
      const lastTry = pendingItemPickups.get(item.id) ?? 0;
      if (now - lastTry < 1000) continue;
      if (Math.hypot(px - item.x, py - item.y) <= 34) {
        pendingItemPickups.set(item.id, now);
        const clientPickupId = nextPredId("pick");
        predictedPickupIds.add(clientPickupId);
        if (predictedPickupIds.size > 120) {
          const first = predictedPickupIds.values().next().value;
          if (first) predictedPickupIds.delete(first);
        }

        if (tpl.category === "chest") {
          // Rare Treasure Chest: play lid-open burst immediately while server awards stage-scaled coins & rare stone!
          item.available = false;
          item.openingTimer = 1.25;
          optimisticItemLocks.set(item.id, now + 1500);
          spawnSparkles(item.x, item.y - 6, "#FFD740", 14);
          actions.sendAction({
            type: "collectItem",
            payload: { itemId: item.id, clientPickupId }
          });
          continue;
        }

        // Immediate 0ms optimistic pickup feedback & state update!
        localPlayer.score += tpl.score;
        if (tpl.category === "weapon" && tpl.weaponId) {
          if (!localPlayer.unlockedWeapons.includes(tpl.weaponId)) {
            localPlayer.unlockedWeapons = [...localPlayer.unlockedWeapons, tpl.weaponId].sort(
              (a, b) =>
                WEAPON_ORDER.indexOf(a as (typeof WEAPON_ORDER)[number]) -
                WEAPON_ORDER.indexOf(b as (typeof WEAPON_ORDER)[number])
            );
          }
          localPlayer.equippedWeaponId = tpl.weaponId;
          pendingWeaponSwitch = { weaponId: tpl.weaponId, seq: 0, expiresAt: now + 2500 };
          spawnText(item.x, item.y - 24, `★ ${tpl.name} 획득!`, "crit");
          spawnSparkles(item.x, item.y, tpl.glowColor, 16);
          audio.playSfx(tpl.sfx, 0);
        } else {
          item.available = false;
          optimisticItemLocks.set(item.id, now + 1500);
          spawnSparkles(item.x, item.y, tpl.glowColor, 10);
          audio.playSfx(tpl.sfx, 0.05);
          if (tpl.category === "coin") {
            localPlayer.coins += 1;
          } else if (tpl.category === "heal") {
            const healAmt = Math.max(tpl.healAmount ?? 30, Math.round(localPlayer.maxHp * 0.25));
            localPlayer.hp = Math.min(localPlayer.maxHp, localPlayer.hp + healAmt);
            spawnText(item.x, item.y - 12, `+${healAmt} HP`, "heal");
          } else if (tpl.category === "potion") {
            localPlayer.potions += tpl.potionCount ?? 1;
            spawnText(item.x, item.y - 12, "포션 +1!", "info");
          } else if (tpl.category === "max_hp") {
            localPlayer.maxHp += tpl.maxHpBonus ?? 20;
            localPlayer.hp = Math.min(localPlayer.maxHp, localPlayer.hp + (tpl.healAmount ?? 60));
            spawnText(item.x, item.y - 16, `최대체력 +${tpl.maxHpBonus}!`, "heal");
          }
        }

        // Send to server for cooperative multi-player reconciliation & D1 persistence
        actions.sendAction({
          type: "collectItem",
          payload: { itemId: item.id, clientPickupId }
        });
      }
    }
  }

  function updateEffects(dt: number): void {
    for (let i = damageTexts.length - 1; i >= 0; i--) {
      const d = damageTexts[i]!;
      d.age += dt;
      d.y += d.vy * dt;
      d.vy *= Math.pow(0.25, dt);
      if (d.age >= d.duration) damageTexts.splice(i, 1);
    }
    for (let i = hitEffects.length - 1; i >= 0; i--) {
      const fx = hitEffects[i]!;
      fx.age += dt;
      if (fx.age >= fx.duration) hitEffects.splice(i, 1);
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const pt = particles[i]!;
      pt.age += dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vy += pt.gravity * dt;
      if (pt.age >= pt.duration) particles.splice(i, 1);
    }
  }

  function updateCamera(dt: number): void {
    const lookAhead = localPlayer.facing * 54;
    const targetX = Math.max(0, Math.min(camera.maxX, localPlayer.x + localPlayer.w * 0.5 + lookAhead - VIEWPORT.width * 0.46));
    const targetY = Math.max(0, Math.min(camera.maxY, localPlayer.y + localPlayer.h * 0.5 - VIEWPORT.height * 0.55));
    const s = Math.min(1, dt * 6.5);
    camera.x += (targetX - camera.x) * s;
    camera.y += (targetY - camera.y) * s;
  }

  function sendPeriodicSync(dt: number): void {
    reconcileMenuModeWithServer(false, 1000);
    poseSendTimer += dt;
    if (poseSendTimer >= 0.085 && actions.sendSignal && ctx.connected !== false && !downed() && !localPlayer.inMenu) {
      poseSendTimer = 0;
      const now = Date.now();
      const animState =
        localPlayer.attackAnimTimer > 0
          ? "attack"
          : localPlayer.onLadder
            ? "climb"
            : !localPlayer.grounded
              ? "jump"
              : Math.abs(localPlayer.vx) > 15
                ? "walk"
                : "idle";

      // Attach compact kinematics for up to 12 nearby mobs where localPlayer is the nearest alive player
      const ownedMobs: Array<{ dist: number; tuple: [string, number, number, number, number, number] }> = [];
      for (const mob of mobs) {
        if (!mob.alive || now < mob.spawnProtectUntil) continue;
        const auth = getMobAuthority(mob, now);
        if (!auth.isLocalAuthority || auth.localDist > 1200) continue;
        ownedMobs.push({
          dist: auth.localDist,
          tuple: [
            mob.id,
            Math.round(mob.x),
            Math.round(mob.y),
            Math.round(mob.vx),
            Math.round(mob.vy),
            mob.facing < 0 ? -1 : 1
          ]
        });
      }
      ownedMobs.sort((a, b) => a.dist - b.dist);
      const mobSyncPayload = ownedMobs.slice(0, 12).map((m) => m.tuple);

      actions.sendSignal({
        type: "playerPose",
        payload: {
          x: Math.round(localPlayer.x),
          y: Math.round(localPlayer.y),
          vx: Math.round(localPlayer.vx),
          vy: Math.round(localPlayer.vy),
          facing: localPlayer.facing,
          animState,
          ...(mobSyncPayload.length > 0 ? { mobs: mobSyncPayload } : {})
        }
      });
    }

    // Periodic persistent D1 position checkpoint every 8s when moved
    checkpointTimer += dt;
    if (checkpointTimer >= 8.0 && ctx.connected !== false) {
      checkpointTimer = 0;
      if (Math.hypot(localPlayer.x - lastSavedPosX, localPlayer.y - lastSavedPosY) > 64) {
        lastSavedPosX = localPlayer.x;
        lastSavedPosY = localPlayer.y;
        actions.sendAction({
          type: "checkpoint",
          payload: { x: Math.round(localPlayer.x), y: Math.round(localPlayer.y) }
        });
      }
    }
  }

  function startLoop(): void {
    if (destroyed || renderSuspended || rafId !== null) return;
    lastFrameTime = performance.now();
    const loop = (now: number) => {
      if (destroyed || renderSuspended) {
        rafId = null;
        return;
      }
      const frameDt = Math.min(0.05, Math.max(0, (now - lastFrameTime) / 1000));
      lastFrameTime = now;
      accumulator += frameDt;
      const fixedDt = 1 / 60;
      while (accumulator >= fixedDt) {
        stepSimulation(fixedDt);
        accumulator -= fixedDt;
      }
      renderer?.render(
        {
          now: Date.now(),
          stage: compiledStage,
          camera,
          shakeX,
          shakeY,
          warpFlash,
          player: localPlayer,
          remotePlayers: [...remotePlayers.values()],
          mobs,
          items,
          lootDrops,
          projectiles,
          damageTexts,
          hitEffects,
          particles,
          coinHover,
          statusHover,
          stagePlayerCount,
          totalPlayersOnline
        },
        frameDt
      );
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
  }

  // Efficient Background Processing: suspend canvas animation when off-screen
  let intersectionObserver: IntersectionObserver | null = null;
  const setSuspended = (skip: boolean) => {
    renderSuspended = skip;
    if (skip && rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    } else if (!skip) {
      startLoop();
    }
  };
  const onContentVis = (ev: Event) => {
    setSuspended(Boolean((ev as Event & { skipped?: boolean }).skipped));
  };
  if ("contentVisibility" in document.documentElement.style) {
    stageFrame.addEventListener("contentvisibilityautostatechange", onContentVis);
  } else if ("IntersectionObserver" in window) {
    intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const e of entries) setSuspended(!e.isIntersecting);
      },
      { rootMargin: "200px" }
    );
    intersectionObserver.observe(stageFrame);
  }

  // Bootstrap assets & initial state
  applySnapshot(initialContext);
  void loadSunnyImages().then((imgs) => {
    if (destroyed) return;
    renderer = new SunnyRenderer(canvas, imgs);
    startLoop();
  });

  return {
    update(nextContext: GameClientSnapshot) {
      const wasConnected = ctx.connected !== false;
      ctx = { ...ctx, ...nextContext };
      const nowConnected = ctx.connected !== false;
      applySnapshot(nextContext);
      if (!wasConnected && nowConnected) {
        reconcileMenuModeWithServer(true);
      }
    },
    destroy() {
      destroyed = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      canvas.removeEventListener("pointermove", onCanvasPointerMove);
      canvas.removeEventListener("pointerleave", onCanvasPointerLeave);
      canvas.removeEventListener("pointercancel", onCanvasPointerCancel);
      canvas.removeEventListener("pointerdown", onCanvasPointerDown);
      canvas.removeEventListener("click", onCanvasClick);
      stageFrame.removeEventListener("contentvisibilityautostatechange", onContentVis);
      intersectionObserver?.disconnect();
      audio.destroy();
      window.clearTimeout(reviveRetryTimer);
      chat.remove();
      container.innerHTML = "";
    }
  };
}
