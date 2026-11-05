// Presets de som simples via WebAudio. Pares combinam (ex: "sparkles" ao iniciar / "sparkles2" ao parar).

export const SOUND_PAIRS: { start: string; stop: string; label: string }[] = [
  { start: "sparkles", stop: "sparkles2", label: "Sparkles" },
  { start: "chime", stop: "chime2", label: "Chime" },
  { start: "pop", stop: "pop2", label: "Pop" },
  { start: "pulse", stop: "pulse2", label: "Pulse" },
  { start: "bloop", stop: "bloop2", label: "Bloop" },
  { start: "beep", stop: "beep2", label: "Beep" },
  { start: "zap", stop: "zap2", label: "Zap" },
  { start: "ding", stop: "ding2", label: "Ding" },
  { start: "buzz", stop: "buzz2", label: "Buzz" },
  { start: "click", stop: "click2", label: "Click" },
  { start: "whoosh", stop: "whoosh2", label: "Whoosh" },
  { start: "coin", stop: "coin2", label: "Coin" },
  { start: "laser", stop: "laser2", label: "Laser" },
  { start: "drop", stop: "drop2", label: "Drop" },
  { start: "blip", stop: "blip2", label: "Blip" },
  { start: "twinkle", stop: "twinkle2", label: "Twinkle" },
  { start: "chirp", stop: "chirp2", label: "Chirp" },
  { start: "boop", stop: "boop2", label: "Boop" },
  { start: "swoosh", stop: "swoosh2", label: "Swoosh" },
  { start: "ping", stop: "ping2", label: "Ping" },
];

export const START_SOUND_OPTIONS = SOUND_PAIRS.map((p) => ({ value: p.start, label: p.start }));
export const STOP_SOUND_OPTIONS = SOUND_PAIRS.map((p) => ({ value: p.stop, label: p.stop }));

type Preset = (o: OscillatorNode, g: GainNode, now: number) => number;

const presets: Record<string, Preset> = {
  sparkles: (o, g, now) => {
    o.type = "triangle";
    o.frequency.setValueAtTime(880, now);
    o.frequency.linearRampToValueAtTime(1760, now + 0.15);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.2, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
    return 0.3;
  },
  sparkles2: (o, g, now) => {
    o.type = "triangle";
    o.frequency.setValueAtTime(1760, now);
    o.frequency.linearRampToValueAtTime(660, now + 0.2);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.2, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    return 0.35;
  },
  chime: (o, g, now) => {
    o.type = "sine";
    o.frequency.setValueAtTime(660, now);
    o.frequency.linearRampToValueAtTime(990, now + 0.12);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    return 0.26;
  },
  chime2: (o, g, now) => {
    o.type = "sine";
    o.frequency.setValueAtTime(520, now);
    o.frequency.linearRampToValueAtTime(260, now + 0.18);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
    return 0.28;
  },
  pop: (o, g, now) => {
    o.type = "square";
    o.frequency.setValueAtTime(440, now);
    o.frequency.exponentialRampToValueAtTime(880, now + 0.05);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.14, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
    return 0.14;
  },
  pop2: (o, g, now) => {
    o.type = "square";
    o.frequency.setValueAtTime(880, now);
    o.frequency.exponentialRampToValueAtTime(220, now + 0.08);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.14, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    return 0.16;
  },
  pulse: (o, g, now) => {
    o.type = "sawtooth";
    o.frequency.setValueAtTime(300, now);
    o.frequency.linearRampToValueAtTime(600, now + 0.18);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.13, now + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    return 0.32;
  },
  pulse2: (o, g, now) => {
    o.type = "sawtooth";
    o.frequency.setValueAtTime(600, now);
    o.frequency.linearRampToValueAtTime(150, now + 0.25);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.13, now + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    return 0.38;
  },
  bloop: (o, g, now) => {
    o.type = "sine";
    o.frequency.setValueAtTime(200, now);
    o.frequency.exponentialRampToValueAtTime(900, now + 0.12);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    return 0.22;
  },
  bloop2: (o, g, now) => {
    o.type = "sine";
    o.frequency.setValueAtTime(900, now);
    o.frequency.exponentialRampToValueAtTime(200, now + 0.16);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    return 0.26;
  },
  beep: (o, g, now) => {
    o.type = "square";
    o.frequency.setValueAtTime(1000, now);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.15, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    return 0.14;
  },
  beep2: (o, g, now) => {
    o.type = "square";
    o.frequency.setValueAtTime(500, now);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.15, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    return 0.16;
  },
  zap: (o, g, now) => {
    o.type = "sawtooth";
    o.frequency.setValueAtTime(200, now);
    o.frequency.exponentialRampToValueAtTime(2000, now + 0.08);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.15, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    return 0.14;
  },
  zap2: (o, g, now) => {
    o.type = "sawtooth";
    o.frequency.setValueAtTime(2000, now);
    o.frequency.exponentialRampToValueAtTime(100, now + 0.12);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.15, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    return 0.18;
  },
  ding: (o, g, now) => {
    o.type = "sine";
    o.frequency.setValueAtTime(1320, now);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.2, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
    return 0.42;
  },
  ding2: (o, g, now) => {
    o.type = "sine";
    o.frequency.setValueAtTime(660, now);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.2, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
    return 0.42;
  },
  buzz: (o, g, now) => {
    o.type = "sawtooth";
    o.frequency.setValueAtTime(120, now);
    o.frequency.linearRampToValueAtTime(180, now + 0.2);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
    return 0.28;
  },
  buzz2: (o, g, now) => {
    o.type = "sawtooth";
    o.frequency.setValueAtTime(180, now);
    o.frequency.linearRampToValueAtTime(80, now + 0.25);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    return 0.32;
  },
  click: (o, g, now) => {
    o.type = "square";
    o.frequency.setValueAtTime(1500, now);
    o.frequency.exponentialRampToValueAtTime(600, now + 0.03);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.14, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
    return 0.07;
  },
  click2: (o, g, now) => {
    o.type = "square";
    o.frequency.setValueAtTime(600, now);
    o.frequency.exponentialRampToValueAtTime(200, now + 0.04);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.14, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    return 0.08;
  },
  whoosh: (o, g, now) => {
    o.type = "triangle";
    o.frequency.setValueAtTime(150, now);
    o.frequency.exponentialRampToValueAtTime(800, now + 0.3);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.1, now + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    return 0.38;
  },
  whoosh2: (o, g, now) => {
    o.type = "triangle";
    o.frequency.setValueAtTime(800, now);
    o.frequency.exponentialRampToValueAtTime(100, now + 0.35);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.1, now + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
    return 0.42;
  },
  coin: (o, g, now) => {
    o.type = "square";
    o.frequency.setValueAtTime(988, now);
    o.frequency.setValueAtTime(1319, now + 0.08);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.16, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
    return 0.28;
  },
  coin2: (o, g, now) => {
    o.type = "square";
    o.frequency.setValueAtTime(1319, now);
    o.frequency.setValueAtTime(659, now + 0.1);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.16, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    return 0.3;
  },
  laser: (o, g, now) => {
    o.type = "sawtooth";
    o.frequency.setValueAtTime(1200, now);
    o.frequency.exponentialRampToValueAtTime(200, now + 0.25);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.14, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    return 0.32;
  },
  laser2: (o, g, now) => {
    o.type = "sawtooth";
    o.frequency.setValueAtTime(200, now);
    o.frequency.exponentialRampToValueAtTime(1500, now + 0.2);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.14, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
    return 0.28;
  },
  drop: (o, g, now) => {
    o.type = "sine";
    o.frequency.setValueAtTime(800, now);
    o.frequency.exponentialRampToValueAtTime(100, now + 0.2);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.18, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
    return 0.28;
  },
  drop2: (o, g, now) => {
    o.type = "sine";
    o.frequency.setValueAtTime(100, now);
    o.frequency.exponentialRampToValueAtTime(800, now + 0.2);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.18, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
    return 0.28;
  },
  blip: (o, g, now) => {
    o.type = "triangle";
    o.frequency.setValueAtTime(1200, now);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.15, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    return 0.1;
  },
  blip2: (o, g, now) => {
    o.type = "triangle";
    o.frequency.setValueAtTime(600, now);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.15, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
    return 0.12;
  },
  twinkle: (o, g, now) => {
    o.type = "sine";
    o.frequency.setValueAtTime(1568, now);
    o.frequency.linearRampToValueAtTime(2093, now + 0.18);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.13, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    return 0.3;
  },
  twinkle2: (o, g, now) => {
    o.type = "sine";
    o.frequency.setValueAtTime(2093, now);
    o.frequency.linearRampToValueAtTime(1046, now + 0.22);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.13, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
    return 0.34;
  },
  chirp: (o, g, now) => {
    o.type = "triangle";
    o.frequency.setValueAtTime(2000, now);
    o.frequency.linearRampToValueAtTime(3500, now + 0.1);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.11, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
    return 0.18;
  },
  chirp2: (o, g, now) => {
    o.type = "triangle";
    o.frequency.setValueAtTime(3500, now);
    o.frequency.linearRampToValueAtTime(1500, now + 0.12);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.11, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    return 0.2;
  },
  boop: (o, g, now) => {
    o.type = "sine";
    o.frequency.setValueAtTime(440, now);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.18, now + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    return 0.16;
  },
  boop2: (o, g, now) => {
    o.type = "sine";
    o.frequency.setValueAtTime(220, now);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.18, now + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    return 0.18;
  },
  swoosh: (o, g, now) => {
    o.type = "triangle";
    o.frequency.setValueAtTime(400, now);
    o.frequency.linearRampToValueAtTime(1200, now + 0.22);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.1, now + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    return 0.32;
  },
  swoosh2: (o, g, now) => {
    o.type = "triangle";
    o.frequency.setValueAtTime(1200, now);
    o.frequency.linearRampToValueAtTime(300, now + 0.26);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.1, now + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
    return 0.36;
  },
  ping: (o, g, now) => {
    o.type = "sine";
    o.frequency.setValueAtTime(2000, now);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.16, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    return 0.32;
  },
  ping2: (o, g, now) => {
    o.type = "sine";
    o.frequency.setValueAtTime(1000, now);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.16, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
    return 0.34;
  },
};

export function playSound(name: string) {
  const preset = presets[name] ?? presets.sparkles;
  try {
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    const now = ctx.currentTime;
    const dur = preset(o, g, now);
    o.start(now);
    o.stop(now + dur + 0.05);
    setTimeout(() => ctx.close().catch(() => {}), (dur + 0.2) * 1000);
  } catch {
    /* ignore */
  }
}