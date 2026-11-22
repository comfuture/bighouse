import piecesSheetUrl from "./assets/images/pieces_sheet.png?url";
import vfxSheetUrl from "./assets/images/vfx_sheet.png?url";
import {
  createCaptureShardParticles,
  createCheckEmberParticle,
  createLandingDustParticles,
  createPromotionSparkles,
  createVictoryConfettiParticles,
  evaluateCheckPulse,
  evaluatePieceTravelPose,
  evaluatePromotionBeam,
  getPieceSpriteFrame,
  getVfxSpriteFrame,
  stepParticles,
  type ChessParticle,
  type ChessPieceKey
} from "./animation";
import type { ChessSquare } from "./move-hints";

export type GridPoint = { column: number; row: number };

export type MoveAnimationRequest = {
  pieceKey: ChessPieceKey;
  from: GridPoint;
  to: GridPoint;
  isKnight: boolean;
  isCapture: boolean;
  capturedColor?: "w" | "b" | undefined;
  isPromotion: boolean;
  rookTransfer?:
    | {
        pieceKey: ChessPieceKey;
        from: GridPoint;
        to: GridPoint;
      }
    | undefined;
  onComplete?: (() => void) | undefined;
};

type ActiveTravel = {
  pieceKey: ChessPieceKey;
  from: GridPoint;
  to: GridPoint;
  isKnight: boolean;
  isCapture: boolean;
  capturedColor?: "w" | "b" | undefined;
  isPromotion: boolean;
  elapsed: number;
  duration: number;
  landedFxTriggered: boolean;
  onComplete?: (() => void) | undefined;
};

type ActiveBurst = {
  col: number;
  row: number;
  elapsed: number;
  duration: number;
};

type ActivePromotionBeam = {
  col: number;
  row: number;
  elapsed: number;
  duration: number;
};

type ContentVisibilityEvent = Event & { skipped?: boolean };

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function squareToGridPoint(square: ChessSquare, blackPerspective: boolean): GridPoint {
  const file = square.charCodeAt(0) - "a".charCodeAt(0);
  const rank = Number(square[1]) - 1;
  return blackPerspective ? { column: 7 - file, row: rank } : { column: file, row: 7 - rank };
}

/**
 * DPR-scaled Canvas VFX overlay for Chess:
 * - Parabolic piece travel + knight jumps + landing dust rings
 * - Golden starburst impact flash + capture shards + damped board recoil
 * - Safe <= 1.4Hz pulsing crimson check aura & embers around checked king
 * - Radiant golden promotion beam + rising crown
 * - Subtle victory crown & confetti celebration
 *
 * Pauses automatically when hidden or off-screen (`contentvisibilityautostatechange`
 * with `IntersectionObserver` fallback) and respects `prefers-reduced-motion`.
 */
export class ChessFxRenderer {
  private readonly host: HTMLElement;
  private readonly boardEl: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private piecesImg: HTMLImageElement | null = null;
  private vfxImg: HTMLImageElement | null = null;
  private piecesReady = false;
  private vfxReady = false;

  private width = 0;
  private height = 0;
  private dpr = 1;
  private rafId = 0;
  private lastTs = 0;
  private clockSec = 0;
  private emberCooldown = 0;

  private travels: ActiveTravel[] = [];
  private bursts: ActiveBurst[] = [];
  private promoBeams: ActivePromotionBeam[] = [];
  private particles: ChessParticle[] = [];
  private checkPos: GridPoint | null = null;
  private recoilTime = 0;
  private recoilDuration = 0;
  private recoilStrength = 0;
  private victoryBannerTime = -1;
  private victoryBannerDuration = 2.6;

  private destroyed = false;
  private skippedOffscreen = false;
  private hiddenTab = typeof document !== "undefined" ? document.hidden : false;

  private resizeObserver: ResizeObserver | null = null;
  private intersectionObserver: IntersectionObserver | null = null;

  private readonly handleVisibilityChange = (): void => {
    this.hiddenTab = typeof document !== "undefined" ? document.hidden : false;
    if (this.hiddenTab) {
      this.pauseLoop();
    } else {
      this.ensureLoop();
    }
  };

  private readonly handleContentVisibility = (event: Event): void => {
    const cvEvent = event as ContentVisibilityEvent;
    this.skippedOffscreen = Boolean(cvEvent.skipped);
    if (this.skippedOffscreen) {
      this.pauseLoop();
    } else {
      this.ensureLoop();
    }
  };

  constructor(host: HTMLElement, boardEl: HTMLElement) {
    this.host = host;
    this.boardEl = boardEl;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "chess-fx-canvas";
    this.canvas.setAttribute("aria-hidden", "true");
    this.host.append(this.canvas);
    this.ctx = typeof this.canvas.getContext === "function" ? this.canvas.getContext("2d") : null;

    this.loadSpriteSheets();
    this.syncSize();
    this.bindLifecycle();
  }

  private loadSpriteSheets(): void {
    if (typeof Image === "undefined") return;
    const pImg = new Image();
    pImg.decoding = "async";
    pImg.onload = () => {
      this.piecesReady = true;
      this.ensureLoop();
    };
    pImg.src = piecesSheetUrl;
    this.piecesImg = pImg;

    const vImg = new Image();
    vImg.decoding = "async";
    vImg.onload = () => {
      this.vfxReady = true;
      this.ensureLoop();
    };
    vImg.src = vfxSheetUrl;
    this.vfxImg = vImg;
  }

  private bindLifecycle(): void {
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.handleVisibilityChange);
    }

    // Attach directly to host element because contentvisibilityautostatechange does not bubble in all browsers.
    const supportsContentVisibility =
      typeof document !== "undefined" &&
      document.documentElement !== null &&
      "contentVisibility" in document.documentElement.style;

    if (supportsContentVisibility) {
      this.host.addEventListener("contentvisibilityautostatechange", this.handleContentVisibility);
    } else if (typeof IntersectionObserver !== "undefined") {
      this.intersectionObserver = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          if (!entry) return;
          this.skippedOffscreen = !entry.isIntersecting;
          if (this.skippedOffscreen) {
            this.pauseLoop();
          } else {
            this.ensureLoop();
          }
        },
        { rootMargin: "160px" }
      );
      this.intersectionObserver.observe(this.host);
    }

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => {
        this.syncSize();
        this.drawFrame();
      });
      this.resizeObserver.observe(this.boardEl);
    }
  }

  private syncSize(): void {
    const rect = this.boardEl.getBoundingClientRect();
    const w = Math.max(0, Math.round(rect.width));
    const h = Math.max(0, Math.round(rect.height));
    const dpr = typeof window !== "undefined" ? Math.min(2.5, Math.max(1, window.devicePixelRatio || 1)) : 1;

    // Align canvas directly over the inner chess-board grid inside board-frame
    const hostRect = this.host.getBoundingClientRect();
    if (w > 0 && h > 0) {
      this.canvas.style.left = `${Math.round(rect.left - hostRect.left)}px`;
      this.canvas.style.top = `${Math.round(rect.top - hostRect.top)}px`;
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;
    }

    if (w !== this.width || h !== this.height || dpr !== this.dpr) {
      this.width = w;
      this.height = h;
      this.dpr = dpr;
      this.canvas.width = Math.max(1, Math.round(w * dpr));
      this.canvas.height = Math.max(1, Math.round(h * dpr));
    }
  }

  setCheckSquare(square: ChessSquare | null, blackPerspective: boolean): void {
    this.checkPos = square ? squareToGridPoint(square, blackPerspective) : null;
    if (this.checkPos) {
      this.ensureLoop();
    } else if (!this.hasActiveWork()) {
      this.clearCanvas();
      this.pauseLoop();
    }
  }

  cancelActiveTravels(): void {
    const pending = this.travels;
    this.travels = [];
    for (const travel of pending) {
      travel.onComplete?.();
    }
  }

  triggerMoveAnimation(request: MoveAnimationRequest): void {
    this.cancelActiveTravels();
    this.syncSize();

    // Respect reduced motion or headless zero-size canvases immediately
    if (prefersReducedMotion() || !this.ctx || this.width <= 0 || this.height <= 0) {
      request.onComplete?.();
      return;
    }

    const baseDuration = request.isKnight ? 0.34 : 0.27;
    this.travels.push({
      pieceKey: request.pieceKey,
      from: request.from,
      to: request.to,
      isKnight: request.isKnight,
      isCapture: request.isCapture,
      capturedColor: request.capturedColor,
      isPromotion: request.isPromotion,
      elapsed: 0,
      duration: baseDuration,
      landedFxTriggered: false,
      onComplete: request.onComplete
    });

    if (request.rookTransfer) {
      this.travels.push({
        pieceKey: request.rookTransfer.pieceKey,
        from: request.rookTransfer.from,
        to: request.rookTransfer.to,
        isKnight: false,
        isCapture: false,
        isPromotion: false,
        elapsed: 0,
        duration: 0.30,
        landedFxTriggered: false
      });
    }

    this.ensureLoop();
  }

  triggerVictoryCelebration(): void {
    this.syncSize();
    if (prefersReducedMotion() || !this.ctx || this.width <= 0 || this.height <= 0) return;
    this.victoryBannerTime = 0;
    this.particles.push(...createVictoryConfettiParticles(this.width, this.height, 36));
    this.ensureLoop();
  }

  private hasActiveWork(): boolean {
    return (
      this.travels.length > 0 ||
      this.bursts.length > 0 ||
      this.promoBeams.length > 0 ||
      this.particles.length > 0 ||
      this.checkPos !== null ||
      this.recoilTime < this.recoilDuration ||
      (this.victoryBannerTime >= 0 && this.victoryBannerTime < this.victoryBannerDuration)
    );
  }

  private ensureLoop(): void {
    if (this.destroyed || this.hiddenTab || this.skippedOffscreen || !this.ctx) return;
    if (!this.hasActiveWork()) {
      this.clearCanvas();
      return;
    }
    if (prefersReducedMotion()) {
      // Draw static check halo once without continuous RAF spin
      this.drawFrame();
      return;
    }
    if (!this.rafId && typeof requestAnimationFrame === "function") {
      this.lastTs = 0;
      this.rafId = requestAnimationFrame(this.tick);
    }
  }

  private pauseLoop(): void {
    if (this.rafId && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.lastTs = 0;
  }

  private readonly tick = (ts: number): void => {
    this.rafId = 0;
    if (this.destroyed || this.hiddenTab || this.skippedOffscreen) return;

    const dt = this.lastTs === 0 ? 1 / 60 : Math.max(0, Math.min(0.05, (ts - this.lastTs) / 1000));
    this.lastTs = ts;
    this.clockSec += dt;

    this.syncSize();
    this.step(dt);
    this.drawFrame();

    if (this.hasActiveWork() && !prefersReducedMotion()) {
      this.rafId = requestAnimationFrame(this.tick);
    } else {
      this.clearBoardRecoil();
    }
  };

  private step(dt: number): void {
    const cellSize = this.width / 8;

    // 1. Step traveling pieces
    const remainingTravels: ActiveTravel[] = [];
    for (const travel of this.travels) {
      travel.elapsed += dt;
      const progress = Math.min(1, travel.elapsed / travel.duration);

      if (!travel.landedFxTriggered && progress >= 0.82 && cellSize > 0) {
        travel.landedFxTriggered = true;
        const cx = (travel.to.column + 0.5) * cellSize;
        const cy = (travel.to.row + 0.5) * cellSize;
        this.particles.push(...createLandingDustParticles(cx, cy, cellSize, travel.isCapture || travel.isKnight));

        if (travel.isCapture) {
          this.bursts.push({ col: travel.to.column, row: travel.to.row, elapsed: 0, duration: 0.38 });
          this.particles.push(
            ...createCaptureShardParticles(cx, cy, cellSize, travel.capturedColor ?? "w")
          );
          this.recoilTime = 0;
          this.recoilDuration = 0.18;
          this.recoilStrength = 3.2;
        }

        if (travel.isPromotion) {
          this.promoBeams.push({ col: travel.to.column, row: travel.to.row, elapsed: 0, duration: 0.95 });
          this.particles.push(...createPromotionSparkles(cx, cy, cellSize));
        }
      }

      if (progress >= 1) {
        travel.onComplete?.();
      } else {
        remainingTravels.push(travel);
      }
    }
    this.travels = remainingTravels;

    // 2. Step bursts & promotion beams
    this.bursts = this.bursts
      .map((b) => ({ ...b, elapsed: b.elapsed + dt }))
      .filter((b) => b.elapsed < b.duration);

    this.promoBeams = this.promoBeams
      .map((b) => ({ ...b, elapsed: b.elapsed + dt }))
      .filter((b) => b.elapsed < b.duration);

    // 3. Emit subtle embers around checked king
    if (this.checkPos && cellSize > 0) {
      this.emberCooldown -= dt;
      if (this.emberCooldown <= 0) {
        this.emberCooldown = 0.24;
        const cx = (this.checkPos.column + 0.5) * cellSize;
        const cy = (this.checkPos.row + 0.5) * cellSize;
        this.particles.push(createCheckEmberParticle(cx, cy, cellSize));
      }
    }

    // 4. Step subtle damped board recoil on capture
    if (this.recoilTime < this.recoilDuration) {
      this.recoilTime += dt;
      const t = Math.min(1, this.recoilTime / this.recoilDuration);
      const mag = (1 - t) * this.recoilStrength;
      const offsetY = Math.sin(t * Math.PI * 3) * mag;
      this.boardEl.style.transform = `translate3d(0, ${offsetY.toFixed(2)}px, 0)`;
    } else if (this.recoilDuration > 0) {
      this.clearBoardRecoil();
    }

    // 5. Step victory banner sparkle timer
    if (this.victoryBannerTime >= 0) {
      this.victoryBannerTime += dt;
      if (this.victoryBannerTime >= this.victoryBannerDuration) {
        this.victoryBannerTime = -1;
      }
    }

    // 6. Step particles
    this.particles = stepParticles(this.particles, dt);
  }

  private clearBoardRecoil(): void {
    this.recoilTime = 0;
    this.recoilDuration = 0;
    this.boardEl.style.transform = "";
  }

  private clearCanvas(): void {
    if (!this.ctx) return;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private drawFrame(): void {
    const ctx = this.ctx;
    if (!ctx || this.width <= 0 || this.height <= 0) return;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    const cellSize = this.width / 8;

    // 1. Checked King crimson pulsing aura
    if (this.checkPos) {
      const pulse = prefersReducedMotion()
        ? { intensity: 0.65, ringScale: 1.0, glowAlpha: 0.42 }
        : evaluateCheckPulse(this.clockSec);
      const cx = (this.checkPos.column + 0.5) * cellSize;
      const cy = (this.checkPos.row + 0.5) * cellSize;
      const radius = cellSize * 0.56 * pulse.ringScale;
      const grad = ctx.createRadialGradient(cx, cy, cellSize * 0.12, cx, cy, radius);
      grad.addColorStop(0, `rgba(255, 72, 72, ${(pulse.glowAlpha * 0.65).toFixed(3)})`);
      grad.addColorStop(0.65, `rgba(210, 28, 42, ${(pulse.glowAlpha * 0.42).toFixed(3)})`);
      grad.addColorStop(1, "rgba(210, 28, 42, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // 2. Promotion light beams
    for (const beam of this.promoBeams) {
      const pose = evaluatePromotionBeam(beam.elapsed / beam.duration);
      const cx = (beam.col + 0.5) * cellSize;
      const cy = (beam.row + 0.5) * cellSize;
      const beamW = cellSize * 0.88 * pose.widthScale;
      const beamH = this.height * 0.62 * pose.heightNorm;
      const grad = ctx.createLinearGradient(cx, cy + cellSize * 0.4, cx, cy - beamH);
      grad.addColorStop(0, `rgba(255, 224, 118, ${(pose.alpha * 0.72).toFixed(3)})`);
      grad.addColorStop(0.5, `rgba(255, 245, 190, ${(pose.alpha * 0.42).toFixed(3)})`);
      grad.addColorStop(1, "rgba(255, 245, 190, 0)");
      ctx.fillStyle = grad;
      ctx.fillRect(cx - beamW * 0.5, cy - beamH, beamW, beamH + cellSize * 0.35);

      if (this.vfxImg && this.vfxReady) {
        const crownFrame = getVfxSpriteFrame("promotionCrown");
        const crownSize = cellSize * 0.78;
        ctx.save();
        ctx.globalAlpha = pose.crownAlpha;
        ctx.drawImage(
          this.vfxImg,
          crownFrame.sx,
          crownFrame.sy,
          crownFrame.sw,
          crownFrame.sh,
          cx - crownSize * 0.5,
          cy - cellSize * (0.45 + pose.crownLiftNorm * 0.65) - crownSize * 0.5,
          crownSize,
          crownSize
        );
        ctx.restore();
      }
    }

    // 3. Dust rings & particles behind/around impacts
    this.drawParticles(ctx);

    // 4. Capture starburst impact flashes
    if (this.vfxImg && this.vfxReady) {
      const burstFrame = getVfxSpriteFrame("captureBurst");
      for (const burst of this.bursts) {
        const t = burst.elapsed / burst.duration;
        const scale = 0.45 + Math.sin(Math.min(1, t * 1.45) * Math.PI * 0.5) * 0.85;
        const alpha = Math.max(0, 1 - t * t);
        const cx = (burst.col + 0.5) * cellSize;
        const cy = (burst.row + 0.5) * cellSize;
        const drawSize = cellSize * 1.05 * scale;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(cx, cy);
        ctx.rotate(t * 0.45);
        ctx.drawImage(
          this.vfxImg,
          burstFrame.sx,
          burstFrame.sy,
          burstFrame.sw,
          burstFrame.sh,
          -drawSize * 0.5,
          -drawSize * 0.5,
          drawSize,
          drawSize
        );
        ctx.restore();
      }
    }

    // 5. Traveling pieces with dynamic ground shadow, arc lift & squash/stretch
    if (this.piecesImg && this.piecesReady) {
      for (const travel of this.travels) {
        const dx = travel.to.column - travel.from.column;
        const pose = evaluatePieceTravelPose(
          travel.elapsed / travel.duration,
          travel.isKnight,
          dx === 0 ? 1 : Math.sign(dx)
        );
        const curCol = travel.from.column + (travel.to.column - travel.from.column) * pose.moveProgress;
        const curRow = travel.from.row + (travel.to.row - travel.from.row) * pose.moveProgress;
        const cx = (curCol + 0.5) * cellSize;
        const groundY = (curRow + 0.86) * cellSize;
        const liftPx = pose.liftNorm * cellSize;

        // Ground shadow ellipse
        ctx.save();
        ctx.fillStyle = `rgba(20, 12, 6, ${pose.shadowAlpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.ellipse(
          cx,
          groundY,
          cellSize * 0.30 * pose.shadowScale,
          cellSize * 0.10 * pose.shadowScale,
          0,
          0,
          Math.PI * 2
        );
        ctx.fill();
        ctx.restore();

        // Piece frame anchored at foot baseline
        const frame = getPieceSpriteFrame(travel.pieceKey);
        const drawSize = cellSize * 0.92;
        ctx.save();
        ctx.translate(cx, groundY - liftPx);
        ctx.rotate(pose.leanRad);
        ctx.scale(pose.scaleX, pose.scaleY);
        ctx.drawImage(
          this.piecesImg,
          frame.sx,
          frame.sy,
          frame.sw,
          frame.sh,
          -drawSize * 0.5,
          -drawSize * 0.90,
          drawSize,
          drawSize
        );
        ctx.restore();
      }
    }

    // 6. Subtle Victory Crown emblem float
    if (this.victoryBannerTime >= 0 && this.vfxImg && this.vfxReady) {
      const t = this.victoryBannerTime / this.victoryBannerDuration;
      const fadeIn = Math.min(1, t / 0.16);
      const fadeOut = t > 0.72 ? 1 - (t - 0.72) / 0.28 : 1;
      const alpha = Math.max(0, Math.min(1, fadeIn * fadeOut));
      const crownFrame = getVfxSpriteFrame("promotionCrown");
      const size = cellSize * 1.45 * (0.85 + Math.sin(Math.min(1, t * 2) * Math.PI * 0.5) * 0.2);
      const cx = this.width * 0.5;
      const cy = this.height * 0.38 - Math.sin(t * Math.PI) * cellSize * 0.22;
      ctx.save();
      ctx.globalAlpha = alpha * 0.95;
      ctx.drawImage(
        this.vfxImg,
        crownFrame.sx,
        crownFrame.sy,
        crownFrame.sw,
        crownFrame.sh,
        cx - size * 0.5,
        cy - size * 0.5,
        size,
        size
      );
      ctx.restore();
    }
  }

  private drawParticles(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      const t = p.age / p.lifetime;
      const alpha = p.alpha * Math.max(0, 1 - t);
      const size = p.size + (p.endSize - p.size) * t;
      ctx.save();
      ctx.globalAlpha = alpha;

      if (p.kind === "dust_ring") {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(1.5, 3.2 * (1 - t));
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, size, size * 0.38, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.kind === "ember") {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === "capture_shard") {
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.moveTo(0, -size);
        ctx.lineTo(size * 0.65, 0);
        ctx.lineTo(0, size * 0.85);
        ctx.lineTo(-size * 0.65, 0);
        ctx.closePath();
        ctx.fill();
      } else if (p.kind === "confetti") {
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;
        ctx.fillRect(-size * 0.5, -size * 0.28, size, size * 0.56);
      } else {
        // 4-point sparkle star
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.moveTo(0, -size);
        ctx.lineTo(size * 0.28, -size * 0.28);
        ctx.lineTo(size, 0);
        ctx.lineTo(size * 0.28, size * 0.28);
        ctx.lineTo(0, size);
        ctx.lineTo(-size * 0.28, size * 0.28);
        ctx.lineTo(-size, 0);
        ctx.lineTo(-size * 0.28, -size * 0.28);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.pauseLoop();
    this.cancelActiveTravels();
    this.clearBoardRecoil();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    }
    this.host.removeEventListener("contentvisibilityautostatechange", this.handleContentVisibility);
    this.resizeObserver?.disconnect();
    this.intersectionObserver?.disconnect();
    this.canvas.remove();
  }
}
