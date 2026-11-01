// Petits retours sonores et vibrations (générés, aucun fichier audio).
import { getState } from './store';

let ctx: AudioContext | null = null;
function tone(freqs: number[], dur = 0.12, type: OscillatorType = 'sine', gain = 0.06) {
  try {
    ctx ??= new AudioContext();
    let t = ctx.currentTime;
    for (const f of freqs) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.value = f;
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + dur);
      t += dur * 0.9;
    }
  } catch {
    /* audio indisponible */
  }
}

export function playResult(correct: boolean) {
  const { sound, vibration } = getState().settings;
  if (sound) correct ? tone([660, 880, 1320], 0.11, 'triangle') : tone([220, 165], 0.18, 'sawtooth', 0.04);
  if (vibration && !correct) navigator.vibrate?.(120);
}

export function playTick() {
  if (getState().settings.sound) tone([1000], 0.04, 'square', 0.02);
}
