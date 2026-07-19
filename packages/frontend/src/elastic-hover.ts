const CLICKABLE_SELECTOR = [
  ".game-plastic-card",
  ".game-plastic-button",
  "button",
  "a[href]",
  '[role="button"]',
  "[data-game-elastic]"
].join(",");

type AudioContextConstructor = new () => AudioContext;

let audioContext: AudioContext | undefined;
let lastHoverSoundAt = 0;
let lastClickSoundAt = 0;

function isFineHoverPointer(): boolean {
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

function shouldSkipElasticMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function findClickable(event: Event): HTMLElement | null {
  const clickable = event
    .composedPath()
    .find((target): target is HTMLElement => target instanceof HTMLElement && target.matches(CLICKABLE_SELECTOR));
  if (!clickable || clickable.getAttribute("aria-disabled") === "true") return null;
  if (clickable instanceof HTMLButtonElement && clickable.disabled) return null;
  return clickable;
}

function allowsElasticMotion(clickable: HTMLElement): boolean {
  return clickable.dataset.gameElastic !== "off";
}

function isStillInside(clickable: HTMLElement, relatedTarget: EventTarget | null): boolean {
  return relatedTarget instanceof Node && clickable.contains(relatedTarget);
}

function restartElasticAnimation(clickable: HTMLElement, className: "game-elastic-enter" | "game-elastic-leave"): void {
  if (shouldSkipElasticMotion()) return;
  clickable.classList.remove("game-elastic-enter", "game-elastic-leave");
  void clickable.offsetWidth;
  clickable.classList.add(className);
}

function getAudioContext(): AudioContext | null {
  if (audioContext) return audioContext;
  const AudioContextClass =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
  if (!AudioContextClass) return null;
  audioContext = new AudioContextClass();
  return audioContext;
}

async function unlockAudio(): Promise<AudioContext | null> {
  const context = getAudioContext();
  if (!context) return null;
  if (context.state === "suspended") {
    try {
      await context.resume();
    } catch {
      return null;
    }
  }
  return context.state === "running" ? context : null;
}

function getRunningAudioContext(): AudioContext | null {
  return audioContext?.state === "running" ? audioContext : null;
}

function playTone(
  context: AudioContext,
  options: {
    type: OscillatorType;
    startFrequency: number;
    endFrequency: number;
    duration: number;
    peakGain: number;
  }
): void {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const start = context.currentTime;
  const end = start + options.duration;

  oscillator.type = options.type;
  oscillator.frequency.setValueAtTime(options.startFrequency, start);
  oscillator.frequency.exponentialRampToValueAtTime(options.endFrequency, end);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(options.peakGain, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.onended = () => {
    oscillator.disconnect();
    gain.disconnect();
  };
  oscillator.start(start);
  oscillator.stop(end + 0.02);
}

function playHoverSound(context: AudioContext): void {
  const now = performance.now();
  if (now - lastHoverSoundAt < 140) return;
  lastHoverSoundAt = now;
  playTone(context, {
    type: "sine",
    startFrequency: 168,
    endFrequency: 112,
    duration: 0.18,
    peakGain: 0.024
  });
}

function playClickSound(context: AudioContext): void {
  const now = performance.now();
  if (now - lastClickSoundAt < 90) return;
  lastClickSoundAt = now;
  playTone(context, {
    type: "triangle",
    startFrequency: 760,
    endFrequency: 430,
    duration: 0.08,
    peakGain: 0.038
  });
}

export function installElasticPointerFeedback(): void {
  if (typeof window === "undefined") return;

  document.addEventListener("pointerover", async (event) => {
    if (event.pointerType !== "mouse" || !isFineHoverPointer()) return;
    const clickable = findClickable(event);
    if (!clickable || !allowsElasticMotion(clickable) || isStillInside(clickable, event.relatedTarget)) return;
    restartElasticAnimation(clickable, "game-elastic-enter");
    const context = getRunningAudioContext();
    if (context) playHoverSound(context);
  });

  document.addEventListener("pointerout", (event) => {
    if (event.pointerType !== "mouse" || !isFineHoverPointer()) return;
    const clickable = findClickable(event);
    if (!clickable || !allowsElasticMotion(clickable) || isStillInside(clickable, event.relatedTarget)) return;
    restartElasticAnimation(clickable, "game-elastic-leave");
  });

  document.addEventListener("click", async (event) => {
    if (event instanceof MouseEvent && event.button !== 0) return;
    const clickable = findClickable(event);
    if (!clickable) return;
    const context = await unlockAudio();
    if (context) playClickSound(context);
  });

  document.addEventListener("animationend", (event) => {
    if (!(event.target instanceof HTMLElement)) return;
    if (!event.animationName.startsWith("game-elastic-")) return;
    event.target.classList.remove("game-elastic-enter", "game-elastic-leave");
  });
}
