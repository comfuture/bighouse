import piecesSheetUrl from "./assets/images/pieces_sheet.png?url";
import {
  createAmbientPetal,
  evaluateSpecialNodePulse,
  getPieceSheetFrame,
  spawnCaptureBurst,
  spawnFinishConfetti,
  spawnHopTrail,
  spawnStackAura,
  spawnVictoryShower,
  stepParticles,
  type YutParticle
} from "./animation";
import type { TeamId } from "./types";

const SPECIAL_NODE_IDS = ["o0", "o5", "o10", "o15", "c"] as const;
const AMBIENT_PETAL_TARGET = 10;

export class YutBoardFxCanvas {
  private readonly host: HTMLElement;
  private readonly board: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly sheetImage: HTMLImageElement | null;
  private sheetLoaded = false;

  private width = 0;
  private height = 0;
  private dpr = 1;
  private rafId: number | null = null;
  private lastTs = 0;
  private elapsedSec = 0;
  private destroyed = false;
  private inViewport = true;
  private contentVisible = true;
  private seed = 1337;

  private ambientPetals: YutParticle[] = [];
  private burstParticles: YutParticle[] = [];
  private timers = new Set<ReturnType<typeof setTimeout>>();

  private readonly media: MediaQueryList | undefined;
  private readonly resizeObserver: ResizeObserver | undefined;
  private readonly intersectionObserver: IntersectionObserver | undefined;

  constructor(host: HTMLElement, board: HTMLElement) {
    this.host = host;
    this.board = board;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "yut-fx-canvas";
    this.canvas.setAttribute("aria-hidden", "true");
    this.host.append(this.canvas);

    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = this.canvas.getContext("2d");
    } catch {
      ctx = null;
    }
    this.ctx = ctx;

    if (typeof Image === "function" && this.ctx) {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        this.sheetLoaded = true;
      };
      img.src = piecesSheetUrl;
      this.sheetImage = img;
    } else {
      this.sheetImage = null;
    }

    this.media = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : undefined;

    this.resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(() => this.resize()) : undefined;
    this.resizeObserver?.observe(this.host);

    this.intersectionObserver =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver((entries) => {
            this.inViewport = entries.some((entry) => entry.isIntersecting);
            this.syncLoop();
          })
        : undefined;
    this.intersectionObserver?.observe(this.host);

    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.media?.addEventListener("change", this.onVisibilityChange);
    this.host.addEventListener("contentvisibilityautostatechange", this.onContentVisibility);

    this.resize();
    this.seedAmbientPetals();
    this.syncLoop();
  }

  private nextSeed(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed;
  }

  private readonly onVisibilityChange = (): void => {
    this.syncLoop();
  };

  private readonly onContentVisibility = (event: Event): void => {
    const skipped = (event as Event & { skipped?: boolean }).skipped;
    this.contentVisible = !skipped;
    this.syncLoop();
  };

  private shouldRun(): boolean {
    return (
      !this.destroyed &&
      this.ctx !== null &&
      !document.hidden &&
      this.inViewport &&
      this.contentVisible &&
      !this.media?.matches
    );
  }

  private resize(): void {
    if (this.destroyed || !this.ctx) return;
    const rect = this.host.getBoundingClientRect();
    const w = Math.max(0, Math.round(rect.width));
    const h = Math.max(0, Math.round(rect.height));
    if (w <= 0 || h <= 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (w === this.width && h === this.height && dpr === this.dpr) return;
    this.width = w;
    this.height = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.ambientPetals.length === 0) {
      this.seedAmbientPetals();
    }
  }

  private seedAmbientPetals(): void {
    if (!this.ctx || this.width <= 0 || this.height <= 0) return;
    this.ambientPetals = Array.from({ length: AMBIENT_PETAL_TARGET }, () =>
      createAmbientPetal(this.width, this.height, this.nextSeed(), true)
    );
  }

  private syncLoop(): void {
    if (!this.shouldRun()) {
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      if (this.ctx && this.width > 0 && this.height > 0 && this.media?.matches) {
        this.ctx.clearRect(0, 0, this.width, this.height);
      }
      return;
    }
    if (this.rafId === null && typeof requestAnimationFrame === "function") {
      this.lastTs = 0;
      this.rafId = requestAnimationFrame(this.tick);
    }
  }

  private nodePoint(nodeId: string): { x: number; y: number } {
    const hostRect = this.host.getBoundingClientRect();
    if (nodeId === "finished" || nodeId === "reserve") {
      const startNode = this.board.querySelector<HTMLElement>('[data-node="o0"]');
      if (startNode) {
        const nr = startNode.getBoundingClientRect();
        return {
          x: nr.left + nr.width / 2 - hostRect.left,
          y: nr.top + nr.height / 2 - hostRect.top
        };
      }
    }
    const target = this.board.querySelector<HTMLElement>(`[data-node="${nodeId}"]`);
    if (target) {
      const nr = target.getBoundingClientRect();
      return {
        x: nr.left + nr.width / 2 - hostRect.left,
        y: nr.top + nr.height / 2 - hostRect.top
      };
    }
    return { x: this.width / 2, y: this.height / 2 };
  }

  emitHop(nodeId: string, teamId: TeamId): void {
    if (!this.shouldRun()) return;
    const pt = this.nodePoint(nodeId);
    this.burstParticles.push(...spawnHopTrail(pt.x, pt.y, teamId, this.nextSeed()));
  }

  emitHopPath(nodes: readonly string[], teamId: TeamId, durationMs: number): void {
    if (!this.shouldRun() || nodes.length === 0) return;
    const stepMs = Math.max(70, Math.round(durationMs / Math.max(1, nodes.length)));
    nodes.forEach((nodeId, idx) => {
      const delay = idx * stepMs;
      if (delay === 0) {
        this.emitHop(nodeId, teamId);
        return;
      }
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        if (!this.destroyed) this.emitHop(nodeId, teamId);
      }, delay);
      this.timers.add(timer);
    });
  }

  emitCapture(nodeId: string, teamId: TeamId, delayMs = 0): void {
    if (this.destroyed || !this.ctx || this.media?.matches) return;
    const trigger = () => {
      if (!this.shouldRun()) return;
      const pt = this.nodePoint(nodeId);
      this.burstParticles.push(...spawnCaptureBurst(pt.x, pt.y, teamId, this.nextSeed()));
    };
    if (delayMs > 0) {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        trigger();
      }, delayMs);
      this.timers.add(timer);
    } else {
      trigger();
    }
  }

  emitStack(nodeId: string, teamId: TeamId, delayMs = 0): void {
    if (this.destroyed || !this.ctx || this.media?.matches) return;
    const trigger = () => {
      if (!this.shouldRun()) return;
      const pt = this.nodePoint(nodeId);
      this.burstParticles.push(...spawnStackAura(pt.x, pt.y, teamId, this.nextSeed()));
    };
    if (delayMs > 0) {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        trigger();
      }, delayMs);
      this.timers.add(timer);
    } else {
      trigger();
    }
  }

  emitFinish(nodeId: string, teamId: TeamId, delayMs = 0): void {
    if (this.destroyed || !this.ctx || this.media?.matches) return;
    const trigger = () => {
      if (!this.shouldRun()) return;
      const pt = this.nodePoint(nodeId);
      this.burstParticles.push(...spawnFinishConfetti(pt.x, pt.y, teamId, this.nextSeed()));
    };
    if (delayMs > 0) {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        trigger();
      }, delayMs);
      this.timers.add(timer);
    } else {
      trigger();
    }
  }

  emitVictory(teamId: TeamId): void {
    if (!this.shouldRun()) return;
    this.resize();
    this.burstParticles.push(...spawnVictoryShower(this.width || 480, this.height || 480, teamId, this.nextSeed()));
  }

  private readonly tick = (ts: number): void => {
    this.rafId = null;
    if (!this.shouldRun() || !this.ctx) return;

    const dt = this.lastTs > 0 ? Math.min(0.05, Math.max(0, (ts - this.lastTs) / 1000)) : 1 / 60;
    this.lastTs = ts;
    this.elapsedSec += dt;

    if (this.width <= 0 || this.height <= 0) {
      this.resize();
    }

    if (this.width > 0 && this.height > 0) {
      const bounds = { width: this.width, height: this.height };
      this.ambientPetals = stepParticles(this.ambientPetals, dt, bounds);
      while (this.ambientPetals.length < AMBIENT_PETAL_TARGET) {
        this.ambientPetals.push(createAmbientPetal(this.width, this.height, this.nextSeed(), false));
      }
      if (this.burstParticles.length > 0) {
        this.burstParticles = stepParticles(this.burstParticles, dt, bounds);
      }
      this.drawFrame(this.ctx);
    }

    this.rafId = requestAnimationFrame(this.tick);
  };

  private drawFrame(ctx: CanvasRenderingContext2D): void {
    ctx.clearRect(0, 0, this.width, this.height);
    this.drawNodeBeacons(ctx);
    for (const petal of this.ambientPetals) {
      this.drawParticle(ctx, petal);
    }
    for (const p of this.burstParticles) {
      this.drawParticle(ctx, p);
    }
  }

  private drawNodeBeacons(ctx: CanvasRenderingContext2D): void {
    const hostRect = this.host.getBoundingClientRect();
    if (hostRect.width <= 0 || hostRect.height <= 0) return;

    // Subtle warm golden aura on special corners & center
    SPECIAL_NODE_IDS.forEach((nodeId, idx) => {
      const nodeEl = this.board.querySelector<HTMLElement>(`[data-node="${nodeId}"]`);
      if (!nodeEl) return;
      const rect = nodeEl.getBoundingClientRect();
      if (rect.width <= 0) return;
      const cx = rect.left + rect.width / 2 - hostRect.left;
      const cy = rect.top + rect.height / 2 - hostRect.top;
      const pulse = evaluateSpecialNodePulse(this.elapsedSec, idx * 1.25);
      const radius = rect.width * 0.54 * pulse.ringScale;

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(214, 168, 82, ${(pulse.ringAlpha * 0.42).toFixed(3)})`;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.restore();
    });

    // Crisp animated beacon on active destination targets
    const targets = this.board.querySelectorAll<HTMLElement>(".yut-node.is-target");
    targets.forEach((nodeEl, idx) => {
      const rect = nodeEl.getBoundingClientRect();
      if (rect.width <= 0) return;
      const cx = rect.left + rect.width / 2 - hostRect.left;
      const cy = rect.top + rect.height / 2 - hostRect.top;
      const pulse = evaluateSpecialNodePulse(this.elapsedSec * 1.45, idx * 0.9);
      const rOuter = rect.width * 0.58 * pulse.ringScale;

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(72, 128, 228, ${(pulse.ringAlpha * 0.92).toFixed(3)})`;
      ctx.lineWidth = 2.4;
      ctx.stroke();

      // Orbiting tiny golden sparkle dot on target node
      const sx = cx + Math.cos(pulse.shimmerRad) * (rect.width * 0.56);
      const sy = cy + Math.sin(pulse.shimmerRad) * (rect.width * 0.56);
      ctx.fillStyle = `rgba(255, 224, 118, ${(0.55 + pulse.glowAlpha * 0.6).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(sx, sy, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  private drawParticle(ctx: CanvasRenderingContext2D, p: YutParticle): void {
    const t = Math.min(1, p.age / Math.max(0.001, p.life));
    const fadeIn = Math.min(1, t * 5);
    const fadeOut = 1 - t * t;
    const alpha = Math.max(0, Math.min(1, p.alpha * fadeIn * fadeOut));
    if (alpha <= 0.01) return;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rotation);

    if (p.kind === "ring") {
      const r = p.size + ((p.endSize ?? p.size * 2) - p.size) * (1 - (1 - t) * (1 - t));
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.strokeStyle = p.color;
      ctx.lineWidth = Math.max(1.2, 4.2 * (1 - t));
      ctx.stroke();
    } else if ((p.kind === "clash" || p.kind === "aura") && this.sheetImage && this.sheetLoaded) {
      const frame = getPieceSheetFrame(p.kind === "aura" ? "A" : "B", "effect");
      const sz = p.size + ((p.endSize ?? p.size * 2) - p.size) * (1 - (1 - t) * (1 - t));
      ctx.drawImage(this.sheetImage, frame.sx, frame.sy, frame.sw, frame.sh, -sz / 2, -sz / 2, sz, sz);
    } else if (p.kind === "clash" || p.kind === "aura") {
      const sz = p.size + ((p.endSize ?? p.size * 2) - p.size) * t;
      ctx.beginPath();
      ctx.arc(0, 0, sz * 0.45, 0, Math.PI * 2);
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 3;
      ctx.stroke();
    } else if (p.kind === "petal") {
      // Soft plum blossom petal silhouette
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, p.size, p.size * 0.62, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
      ctx.beginPath();
      ctx.ellipse(-p.size * 0.22, -p.size * 0.12, p.size * 0.35, p.size * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.kind === "spark") {
      // Crisp 4-point sparkle star
      const s = p.size * (1 - t * 0.35);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const ang = (i * Math.PI) / 4;
        const r = i % 2 === 0 ? s : s * 0.32;
        const px = Math.cos(ang) * r;
        const py = Math.sin(ang) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    } else if (p.kind === "dust") {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(0, 0, p.size * (0.7 + t * 0.6), 0, Math.PI * 2);
      ctx.fill();
    } else if (p.kind === "confetti") {
      ctx.fillStyle = p.color;
      const w = p.size * 1.15;
      const h = p.size * 0.6 * Math.abs(Math.cos(p.age * 7 + p.rotation));
      ctx.fillRect(-w / 2, -Math.max(1.2, h) / 2, w, Math.max(1.2, h));
    }

    ctx.restore();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.resizeObserver?.disconnect();
    this.intersectionObserver?.disconnect();
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.media?.removeEventListener("change", this.onVisibilityChange);
    this.host.removeEventListener("contentvisibilityautostatechange", this.onContentVisibility);
    this.canvas.remove();
  }
}

export function createBoardFxCanvas(host: HTMLElement, board: HTMLElement): YutBoardFxCanvas {
  return new YutBoardFxCanvas(host, board);
}
