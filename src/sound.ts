import { getState } from './store';

// Tiny synthesized cues. The audio context is only created inside a tap,
// which is what iOS requires before any sound can play.

type Cue = 'tap' | 'complete' | 'undo' | 'drop' | 'reveal3' | 'reveal4' | 'reveal5' | 'buy';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(ac: AudioContext, freq: number, start: number, length: number, type: OscillatorType, gain = 0.08) {
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ac.currentTime + start);
  amp.gain.setValueAtTime(0.0001, ac.currentTime + start);
  amp.gain.exponentialRampToValueAtTime(gain, ac.currentTime + start + 0.01);
  amp.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + start + length);
  osc.connect(amp).connect(ac.destination);
  osc.start(ac.currentTime + start);
  osc.stop(ac.currentTime + start + length + 0.05);
}

const CUES: Record<Cue, [freq: number, start: number, length: number, type: OscillatorType][]> = {
  tap: [[880, 0, 0.05, 'square']],
  complete: [
    [660, 0, 0.08, 'triangle'],
    [990, 0.07, 0.14, 'triangle'],
  ],
  undo: [[330, 0, 0.12, 'triangle']],
  drop: [
    [140, 0, 0.25, 'sine'],
    [70, 0.02, 0.35, 'triangle'],
  ],
  buy: [
    [520, 0, 0.08, 'triangle'],
    [780, 0.08, 0.12, 'triangle'],
  ],
  reveal3: [
    [523, 0, 0.18, 'sine'],
    [784, 0.1, 0.25, 'sine'],
  ],
  reveal4: [
    [523, 0, 0.18, 'sine'],
    [659, 0.1, 0.2, 'sine'],
    [988, 0.2, 0.35, 'sine'],
  ],
  reveal5: [
    [523, 0, 0.2, 'sine'],
    [659, 0.1, 0.2, 'sine'],
    [784, 0.2, 0.2, 'sine'],
    [1047, 0.3, 0.6, 'sine'],
    [1319, 0.42, 0.6, 'triangle'],
  ],
};

/** Call only from a tap handler (or code a tap just started). */
export function play(cue: Cue): void {
  if (!getState().meta.get('meta')?.settings.soundOn) return;
  const ac = audio();
  if (!ac) return;
  for (const [freq, start, length, type] of CUES[cue]) tone(ac, freq, start, length, type);
}
