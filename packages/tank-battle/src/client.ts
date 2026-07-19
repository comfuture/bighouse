import "./style.css";
import Phaser from "phaser";
import type { GameClientContext, MountedGameClient } from "@bighouse/game-sdk/client";
import { triggerPlacementFeedback, triggerSelectionFeedback } from "@bighouse/game-sdk/feedback";
import { createGameUi, type MountedGameUi } from "@bighouse/ui";
import { createTankBattleAudio, type TankBattleAudioController } from "./audio";
import { clamp, simulateTrajectory, tankFacing } from "./physics";
import type {
  LastShot,
  TankBattlePrivateView,
  TankBattlePublicView,
  TankItemSelection
} from "./types";
export { gameMetadata } from "./client-metadata";

type TankBattleClient = {
  playerId: string;
  version: number;
  serverTime: number;
  publicView: TankBattlePublicView;
  privateView: TankBattlePrivateView;
  sendAction(action: { type: string; payload: Record<string, unknown> }): void;
  requestPlayAgain(): void;
  leaveFinishedGame(): void;
};

type BattleButton = {
  container: Phaser.GameObjects.Container;
  background: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
};

type ShotAnimation = {
  shot: LastShot;
  startedAt: number;
  baseView: TankBattlePublicView;
  exploded: boolean;
};

type QueuedShotAnimation = Pick<ShotAnimation, "shot" | "baseView">;

const GAME_WIDTH = 1000;
const GAME_HEIGHT = 800;
const BATTLE_HEIGHT = 600;
const ANGLE_MIN = 10;
const ANGLE_MAX = 80;
const IMPACT_EFFECT_MS = 950;
const MAX_WIND_SPEED = 12;
const POWER_GAUGE_X = 166;
const POWER_GAUGE_Y = 744;
const POWER_GAUGE_WIDTH = 488;
const POWER_GAUGE_HEIGHT = 20;
const itemLabels: Record<Exclude<TankItemSelection, "none">, string> = {
  megaBlast: "광역 폭탄",
  warhead: "고폭탄",
  scope: "궤도 스코프"
};

export function mountGame(container: HTMLElement, context: GameClientContext): MountedGameClient {
  const callbacks = {
    sendAction: context.sendAction,
    requestPlayAgain: context.requestPlayAgain,
    leaveFinishedGame: context.leaveFinishedGame
  };
  let client = toTankBattleClient(context, callbacks);
  container.classList.add("tank-battle-game");
  container.replaceChildren();

  const scene = new TankBattleScene(() => client);
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: container,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    backgroundColor: "#101a35",
    render: { antialias: true, pixelArt: false, roundPixels: false },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: GAME_WIDTH,
      height: GAME_HEIGHT
    },
    scene: [scene]
  });
  const gameUi = createGameUi(container, context, context);
  syncResultDialog(gameUi, client);
  const handleChatOpenChange = (event: Event): void => {
    const open = (event as CustomEvent<{ open: boolean }>).detail.open;
    if (game.input.keyboard) game.input.keyboard.enabled = !open;
  };
  container.addEventListener("bighouse-chat-open-change", handleChatOpenChange);

  return {
    update(nextContext) {
      const previous = client;
      client = toTankBattleClient({ ...context, ...nextContext }, callbacks);
      gameUi.update(nextContext);
      syncResultDialog(gameUi, client);
      scene.applySnapshot(client, previous);
    },
    destroy() {
      container.removeEventListener("bighouse-chat-open-change", handleChatOpenChange);
      gameUi.destroy();
      scene.prepareDestroy();
      game.destroy(true, false);
      container.classList.remove("tank-battle-game");
      container.replaceChildren();
    }
  };
}

class TankBattleScene extends Phaser.Scene {
  private readonly getClient: () => TankBattleClient;
  private readonly audio: TankBattleAudioController = createTankBattleAudio();
  private skyGraphics?: Phaser.GameObjects.Graphics;
  private terrainGraphics?: Phaser.GameObjects.Graphics;
  private tankGraphics?: Phaser.GameObjects.Graphics;
  private previewGraphics?: Phaser.GameObjects.Graphics;
  private hudGraphics?: Phaser.GameObjects.Graphics;
  private windGraphics?: Phaser.GameObjects.Graphics;
  private powerGaugeGraphics?: Phaser.GameObjects.Graphics;
  private projectile?: Phaser.GameObjects.Arc;
  private statusText?: Phaser.GameObjects.Text;
  private windText?: Phaser.GameObjects.Text;
  private gravityText?: Phaser.GameObjects.Text;
  private angleText?: Phaser.GameObjects.Text;
  private powerText?: Phaser.GameObjects.Text;
  private lastPowerText?: Phaser.GameObjects.Text;
  private playerTexts: Phaser.GameObjects.Text[] = [];
  private itemButtons = new Map<Exclude<TankItemSelection, "none">, BattleButton>();
  private angleButtons: BattleButton[] = [];
  private fireButton?: BattleButton;
  private selectedItem: TankItemSelection = "none";
  private angle = 45;
  private power = 55;
  private lastOwnShotPower: number | undefined;
  private chargeStartedAt: number | undefined;
  private chargingPointerId: number | undefined;
  private awaitingSnapshot = false;
  private receivedAt = 0;
  private shotAnimation: ShotAnimation | undefined;
  private readonly shotAnimationQueue: QueuedShotAnimation[] = [];
  private seenShotId: number | undefined;
  private lastUiSecond = -1;
  private readonly heldAngleKeys = new Set<string>();
  private angleHoldStartedAt: number | undefined;
  private nextGearCreakAt = 0;
  private activeAimPointerId: number | undefined;
  private flightSafetyTimer: Phaser.Time.TimerEvent | undefined;
  private soundingShotId: number | undefined;

  constructor(getClient: () => TankBattleClient) {
    super({ key: "tank-battle" });
    this.getClient = getClient;
  }

  create(): void {
    this.receivedAt = performance.now();
    this.skyGraphics = this.add.graphics().setDepth(0);
    this.terrainGraphics = this.add.graphics().setDepth(2);
    this.tankGraphics = this.add.graphics().setDepth(4);
    this.previewGraphics = this.add.graphics().setDepth(3);
    this.hudGraphics = this.add.graphics().setDepth(10);
    this.windGraphics = this.add.graphics().setDepth(11);
    this.projectile = this.add.circle(0, 0, 5, 0xfff2a8).setDepth(7).setVisible(false);
    this.createParticleTextures();
    this.createHud();
    this.createControls();
    this.drawSky();
    const initialShot = this.getClient().publicView.lastShot;
    this.seenShotId = initialShot?.id;
    if (initialShot?.shooterPlayerId === this.getClient().playerId) {
      this.lastOwnShotPower = initialShot.power;
    }
    this.renderAll();

    this.input.on("pointerdown", this.handleBattlefieldPointerDown, this);
    this.input.on("pointermove", this.handleBattlefieldPointerMove, this);
    this.input.on("pointerup", this.handleGlobalPointerUp, this);
    this.input.on("gameout", this.handleGameOut, this);
    this.input.keyboard?.on("keydown", this.handleKeyDown, this);
    this.input.keyboard?.on("keyup", this.handleKeyUp, this);
    this.input.keyboard?.on("keydown-SPACE", this.handleSpaceDown, this);
    this.input.keyboard?.on("keyup-SPACE", this.handleSpaceUp, this);
    this.game.events.on(Phaser.Core.Events.BLUR, this.handleBlur, this);
  }

  update(time: number, delta: number): void {
    this.updateHeldAngle(time, delta);
    if (this.chargeStartedAt !== undefined) {
      this.power = chargedPower(time - this.chargeStartedAt);
      this.renderPowerAndPreview();
    }
    if (this.shotAnimation) {
      this.updateShotAnimation(time);
    }
    const second = Math.floor(time / 250);
    if (second !== this.lastUiSecond) {
      this.lastUiSecond = second;
      this.renderStatus();
    }
  }

  applySnapshot(next: TankBattleClient, previous: TankBattleClient): void {
    if (!this.sys.isActive()) return;
    this.receivedAt = performance.now();
    if (next.version !== previous.version) {
      this.awaitingSnapshot = false;
    }
    const shot = next.publicView.lastShot;
    if (!shot) {
      // A rematch starts shot ids over at 1, so the previous match's id must
      // not suppress the first projectile animation in the new match.
      this.seenShotId = undefined;
      if (previous.publicView.lastShot && next.publicView.turnNumber <= 1) {
        this.lastOwnShotPower = undefined;
        this.power = 55;
        this.angle = 45;
      }
    } else if (shot.shooterPlayerId === next.playerId) {
      this.lastOwnShotPower = shot.power;
    }
    if (shot && shot.id !== this.seenShotId) {
      this.seenShotId = shot.id;
      const nextAnimation = {
        shot,
        baseView: clonePublicView(previous.publicView)
      };
      if (this.shotAnimation) {
        this.shotAnimationQueue.push(nextAnimation);
      } else {
        this.beginShotAnimation(nextAnimation);
      }
    }
    this.ensureSelectedItemAvailable();
    this.renderAll();
  }

  prepareDestroy(): void {
    this.cancelCharge();
    this.stopAngleAdjustment();
    this.activeAimPointerId = undefined;
    this.shotAnimationQueue.length = 0;
    if (!this.sys.isActive()) {
      this.audio.destroy();
      return;
    }
    this.input.off("pointerdown", this.handleBattlefieldPointerDown, this);
    this.input.off("pointermove", this.handleBattlefieldPointerMove, this);
    this.input.off("pointerup", this.handleGlobalPointerUp, this);
    this.input.off("gameout", this.handleGameOut, this);
    this.input.keyboard?.off("keydown", this.handleKeyDown, this);
    this.input.keyboard?.off("keyup", this.handleKeyUp, this);
    this.input.keyboard?.off("keydown-SPACE", this.handleSpaceDown, this);
    this.input.keyboard?.off("keyup-SPACE", this.handleSpaceUp, this);
    this.game.events.off(Phaser.Core.Events.BLUR, this.handleBlur, this);
    this.flightSafetyTimer?.remove(false);
    this.flightSafetyTimer = undefined;
    this.audio.destroy();
    this.tweens.killAll();
    this.time.removeAllEvents();
  }

  private createHud(): void {
    const style: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: "Inter, Pretendard, system-ui, sans-serif",
      color: "#f8fbff"
    };
    this.statusText = this.add.text(500, 98, "", { ...style, fontSize: "20px", fontStyle: "bold" }).setOrigin(0.5).setDepth(12);
    this.windText = this.add.text(500, 18, "", { ...style, fontSize: "17px", fontStyle: "bold" }).setOrigin(0.5).setDepth(12);
    this.gravityText = this.add.text(500, 70, "", { ...style, fontSize: "13px", color: "#c7d7f4" }).setOrigin(0.5).setDepth(12);
    this.playerTexts = [
      this.add.text(28, 19, "", { ...style, fontSize: "16px", fontStyle: "bold" }).setDepth(12),
      this.add.text(972, 19, "", { ...style, fontSize: "16px", fontStyle: "bold", align: "right" }).setOrigin(1, 0).setDepth(12)
    ];
  }

  private createControls(): void {
    this.hudGraphics
      ?.fillStyle(0x07101f, 1)
      .fillRect(0, BATTLE_HEIGHT, GAME_WIDTH, GAME_HEIGHT - BATTLE_HEIGHT)
      .lineStyle(3, 0x7dd3fc, 0.8)
      .lineBetween(0, BATTLE_HEIGHT + 1, GAME_WIDTH, BATTLE_HEIGHT + 1)
      .fillStyle(0x073e78, 0.96)
      .fillRoundedRect(12, 610, 288, 82, 14)
      .lineStyle(3, 0x22d3ee, 1)
      .strokeRoundedRect(12, 610, 288, 82, 14)
      .fillStyle(0x0b2039, 1)
      .fillRoundedRect(18, 708, 656, 82, 14)
      .lineStyle(2, 0x38bdf8, 0.82)
      .strokeRoundedRect(18, 708, 656, 82, 14)
      .fillStyle(0x3a160c, 1)
      .fillRoundedRect(688, 708, 300, 82, 14)
      .lineStyle(3, 0xfb923c, 1)
      .strokeRoundedRect(688, 708, 300, 82, 14);

    const minus = this.createButton(54, 653, 72, 56, "−", () => this.changeAngle(-2), 30);
    const plus = this.createButton(254, 653, 72, 56, "+", () => this.changeAngle(2), 30);
    this.angleButtons = [minus, plus];
    this.angleText = this.add.text(154, 638, "", {
      fontFamily: "Inter, Pretendard, system-ui, sans-serif",
      fontSize: "21px",
      fontStyle: "bold",
      color: "#ffffff",
      align: "center"
    }).setOrigin(0.5).setDepth(14);
    this.add.text(154, 674, "← ↓  낮추기   ·   높이기  ↑ →", {
      fontFamily: "Inter, Pretendard, system-ui, sans-serif",
      fontSize: "12px",
      fontStyle: "bold",
      color: "#a9d8ff",
      align: "center"
    }).setOrigin(0.5).setDepth(14);

    const itemEntries = ["megaBlast", "warhead", "scope"] as const;
    itemEntries.forEach((item, index) => {
      const button = this.createButton(385 + index * 168, 650, 154, 62, itemLabels[item], () => this.selectItem(item), 14);
      this.itemButtons.set(item, button);
    });

    this.powerGaugeGraphics = this.add.graphics().setDepth(13);
    this.powerText = this.add.text(36, 744, "", {
      fontFamily: "Inter, Pretendard, system-ui, sans-serif",
      fontSize: "22px",
      fontStyle: "bold",
      color: "#ffffff"
    }).setOrigin(0, 0.5).setDepth(14);
    this.lastPowerText = this.add.text(POWER_GAUGE_X, 718, "", {
      fontFamily: "Inter, Pretendard, system-ui, sans-serif",
      fontSize: "12px",
      fontStyle: "bold",
      color: "#fde68a",
      backgroundColor: "#422006",
      padding: { x: 5, y: 2 }
    }).setOrigin(0.5).setDepth(14).setVisible(false);
    this.add.text(POWER_GAUGE_X, 774, "10", {
      fontFamily: "Inter, Pretendard, system-ui, sans-serif",
      fontSize: "12px",
      fontStyle: "bold",
      color: "#b9d9ff"
    }).setOrigin(0.5).setDepth(14);
    this.add.text(410, 774, "Space / 버튼을 길게 눌러 충전", {
      fontFamily: "Inter, Pretendard, system-ui, sans-serif",
      fontSize: "12px",
      fontStyle: "bold",
      color: "#b9d9ff"
    }).setOrigin(0.5).setDepth(14);
    this.add.text(POWER_GAUGE_X + POWER_GAUGE_WIDTH, 774, "100", {
      fontFamily: "Inter, Pretendard, system-ui, sans-serif",
      fontSize: "12px",
      fontStyle: "bold",
      color: "#b9d9ff"
    }).setOrigin(0.5).setDepth(14);
    this.fireButton = this.createButton(838, 753, 276, 64, "발사 · 길게 눌러 충전", () => undefined, 20);
    this.fireButton.container.on("pointerdown", (pointer: Phaser.Input.Pointer) => this.startCharge(pointer.id));
  }

  private createButton(
    x: number,
    y: number,
    width: number,
    height: number,
    text: string,
    onPress: () => void,
    fontSize = 18,
    addToScene = true
  ): BattleButton {
    const background = this.add.rectangle(0, 0, width, height, 0x203250, 1).setStrokeStyle(1, 0x5475a3, 0.9);
    const label = this.add.text(0, 0, text, {
      fontFamily: "Inter, Pretendard, system-ui, sans-serif",
      fontSize: `${fontSize}px`,
      fontStyle: "bold",
      color: "#f8fbff",
      align: "center"
    }).setOrigin(0.5);
    const container = this.add.container(x, y, [background, label]).setSize(width, height).setInteractive({ useHandCursor: true });
    container.on("pointerover", () => background.setFillStyle(0x2c4772, 1));
    container.on("pointerout", () => this.refreshButtonStyles());
    container.on("pointerdown", (_pointer: Phaser.Input.Pointer, _localX: number, _localY: number, event: Phaser.Types.Input.EventData) => {
      void this.audio.unlock();
      event.stopPropagation();
      if (addToScene && !this.canAim()) return;
      triggerSelectionFeedback();
      onPress();
    });
    if (!addToScene) {
      container.removeFromDisplayList();
      background.removeFromDisplayList();
      label.removeFromDisplayList();
    }
    return { container, background, label };
  }

  private renderAll(): void {
    if (!this.sys.isActive()) return;
    this.drawTerrain(this.getVisualView().terrain);
    this.drawTanks();
    this.renderStatus();
    this.renderPowerAndPreview();
    this.renderItems();
    this.refreshButtonStyles();
  }

  private getVisualView(): TankBattlePublicView {
    return this.shotAnimation?.baseView ?? this.getClient().publicView;
  }

  private beginShotAnimation(animation: QueuedShotAnimation, startedAt = performance.now()): void {
    this.shotAnimation = { ...animation, startedAt, exploded: false };
    if (this.soundingShotId !== animation.shot.id) {
      this.startFlightAudio(animation.shot.id);
    }
  }

  private drawSky(): void {
    const graphics = this.skyGraphics;
    if (!graphics) return;
    graphics.clear();
    graphics.fillGradientStyle(0x0d1732, 0x0d1732, 0x315687, 0x315687, 1);
    graphics.fillRect(0, 0, GAME_WIDTH, BATTLE_HEIGHT);
    graphics.fillStyle(0xf8e8b0, 0.92).fillCircle(850, 105, 38);
    graphics.fillStyle(0xffffff, 0.7);
    for (let index = 0; index < 52; index += 1) {
      const x = (index * 191 + 43) % GAME_WIDTH;
      const y = 112 + ((index * 83) % 255);
      graphics.fillCircle(x, y, index % 5 === 0 ? 2 : 1);
    }
    graphics.fillStyle(0x8cc6ec, 0.08).fillCircle(185, 160, 130);
  }

  private drawTerrain(terrain: number[]): void {
    const graphics = this.terrainGraphics;
    const view = this.getVisualView();
    if (!graphics || terrain.length === 0) return;
    graphics.clear();
    graphics.fillStyle(0x405639, 1);
    graphics.beginPath();
    graphics.moveTo(0, terrain[0] ?? view.worldHeight);
    terrain.forEach((y, index) => graphics.lineTo(index * view.terrainStep, y));
    graphics.lineTo(view.worldWidth, view.worldHeight);
    graphics.lineTo(0, view.worldHeight);
    graphics.closePath();
    graphics.fillPath();
    graphics.lineStyle(6, 0x9bb76b, 1);
    graphics.beginPath();
    terrain.forEach((y, index) => index === 0 ? graphics.moveTo(0, y) : graphics.lineTo(index * view.terrainStep, y));
    graphics.strokePath();
    graphics.lineStyle(2, 0x2b3d2d, 0.65);
    for (let layer = 1; layer <= 3; layer += 1) {
      graphics.beginPath();
      terrain.forEach((y, index) => index === 0
        ? graphics.moveTo(0, Math.min(view.worldHeight, y + layer * 22))
        : graphics.lineTo(index * view.terrainStep, Math.min(view.worldHeight, y + layer * 22)));
      graphics.strokePath();
    }
  }

  private drawTanks(): void {
    const graphics = this.tankGraphics;
    if (!graphics) return;
    graphics.clear();
    const { playerId } = this.getClient();
    const publicView = this.getVisualView();
    for (const tank of publicView.players) {
      const alive = tank.health > 0;
      const facing = tankFacing(tank);
      const displayedShot = this.shotAnimation?.shot ?? publicView.lastShot;
      const barrelAngle = displayedShot?.shooterPlayerId === tank.playerId
        ? displayedShot.angle
        : tank.playerId === playerId ? this.angle : 45;
      const radians = (barrelAngle * Math.PI) / 180;
      const barrelStartY = tank.y - 21;
      graphics.lineStyle(8, alive ? Phaser.Display.Color.HexStringToColor(tank.color).color : 0x4b5563, 1);
      graphics.beginPath();
      graphics.moveTo(tank.x + facing * 4, barrelStartY);
      graphics.lineTo(tank.x + facing * Math.cos(radians) * 34, barrelStartY - Math.sin(radians) * 34);
      graphics.strokePath();
      graphics.fillStyle(0x142033, 1).fillRoundedRect(tank.x - 25, tank.y - 11, 50, 18, 7);
      graphics.fillStyle(alive ? Phaser.Display.Color.HexStringToColor(tank.color).color : 0x596275, 1)
        .fillRoundedRect(tank.x - 22, tank.y - 18, 44, 18, 6)
        .fillCircle(tank.x, tank.y - 21, 13);
      graphics.fillStyle(0x0b1220, 1);
      [-16, 0, 16].forEach((offset) => graphics.fillCircle(tank.x + offset, tank.y + 2, 8));
      graphics.fillStyle(0x172034, 1).fillRect(tank.x - 31, tank.y - 3, 62, 8);
      const healthWidth = 72;
      graphics.fillStyle(0x101827, 0.9).fillRoundedRect(tank.x - healthWidth / 2, tank.y - 67, healthWidth, 9, 4);
      const healthColor = tank.health > 55 ? 0x4ade80 : tank.health > 25 ? 0xfbbf24 : 0xfb7185;
      graphics.fillStyle(healthColor, 1).fillRoundedRect(tank.x - healthWidth / 2, tank.y - 67, healthWidth * (tank.health / tank.maxHealth), 9, 4);
    }
  }

  private renderStatus(): void {
    const client = this.getClient();
    const view = this.getVisualView();
    const myTurn = view.currentPlayerId === client.playerId;
    const estimatedServerTime = client.serverTime + (performance.now() - this.receivedAt);
    const seconds = view.turnDeadline ? Math.max(0, Math.ceil((view.turnDeadline - estimatedServerTime) / 1000)) : undefined;
    if (this.shotAnimation) {
      this.statusText?.setText(this.shotAnimation.exploded ? "폭발 충격과 잔해가 가라앉는 중" : "포탄 비행 중");
    } else if (view.result) {
      this.statusText?.setText(view.result === "draw" ? "동시 격파 — 무승부" : view.winnerPlayerId === client.playerId ? "승리!" : "패배");
    } else if (view.roomPhase !== "active") {
      this.statusText?.setText("상대 플레이어를 기다리는 중");
    } else if (view.turnPhase === "resolving") {
      this.statusText?.setText("포탄 비행 중 · 충돌 결과 계산 완료");
    } else if (myTurn) {
      this.statusText?.setText(`내 턴 · 발사 버튼을 누르고 떼세요${seconds === undefined ? "" : ` · ${seconds}초`}`);
    } else {
      const opponent = view.players.find((player) => player.playerId === view.currentPlayerId);
      this.statusText?.setText(`${opponent?.displayName ?? "상대"}의 조준을 기다리는 중${seconds === undefined ? "" : ` · ${seconds}초`}`);
    }
    const windArrow = view.wind > 0 ? "→" : view.wind < 0 ? "←" : "·";
    this.windText?.setText(`바람 ${windArrow} ${Math.abs(view.wind).toFixed(1)} / ${MAX_WIND_SPEED}`);
    this.renderWindIndicator(view.wind);
    this.gravityText?.setText(`중력 ${view.gravity.toFixed(1)} px/s²  ·  턴 ${view.turnNumber}`);
    view.players.slice(0, 2).forEach((player, index) => {
      this.playerTexts[index]?.setText(`${player.displayName}  HP ${player.health}/${player.maxHealth}`)
        .setColor(player.color);
    });
  }

  private renderPowerAndPreview(): void {
    this.angleText?.setText(`각도 조절  ${Math.round(this.angle)}°`);
    this.powerText?.setText(`현재\n${Math.round(this.power)}`);
    if (this.fireButton) {
      this.fireButton.label.setText(this.chargeStartedAt === undefined ? "발사 · 길게 눌러 충전" : `손을 떼서 발사  ${Math.round(this.power)}`);
    }
    this.renderPowerGauge();
    this.drawPreview();
    this.drawTanks();
  }

  private renderWindIndicator(wind: number): void {
    const graphics = this.windGraphics;
    if (!graphics) return;
    const centerX = 500;
    const y = 47;
    const maxLength = 88;
    const normalized = clamp(Math.abs(wind) / MAX_WIND_SPEED, 0, 1);
    const direction = wind < 0 ? -1 : wind > 0 ? 1 : 0;
    const endX = centerX + direction * maxLength * normalized;

    graphics.clear();
    graphics.lineStyle(2, 0x6083ac, 0.8).lineBetween(centerX - maxLength, y, centerX + maxLength, y);
    graphics.lineStyle(2, 0xc7d7f4, 0.85).lineBetween(centerX, y - 7, centerX, y + 7);
    graphics.fillStyle(0xdbeafe, 1).fillCircle(centerX, y, 3);
    if (direction === 0 || normalized === 0) return;

    const color = direction > 0 ? 0x67e8f9 : 0x93c5fd;
    const arrowLength = maxLength * normalized;
    const headLength = clamp(arrowLength * 0.35, 2, 12);
    const headHeight = clamp(arrowLength * 0.22, 2, 8);
    graphics.lineStyle(3 + normalized * 3, color, 1).lineBetween(centerX, y, endX, y);
    graphics.fillStyle(color, 1);
    graphics.beginPath();
    graphics.moveTo(endX, y);
    graphics.lineTo(endX - direction * headLength, y - headHeight);
    graphics.lineTo(endX - direction * headLength, y + headHeight);
    graphics.closePath();
    graphics.fillPath();
  }

  private renderPowerGauge(): void {
    const graphics = this.powerGaugeGraphics;
    if (!graphics) return;
    const currentPower = clamp(this.power, 10, 100);
    const currentWidth = POWER_GAUGE_WIDTH * ((currentPower - 10) / 90);

    graphics.clear();
    graphics.fillStyle(0x030a14, 1).fillRoundedRect(
      POWER_GAUGE_X,
      POWER_GAUGE_Y,
      POWER_GAUGE_WIDTH,
      POWER_GAUGE_HEIGHT,
      POWER_GAUGE_HEIGHT / 2
    );
    graphics.lineStyle(2, 0x7dd3fc, 0.9).strokeRoundedRect(
      POWER_GAUGE_X,
      POWER_GAUGE_Y,
      POWER_GAUGE_WIDTH,
      POWER_GAUGE_HEIGHT,
      POWER_GAUGE_HEIGHT / 2
    );
    if (currentWidth > 0) {
      graphics.fillStyle(this.chargeStartedAt === undefined ? 0x22d3ee : 0xfbbf24, 1).fillRoundedRect(
        POWER_GAUGE_X + 3,
        POWER_GAUGE_Y + 3,
        Math.max(6, currentWidth - 6),
        POWER_GAUGE_HEIGHT - 6,
        (POWER_GAUGE_HEIGHT - 6) / 2
      );
    }

    if (this.lastOwnShotPower === undefined) {
      this.lastPowerText?.setVisible(false);
      return;
    }
    const previousPower = clamp(this.lastOwnShotPower, 10, 100);
    const markerX = POWER_GAUGE_X + POWER_GAUGE_WIDTH * ((previousPower - 10) / 90);
    graphics.lineStyle(3, 0xfde047, 1).lineBetween(markerX, POWER_GAUGE_Y - 5, markerX, POWER_GAUGE_Y + POWER_GAUGE_HEIGHT + 3);
    graphics.fillStyle(0xfde047, 1).fillTriangle(markerX, POWER_GAUGE_Y - 1, markerX - 5, POWER_GAUGE_Y - 8, markerX + 5, POWER_GAUGE_Y - 8);
    this.lastPowerText
      ?.setText(`이전 발사 ${Math.round(previousPower)}`)
      .setPosition(clamp(markerX, POWER_GAUGE_X + 42, POWER_GAUGE_X + POWER_GAUGE_WIDTH - 42), 718)
      .setVisible(true);
  }

  private drawPreview(): void {
    const graphics = this.previewGraphics;
    if (!graphics) return;
    graphics.clear();
    const client = this.getClient();
    const view = this.getVisualView();
    const tank = view.players.find((player) => player.playerId === client.playerId);
    if (!tank || !this.canAim()) return;
    const facing = tankFacing(tank);
    const radians = (this.angle * Math.PI) / 180;
    if (this.selectedItem !== "scope") {
      graphics.lineStyle(3, 0xffffff, 0.55);
      graphics.beginPath();
      graphics.moveTo(tank.x + facing * 19, tank.y - 20);
      graphics.lineTo(tank.x + facing * Math.cos(radians) * 74, tank.y - 20 - Math.sin(radians) * 74);
      graphics.strokePath();
      return;
    }
    const prediction = simulateTrajectory({
      start: { x: tank.x + facing * 19, y: tank.y - 20 },
      facing,
      angle: this.angle,
      power: this.power,
      gravity: view.gravity,
      wind: view.wind,
      terrain: view.terrain,
      tanks: view.players,
      shooterPlayerId: client.playerId,
      worldWidth: view.worldWidth,
      worldHeight: view.worldHeight,
      terrainStep: view.terrainStep
    });
    graphics.fillStyle(0x8be9ff, 0.82);
    prediction.trajectory.forEach((point, index) => {
      if (index % 3 === 0) graphics.fillCircle(point.x, point.y, index % 9 === 0 ? 3 : 2);
    });
    if (prediction.impact) {
      graphics.lineStyle(2, 0xffe082, 0.9).strokeCircle(prediction.impact.x, prediction.impact.y, 8);
    }
  }

  private renderItems(): void {
    const items = this.getClient().privateView.items ?? { megaBlast: 0, warhead: 0, scope: 0 };
    for (const [item, button] of this.itemButtons) {
      button.label.setText(`${itemLabels[item]}  ×${items[item] ?? 0}`);
    }
  }

  private refreshButtonStyles(): void {
    const enabled = this.canAim();
    const items = this.getClient().privateView.items ?? { megaBlast: 0, warhead: 0, scope: 0 };
    for (const button of this.angleButtons) {
      button.container.setAlpha(enabled ? 1 : 0.78);
      button.background.setFillStyle(enabled ? 0x075fc7 : 0x173b5c, 1);
      button.background.setStrokeStyle(2, enabled ? 0x67e8f9 : 0x4d83a6, 1);
      button.label.setColor(enabled ? "#ffffff" : "#9fc8de");
    }
    for (const [item, button] of this.itemButtons) {
      const available = enabled && (items[item] ?? 0) > 0;
      button.container.setAlpha(available ? 1 : 0.36);
      button.background.setFillStyle(this.selectedItem === item ? 0x0f766e : available ? 0x244b78 : 0x203250, 1);
      button.background.setStrokeStyle(2, this.selectedItem === item ? 0x67e8f9 : 0x5475a3, 0.9);
    }
    if (this.fireButton) {
      this.fireButton.container.setAlpha(enabled ? 1 : 0.78);
      this.fireButton.background.setFillStyle(
        enabled ? this.chargeStartedAt === undefined ? 0xdc3e24 : 0xf59e0b : 0x5f291f,
        1
      );
      this.fireButton.background.setStrokeStyle(3, enabled ? 0xffd39c : 0xb8674e, 1);
      this.fireButton.label.setColor(enabled ? "#ffffff" : "#d7aa9e");
    }
  }

  private updateShotAnimation(time: number): void {
    const animation = this.shotAnimation;
    if (!animation) return;
    const serverReplayDuration = clamp(animation.shot.replayDurationMs || 1_900, 900, 4_500);
    const impactDuration = animation.shot.impact ? IMPACT_EFFECT_MS : 0;
    const flightDuration = Math.max(700, serverReplayDuration - impactDuration);
    const elapsed = time - animation.startedAt;
    const flightProgress = clamp(elapsed / flightDuration, 0, 1);
    const point = pointAlongPath(animation.shot.trajectory, flightProgress);
    if (point && flightProgress < 1) {
      this.projectile?.setPosition(point.x, point.y).setVisible(true);
    } else {
      this.projectile?.setVisible(false);
    }
    if (flightProgress >= 1 && !animation.exploded) {
      animation.exploded = true;
      this.audio.stopFlight();
      if (animation.shot.impact) {
        this.playExplosion(animation.shot);
      }
      this.renderStatus();
    }
    if (elapsed >= flightDuration + impactDuration) {
      this.shotAnimation = undefined;
      this.projectile?.setVisible(false);
      this.stopFlightAudio();
      const nextAnimation = this.shotAnimationQueue.shift();
      if (nextAnimation) this.beginShotAnimation(nextAnimation, time);
      // Commit the newest authoritative terrain, tank positions, HP, and result
      // only after the projectile and impact effects have both completed.
      this.renderAll();
    }
  }

  private playExplosion(shot: LastShot): void {
    if (!shot.impact) return;
    if (shot.directHitPlayerId) {
      this.audio.playTankExplosion();
    } else {
      this.audio.playTerrainExplosion();
    }
    const { x, y } = shot.impact;
    const blast = this.add.circle(x, y, Math.max(14, shot.explosionRadius * 0.6), 0xffb347, 0.68).setDepth(8);
    this.tweens.add({
      targets: blast,
      scale: 1.8,
      alpha: 0,
      duration: 480,
      ease: "Quad.Out",
      onComplete: () => blast.destroy()
    });
    const sparks = this.add.particles(x, y, "tank-battle-spark", {
      speed: { min: 110, max: 320 },
      angle: { min: 195, max: 345 },
      lifespan: { min: 300, max: 650 },
      gravityY: 260,
      scale: { start: 1.2, end: 0 },
      quantity: 0,
      emitting: false
    }).setDepth(9);
    sparks.explode(34);
    const debris = this.add.particles(x, y, "tank-battle-debris", {
      speedX: { min: -190, max: 190 },
      speedY: { min: -310, max: -80 },
      lifespan: { min: 520, max: 880 },
      gravityY: 390,
      rotate: { min: 0, max: 360 },
      scale: { min: 0.65, max: 1.5 },
      quantity: 0,
      emitting: false
    }).setDepth(8);
    debris.explode(26);
    this.time.delayedCall(IMPACT_EFFECT_MS - 50, () => {
      sparks.destroy();
      debris.destroy();
    });
    this.cameras.main.shake(330, 0.007 + shot.explosionRadius / 25_000);
  }

  private createParticleTextures(): void {
    if (!this.textures.exists("tank-battle-spark")) {
      const spark = this.make.graphics({ x: 0, y: 0 });
      spark.fillStyle(0xffe082, 1).fillCircle(4, 4, 4).generateTexture("tank-battle-spark", 8, 8).destroy();
    }
    if (!this.textures.exists("tank-battle-debris")) {
      const debris = this.make.graphics({ x: 0, y: 0 });
      debris.fillStyle(0x6b4f36, 1).fillRect(0, 0, 8, 6).generateTexture("tank-battle-debris", 8, 6).destroy();
    }
  }

  private changeAngle(delta: number): void {
    if (!this.canAim()) return;
    this.angle = clamp(this.angle + delta, ANGLE_MIN, ANGLE_MAX);
    this.renderPowerAndPreview();
  }

  private updateHeldAngle(time: number, delta: number): void {
    if (this.heldAngleKeys.size === 0) return;
    if (!this.canAim()) {
      this.stopAngleAdjustment();
      return;
    }
    const direction = this.currentAngleKeyDirection();
    if (direction === 0) return;
    this.angleHoldStartedAt ??= time;
    const heldMs = Math.max(0, time - this.angleHoldStartedAt);
    const speed = clamp(24 + heldMs * 0.05, 24, 120);
    const previousAngle = this.angle;
    this.angle = clamp(this.angle + direction * speed * (Math.min(delta, 50) / 1_000), ANGLE_MIN, ANGLE_MAX);
    if (this.angle === previousAngle) return;

    this.renderPowerAndPreview();
    if (time >= this.nextGearCreakAt) {
      const intensity = clamp((speed - 24) / 96, 0, 1);
      this.audio.playGearCreak(intensity);
      this.nextGearCreakAt = time + 210 - intensity * 125;
    }
  }

  private handleKeyDown(event: KeyboardEvent): void {
    void this.audio.unlock();
    const direction = angleDirectionForKey(event.code);
    if (direction === 0) return;
    if (this.canAim()) event.preventDefault();
    if (!this.canAim() || this.heldAngleKeys.has(event.code)) return;
    const previousDirection = this.currentAngleKeyDirection();
    this.heldAngleKeys.add(event.code);
    if (this.currentAngleKeyDirection() !== previousDirection) {
      this.angleHoldStartedAt = performance.now();
      this.nextGearCreakAt = 0;
    }
  }

  private handleKeyUp(event: KeyboardEvent): void {
    const direction = angleDirectionForKey(event.code);
    if (direction === 0) return;
    if (this.heldAngleKeys.delete(event.code)) event.preventDefault();
    if (this.currentAngleKeyDirection() === 0) {
      this.angleHoldStartedAt = undefined;
    } else {
      this.angleHoldStartedAt = performance.now();
    }
  }

  private currentAngleKeyDirection(): number {
    let direction = 0;
    for (const code of this.heldAngleKeys) direction += angleDirectionForKey(code);
    return clamp(direction, -1, 1);
  }

  private stopAngleAdjustment(): void {
    this.heldAngleKeys.clear();
    this.angleHoldStartedAt = undefined;
    this.nextGearCreakAt = 0;
  }

  private handleBattlefieldPointerDown(pointer: Phaser.Input.Pointer): void {
    void this.audio.unlock();
    if (!pointer.wasTouch || pointer.worldY < 0 || pointer.worldY >= GAME_HEIGHT || !this.canAim()) return;
    this.activeAimPointerId = pointer.id;
    this.updateAngleFromPointer(pointer);
  }

  private handleBattlefieldPointerMove(pointer: Phaser.Input.Pointer): void {
    if (!pointer.wasTouch || !pointer.isDown || pointer.id !== this.activeAimPointerId) return;
    this.updateAngleFromPointer(pointer);
  }

  private updateAngleFromPointer(pointer: Phaser.Input.Pointer): void {
    const client = this.getClient();
    const tank = this.getVisualView().players.find((candidate) => candidate.playerId === client.playerId);
    if (!tank || !this.canAim()) return;
    const facing = tankFacing(tank);
    const barrelX = tank.x + facing * 4;
    const barrelY = tank.y - 21;
    const vectorX = pointer.worldX - barrelX;
    const vectorY = pointer.worldY - barrelY;
    const magnitude = Math.hypot(vectorX, vectorY);
    if (magnitude < 1) return;
    const cosine = clamp((vectorX * facing) / magnitude, -1, 1);
    const unsignedAngle = Math.acos(cosine) * (180 / Math.PI);
    const elevationAngle = vectorY <= 0 ? unsignedAngle : -unsignedAngle;
    this.angle = Math.round(clamp(elevationAngle, ANGLE_MIN, ANGLE_MAX) * 10) / 10;
    this.renderPowerAndPreview();
  }

  private selectItem(item: Exclude<TankItemSelection, "none">): void {
    if (!this.canAim() || (this.getClient().privateView.items?.[item] ?? 0) <= 0) return;
    this.selectedItem = this.selectedItem === item ? "none" : item;
    this.renderItems();
    this.renderPowerAndPreview();
    this.refreshButtonStyles();
  }

  private startCharge(pointerId?: number): void {
    if (!this.canAim() || this.chargeStartedAt !== undefined) return;
    this.chargeStartedAt = performance.now();
    this.chargingPointerId = pointerId;
    this.power = 10;
    triggerSelectionFeedback();
    this.refreshButtonStyles();
  }

  private releaseCharge(send: boolean): void {
    if (this.chargeStartedAt === undefined) return;
    const elapsed = performance.now() - this.chargeStartedAt;
    this.power = chargedPower(elapsed);
    this.chargeStartedAt = undefined;
    this.chargingPointerId = undefined;
    if (send && this.canAim()) {
      const firedPower = Math.round(this.power * 10) / 10;
      this.lastOwnShotPower = firedPower;
      this.awaitingSnapshot = true;
      triggerPlacementFeedback();
      this.startFlightAudio(this.getClient().publicView.turnNumber);
      this.getClient().sendAction({
        type: "fire",
        payload: { angle: this.angle, power: firedPower, item: this.selectedItem }
      });
    }
    this.renderPowerAndPreview();
    this.refreshButtonStyles();
  }

  private cancelCharge(): void {
    this.releaseCharge(false);
  }

  private handleBlur(): void {
    this.cancelCharge();
    this.stopAngleAdjustment();
    this.activeAimPointerId = undefined;
  }

  private handleGameOut(): void {
    this.cancelCharge();
    this.activeAimPointerId = undefined;
  }

  private handleGlobalPointerUp(pointer: Phaser.Input.Pointer): void {
    if (pointer.id === this.activeAimPointerId) this.activeAimPointerId = undefined;
    if (this.chargingPointerId === undefined || pointer.id === this.chargingPointerId) {
      this.releaseCharge(true);
    }
  }

  private handleSpaceDown(event: KeyboardEvent): void {
    event.preventDefault();
    void this.audio.unlock();
    if (!event.repeat) this.startCharge();
  }

  private handleSpaceUp(event: KeyboardEvent): void {
    event.preventDefault();
    this.releaseCharge(true);
  }

  private startFlightAudio(shotId: number): void {
    this.soundingShotId = shotId;
    this.flightSafetyTimer?.remove(false);
    this.flightSafetyTimer = this.time.delayedCall(5_000, () => this.stopFlightAudio());
    void this.audio.resume().then((ready) => {
      if (!ready || this.soundingShotId !== shotId) return;
      this.audio.playLaunch();
      this.audio.playFlight();
    });
  }

  private stopFlightAudio(): void {
    this.flightSafetyTimer?.remove(false);
    this.flightSafetyTimer = undefined;
    this.soundingShotId = undefined;
    this.audio.stopFlight();
  }

  private canAim(): boolean {
    const client = this.getClient();
    const view = client.publicView;
    return (
      view.roomPhase === "active" &&
      view.turnPhase !== "resolving" &&
      view.currentPlayerId === client.playerId &&
      !view.result &&
      !this.awaitingSnapshot &&
      !this.shotAnimation
    );
  }

  private ensureSelectedItemAvailable(): void {
    if (this.selectedItem === "none") return;
    if ((this.getClient().privateView.items?.[this.selectedItem] ?? 0) <= 0) this.selectedItem = "none";
  }
}

function toTankBattleClient(
  context: GameClientContext,
  callbacks: Pick<TankBattleClient, "sendAction" | "requestPlayAgain" | "leaveFinishedGame">
): TankBattleClient {
  return {
    playerId: context.playerId,
    version: context.version,
    serverTime: context.serverTime,
    publicView: {
      ...(context.publicView as unknown as TankBattlePublicView),
      roomPhase: context.phase,
      rematchRequests: context.rematchRequests
    },
    privateView: context.privateView as unknown as TankBattlePrivateView,
    ...callbacks
  };
}

function syncResultDialog(gameUi: MountedGameUi, client: TankBattleClient): void {
  const view = client.publicView;
  const finished = view.roomPhase === "finished" && Boolean(view.result);
  if (!finished) {
    gameUi.setResult({ open: false, title: "", message: "" });
    return;
  }
  const requested = view.rematchRequests?.includes(client.playerId) ?? false;
  gameUi.setResult({
    open: true,
    title: view.result === "draw" ? "무승부" : view.winnerPlayerId === client.playerId ? "전장 승리" : "탱크 파괴",
    message: requested ? "상대의 재대결 응답을 기다리고 있습니다." : "새 지형에서 다시 싸우거나 로비로 돌아갈 수 있습니다.",
    primaryLabel: requested ? "대기 중…" : "다시 하기",
    primaryDisabled: requested,
    secondaryLabel: "나가기"
  });
}

function chargedPower(elapsedMs: number): number {
  return clamp(10 + elapsedMs / 15, 10, 100);
}

function angleDirectionForKey(code: string): -1 | 0 | 1 {
  if (code === "ArrowUp" || code === "ArrowRight") return 1;
  if (code === "ArrowDown" || code === "ArrowLeft") return -1;
  return 0;
}

function clonePublicView(view: TankBattlePublicView): TankBattlePublicView {
  return {
    ...view,
    terrain: [...view.terrain],
    players: view.players.map((player) => ({
      ...player,
      itemCounts: { ...player.itemCounts }
    })),
    ...(view.lastShot ? {
      lastShot: {
        ...view.lastShot,
        trajectory: view.lastShot.trajectory.map((point) => ({ ...point })),
        damage: view.lastShot.damage.map((entry) => ({ ...entry })),
        ...(view.lastShot.impact ? { impact: { ...view.lastShot.impact } } : {})
      }
    } : {}),
    ...(view.rematchRequests ? { rematchRequests: [...view.rematchRequests] } : {})
  };
}

function pointAlongPath(path: Array<{ x: number; y: number }>, progress: number): { x: number; y: number } | undefined {
  if (path.length === 0) return undefined;
  const index = progress * (path.length - 1);
  const left = Math.floor(index);
  const right = Math.min(path.length - 1, left + 1);
  const mix = index - left;
  const a = path[left]!;
  const b = path[right]!;
  return { x: a.x + (b.x - a.x) * mix, y: a.y + (b.y - a.y) * mix };
}
