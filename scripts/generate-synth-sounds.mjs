// Synthesizes the sounds of the default pack that are melodies in the public domain
// (the recordings are ours, the compositions are long out of copyright) plus a censor bleep.
// Writes WAV files into sounds/default/. Usage: node scripts/generate-synth-sounds.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RATE = 44100;
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../sounds/default');

const NOTE = {
  C: 0,
  'C#': 1,
  Db: 1,
  D: 2,
  'D#': 3,
  Eb: 3,
  E: 4,
  F: 5,
  'F#': 6,
  Gb: 6,
  G: 7,
  'G#': 8,
  Ab: 8,
  A: 9,
  'A#': 10,
  Bb: 10,
  B: 11,
};
/** 'A4' → 440 Hz. */
function freq(name) {
  const [, pitch, octave] = name.match(/^([A-G][#b]?)(\d)$/);
  const midi = 12 * (Number(octave) + 1) + NOTE[pitch];
  return 440 * 2 ** ((midi - 69) / 12);
}

/** Old monophonic phone beeper: a soft square-ish tone, slightly detached notes. */
const beeper = (f, t, len) =>
  (Math.sin(2 * Math.PI * f * t) +
    0.3 * Math.sin(6 * Math.PI * f * t) +
    0.15 * Math.sin(10 * Math.PI * f * t)) *
  Math.min(1, t / 0.005, Math.max(0, (len * 0.9 - t) / 0.02));

/** Plucked, piano-ish tone that rings out. */
const piano = (f, t) =>
  (Math.sin(2 * Math.PI * f * t) +
    0.5 * Math.sin(4 * Math.PI * f * t) * Math.exp(-3 * t) +
    0.2 * Math.sin(6 * Math.PI * f * t) * Math.exp(-5 * t)) *
  Math.exp(-2.5 * t) *
  Math.min(1, t / 0.004);

/** Sustained low organ, for the funeral march. */
const organ = (f, t, len) =>
  (Math.sin(2 * Math.PI * f * t) +
    0.6 * Math.sin(4 * Math.PI * f * t) +
    0.35 * Math.sin(6 * Math.PI * f * t) +
    0.2 * Math.sin(8 * Math.PI * f * t)) *
  Math.min(1, t / 0.03, Math.max(0, (len - t) / 0.06));

/** Renders [note | null (rest), beats] pairs. `ring` lets notes overlap the next one. */
function melody(notes, beatSeconds, voice, ring = 0) {
  const total = notes.reduce((s, [, b]) => s + b * beatSeconds, 0) + ring;
  const out = new Float64Array(Math.ceil(total * RATE));
  let start = 0;
  for (const [note, beats] of notes) {
    const len = beats * beatSeconds;
    if (note) {
      const f = freq(note);
      const span = Math.min(out.length - Math.round(start * RATE), Math.ceil((len + ring) * RATE));
      for (let i = 0; i < span; i++) out[Math.round(start * RATE) + i] += voice(f, i / RATE, len);
    }
    start += len;
  }
  return normalize(out, 0.8);
}

function normalize(samples, peak) {
  const max = samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;
  return samples.map((v) => (v / max) * peak);
}

const sounds = {
  // Francisco Tárrega, "Gran Vals" (1902): the bar everyone knows as the Nokia ringtone.
  'nokia-tune': melody(
    [
      ['E5', 0.5],
      ['D5', 0.5],
      ['F#4', 1],
      ['G#4', 1],
      ['C#5', 0.5],
      ['B4', 0.5],
      ['D4', 1],
      ['E4', 1],
      ['B4', 0.5],
      ['A4', 0.5],
      ['C#4', 1],
      ['E4', 1],
      ['A4', 2],
    ],
    0.3,
    beeper,
  ),
  // Traditional "shave and a haircut… two bits!" knock.
  'shave-and-a-haircut': melody(
    [
      ['C5', 1],
      ['G4', 0.5],
      ['G4', 0.5],
      ['A4', 1],
      ['G4', 1],
      [null, 1],
      ['B4', 1],
      ['C5', 1],
    ],
    0.38,
    piano,
    0.6,
  ),
  // Frédéric Chopin, Piano Sonata No. 2, "Marche funèbre" (1839): the opening bars.
  'funeral-march': melody(
    [
      ['Bb3', 1],
      ['Bb3', 0.75],
      ['Bb3', 0.25],
      ['Bb3', 2],
      ['Db4', 0.75],
      ['C4', 0.25],
      ['C4', 0.75],
      ['Bb3', 0.25],
      ['Bb3', 0.75],
      ['A3', 0.25],
      ['Bb3', 2],
    ],
    0.55,
    organ,
  ),
  // The TV censor bleep: a 1 kHz tone.
  'censor-bleep': normalize(
    Float64Array.from({ length: Math.round(0.8 * RATE) }, (_, i) => {
      const t = i / RATE;
      return Math.sin(2 * Math.PI * 1000 * t) * Math.min(1, t / 0.01, (0.8 - t) / 0.01);
    }),
    0.5,
  ),
};

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) =>
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2),
  );
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

fs.mkdirSync(outDir, { recursive: true });
for (const [id, samples] of Object.entries(sounds)) {
  fs.writeFileSync(path.join(outDir, `${id}.wav`), wav(samples));
  console.log(`${id}.wav  ${(samples.length / RATE).toFixed(2)}s`);
}
