import boardTextureUrl from "./assets/images/board_texture.png?url";
import stonesSheetUrl from "./assets/images/stones_sheet.png?url";
import {
  GOMOKU_STONES_SHEET_SPEC,
  GOMOKU_STONE_FRAMES,
  PLACEMENT_RIPPLE_DURATION_SEC,
  STONE_DROP_DURATION_SEC,
  createAmbientPetals,
  createPlacementBurstParticles,
  createVictoryPetalShower,
  evaluateHoverPulse,
  evaluateLastMoveHalo,
  evaluateParticleAlpha,
  evaluatePlacementRipple,
  evaluateStoneDropPose,
  evaluateWinningBeam,
  findWinningLine,
  getHoshiPoints,
  getStoneFrameIndex,
  stepParticles,
  type GomokuParticle,
  type WinningLine
} from "./animation";
import type { Board, Point, Stone } from "./rules";

export type GomokuRenderState = {
  boardSize: number;
  board: Board;
  lastMove?: (Point & { stone: Stone }) | undefined;
  hoveredCell: Point | null;
  hoverStone: Stone | null;
  won: boolean;
};

type ActiveDrop = {
  key: string;
  x: number;
  y: number;
  startedAt: number;
};

type ActiveRipple = {
  x: number;
  y: number;
  stone: Stone;
  startedAt: number;
};

type ContentVisibilityEvent = Event & { skipped?: boolean };

const COORD_LETTERS = "ABCDEFGHJKLMNOPQRST";

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function loadImage(url: string, onLoad: () => void): HTMLImageElement | null {
  if (typeof Image === "undefined") return null;
  const img = new Image();
  img.decoding = "async";
  img.onload = onLoad;
  img.src = url;
  return img;
}

/**
 * DPR-scaled 2D Canvas renderer for the Gomoku goban surface, stones,
 * tactile drop physics, placement ripples, ambient sakura petals, and 5-in-a-row beam.
 */
export class GomokuCanvasRenderer {
  private readonly boardElement: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private boardImage: HTMLImageElement | null = null;
  private stonesSheet: HTMLImageElement | null = null;
  private boardImageReady = false;
  private stonesSheetReady = false;

  private state: GomokuRenderState;
  private winningLine: WinningLine | null = null;
  private winningStartedAt = 0;
  private activeDrops = new Map<string, ActiveDrop>();
  private activeRipples: ActiveRipple[] = [];
  private particles: GomokuParticle[] = createAmbientPetals(7, 2026);
  private burstCounter = 1;

  private cssWidth = 0;
  private cssHeight = 0;
  private dpr = 1;

  private rafId = 0;
  private clockSec = 0;
  private lastFrameMs = 0;
  private pausedByHidden = false;
  private pausedByContentVisibility = false;
  private reducedMotion = false;
  private destroyed = false;

  private resizeObserver: ResizeObserver | null = null;
  private intersectionObserver: IntersectionObserver | null = null;
  private motionMediaQuery: MediaQueryList | null = null;
  private usesContentVisibilityEvent = false;

  constructor(boardElement: HTMLElement, initialState: GomokuRenderState) {
    this.boardElement = boardElement;
    this.state = initialState;

    this.canvas = document.createElement("canvas");
    this.canvas.className = "gomoku-canvas";
    this.canvas.setAttribute("aria-hidden", "true");
    this.boardElement.prepend(this.canvas);
    this.ctx = this.canvas.getContext("2d");

    if (initialState.won) {
      this.winningLine = findWinningLine(initialState.board, initialState.lastMove ?? null);
    }

    this.boardImage = loadImage(boardTextureUrl, () => {
      this.boardImageReady = true;
      this.renderStaticIfIdle();
    });
    this.stonesSheet = loadImage(stonesSheetUrl, () => {
      this.stonesSheetReady = true;
      this.renderStaticIfIdle();
    });

    this.setupReducedMotion();
    this.setupVisibilityPause();
    this.setupResizeObserver();
    this.syncCanvasSize();
    this.updateLoopState();
  }

  private setupReducedMotion(): void {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    this.motionMediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.reducedMotion = this.motionMediaQuery.matches;
    this.motionMediaQuery.addEventListener("change", this.onReducedMotionChange);
  }

  private readonly onReducedMotionChange = (event: MediaQueryListEvent): void => {
    this.reducedMotion = event.matches;
    if (this.reducedMotion) {
      this.activeDrops.clear();
      this.activeRipples = [];
    }
    this.updateLoopState();
    this.drawFrame();
  };

  private setupVisibilityPause(): void {
    if (typeof document !== "undefined") {
      this.pausedByHidden = document.hidden;
      document.addEventListener("visibilitychange", this.onDocumentVisibilityChange);
    }

    // Listen directly on the element that has `content-visibility: auto` (does not bubble in some browsers).
    const supportsContentVisibility =
      typeof document !== "undefined" &&
      document.documentElement !== null &&
      "contentVisibility" in document.documentElement.style;

    if (supportsContentVisibility) {
      this.usesContentVisibilityEvent = true;
      this.boardElement.addEventListener(
        "contentvisibilityautostatechange",
        this.onContentVisibilityAutoStateChange
      );
    } else if (typeof IntersectionObserver !== "undefined") {
      this.intersectionObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.target === this.boardElement) {
              this.pausedByContentVisibility = !entry.isIntersecting;
              this.updateLoopState();
            }
          }
        },
        { rootMargin: "200px" }
      );
      this.intersectionObserver.observe(this.boardElement);
    }
  }

  private readonly onDocumentVisibilityChange = (): void => {
    if (typeof document === "undefined") return;
    this.pausedByHidden = document.hidden;
    this.updateLoopState();
  };

  private readonly onContentVisibilityAutoStateChange = (event: Event): void => {
    const cvEvent = event as ContentVisibilityEvent;
    this.pausedByContentVisibility = Boolean(cvEvent.skipped);
    this.updateLoopState();
  };

  private setupResizeObserver(): void {
    if (typeof ResizeObserver === "undefined") return;
    this.resizeObserver = new ResizeObserver(() => {
      if (this.syncCanvasSize()) {
        this.drawFrame();
      }
    });
    this.resizeObserver.observe(this.boardElement);
  }

  private syncCanvasSize(): boolean {
    const width = Math.round(this.boardElement.clientWidth);
    const height = Math.round(this.boardElement.clientHeight);
    if (width <= 0 || height <= 0) return false;
    const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 3) : 1;
    if (width === this.cssWidth && height === this.cssHeight && dpr === this.dpr) {
      return false;
    }
    this.cssWidth = width;
    this.cssHeight = height;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
    return true;
  }

  private shouldRunLoop(): boolean {
    return (
      !this.destroyed &&
      !this.pausedByHidden &&
      !this.pausedByContentVisibility &&
      !this.reducedMotion
    );
  }

  private updateLoopState(): void {
    if (this.shouldRunLoop()) {
      if (this.rafId === 0 && typeof requestAnimationFrame === "function") {
        this.lastFrameMs = typeof performance !== "undefined" ? performance.now() : Date.now();
        this.rafId = requestAnimationFrame(this.tick);
      }
    } else {
      if (this.rafId !== 0 && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(this.rafId);
        this.rafId = 0;
      }
      if (!this.destroyed && !this.pausedByHidden && !this.pausedByContentVisibility) {
        this.drawFrame();
      }
    }
  }

  private renderStaticIfIdle(): void {
    if (this.destroyed) return;
    if (this.rafId === 0) {
      this.drawFrame();
    }
  }

  private readonly tick = (nowMs: number): void => {
    this.rafId = 0;
    if (!this.shouldRunLoop()) return;

    const rawDt = (nowMs - this.lastFrameMs) / 1000;
    this.lastFrameMs = nowMs;
    const dt = Math.min(0.05, Math.max(0, Number.isFinite(rawDt) ? rawDt : 0));
    this.clockSec += dt;

    // Clean up completed stone drops & ripples
    for (const [key, drop] of this.activeDrops) {
      if (this.clockSec - drop.startedAt >= STONE_DROP_DURATION_SEC) {
        this.activeDrops.delete(key);
      }
    }
    if (this.activeRipples.length > 0) {
      this.activeRipples = this.activeRipples.filter(
        (ripple) => this.clockSec - ripple.startedAt < PLACEMENT_RIPPLE_DURATION_SEC
      );
    }

    this.particles = stepParticles(this.particles, dt);

    this.syncCanvasSize();
    this.drawFrame();

    this.rafId = requestAnimationFrame(this.tick);
  };

  /**
   * Updates the rendered board state, triggering drop/victory animations as needed.
   */
  setState(nextState: GomokuRenderState): void {
    const prevWon = this.state.won;
    const prevSize = this.state.boardSize;
    this.state = nextState;

    if (prevSize !== nextState.boardSize) {
      this.activeDrops.clear();
      this.activeRipples = [];
    }

    if (nextState.won) {
      const line = findWinningLine(nextState.board, nextState.lastMove ?? null);
      if (!prevWon && line) {
        this.winningLine = line;
        this.winningStartedAt = this.clockSec;
        if (!this.reducedMotion) {
          const denom = nextState.boardSize + 1;
          const normalized = line.points.map((pt) => ({
            x: (pt.x + 1) / denom,
            y: (pt.y + 1) / denom
          }));
          this.burstCounter += 1;
          this.particles = [
            ...this.particles,
            ...createVictoryPetalShower(normalized, 22, 1000 + this.burstCounter * 37)
          ];
        }
      } else {
        this.winningLine = line;
      }
    } else {
      this.winningLine = null;
    }

    this.syncCanvasSize();
    this.renderStaticIfIdle();
  }

  /**
   * Updates only the hovered/focused legal cell for instant ghost stone preview.
   */
  setHover(hoveredCell: Point | null, hoverStone: Stone | null): void {
    const same =
      this.state.hoverStone === hoverStone &&
      this.state.hoveredCell?.x === hoveredCell?.x &&
      this.state.hoveredCell?.y === hoveredCell?.y;
    if (same) return;
    this.state = { ...this.state, hoveredCell, hoverStone };
    this.renderStaticIfIdle();
  }

  /**
   * Triggers tactile drop bounce, impact ripple, and subtle sakura spark burst for a newly placed stone.
   */
  notifyStonePlaced(x: number, y: number, stone: Stone): void {
    if (this.reducedMotion) {
      this.renderStaticIfIdle();
      return;
    }
    const key = cellKey(x, y);
    this.activeDrops.set(key, { key, x, y, startedAt: this.clockSec });
    this.activeRipples.push({ x, y, stone, startedAt: this.clockSec });

    const denom = this.state.boardSize + 1;
    this.burstCounter += 1;
    this.particles = [
      ...this.particles,
      ...createPlacementBurstParticles((x + 1) / denom, (y + 1) / denom, 6, 300 + this.burstCounter * 29)
    ];
    this.renderStaticIfIdle();
  }

  /** Ensures the canvas remains mounted as the first child of boardElement if cells are rebuilt. */
  ensureMounted(): void {
    if (this.canvas.parentElement !== this.boardElement) {
      this.boardElement.prepend(this.canvas);
    }
  }

  private drawFrame(): void {
    const ctx = this.ctx;
    if (!ctx || this.cssWidth <= 0 || this.cssHeight <= 0) return;

    const w = this.cssWidth;
    const h = this.cssHeight;
    const size = Math.min(w, h);
    const boardSize = Math.max(1, this.state.boardSize);
    const pointSize = size / (boardSize + 1);

    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    this.drawBoardSurface(ctx, w, h, pointSize);
    this.drawGridAndHoshi(ctx, boardSize, pointSize);
    this.drawCoordinates(ctx, boardSize, pointSize);
    this.drawHoverGhost(ctx, pointSize);
    this.drawRipples(ctx, pointSize);
    this.drawStones(ctx, boardSize, pointSize);
    this.drawLastMoveHalo(ctx, pointSize);
    this.drawWinningBeam(ctx, pointSize);
    if (!this.reducedMotion) {
      this.drawParticles(ctx, w, h, pointSize);
    }

    ctx.restore();
  }

  private drawBoardSurface(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    pointSize: number
  ): void {
    if (this.boardImage && this.boardImageReady && this.boardImage.naturalWidth > 0) {
      ctx.drawImage(this.boardImage, 0, 0, w, h);
    } else {
      // Warm Kaya wood fallback while texture decodes
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, "#e2b86d");
      grad.addColorStop(0.5, "#d6a452");
      grad.addColorStop(1, "#c48d3f");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }

    // Subtle carved inner bevel sheen framing the playable goban
    const inset = Math.max(2, pointSize * 0.16);
    ctx.save();
    ctx.strokeStyle = "rgba(255, 243, 214, 0.34)";
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(inset, h - inset);
    ctx.lineTo(inset, inset);
    ctx.lineTo(w - inset, inset);
    ctx.stroke();

    ctx.strokeStyle = "rgba(74, 44, 14, 0.28)";
    ctx.beginPath();
    ctx.moveTo(w - inset, inset);
    ctx.lineTo(w - inset, h - inset);
    ctx.lineTo(inset, h - inset);
    ctx.stroke();
    ctx.restore();
  }

  private drawGridAndHoshi(
    ctx: CanvasRenderingContext2D,
    boardSize: number,
    pointSize: number
  ): void {
    const start = pointSize;
    const end = boardSize * pointSize;
    const snap = (v: number): number => Math.round(v * this.dpr) / this.dpr + 0.5 / this.dpr;

    ctx.save();
    // Crisp sumi-ink interior lines
    ctx.strokeStyle = "rgba(56, 36, 14, 0.78)";
    ctx.lineWidth = Math.max(0.85, Math.min(1.25, pointSize * 0.038));

    ctx.beginPath();
    for (let i = 1; i < boardSize - 1; i += 1) {
      const pos = snap((i + 1) * pointSize);
      ctx.moveTo(pos, start);
      ctx.lineTo(pos, end);
      ctx.moveTo(start, pos);
      ctx.lineTo(end, pos);
    }
    ctx.stroke();

    // Slightly firmer outer grid frame (traditional goban line weight)
    ctx.strokeStyle = "rgba(44, 27, 10, 0.88)";
    ctx.lineWidth = Math.max(1.2, Math.min(1.8, pointSize * 0.055));
    const s0 = snap(start);
    const s1 = snap(end);
    ctx.strokeRect(s0, s0, s1 - s0, s1 - s0);

    // Traditional Hoshi star points
    const hoshiRadius = Math.max(2.1, Math.min(4.2, pointSize * 0.125));
    ctx.fillStyle = "rgba(40, 24, 9, 0.9)";
    for (const pt of getHoshiPoints(boardSize)) {
      const cx = (pt.x + 1) * pointSize;
      const cy = (pt.y + 1) * pointSize;
      ctx.beginPath();
      ctx.arc(cx, cy, hoshiRadius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawCoordinates(
    ctx: CanvasRenderingContext2D,
    boardSize: number,
    pointSize: number
  ): void {
    // Only render subtle coordinate labels when cells are roomy enough to stay legible
    if (pointSize < 21 || boardSize > COORD_LETTERS.length) return;
    const fontSize = Math.max(8, Math.min(11, Math.round(pointSize * 0.31)));
    ctx.save();
    ctx.font = `600 ${fontSize}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
    ctx.fillStyle = "rgba(72, 46, 18, 0.56)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const topY = pointSize * 0.42;
    const leftX = pointSize * 0.42;
    for (let i = 0; i < boardSize; i += 1) {
      const pos = (i + 1) * pointSize;
      ctx.fillText(COORD_LETTERS[i] ?? "", pos, topY);
      ctx.fillText(String(boardSize - i), leftX, pos);
    }
    ctx.restore();
  }

  private drawHoverGhost(ctx: CanvasRenderingContext2D, pointSize: number): void {
    const { hoveredCell, hoverStone, board } = this.state;
    if (!hoveredCell || !hoverStone) return;
    if (board[hoveredCell.y]?.[hoveredCell.x] !== null) return;

    const cx = (hoveredCell.x + 1) * pointSize;
    const cy = (hoveredCell.y + 1) * pointSize;
    const pulse = evaluateHoverPulse(this.clockSec, this.reducedMotion);
    const drawSize = pointSize * 0.98 * pulse.scale;

    ctx.save();
    // Subtle warm targeting ring beneath ghost stone
    ctx.strokeStyle = hoverStone === "black" ? "rgba(38, 28, 16, 0.38)" : "rgba(255, 250, 232, 0.65)";
    ctx.lineWidth = Math.max(1.2, pointSize * 0.045);
    ctx.beginPath();
    ctx.arc(cx, cy, pointSize * 0.44 * pulse.scale, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = pulse.alpha;
    this.drawStoneSprite(ctx, hoverStone, cx, cy, drawSize, drawSize);
    ctx.restore();
  }

  private drawRipples(ctx: CanvasRenderingContext2D, pointSize: number): void {
    if (this.activeRipples.length === 0) return;
    ctx.save();
    for (const ripple of this.activeRipples) {
      const pose = evaluatePlacementRipple(this.clockSec - ripple.startedAt, this.reducedMotion);
      if (!pose.active || pose.alpha <= 0.005) continue;
      const cx = (ripple.x + 1) * pointSize;
      const cy = (ripple.y + 1) * pointSize;
      ctx.strokeStyle =
        ripple.stone === "black"
          ? `rgba(246, 213, 134, ${pose.alpha.toFixed(3)})`
          : `rgba(255, 245, 210, ${pose.alpha.toFixed(3)})`;
      ctx.lineWidth = Math.max(1, pointSize * 0.08 * pose.lineWidthRatio);
      ctx.beginPath();
      ctx.arc(cx, cy, pointSize * pose.radiusRatio, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawStones(
    ctx: CanvasRenderingContext2D,
    boardSize: number,
    pointSize: number
  ): void {
    const baseSize = pointSize * 1.03; // sprite has 112/128 stone diameter -> ~0.90*pointSize stone!
    const stoneRadius = pointSize * 0.45;

    for (let y = 0; y < boardSize; y += 1) {
      const row = this.state.board[y];
      if (!row) continue;
      for (let x = 0; x < boardSize; x += 1) {
        const stone = row[x];
        if (stone !== "black" && stone !== "white") continue;

        const cx = (x + 1) * pointSize;
        const cy = (y + 1) * pointSize;
        const drop = this.activeDrops.get(cellKey(x, y));
        const pose = drop
          ? evaluateStoneDropPose(this.clockSec - drop.startedAt, this.reducedMotion)
          : evaluateStoneDropPose(STONE_DROP_DURATION_SEC, true);

        // Soft directional ground shadow
        const shadowOffsetX = pointSize * 0.075 + Math.abs(pose.offsetY) * pointSize * 0.25;
        const shadowOffsetY = pointSize * 0.1 + Math.abs(pose.offsetY) * pointSize * 0.35;
        const sr = stoneRadius * pose.shadowScale;
        ctx.save();
        const shadowGrad = ctx.createRadialGradient(
          cx + shadowOffsetX,
          cy + shadowOffsetY,
          sr * 0.2,
          cx + shadowOffsetX,
          cy + shadowOffsetY,
          sr * 1.15
        );
        const sAlpha = (stone === "black" ? 0.42 : 0.34) * pose.shadowAlpha;
        shadowGrad.addColorStop(0, `rgba(28, 16, 4, ${sAlpha.toFixed(3)})`);
        shadowGrad.addColorStop(0.72, `rgba(28, 16, 4, ${(sAlpha * 0.45).toFixed(3)})`);
        shadowGrad.addColorStop(1, "rgba(28, 16, 4, 0)");
        ctx.fillStyle = shadowGrad;
        ctx.beginPath();
        ctx.arc(cx + shadowOffsetX, cy + shadowOffsetY, sr * 1.15, 0, Math.PI * 2);
        ctx.fill();

        // Stone sprite with volume-preserving squash & stretch
        ctx.globalAlpha = pose.opacity;
        const drawW = baseSize * pose.scaleX;
        const drawH = baseSize * pose.scaleY;
        const drawY = cy + pose.offsetY * pointSize;
        this.drawStoneSprite(ctx, stone, cx, drawY, drawW, drawH);
        ctx.restore();
      }
    }
  }

  private drawStoneSprite(
    ctx: CanvasRenderingContext2D,
    stone: Stone,
    cx: number,
    cy: number,
    drawW: number,
    drawH: number
  ): void {
    if (this.stonesSheet && this.stonesSheetReady && this.stonesSheet.naturalWidth > 0) {
      const frameIdx = getStoneFrameIndex(stone);
      const fw = GOMOKU_STONES_SHEET_SPEC.frameWidth;
      const fh = GOMOKU_STONES_SHEET_SPEC.frameHeight;
      ctx.drawImage(
        this.stonesSheet,
        frameIdx * fw,
        0,
        fw,
        fh,
        cx - drawW / 2,
        cy - drawH / 2,
        drawW,
        drawH
      );
      return;
    }

    // Crisp radial gradient fallback while sprite sheet decodes
    const rx = drawW * 0.43;
    const ry = drawH * 0.43;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, ry / Math.max(0.01, rx));
    const grad = ctx.createRadialGradient(-rx * 0.3, -rx * 0.3, rx * 0.08, 0, 0, rx);
    if (stone === "black") {
      grad.addColorStop(0, "#555c66");
      grad.addColorStop(0.35, "#23272e");
      grad.addColorStop(1, "#0d0f12");
    } else {
      grad.addColorStop(0, "#ffffff");
      grad.addColorStop(0.65, "#efe8da");
      grad.addColorStop(1, "#bdb4a3");
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawLastMoveHalo(ctx: CanvasRenderingContext2D, pointSize: number): void {
    const last = this.state.lastMove;
    if (!last) return;
    if (this.state.board[last.y]?.[last.x] === null) return;

    const cx = (last.x + 1) * pointSize;
    const cy = (last.y + 1) * pointSize;
    const halo = evaluateLastMoveHalo(this.clockSec, this.reducedMotion);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(halo.rotation);
    ctx.globalAlpha = halo.alpha;

    if (this.stonesSheet && this.stonesSheetReady && this.stonesSheet.naturalWidth > 0) {
      const fw = GOMOKU_STONES_SHEET_SPEC.frameWidth;
      const fh = GOMOKU_STONES_SHEET_SPEC.frameHeight;
      const haloSize = pointSize * 1.18 * halo.scale;
      ctx.drawImage(
        this.stonesSheet,
        GOMOKU_STONE_FRAMES.lastMoveHalo * fw,
        0,
        fw,
        fh,
        -haloSize / 2,
        -haloSize / 2,
        haloSize,
        haloSize
      );
    }

    // Crisp subtle center accent ring so last move reads effortlessly on both black & white stones
    ctx.rotate(-halo.rotation);
    ctx.strokeStyle =
      last.stone === "black" ? "rgba(255, 224, 130, 0.9)" : "rgba(176, 108, 16, 0.88)";
    ctx.lineWidth = Math.max(1.4, pointSize * 0.055);
    ctx.beginPath();
    ctx.arc(0, 0, pointSize * 0.16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawWinningBeam(ctx: CanvasRenderingContext2D, pointSize: number): void {
    if (!this.winningLine || this.winningLine.points.length < 2) return;
    const first = this.winningLine.points[0]!;
    const last = this.winningLine.points[this.winningLine.points.length - 1]!;
    const x1 = (first.x + 1) * pointSize;
    const y1 = (first.y + 1) * pointSize;
    const x2 = (last.x + 1) * pointSize;
    const y2 = (last.y + 1) * pointSize;

    const beam = evaluateWinningBeam(
      this.clockSec - this.winningStartedAt,
      this.clockSec,
      this.reducedMotion
    );
    const curX = x1 + (x2 - x1) * beam.progress;
    const curY = y1 + (y2 - y1) * beam.progress;

    ctx.save();
    ctx.lineCap = "round";

    // Highlight rings around each winning stone reached by the beam
    const reachedCount = Math.max(
      1,
      Math.ceil(this.winningLine.points.length * beam.progress)
    );
    for (let i = 0; i < reachedCount; i += 1) {
      const pt = this.winningLine.points[i]!;
      const px = (pt.x + 1) * pointSize;
      const py = (pt.y + 1) * pointSize;
      ctx.strokeStyle = `rgba(255, 214, 92, ${(beam.glowAlpha * 0.85).toFixed(3)})`;
      ctx.lineWidth = Math.max(2, pointSize * 0.085);
      ctx.beginPath();
      ctx.arc(px, py, pointSize * 0.48, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Outer warm amber aura
    ctx.strokeStyle = `rgba(245, 166, 35, ${(beam.glowAlpha * 0.42).toFixed(3)})`;
    ctx.lineWidth = Math.max(6, pointSize * 0.34);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(curX, curY);
    ctx.stroke();

    // Inner luminous gold ribbon with moving shimmer highlight
    const grad = ctx.createLinearGradient(x1, y1, x2, y2);
    const s = Math.max(0.08, Math.min(0.92, beam.shimmerOffset));
    grad.addColorStop(0, "rgba(255, 206, 86, 0.92)");
    grad.addColorStop(Math.max(0, s - 0.14), "rgba(255, 224, 122, 0.96)");
    grad.addColorStop(s, "rgba(255, 253, 232, 1)");
    grad.addColorStop(Math.min(1, s + 0.14), "rgba(255, 224, 122, 0.96)");
    grad.addColorStop(1, "rgba(255, 206, 86, 0.92)");

    ctx.strokeStyle = grad;
    ctx.lineWidth = Math.max(2.6, pointSize * 0.14);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(curX, curY);
    ctx.stroke();

    ctx.restore();
  }

  private drawParticles(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    pointSize: number
  ): void {
    if (this.particles.length === 0) return;
    const hasSheet = Boolean(
      this.stonesSheet && this.stonesSheetReady && this.stonesSheet.naturalWidth > 0
    );
    const fw = GOMOKU_STONES_SHEET_SPEC.frameWidth;
    const fh = GOMOKU_STONES_SHEET_SPEC.frameHeight;

    ctx.save();
    for (const p of this.particles) {
      const alpha = evaluateParticleAlpha(p);
      if (alpha <= 0.01) continue;

      const px = p.x * w;
      const py = p.y * h;
      const drawSize = p.size * pointSize;

      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(p.rotation);
      ctx.globalAlpha = alpha;

      if (hasSheet) {
        ctx.drawImage(
          this.stonesSheet!,
          GOMOKU_STONE_FRAMES.sakuraPetal * fw,
          0,
          fw,
          fh,
          -drawSize / 2,
          -drawSize / 2,
          drawSize,
          drawSize
        );
      } else {
        ctx.fillStyle = "#f9c6d0";
        ctx.beginPath();
        ctx.ellipse(0, 0, drawSize * 0.25, drawSize * 0.42, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.rafId !== 0 && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.intersectionObserver?.disconnect();
    this.intersectionObserver = null;
    if (this.usesContentVisibilityEvent) {
      this.boardElement.removeEventListener(
        "contentvisibilityautostatechange",
        this.onContentVisibilityAutoStateChange
      );
      this.usesContentVisibilityEvent = false;
    }
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onDocumentVisibilityChange);
    }
    if (this.motionMediaQuery) {
      this.motionMediaQuery.removeEventListener("change", this.onReducedMotionChange);
      this.motionMediaQuery = null;
    }
    this.canvas.remove();
  }
}
