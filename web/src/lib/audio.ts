"use client";

// Shared AudioContext for the demo's edge-overlay sound effects.
//
// Browser autoplay policy: AudioContext can only START playing audio
// after a user gesture. We initialize on the address-submit click (which
// IS a user gesture), so by the time edges animate in, sounds work
// without any "click to enable" toggle in the UI.

let ctx: AudioContext | null = null;
let unlocked = false;

type AudioWindow = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };

// Call this from a USER GESTURE handler (e.g. the submit button onClick).
// Safe to call multiple times — first call wins; subsequent calls are no-ops.
export function unlockAudio(): void {
  if (unlocked) return;
  if (typeof window === "undefined") return;
  const w = window as AudioWindow;
  const Ctx = window.AudioContext || w.webkitAudioContext;
  if (!Ctx) return;
  try {
    ctx = new Ctx();
    if (ctx.state === "suspended") void ctx.resume();
    unlocked = true;
  } catch {
    // Audio not available (privacy mode, etc.) — silently degrade.
  }
}

export function isAudioUnlocked(): boolean {
  return unlocked && ctx !== null;
}

// Scroll-scrubbed "wind swoosh" — bandpass-filtered white noise whose
// center frequency follows parallax progress and amplitude follows
// scroll velocity.
//
// Architecture:
//   white-noise buffer source (looped) → bandpass filter → master gain → out
//
// Filtered noise reads as "wind / atmospheric whoosh" rather than a
// synth tone. Sweeping the bandpass center upward as progress → 1
// gives the sense of zooming into something — higher pitched air, like
// rushing toward the roof.
//
// Mappings:
//   - bandpass center:   400 Hz → 2200 Hz across progress 0 → 1
//   - master gain:       silent unless scrolling; tied to velocity
//   - silent at edges and at the centered "landed" state

let noiseSource: AudioBufferSourceNode | null = null;
let bandpass: BiquadFilterNode | null = null;
let masterGain: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let lastT = 0;
let lastUpdateAt = 0;
// "One-and-done" semantics: once the sound has played and the user
// pauses scrolling, it ENDS for good — it does not resume on the next
// scroll burst. (Resuming felt pointless and made the audio feel
// stuttery.) Reset on component unmount so a new address search
// gets a fresh sound.
let hasPlayedOnce = false;
let completed = false;
let endTimeoutId: ReturnType<typeof setTimeout> | null = null;

function ensureWindNodes(): boolean {
  if (!unlocked || !ctx) return false;
  if (noiseSource && bandpass && masterGain) return true;

  // Build (and cache) a 2-second mono white-noise buffer. Looped, it
  // reads as continuous wind. 2s is long enough that no perceptible
  // loop seam lands during the parallax window.
  if (!noiseBuffer) {
    const seconds = 2;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffer = buf;
  }

  noiseSource = ctx.createBufferSource();
  noiseSource.buffer = noiseBuffer;
  noiseSource.loop = true;

  bandpass = ctx.createBiquadFilter();
  bandpass.type = "bandpass";
  bandpass.frequency.value = 600;
  bandpass.Q.value = 1.4;  // moderate width — too narrow sounds like a whistle

  masterGain = ctx.createGain();
  masterGain.gain.value = 0;

  noiseSource.connect(bandpass).connect(masterGain).connect(ctx.destination);
  noiseSource.start();
  return true;
}

// Call from rAF/scroll handler with the current parallax progress (0..1).
// Velocity is computed from delta-t internally.
export function updateScrollScrubbedSwoosh(progress: number): void {
  // One-and-done: once the user has paused for >250ms after the sound
  // played, it's marked complete and further scrolls are silent.
  if (completed) return;
  if (!ensureWindNodes() || !ctx || !bandpass || !masterGain) return;

  const now = ctx.currentTime;
  const dt = lastUpdateAt > 0 ? Math.max(0.001, now - lastUpdateAt) : 0.05;
  const dProgress = Math.abs(progress - lastT);
  const velocity = dProgress / dt;       // progress units per second
  lastT = progress;
  lastUpdateAt = now;

  // Bandpass center sweeps with progress: low rumble at edges,
  // brighter air-rush near center.
  const targetCenter = 400 + Math.pow(progress, 1.2) * 1800;

  // Volume tied to velocity. Subtle by design — UI texture, not lead.
  // Cap at ~0.025 (about 1/7 of the original wind level) so the swoosh
  // sits well underneath the visual — present if you're listening for
  // it, easy to ignore otherwise.
  let targetGain = Math.min(0.025, velocity * 0.09);
  if (progress < 0.01 || progress >= 0.99) targetGain = 0;

  if (targetGain > 0.005) hasPlayedOnce = true;

  masterGain.gain.cancelScheduledValues(now);
  masterGain.gain.setValueAtTime(masterGain.gain.value, now);
  masterGain.gain.linearRampToValueAtTime(targetGain, now + 0.05);
  masterGain.gain.linearRampToValueAtTime(0, now + 0.30);

  bandpass.frequency.cancelScheduledValues(now);
  bandpass.frequency.linearRampToValueAtTime(targetCenter, now + 0.07);

  // Reset the "end" watchdog. If no further updates arrive within
  // 250ms (user paused scrolling), the sound ends permanently for
  // this mount. Subsequent scroll bursts won't replay it.
  if (endTimeoutId) clearTimeout(endTimeoutId);
  endTimeoutId = setTimeout(() => {
    if (hasPlayedOnce && ctx && masterGain) {
      completed = true;
      const t0 = ctx.currentTime;
      masterGain.gain.cancelScheduledValues(t0);
      masterGain.gain.linearRampToValueAtTime(0, t0 + 0.2);
    }
  }, 250);
}

// Silence + free persistent nodes (called on component unmount).
// Resets the one-and-done state so the next mount (e.g. after a fresh
// address search) gets a fresh chain that can play its sound again.
export function stopScrollScrubbedSwoosh(): void {
  if (endTimeoutId) {
    clearTimeout(endTimeoutId);
    endTimeoutId = null;
  }
  if (!ctx) {
    hasPlayedOnce = false;
    completed = false;
    return;
  }
  try {
    if (masterGain) {
      const now = ctx.currentTime;
      masterGain.gain.cancelScheduledValues(now);
      masterGain.gain.linearRampToValueAtTime(0, now + 0.15);
    }
    if (noiseSource) {
      noiseSource.stop(ctx.currentTime + 0.2);
      noiseSource.disconnect();
    }
    if (bandpass) bandpass.disconnect();
    if (masterGain) masterGain.disconnect();
  } catch { /* ignore */ }
  noiseSource = null;
  bandpass = null;
  masterGain = null;
  lastT = 0;
  lastUpdateAt = 0;
  hasPlayedOnce = false;
  completed = false;
}

// Meditative tone — slow attack, sustained body, long exponential
// release, with a soft secondary harmonic. Aimed at "Calm app" / Tibetan-
// bowl vibe rather than a notification ping. Frequencies sit in a
// pentatonic A-minor neighborhood: low enough to feel grounding, varied
// enough across edge types to suggest the roof is being "read" deliberately.
//
//   ridge  → A3   (220 Hz) — the foundation, peak of the roof
//   hip    → C4   (262 Hz)
//   valley → E4   (330 Hz) — slightly higher pitch, water flowing down
//   rake   → G4   (392 Hz)
//   eave   → A4   (440 Hz) — closing tone
//
// Total played voice ≈ 1.2s per edge (much longer than the old 110ms
// pulse), so the user has time to register each note as the line draws.
export function playEdgeTick(edgeType: "ridge" | "hip" | "valley" | "rake" | "eave"): void {
  if (!unlocked || !ctx) return;
  const freq = edgeType === "ridge"  ? 220
            : edgeType === "hip"     ? 262
            : edgeType === "valley"  ? 330
            : edgeType === "rake"    ? 392
            :                          440; // eave
  try {
    const now = ctx.currentTime;
    const ATTACK = 0.08;
    const HOLD   = 0.30;
    const RELEASE = 0.85;
    const peakGain = 0.045;
    const harmonicGain = 0.018;

    // Fundamental
    const o1 = ctx.createOscillator();
    const g1 = ctx.createGain();
    o1.type = "sine";
    o1.frequency.value = freq;
    g1.gain.setValueAtTime(0.0001, now);
    g1.gain.exponentialRampToValueAtTime(peakGain, now + ATTACK);
    g1.gain.setValueAtTime(peakGain, now + ATTACK + HOLD);
    g1.gain.exponentialRampToValueAtTime(0.0001, now + ATTACK + HOLD + RELEASE);
    o1.connect(g1).connect(ctx.destination);
    o1.start(now);
    o1.stop(now + ATTACK + HOLD + RELEASE + 0.05);

    // Soft octave harmonic for warmth
    const o2 = ctx.createOscillator();
    const g2 = ctx.createGain();
    o2.type = "sine";
    o2.frequency.value = freq * 2;
    g2.gain.setValueAtTime(0.0001, now);
    g2.gain.exponentialRampToValueAtTime(harmonicGain, now + ATTACK + 0.05);
    g2.gain.exponentialRampToValueAtTime(0.0001, now + ATTACK + HOLD + RELEASE * 0.7);
    o2.connect(g2).connect(ctx.destination);
    o2.start(now);
    o2.stop(now + ATTACK + HOLD + RELEASE);
  } catch {
    // ignore — autoplay can still fail in edge cases
  }
}
