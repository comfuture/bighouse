type AudioContextConstructor = new () => AudioContext;

let audioContext: AudioContext | undefined;

export function triggerSelectionFeedback(): void {
  safely(() => vibrate(12));
}

export function triggerPlacementFeedback(): void {
  safely(() => vibrate(16));
  safely(playTap);
}

export function triggerCardSubmitFeedback(): void {
  safely(() => vibrate(18));
  safely(playSwoosh);
}

function getAudioContext(): AudioContext | undefined {
  if (typeof globalThis === "undefined") return undefined;
  const audioGlobal = globalThis as typeof globalThis & {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  const AudioContextClass = audioGlobal.AudioContext ?? audioGlobal.webkitAudioContext;
  if (!AudioContextClass) return undefined;

  try {
    if (audioContext?.state === "closed") {
      audioContext = undefined;
    }
    audioContext ??= new AudioContextClass();
    if (audioContext.state === "suspended") {
      void audioContext.resume().catch(() => {});
    }
    return audioContext;
  } catch {
    audioContext = undefined;
    return undefined;
  }
}

function vibrate(durationMs: number): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(durationMs);
  } catch {
    // Vibration is optional and can be blocked by browser policy.
  }
}

function playTap(): void {
  const context = getAudioContext();
  if (!context) return;

  const now = context.currentTime;
  const body = context.createOscillator();
  const bodyGain = context.createGain();
  body.type = "triangle";
  body.frequency.setValueAtTime(190, now);
  body.frequency.exponentialRampToValueAtTime(92, now + 0.075);
  bodyGain.gain.setValueAtTime(0.0001, now);
  bodyGain.gain.exponentialRampToValueAtTime(0.42, now + 0.006);
  bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.105);
  body.connect(bodyGain);
  bodyGain.connect(context.destination);
  body.start(now);
  body.stop(now + 0.11);

  const click = context.createOscillator();
  const clickGain = context.createGain();
  click.type = "square";
  click.frequency.setValueAtTime(1180, now);
  clickGain.gain.setValueAtTime(0.0001, now);
  clickGain.gain.exponentialRampToValueAtTime(0.12, now + 0.002);
  clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.025);
  click.connect(clickGain);
  clickGain.connect(context.destination);
  click.start(now);
  click.stop(now + 0.03);
}

function playSwoosh(): void {
  const context = getAudioContext();
  if (!context) return;

  const duration = 0.2;
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let index = 0; index < channel.length; index += 1) {
    const fade = 1 - index / channel.length;
    channel[index] = (Math.random() * 2 - 1) * fade;
  }

  const now = context.currentTime;
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();

  source.buffer = buffer;
  filter.type = "bandpass";
  filter.Q.setValueAtTime(5.5, now);
  filter.frequency.setValueAtTime(620, now);
  filter.frequency.exponentialRampToValueAtTime(2_800, now + duration);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.26, now + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(context.destination);
  source.start(now);
  source.stop(now + duration);
}

function safely(callback: () => void): void {
  try {
    callback();
  } catch {
    // Feedback is best-effort; gameplay actions must continue if it fails.
  }
}
