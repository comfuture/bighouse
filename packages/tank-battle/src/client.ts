import "./style.css";
import Phaser from "phaser";
import type { GameClientContext, MountedGameClient } from "@bighouse/game-sdk/client";
import { triggerPlacementFeedback, triggerSelectionFeedback } from "@bighouse/game-sdk/feedback";
import { clamp, simulateTrajectory, tankFacing } from "./physics";
import type {
  LastShot,
  TankBattlePrivateView,
  TankBattlePublicView,
  TankItemSelection,
  TankState
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
  previousTerrain: number[];
  exploded: boolean;
};

const GAME_WIDTH = 1000;
const GAME_HEIGHT = 700;
const BATTLE_HEIGHT = 600;
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

  return {
    update(nextContext) {
      const previous = client;
      client = toTankBattleClient({ ...context, ...nextContext }, callbacks);
      scene.applySnapshot(client, previous);
    },
    destroy() {
      scene.prepareDestroy();
      game.destroy(true, false);
      container.classList.remove("tank-battle-game");
      container.replaceChildren();
    }
  };
}

class TankBattleScene extends Phaser.Scene {
  private readonly getClient: () => TankBattleClient;
  private skyGraphics?: Phaser.GameObjects.Graphics;
  private terrainGraphics?: Phaser.GameObjects.Graphics;
  private tankGraphics?: Phaser.GameObjects.Graphics;
  private previewGraphics?: Phaser.GameObjects.Graphics;
  private hudGraphics?: Phaser.GameObjects.Graphics;
  private projectile?: Phaser.GameObjects.Arc;
  private statusText?: Phaser.GameObjects.Text;
  private windText?: Phaser.GameObjects.Text;
  private gravityText?: Phaser.GameObjects.Text;
  private angleText?: Phaser.GameObjects.Text;
  private powerText?: Phaser.GameObjects.Text;
  private playerTexts: Phaser.GameObjects.Text[] = [];
  private itemButtons = new Map<Exclude<TankItemSelection, "none">, BattleButton>();
  private angleButtons: BattleButton[] = [];
  private fireButton?: BattleButton;
  private resultContainer?: Phaser.GameObjects.Container;
  private resultTitle?: Phaser.GameObjects.Text;
  private resultMessage?: Phaser.GameObjects.Text;
  private rematchButton?: BattleButton;
  private selectedItem: TankItemSelection = "none";
  private angle = 45;
  private power = 55;
  private chargeStartedAt: number | undefined;
  private chargingPointerId: number | undefined;
  private awaitingSnapshot = false;
  private receivedAt = 0;
  private shotAnimation: ShotAnimation | undefined;
  private seenShotId: number | undefined;
  private lastUiSecond = -1;

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
    this.projectile = this.add.circle(0, 0, 5, 0xfff2a8).setDepth(7).setVisible(false);
    this.createParticleTextures();
    this.createHud();
    this.createControls();
    this.createResultOverlay();
    this.drawSky();
    this.seenShotId = this.getClient().publicView.lastShot?.id;
    this.renderAll();

    this.input.on("pointerup", this.handleGlobalPointerUp, this);
    this.input.on("gameout", this.cancelCharge, this);
    this.input.keyboard?.on("keydown-SPACE", this.handleSpaceDown, this);
    this.input.keyboard?.on("keyup-SPACE", this.handleSpaceUp, this);
    this.game.events.on(Phaser.Core.Events.BLUR, this.cancelCharge, this);
  }

  update(time: number): void {
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
    if (shot && shot.id !== this.seenShotId) {
      this.seenShotId = shot.id;
      this.shotAnimation = {
        shot,
        startedAt: performance.now(),
        previousTerrain: [...previous.publicView.terrain],
        exploded: false
      };
    }
    this.ensureSelectedItemAvailable();
    this.renderAll();
  }

  prepareDestroy(): void {
    this.cancelCharge();
    if (!this.sys.isActive()) return;
    this.input.off("pointerup", this.handleGlobalPointerUp, this);
    this.input.off("gameout", this.cancelCharge, this);
    this.input.keyboard?.off("keydown-SPACE", this.handleSpaceDown, this);
    this.input.keyboard?.off("keyup-SPACE", this.handleSpaceUp, this);
    this.game.events.off(Phaser.Core.Events.BLUR, this.cancelCharge, this);
    this.tweens.killAll();
    this.time.removeAllEvents();
  }

  private createHud(): void {
    const style: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: "Inter, Pretendard, system-ui, sans-serif",
      color: "#f8fbff"
    };
    this.statusText = this.add.text(500, 84, "", { ...style, fontSize: "20px", fontStyle: "bold" }).setOrigin(0.5).setDepth(12);
    this.windText = this.add.text(500, 25, "", { ...style, fontSize: "18px", fontStyle: "bold" }).setOrigin(0.5).setDepth(12);
    this.gravityText = this.add.text(500, 51, "", { ...style, fontSize: "13px", color: "#c7d7f4" }).setOrigin(0.5).setDepth(12);
    this.playerTexts = [
      this.add.text(28, 19, "", { ...style, fontSize: "16px", fontStyle: "bold" }).setDepth(12),
      this.add.text(972, 19, "", { ...style, fontSize: "16px", fontStyle: "bold", align: "right" }).setOrigin(1, 0).setDepth(12)
    ];
  }

  private createControls(): void {
    this.hudGraphics?.fillStyle(0x0b1428, 0.96).fillRoundedRect(0, BATTLE_HEIGHT, GAME_WIDTH, 100, 0);
    const minus = this.createButton(78, 651, 54, 48, "−", () => this.changeAngle(-2));
    const plus = this.createButton(254, 651, 54, 48, "+", () => this.changeAngle(2));
    this.angleButtons = [minus, plus];
    this.angleText = this.add.text(166, 638, "", {
      fontFamily: "Inter, Pretendard, system-ui, sans-serif",
      fontSize: "17px",
      fontStyle: "bold",
      color: "#f8fbff",
      align: "center"
    }).setOrigin(0.5).setDepth(14);
    this.powerText = this.add.text(166, 666, "", {
      fontFamily: "Inter, Pretendard, system-ui, sans-serif",
      fontSize: "13px",
      color: "#9fc9ff",
      align: "center"
    }).setOrigin(0.5).setDepth(14);

    const itemEntries = ["megaBlast", "warhead", "scope"] as const;
    itemEntries.forEach((item, index) => {
      const button = this.createButton(382 + index * 152, 651, 138, 52, itemLabels[item], () => this.selectItem(item), 13);
      this.itemButtons.set(item, button);
    });
    this.fireButton = this.createButton(891, 651, 172, 64, "눌러서 충전", () => undefined, 17);
    this.fireButton.container.on("pointerdown", (pointer: Phaser.Input.Pointer) => this.startCharge(pointer.id));
  }

  private createResultOverlay(): void {
    const panel = this.add.rectangle(0, 0, 480, 260, 0x10192b, 0.98).setStrokeStyle(2, 0x7dd3fc, 0.8);
    this.resultTitle = this.add.text(0, -75, "", {
      fontFamily: "Inter, Pretendard, system-ui, sans-serif",
      fontSize: "36px",
      fontStyle: "bold",
      color: "#ffffff"
    }).setOrigin(0.5);
    this.resultMessage = this.add.text(0, -24, "", {
      fontFamily: "Inter, Pretendard, system-ui, sans-serif",
      fontSize: "16px",
      color: "#c7d7f4",
      align: "center",
      wordWrap: { width: 390 }
    }).setOrigin(0.5);
    this.rematchButton = this.createButton(-105, 66, 176, 52, "다시 하기", () => this.getClient().requestPlayAgain(), 15, false);
    const leaveButton = this.createButton(105, 66, 176, 52, "나가기", () => this.getClient().leaveFinishedGame(), 15, false);
    this.resultContainer = this.add.container(500, 330, [
      panel,
      this.resultTitle,
      this.resultMessage,
      this.rematchButton.container,
      leaveButton.container
    ]).setDepth(30).setVisible(false);
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
    container.on("pointerdown", () => {
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
    const terrain = this.shotAnimation ? this.shotAnimation.previousTerrain : this.getClient().publicView.terrain;
    this.drawTerrain(terrain);
    this.drawTanks();
    this.renderStatus();
    this.renderPowerAndPreview();
    this.renderItems();
    this.renderResult();
    this.refreshButtonStyles();
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
    const view = this.getClient().publicView;
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
    const { publicView, playerId } = this.getClient();
    for (const tank of publicView.players) {
      const alive = tank.health > 0;
      const facing = tankFacing(tank);
      const barrelAngle = publicView.lastShot?.shooterPlayerId === tank.playerId
        ? publicView.lastShot.angle
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
    const view = client.publicView;
    const myTurn = view.currentPlayerId === client.playerId;
    const estimatedServerTime = client.serverTime + (performance.now() - this.receivedAt);
    const seconds = view.turnDeadline ? Math.max(0, Math.ceil((view.turnDeadline - estimatedServerTime) / 1000)) : undefined;
    if (view.result) {
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
    const windArrow = view.wind > 0.2 ? "→" : view.wind < -0.2 ? "←" : "·";
    this.windText?.setText(`바람 ${windArrow} ${Math.abs(view.wind).toFixed(1)}`);
    this.gravityText?.setText(`중력 ${view.gravity.toFixed(1)} px/s²  ·  턴 ${view.turnNumber}`);
    view.players.slice(0, 2).forEach((player, index) => {
      this.playerTexts[index]?.setText(`${player.displayName}  HP ${player.health}/${player.maxHealth}`)
        .setColor(player.color);
    });
  }

  private renderPowerAndPreview(): void {
    this.angleText?.setText(`각도 ${this.angle}°`);
    this.powerText?.setText(`파워 ${Math.round(this.power)}${this.chargeStartedAt === undefined ? "" : "  충전 중!"}`);
    if (this.fireButton) {
      this.fireButton.label.setText(this.chargeStartedAt === undefined ? "눌러서 충전" : `떼서 발사  ${Math.round(this.power)}`);
    }
    this.drawPreview();
    this.drawTanks();
  }

  private drawPreview(): void {
    const graphics = this.previewGraphics;
    if (!graphics) return;
    graphics.clear();
    const client = this.getClient();
    const view = client.publicView;
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

  private renderResult(): void {
    const client = this.getClient();
    const view = client.publicView;
    const finished = view.roomPhase === "finished" && Boolean(view.result);
    this.resultContainer?.setVisible(finished);
    if (!finished) return;
    const requested = view.rematchRequests?.includes(client.playerId) ?? false;
    this.resultTitle?.setText(view.result === "draw" ? "무승부" : view.winnerPlayerId === client.playerId ? "전장 승리" : "탱크 파괴");
    this.resultMessage?.setText(requested ? "상대의 재대결 응답을 기다리고 있습니다." : "새 지형에서 다시 싸우거나 로비로 돌아갈 수 있습니다.");
    if (this.rematchButton) {
      this.rematchButton.label.setText(requested ? "대기 중…" : "다시 하기");
      this.rematchButton.container.disableInteractive().setAlpha(requested ? 0.55 : 1);
      if (!requested) this.rematchButton.container.setInteractive({ useHandCursor: true });
    }
  }

  private refreshButtonStyles(): void {
    const enabled = this.canAim();
    const items = this.getClient().privateView.items ?? { megaBlast: 0, warhead: 0, scope: 0 };
    for (const button of this.angleButtons) {
      button.container.setAlpha(enabled ? 1 : 0.42);
      button.background.setFillStyle(0x203250, 1);
    }
    for (const [item, button] of this.itemButtons) {
      const available = enabled && (items[item] ?? 0) > 0;
      button.container.setAlpha(available ? 1 : 0.36);
      button.background.setFillStyle(this.selectedItem === item ? 0x176b73 : 0x203250, 1);
      button.background.setStrokeStyle(2, this.selectedItem === item ? 0x67e8f9 : 0x5475a3, 0.9);
    }
    if (this.fireButton) {
      this.fireButton.container.setAlpha(enabled ? 1 : 0.42);
      this.fireButton.background.setFillStyle(this.chargeStartedAt === undefined ? 0xd2563f : 0xf59e0b, 1);
      this.fireButton.background.setStrokeStyle(2, 0xffd39c, 0.9);
    }
  }

  private updateShotAnimation(time: number): void {
    const animation = this.shotAnimation;
    if (!animation) return;
    const duration = clamp(animation.shot.replayDurationMs || 1_500, 900, 3_000);
    const progress = clamp((time - animation.startedAt) / duration, 0, 1);
    const flightProgress = clamp(progress / 0.78, 0, 1);
    const point = pointAlongPath(animation.shot.trajectory, flightProgress);
    if (point && flightProgress < 1) {
      this.projectile?.setPosition(point.x, point.y).setVisible(true);
    } else {
      this.projectile?.setVisible(false);
    }
    if (progress >= 0.76 && !animation.exploded) {
      animation.exploded = true;
      if (animation.shot.impact) this.playExplosion(animation.shot);
    }
    if (progress >= 0.76) {
      const terrainMix = clamp((progress - 0.76) / 0.2, 0, 1);
      this.drawTerrain(interpolateTerrain(animation.previousTerrain, this.getClient().publicView.terrain, terrainMix));
      this.drawTanks();
    }
    if (progress >= 1) {
      this.shotAnimation = undefined;
      this.projectile?.setVisible(false);
      this.drawTerrain(this.getClient().publicView.terrain);
      this.drawTanks();
      this.refreshButtonStyles();
    }
  }

  private playExplosion(shot: LastShot): void {
    if (!shot.impact) return;
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
      lifespan: { min: 450, max: 950 },
      gravityY: 260,
      scale: { start: 1.2, end: 0 },
      quantity: 0,
      emitting: false
    }).setDepth(9);
    sparks.explode(34);
    const debris = this.add.particles(x, y, "tank-battle-debris", {
      speedX: { min: -190, max: 190 },
      speedY: { min: -310, max: -80 },
      lifespan: { min: 850, max: 1_550 },
      gravityY: 390,
      rotate: { min: 0, max: 360 },
      scale: { min: 0.65, max: 1.5 },
      quantity: 0,
      emitting: false
    }).setDepth(8);
    debris.explode(26);
    this.time.delayedCall(1_700, () => {
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
    this.angle = clamp(this.angle + delta, 10, 80);
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
      this.awaitingSnapshot = true;
      triggerPlacementFeedback();
      this.getClient().sendAction({
        type: "fire",
        payload: { angle: this.angle, power: Math.round(this.power * 10) / 10, item: this.selectedItem }
      });
    }
    this.renderPowerAndPreview();
    this.refreshButtonStyles();
  }

  private cancelCharge(): void {
    this.releaseCharge(false);
  }

  private handleGlobalPointerUp(pointer: Phaser.Input.Pointer): void {
    if (this.chargingPointerId === undefined || pointer.id === this.chargingPointerId) {
      this.releaseCharge(true);
    }
  }

  private handleSpaceDown(event: KeyboardEvent): void {
    if (!event.repeat) this.startCharge();
  }

  private handleSpaceUp(): void {
    this.releaseCharge(true);
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
  context: Omit<GameClientContext, "sendAction" | "requestPlayAgain" | "leaveFinishedGame"> & Partial<Pick<GameClientContext, "sendAction" | "requestPlayAgain" | "leaveFinishedGame">>,
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

function chargedPower(elapsedMs: number): number {
  return clamp(10 + elapsedMs / 15, 10, 100);
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

function interpolateTerrain(previous: number[], next: number[], progress: number): number[] {
  const length = Math.max(previous.length, next.length);
  return Array.from({ length }, (_, index) => {
    const before = previous[index] ?? next[index] ?? 600;
    const after = next[index] ?? before;
    return before + (after - before) * progress;
  });
}
