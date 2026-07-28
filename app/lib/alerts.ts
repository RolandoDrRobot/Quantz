// Audio alerts — distinct sounds so you know what happened without looking

function playNotes(notes: [number, number][], vol = 0.35) {
  try {
    const ctx = new AudioContext();
    notes.forEach(([freq, delay]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = ctx.currentTime + delay;
      gain.gain.setValueAtTime(0.0, t);
      gain.gain.linearRampToValueAtTime(vol, t + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
      osc.start(t);
      osc.stop(t + 0.4);
    });
  } catch { /* audio not available */ }
}

// Level just broke — two urgent rising notes
export function playBreakoutSound() {
  playNotes([[523, 0], [784, 0.2]]);
}

// Price is retesting the level — four-note fanfare, this is the money moment
export function playRetestSound() {
  playNotes([[440, 0], [554, 0.18], [659, 0.36], [880, 0.54]]);
}

// Trade resolved (TP or SL)
export function playResolvedSound(win: boolean) {
  playNotes(win ? [[659, 0], [880, 0.2], [1047, 0.4]] : [[330, 0], [262, 0.25]]);
}
