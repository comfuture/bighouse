import type { YutThrow } from "./types";

const IMPACT_FRACTIONS = [.53, .67, .79, .88];
/** Late listeners hear only impacts that have not happened on the shared timeline. */
export function remainingImpactDelays(roll: YutThrow, serverNow: number): number[] {
  return IMPACT_FRACTIONS.map((fraction) => roll.startedAt + roll.durationMs * fraction - serverNow).filter((delay) => delay >= 0);
}

export function createThrowAudio(initialMuted: boolean): { unlock(): void; setMuted(muted: boolean): void; play(roll: YutThrow, serverNow: number): void; destroy(): void } {
  let context: AudioContext | undefined;
  let muted = initialMuted;
  let destroyed = false;
  let current: YutThrow | undefined;
  let offset = 0;
  let scheduledKey = "";
  const sources = new Set<AudioScheduledSourceNode>();
  const nodes = new Set<AudioNode>();
  function stop(): void {
    for (const source of sources) { try { source.stop(); } catch { /* Already finished. */ } }
    sources.clear();
    for (const node of nodes) node.disconnect();
    nodes.clear();
  }
  function impact(time: number, index: number, seed: number): void {
    if (!context) return;
    const ctx = context;
    const strength = .7 - index * .1;
    // Short high-passed noise is the click; decaying resonances give it a hollow wood body.
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * .035), ctx.sampleRate);
    const samples = buffer.getChannelData(0);
    let random = (seed + index * 7919) >>> 0;
    for (let i = 0; i < samples.length; i++) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      samples[i] = ((random / 0xffffffff) * 2 - 1) * (1 - i / samples.length);
    }
    const noise = ctx.createBufferSource(); noise.buffer = buffer;
    const filter = ctx.createBiquadFilter(); filter.type = "highpass"; filter.frequency.value = 1900;
    const clickGain = ctx.createGain(); clickGain.gain.setValueAtTime(.12 * strength, time); clickGain.gain.exponentialRampToValueAtTime(.001, time + .04);
    noise.connect(filter); filter.connect(clickGain); clickGain.connect(ctx.destination);
    nodes.add(filter); nodes.add(clickGain); sources.add(noise);
    noise.onended = () => { sources.delete(noise); noise.disconnect(); filter.disconnect(); clickGain.disconnect(); nodes.delete(filter); nodes.delete(clickGain); };
    noise.start(time); noise.stop(time + .045);
    for (const [frequency, gain] of [[810, .15], [1370, .075], [2340, .027]]) {
      const oscillator = ctx.createOscillator(); oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency! * (1 + index * .025), time);
      oscillator.frequency.exponentialRampToValueAtTime(frequency! * .87, time + .09);
      const envelope = ctx.createGain(); envelope.gain.setValueAtTime(gain! * strength, time); envelope.gain.exponentialRampToValueAtTime(.0001, time + .12);
      oscillator.connect(envelope); envelope.connect(ctx.destination); nodes.add(envelope); sources.add(oscillator);
      oscillator.onended = () => { sources.delete(oscillator); oscillator.disconnect(); envelope.disconnect(); nodes.delete(envelope); };
      oscillator.start(time); oscillator.stop(time + .13);
    }
  }
  function schedule(): void {
    if (!context || context.state !== "running" || !current || muted || destroyed || document.hidden) return;
    const key = `${current.matchId}:${current.rollId}`;
    if (key === scheduledKey) return;
    scheduledKey = key;
    remainingImpactDelays(current, Date.now() + offset).forEach((delay, index) => impact(context!.currentTime + delay / 1000, index, current!.visualSeed));
  }
  const onVisibility = (): void => { if (document.hidden) stop(); };
  document.addEventListener("visibilitychange", onVisibility);
  return {
    unlock() {
      if (destroyed || muted) return;
      try {
        const Audio = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Audio) return;
        context ??= new Audio();
        void context.resume().then(schedule).catch(() => undefined);
      } catch { /* Playback requires browser/user activation; silence remains a valid fallback. */ }
    },
    setMuted(value) { muted = value; if (muted) stop(); },
    play(roll, serverNow) {
      if (destroyed) return;
      if (current?.matchId === roll.matchId && current.rollId === roll.rollId) return;
      stop(); current = roll; offset = serverNow - Date.now(); schedule();
    },
    destroy() { destroyed = true; stop(); document.removeEventListener("visibilitychange", onVisibility); void context?.close().catch(() => undefined); }
  };
}
