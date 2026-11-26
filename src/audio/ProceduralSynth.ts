// ============================================================================
// Krunked Circuit — 16-Bit Mega Man X / Zero-Inspired Web Audio Synthesizer
// Multi-channel lookahead step sequencer (25% / 12.5% Pulse lead, FM slap
// bass, Triangle/Saw harmony arpeggios, crisp Noise/Pitch-env percussion),
// Intro -> seamless Loop playback, 3-stem dynamic crossfading Hub theme,
// and bespoke synthesized SFX for every key in SFX_SPECS.
// ============================================================================

import {
  BGM_TRACKS,
  resolveBgmKey,
  resolveSfxKey,
  type BgmKey,
  type HubStem,
  type SfxKey,
} from './soundManifest';

const NOTE_REST = -1;
const NOTE_HOLD = -2;

const NOTE_NAME_TO_SEMITONE: Readonly<Record<string, number>> = {
  C: 0,
  'C#': 1,
  DB: 1,
  D: 2,
  'D#': 3,
  EB: 3,
  E: 4,
  F: 5,
  'F#': 6,
  GB: 6,
  G: 7,
  'G#': 8,
  AB: 8,
  A: 9,
  'A#': 10,
  BB: 10,
  B: 11,
};

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function parseNoteToken(token: string): number {
  if (token === '.' || token === '_') return NOTE_REST;
  if (token === '-' || token === '~') return NOTE_HOLD;
  const match = /^([A-Ga-g][#bB]?)(-?\d)$/.exec(token);
  if (!match) return NOTE_REST;
  const semitone = NOTE_NAME_TO_SEMITONE[match[1].toUpperCase()];
  if (semitone === undefined) return NOTE_REST;
  const octave = parseInt(match[2], 10);
  return (octave + 1) * 12 + semitone;
}

function parseNotes(pattern: string): number[] {
  const cleaned = pattern.replace(/\|/g, ' ').trim();
  if (!cleaned) return [];
  return cleaned.split(/\s+/).map(parseNoteToken);
}

function parseDrums(pattern: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '|') {
      continue;
    }
    out.push(ch);
  }
  return out;
}

interface PatternSection {
  readonly length: number;
  readonly lead: readonly number[];
  readonly bass: readonly number[];
  readonly arp: readonly number[];
  readonly drums: readonly string[];
}

interface HubStemLayers {
  readonly commandLead: readonly number[];
  readonly commandArp: readonly number[];
  readonly medbayLead: readonly number[];
  readonly medbayArp: readonly number[];
  readonly dojoLead: readonly number[];
  readonly dojoArp: readonly number[];
  readonly dojoDrums: readonly string[];
}

interface SongComposition {
  readonly bpm: number;
  readonly loop: boolean;
  readonly leadGain: number;
  readonly bassGain: number;
  readonly arpGain: number;
  readonly drumGain: number;
  readonly leadStyle: 'pulse25' | 'pulse12' | 'saw' | 'triangle';
  readonly arpStyle: 'pulse12' | 'triangle' | 'saw';
  readonly echoMix: number;
  readonly intro?: PatternSection;
  readonly main: PatternSection;
  readonly hubStems?: HubStemLayers;
}

function makeSection(
  leadStr: string,
  bassStr: string,
  arpStr: string,
  drumStr: string,
): PatternSection {
  const lead = parseNotes(leadStr);
  const bass = parseNotes(bassStr);
  const arp = parseNotes(arpStr);
  const drums = parseDrums(drumStr);
  const length = Math.max(lead.length, bass.length, arp.length, drums.length, 16);
  return { length, lead, bass, arp, drums };
}

function noteHoldSteps(arr: readonly number[], startIdx: number): number {
  let count = 1;
  for (let i = startIdx + 1; i < arr.length; i++) {
    if (arr[i] === NOTE_HOLD) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

// ============================================================================
// Full-Catalog 16-Bit Mega Man X / Zero-Inspired Compositions (All 23 BGM Keys!)
// Every single track has its own original motif, key signature, tempo, bass
// groove, harmony arpeggio, drum kit groove, and Intro -> 64-step Loop!
// ============================================================================

const SONGS: Readonly<Record<BgmKey, SongComposition>> = {
  // --------------------------------------------------------------------------
  // 1. bgm_title — Heroic cyber-synth anthem (148 BPM, E minor -> G major)
  // --------------------------------------------------------------------------
  bgm_title: {
    bpm: 148,
    loop: true,
    leadGain: 0.25,
    bassGain: 0.28,
    arpGain: 0.14,
    drumGain: 0.3,
    leadStyle: 'pulse25',
    arpStyle: 'pulse12',
    echoMix: 0.16,
    intro: makeSection(
      [
        'E5 . G5 . B5 . D6 . | E6 - - - D6 . B5 .',
        'C6 . B5 . A5 . G5 . | F#5 - A5 . B5 - - .',
      ].join(' | '),
      [
        'E2 . E3 . E2 . E3 . | D2 . D3 . B1 . D2 .',
        'C2 . C3 . A1 . C2 . | B1 B1 B2 B1 B1 . D#2 .',
      ].join(' | '),
      [
        'E4 G4 B4 E5 G4 B4 E5 G5 | D4 F#4 A4 D5 B3 D4 F#4 B4',
        'C4 E4 G4 C5 A3 C4 E4 A4 | B3 D#4 F#4 B4 F#4 D#4 B3 F#4',
      ].join(' | '),
      [
        'C.h.S.h.K.hKS.hH',
        'K.h.S.h.T.t.R.R.',
      ].join(' | '),
    ),
    main: makeSection(
      [
        'E5 - . B4 E5 . F#5 . | G5 - - . F#5 . E5 .',
        'D5 - . A4 D5 . E5 . | F#5 - - . E5 . D5 .',
        'C5 - . G4 C5 . D5 . | E5 - G5 - A5 . B5 .',
        'B5 - - . A5 . G5 . | F#5 - - . D#5 . B4 .',
      ].join(' | '),
      [
        'E2 E2 E3 E2 E2 E2 E3 E2 | E2 E2 E3 E2 G2 . F#2 .',
        'D2 D2 D3 D2 D2 D2 D3 D2 | D2 D2 D3 D2 F#2 . E2 .',
        'C2 C2 C3 C2 C2 C2 C3 C2 | C2 C2 C3 C2 D2 . E2 .',
        'B1 B1 B2 B1 B1 B1 B2 B1 | B1 B1 B2 B1 D#2 . B1 .',
      ].join(' | '),
      [
        'E4 G4 B4 E5 B4 G4 E4 G4 | E4 G4 B4 E5 B4 G4 E4 B4',
        'D4 F#4 A4 D5 A4 F#4 D4 F#4 | D4 F#4 A4 D5 A4 F#4 D4 A4',
        'C4 E4 G4 C5 G4 E4 C4 E4 | C4 E4 G4 C5 D4 F#4 A4 D5',
        'B3 D#4 F#4 B4 F#4 D#4 B3 D#4 | B3 D#4 F#4 B4 F#4 D#4 B3 F#4',
      ].join(' | '),
      [
        'C.h.S.h.K.hKS.hH',
        'K.h.S.h.K.hKT.t.',
        'C.h.S.h.K.hKS.hH',
        'K.K.S.T.t.S.R.H.',
      ].join(' | '),
    ),
  },

  // --------------------------------------------------------------------------
  // 2. bgm_hub — 3-stem dynamic crossfading hub theme (135 BPM, C major / Am)
  // 16-step Command Deck arrival chime -> seamless 64-step 3-stem crossfade!
  // --------------------------------------------------------------------------
  bgm_hub: {
    bpm: 135,
    loop: true,
    leadGain: 0.22,
    bassGain: 0.25,
    arpGain: 0.13,
    drumGain: 0.24,
    leadStyle: 'pulse25',
    arpStyle: 'triangle',
    echoMix: 0.14,
    intro: makeSection(
      'G5 . C6 . E6 - D6 . | C6 . G5 . B5 - - .',
      'C2 . G2 . C3 . G2 . | G1 . D2 . G2 . B1 .',
      'C4 E4 G4 C5 E4 G4 C5 E5 | G3 B3 D4 G4 D4 B3 G3 D4',
      'K.h.S.h.K.h.T.t.',
    ),
    main: makeSection(
      // Base melodic pad is silent; all 3 hub melodies live in dedicated stems!
      [
        '. . . . . . . . | . . . . . . . .',
        '. . . . . . . . | . . . . . . . .',
        '. . . . . . . . | . . . . . . . .',
        '. . . . . . . . | . . . . . . . .',
      ].join(' | '),
      [
        'C2 . C3 . C2 . G2 . | C2 . C3 . G2 . E2 .',
        'A1 . A2 . A1 . E2 . | A1 . A2 . G2 . E2 .',
        'F1 . F2 . F1 . C2 . | F1 . F2 . G2 . A2 .',
        'G1 . G2 . G1 . D2 . | G1 . G2 . B1 . D2 .',
      ].join(' | '),
      [
        '. . . . . . . . | . . . . . . . .',
        '. . . . . . . . | . . . . . . . .',
        '. . . . . . . . | . . . . . . . .',
        '. . . . . . . . | . . . . . . . .',
      ].join(' | '),
      [
        'K.h.S.h.K.h.S.h.',
        'K.h.S.h.K.hKS.h.',
        'K.h.S.h.K.h.S.hH',
        'K.h.S.h.K.h.S.T.',
      ].join(' | '),
    ),
    hubStems: {
      // Command Deck: bright heroic brass-pulse HQ melody (64 steps)
      commandLead: parseNotes(
        [
          'E5 - G5 . C6 - . B5 | G5 - E5 - . . D5 .',
          'C5 - E5 . A5 - . G5 | E5 - C5 - . . G5 .',
          'F5 - A5 . C6 - B5 . | A5 - F5 - . . A5 .',
          'G5 - B5 . D6 - C6 . | B5 - G5 - . . D5 .',
        ].join(' | '),
      ),
      commandArp: parseNotes(
        [
          'C4 E4 G4 C5 G4 E4 C4 G4 | C4 E4 G4 C5 E5 C5 G4 E4',
          'A3 C4 E4 A4 E4 C4 A3 E4 | A3 C4 E4 A4 C5 A4 E4 C4',
          'F3 A3 C4 F4 C4 A3 F3 C4 | F3 A3 C4 F4 A4 F4 C4 A3',
          'G3 B3 D4 G4 D4 B3 G3 D4 | G3 B3 D4 G4 B4 G4 D4 B3',
        ].join(' | '),
      ),
      // Medbay: soothing crystalline triangle-chime harmony (64 steps)
      medbayLead: parseNotes(
        [
          'G5 - - . E5 - . . | G5 - C6 - B5 - . .',
          'E5 - - . C5 - . . | E5 - A5 - G5 - . .',
          'A5 - - . F5 - . . | C6 - A5 - F5 - . .',
          'G5 - - . D5 - . . | B5 - G5 - D5 - . .',
        ].join(' | '),
      ),
      medbayArp: parseNotes(
        [
          'E4 . G4 . B4 . G4 . | C4 . E4 . G4 . E4 .',
          'C4 . E4 . A4 . E4 . | A3 . C4 . E4 . C4 .',
          'A3 . C4 . F4 . C4 . | F3 . A3 . C4 . A3 .',
          'B3 . D4 . G4 . D4 . | G3 . B3 . D4 . B3 .',
        ].join(' | '),
      ),
      // Burst Dojo: energetic martial synth-koto pentatonic riff + crisp snare/tom drive (64 steps)
      dojoLead: parseNotes(
        [
          'C5 D5 E5 G5 A5 . G5 E5 | G5 E5 D5 C5 D5 . E5 G5',
          'A5 G5 E5 D5 C5 . E5 G5 | A5 . C6 A5 G5 E5 D5 C5',
          'F5 G5 A5 C6 D6 . C6 A5 | C6 A5 G5 F5 G5 . A5 C6',
          'G5 A5 B5 D6 C6 . B5 G5 | D5 E5 G5 A5 B5 . G5 .',
        ].join(' | '),
      ),
      dojoArp: parseNotes(
        [
          'C4 G4 C5 G4 E4 G4 C5 G4 | C4 G4 E4 G4 C5 G4 E4 G4',
          'A3 E4 A4 E4 C4 E4 A4 E4 | A3 E4 C4 E4 A4 E4 C4 E4',
          'F3 C4 F4 C4 A3 C4 F4 C4 | F3 C4 A3 C4 F4 C4 A3 C4',
          'G3 D4 G4 D4 B3 D4 G4 D4 | G3 D4 B3 D4 G4 D4 B3 D4',
        ].join(' | '),
      ),
      dojoDrums: parseDrums(
        [
          '.h.h.hT..h.h.hS.',
          '.h.h.hT..h.hR.h.',
          '.h.h.hT..h.h.hS.',
          '.hT.t.h.T.t.R.H.',
        ].join(' | '),
      ),
    },
  },

  // --------------------------------------------------------------------------
  // 3. bgm_tutorial — Upbeat VR Calibration Course (138 BPM, G major)
  // --------------------------------------------------------------------------
  bgm_tutorial: {
    bpm: 138,
    loop: true,
    leadGain: 0.23,
    bassGain: 0.25,
    arpGain: 0.14,
    drumGain: 0.26,
    leadStyle: 'pulse25',
    arpStyle: 'triangle',
    echoMix: 0.12,
    intro: makeSection(
      'D5 . G5 . A5 . B5 . | D6 - B5 . A5 . G5 .',
      'G2 . D2 . G2 . B2 . | D2 . A2 . D3 . F#2 .',
      'G4 B4 D5 G5 B4 D5 G5 B5 | D4 F#4 A4 D5 A4 F#4 D4 A4',
      'K.B.S.h.K.K.T.t.',
    ),
    main: makeSection(
      [
        'G5 . B5 . D6 - B5 . | A5 . G5 . E5 - D5 .',
        'E5 . G5 . B5 - A5 . | G5 - F#5 . E5 - . .',
        'C5 . E5 . G5 - B5 . | A5 . G5 . F#5 - D5 .',
        'G5 . A5 . B5 - D6 . | C6 . B5 . A5 - . .',
      ].join(' | '),
      [
        'G2 . G3 . G2 . D3 . | G2 . G3 . B2 . D3 .',
        'E2 . E3 . E2 . B2 . | E2 . E3 . D2 . B1 .',
        'C2 . C3 . C2 . G2 . | D2 . D3 . D2 . A2 .',
        'G2 . G3 . B2 . G2 . | D2 . D3 . F#2 . D2 .',
      ].join(' | '),
      [
        'G4 B4 D5 G5 D5 B4 G4 D5 | G4 B4 D5 G5 B4 D5 G5 D5',
        'E4 G4 B4 E5 B4 G4 E4 B4 | E4 G4 B4 E5 D4 F#4 A4 D5',
        'C4 E4 G4 C5 G4 E4 C4 G4 | D4 F#4 A4 D5 A4 F#4 D4 A4',
        'G4 B4 D5 G5 D5 B4 G4 D5 | D4 F#4 A4 D5 F#4 A4 D5 A4',
      ].join(' | '),
      [
        'C.h.S.h.K.B.S.h.',
        'K.h.S.h.K.hKT.t.',
        'C.h.S.h.K.B.S.hH',
        'K.h.S.h.T.t.R.h.',
      ].join(' | '),
    ),
  },

  // --------------------------------------------------------------------------
  // 4. bgm_opening — Metro Expressway Overdrive (158 BPM, D minor)
  // --------------------------------------------------------------------------
  bgm_opening: {
    bpm: 158,
    loop: true,
    leadGain: 0.25,
    bassGain: 0.3,
    arpGain: 0.14,
    drumGain: 0.32,
    leadStyle: 'pulse25',
    arpStyle: 'pulse12',
    echoMix: 0.13,
    intro: makeSection(
      [
        'D5 . F5 . A5 . C6 . | D6 - A5 . C6 . A5 G5',
        'F5 . G5 . A5 . Bb5 . | A5 - - . E5 . A5 .',
      ].join(' | '),
      [
        'D2 D2 D3 D2 D2 D2 D3 D2 | C2 C2 C3 C2 Bb1 . C2 .',
        'Bb1 Bb1 Bb2 Bb1 G1 . Bb1 . | A1 A1 A2 A1 C#2 . A1 .',
      ].join(' | '),
      [
        'D4 F4 A4 D5 F4 A4 D5 F5 | C4 E4 G4 C5 Bb3 D4 F4 Bb4',
        'Bb3 D4 F4 Bb4 G3 Bb3 D4 G4 | A3 C#4 E4 A4 E4 C#4 A3 E4',
      ].join(' | '),
      [
        'C.h.S.h.K.hKS.hH',
        'K.h.S.h.T.T.t.R.',
      ].join(' | '),
    ),
    main: makeSection(
      [
        'D5 . F5 . A5 - . G5 | F5 . E5 . D5 . C5 .',
        'Bb4 - D5 . F5 - . E5 | D5 . C5 . A4 - . .',
        'D5 . F5 . A5 . C6 . | D6 - - . C6 . Bb5 .',
        'A5 - G5 . F5 . E5 . | F5 . G5 . A5 - . .',
      ].join(' | '),
      [
        'D2 D2 D3 D2 D2 D2 D3 D2 | D2 D2 D3 D2 C2 . D2 .',
        'Bb1 Bb1 Bb2 Bb1 Bb1 Bb1 Bb2 Bb1 | C2 C2 C3 C2 A1 . C2 .',
        'D2 D2 D3 D2 D2 D2 D3 D2 | Bb1 Bb1 Bb2 Bb1 C2 . D2 .',
        'G1 G1 G2 G1 A1 A1 A2 A1 | A1 A1 A2 A1 C#2 . A1 .',
      ].join(' | '),
      [
        'D4 F4 A4 D5 A4 F4 D4 A4 | D4 F4 A4 D5 A4 F4 C4 G4',
        'Bb3 D4 F4 Bb4 F4 D4 Bb3 F4 | C4 E4 G4 C5 A3 C4 E4 A4',
        'D4 F4 A4 D5 A4 F4 D4 A4 | Bb3 D4 F4 Bb4 C4 E4 G4 C5',
        'G3 Bb3 D4 G4 A3 C#4 E4 A4 | A3 C#4 E4 A4 G4 E4 C#4 A3',
      ].join(' | '),
      [
        'C.hKS.h.K.hKS.hH',
        'K.hKS.h.K.K.T.t.',
        'C.hKS.h.K.hKS.hH',
        'K.K.S.T.t.S.R.H.',
      ].join(' | '),
    ),
  },

  // --------------------------------------------------------------------------
  // 5. bgm_optic — Solar Relay Mirage (150 BPM, F# Phrygian-Dominant / F#m)
  // --------------------------------------------------------------------------
  bgm_optic: {
    bpm: 150,
    loop: true,
    leadGain: 0.24,
    bassGain: 0.28,
    arpGain: 0.16,
    drumGain: 0.3,
    leadStyle: 'pulse25',
    arpStyle: 'pulse12',
    echoMix: 0.18,
    intro: makeSection(
      [
        'F#5 G5 A5 C#6 B5 A5 G5 F#5 | C#6 - B5 . A5 . G5 .',
        'F#5 . G5 . A#5 . C#6 . | C#6 - - . B5 . G5 .',
      ].join(' | '),
      [
        'F#2 . F#3 . F#2 . F#3 . | E2 . E3 . D2 . E2 .',
        'F#2 F#2 F#3 F#2 G2 . F#2 . | C#2 C#2 C#3 C#2 F2 . C#2 .',
      ].join(' | '),
      [
        'F#4 A4 C#5 F#5 G4 B4 D5 G5 | E4 G#4 B4 E5 D4 F#4 A4 D5',
        'F#4 A#4 C#5 F#5 G4 B4 D5 G5 | C#4 F4 G#4 C#5 G#4 F4 C#4 G#4',
      ].join(' | '),
      [
        'C.h.S.h.K.B.S.h.',
        'K.h.S.h.T.t.R.H.',
      ].join(' | '),
    ),
    main: makeSection(
      [
        'F#5 - . G5 A5 - . B5 | C#6 - . B5 A5 . G5 .',
        'F#5 . E5 . D5 - . E5 | F#5 - - . C#5 - . .',
        'D5 - . E5 F#5 . A5 . | B5 - . A5 G5 . F#5 .',
        'G5 - F#5 . E5 . D5 . | C#5 - - . F5 . G#5 .',
      ].join(' | '),
      [
        'F#2 F#2 F#3 F#2 F#2 F#2 F#3 F#2 | F#2 F#2 F#3 F#2 E2 . F#2 .',
        'D2 D2 D3 D2 D2 D2 D3 D2 | C#2 C#2 C#3 C#2 F#2 . C#2 .',
        'D2 D2 D3 D2 D2 D2 D3 D2 | E2 E2 E3 E2 E2 . D2 .',
        'G2 G2 G3 G2 E2 E2 E3 E2 | C#2 C#2 C#3 C#2 C#2 . F2 .',
      ].join(' | '),
      [
        'F#4 A4 C#5 F#5 C#5 A4 F#4 C#5 | F#4 G4 B4 E5 C#5 A4 F#4 C#5',
        'D4 F#4 A4 D5 A4 F#4 D4 A4 | C#4 F4 G#4 C#5 G#4 F4 C#4 G#4',
        'D4 F#4 A4 D5 F#4 A4 D5 F#5 | E4 G4 B4 E5 G4 B4 E5 G5',
        'G4 B4 D5 G5 E4 G4 B4 E5 | C#4 F4 G#4 C#5 F4 G#4 C#5 F5',
      ].join(' | '),
      [
        'C.h.S.h.K.hKS.hH',
        'K.hKS.h.K.h.T.t.',
        'C.h.S.h.K.hKS.hH',
        'K.K.S.K.T.t.R.H.',
      ].join(' | '),
    ),
  },

  // --------------------------------------------------------------------------
  // 6. bgm_patch — Scrap Forge Foundry (144 BPM, A minor industrial stomp)
  // --------------------------------------------------------------------------
  bgm_patch: {
    bpm: 144,
    loop: true,
    leadGain: 0.25,
    bassGain: 0.31,
    arpGain: 0.14,
    drumGain: 0.33,
    leadStyle: 'saw',
    arpStyle: 'pulse12',
    echoMix: 0.12,
    intro: makeSection(
      'A4 . A4 . C5 . D5 Eb5 | E5 - D5 . C5 . G4 .',
      'A1 A1 . A1 C2 . D2 Eb2 | E2 - D2 . C2 . G1 .',
      'A3 C4 E4 A4 A3 C4 E4 A4 | E3 G#3 B3 E4 G3 B3 D4 G4',
      'C.A.S.A.K.K.T.R.',
    ),
    main: makeSection(
      [
        'A4 . C5 . E5 - D5 . | C5 . A4 . G4 . A4 .',
        'C5 . D5 . Eb5 - D5 . | C5 . A4 . E4 - . .',
        'F4 . A4 . C5 - D5 . | E5 - D5 . C5 . B4 .',
        'A4 . G4 . A4 . C5 . | E5 - - . D5 . B4 .',
      ].join(' | '),
      [
        'A1 A1 A2 A1 A1 . G1 . | A1 A1 A2 A1 E2 . G1 .',
        'C2 C2 C3 C2 B1 . A1 . | A1 A1 A2 A1 G1 . E1 .',
        'F1 F1 F2 F1 F1 . G1 . | A1 A1 A2 A1 G1 . F1 .',
        'D1 D1 D2 D1 F1 . G1 . | E1 E1 E2 E1 G#1 . E1 .',
      ].join(' | '),
      [
        'A3 C4 E4 A4 E4 C4 A3 E4 | A3 C4 E4 A4 G3 B3 D4 G4',
        'C4 E4 G4 C5 B3 D4 F4 B4 | A3 C4 E4 A4 E4 C4 A3 E4',
        'F3 A3 C4 F4 C4 A3 F3 C4 | A3 C4 E4 A4 G3 B3 D4 G4',
        'D3 F3 A3 D4 F3 A3 C4 F4 | E3 G#3 B3 E4 B3 G#3 E3 B3',
      ].join(' | '),
      [
        'C.A.S.h.K.K.S.A.',
        'K.A.S.h.K.K.T.t.',
        'C.A.S.h.K.K.S.AH',
        'K.K.S.A.T.t.R.H.',
      ].join(' | '),
    ),
  },

  // --------------------------------------------------------------------------
  // 7. bgm_cooler — Cryo Conduit Drift (142 BPM, Eb minor crystalline bells)
  // --------------------------------------------------------------------------
  bgm_cooler: {
    bpm: 142,
    loop: true,
    leadGain: 0.23,
    bassGain: 0.26,
    arpGain: 0.16,
    drumGain: 0.26,
    leadStyle: 'pulse12',
    arpStyle: 'triangle',
    echoMix: 0.21,
    intro: makeSection(
      [
        'Bb5 . Gb5 . Eb5 . Bb4 . | Db5 . F5 . Ab5 - Gb5 .',
        'B5 . Gb5 . Eb5 . B4 . | Bb4 - D5 . F5 - - .',
      ].join(' | '),
      [
        'Eb2 . Eb3 . Eb2 . Db2 . | Db2 . Db3 . Ab1 . Db2 .',
        'B1 . B2 . B1 . Gb1 . | Bb1 . Bb2 . D2 . Bb1 .',
      ].join(' | '),
      [
        'Eb4 Gb4 Bb4 Eb5 Gb4 Bb4 Eb5 Gb5 | Db4 F4 Ab4 Db5 F4 Ab4 Db5 F5',
        'B3 Eb4 Gb4 B4 Eb4 Gb4 B4 Eb5 | Bb3 D4 F4 Bb4 D4 F4 Bb4 D5',
      ].join(' | '),
      [
        'C.B.S.B.K.h.S.B.',
        'K.B.S.B.K.T.t.H.',
      ].join(' | '),
    ),
    main: makeSection(
      [
        'Eb5 . Gb5 . Bb5 - Ab5 . | Gb5 . F5 . Eb5 - Db5 .',
        'B4 . Eb5 . Gb5 - Ab5 . | Bb5 - - . F5 - . .',
        'Gb5 . Bb5 . Db6 - B5 . | Bb5 . Ab5 . Gb5 - F5 .',
        'Eb5 . F5 . Gb5 - Ab5 . | Bb5 - Ab5 . F5 - . .',
      ].join(' | '),
      [
        'Eb2 . Eb3 Eb2 Eb2 . Db2 . | Eb2 . Eb3 Eb2 Gb2 . F2 .',
        'B1 . B2 B1 B1 . Db2 . | Bb1 . Bb2 Bb1 D2 . Bb1 .',
        'Gb1 . Gb2 Gb1 Gb1 . F1 . | Eb2 . Eb3 Eb2 Db2 . B1 .',
        'Ab1 . Ab2 Ab1 B1 . Db2 . | Bb1 . Bb2 Bb1 D2 . F2 .',
      ].join(' | '),
      [
        'Eb4 Gb4 Bb4 Eb5 Bb4 Gb4 Eb4 Bb4 | Eb4 Gb4 Bb4 Eb5 Db4 F4 Ab4 Db5',
        'B3 Eb4 Gb4 B4 Gb4 Eb4 B3 Gb4 | Bb3 D4 F4 Bb4 F4 D4 Bb3 F4',
        'Gb4 Bb4 Db5 Gb5 Db5 Bb4 Gb4 Db5 | Eb4 Gb4 Bb4 Eb5 Db4 F4 Ab4 Db5',
        'Ab3 B3 Eb4 Ab4 B3 Eb4 Gb4 B4 | Bb3 D4 F4 Bb4 D4 F4 Bb4 D5',
      ].join(' | '),
      [
        'C.B.S.h.K.hKS.BH',
        'K.B.S.h.K.B.T.t.',
        'C.B.S.h.K.hKS.BH',
        'K.h.S.B.T.t.R.H.',
      ].join(' | '),
    ),
  },

  // --------------------------------------------------------------------------
  // 8. bgm_elec — High-Voltage Surge (156 BPM, B minor lightning shredder)
  // --------------------------------------------------------------------------
  bgm_elec: {
    bpm: 156,
    loop: true,
    leadGain: 0.25,
    bassGain: 0.3,
    arpGain: 0.16,
    drumGain: 0.32,
    leadStyle: 'pulse25',
    arpStyle: 'pulse12',
    echoMix: 0.14,
    intro: makeSection(
      [
        'B5 F#5 D5 B4 B5 F#5 D5 B4 | A5 E5 C#5 A4 A5 E5 C#5 A4',
        'G5 D5 B4 G4 A5 E5 C#5 A4 | F#5 - A#5 . C#6 - - .',
      ].join(' | '),
      [
        'B1 B1 B2 B1 B1 B1 B2 B1 | A1 A1 A2 A1 A1 A1 A2 A1',
        'G1 G1 G2 G1 A1 A1 A2 A1 | F#1 F#1 F#2 F#1 A#1 . F#1 .',
      ].join(' | '),
      [
        'B3 D4 F#4 B4 D4 F#4 B4 D5 | A3 C#4 E4 A4 C#4 E4 A4 C#5',
        'G3 B3 D4 G4 A3 C#4 E4 A4 | F#3 A#3 C#4 F#4 C#4 A#3 F#3 C#4',
      ].join(' | '),
      [
        'C.K.S.h.K.K.S.hH',
        'K.K.S.K.T.t.R.R.',
      ].join(' | '),
    ),
    main: makeSection(
      [
        'B4 D5 F#5 B5 A5 F#5 D5 F#5 | G5 . F#5 . E5 . D5 .',
        'E5 G5 B5 E6 D6 B5 G5 B5 | F#5 - E5 . D5 . C#5 .',
        'D5 F#5 A5 D6 C#6 A5 F#5 A5 | B5 - A5 . G5 . F#5 .',
        'G5 . A5 . B5 . C#6 . | A#5 - F#5 . C#6 - B5 .',
      ].join(' | '),
      [
        'B1 B1 B2 B1 B1 B1 B2 B1 | G1 G1 G2 G1 A1 . B1 .',
        'E2 E2 E3 E2 E2 E2 E3 E2 | F#1 F#1 F#2 F#1 A1 . F#1 .',
        'D2 D2 D3 D2 D2 D2 D3 D2 | G1 G1 G2 G1 G1 . F#1 .',
        'E2 E2 E3 E2 G1 G1 G2 G1 | F#1 F#1 F#2 F#1 A#1 . C#2 .',
      ].join(' | '),
      [
        'B3 D4 F#4 B4 F#4 D4 B3 F#4 | G3 B3 D4 G4 A3 C#4 E4 A4',
        'E4 G4 B4 E5 B4 G4 E4 B4 | F#3 A#3 C#4 F#4 C#4 A#3 F#3 C#4',
        'D4 F#4 A4 D5 A4 F#4 D4 A4 | G3 B3 D4 G4 D4 B3 G3 D4',
        'E4 G4 B4 E5 G3 B3 D4 G4 | F#3 A#3 C#4 F#4 A#3 C#4 F#4 A#4',
      ].join(' | '),
      [
        'C.hKS.h.K.hKS.hH',
        'K.hKS.h.K.K.T.t.',
        'C.hKS.h.K.hKS.hH',
        'K.K.S.T.t.S.R.H.',
      ].join(' | '),
    ),
  },

  // --------------------------------------------------------------------------
  // 9. bgm_shift — Skyway Convoy Run (152 BPM, F minor soaring aerial gallop)
  // --------------------------------------------------------------------------
  bgm_shift: {
    bpm: 152,
    loop: true,
    leadGain: 0.24,
    bassGain: 0.28,
    arpGain: 0.15,
    drumGain: 0.3,
    leadStyle: 'pulse25',
    arpStyle: 'saw',
    echoMix: 0.15,
    intro: makeSection(
      [
        'C5 . F5 . G5 . Ab5 . | C6 - Bb5 . Ab5 . G5 .',
        'F5 . G5 . Ab5 . Bb5 . | C6 - - . G5 . E5 .',
      ].join(' | '),
      [
        'F2 . F2 F3 F2 . Eb2 . | Db2 . Db2 Db3 Db2 . Eb2 .',
        'Bb1 . Bb1 Bb2 Bb1 . Db2 . | C2 C2 C3 C2 E2 . C2 .',
      ].join(' | '),
      [
        'F4 Ab4 C5 F5 Ab4 C5 F5 Ab5 | Db4 F4 Ab4 Db5 Eb4 G4 Bb4 Eb5',
        'Bb3 Db4 F4 Bb4 Db4 F4 Ab4 Db5 | C4 E4 G4 C5 G4 E4 C4 G4',
      ].join(' | '),
      [
        'C.B.S.B.K.hKS.BH',
        'K.B.S.B.T.t.R.H.',
      ].join(' | '),
    ),
    main: makeSection(
      [
        'F5 - Ab5 . C6 - Bb5 . | Ab5 . G5 . F5 . Eb5 .',
        'Db5 - F5 . Ab5 - G5 . | F5 - Eb5 . C5 - . .',
        'Bb4 . Db5 . F5 . Ab5 . | G5 - Bb5 . Eb6 - Db6 .',
        'C6 - Bb5 . Ab5 . G5 . | C6 - - . G5 . E5 .',
      ].join(' | '),
      [
        'F2 F2 F3 F2 F2 . Eb2 . | F2 F2 F3 F2 Ab2 . G2 .',
        'Db2 Db2 Db3 Db2 Db2 . Eb2 . | C2 C2 C3 C2 G1 . C2 .',
        'Bb1 Bb1 Bb2 Bb1 Bb1 . Db2 . | Eb2 Eb2 Eb3 Eb2 G2 . Eb2 .',
        'Ab1 Ab1 Ab2 Ab1 Bb1 . Db2 . | C2 C2 C3 C2 E2 . C2 .',
      ].join(' | '),
      [
        'F4 Ab4 C5 F5 C5 Ab4 F4 C5 | F4 Ab4 C5 F5 Eb4 G4 Bb4 Eb5',
        'Db4 F4 Ab4 Db5 Ab4 F4 Db4 Ab4 | C4 E4 G4 C5 G4 E4 C4 G4',
        'Bb3 Db4 F4 Bb4 F4 Db4 Bb3 F4 | Eb4 G4 Bb4 Eb5 Bb4 G4 Eb4 Bb4',
        'Ab3 C4 Eb4 Ab4 Bb3 Db4 F4 Bb4 | C4 E4 G4 C5 E4 G4 C5 E5',
      ].join(' | '),
      [
        'C.B.S.h.K.hKS.BH',
        'K.K.S.B.K.h.T.t.',
        'C.B.S.h.K.hKS.BH',
        'K.K.S.B.T.t.R.H.',
      ].join(' | '),
    ),
  },

  // --------------------------------------------------------------------------
  // 10. bgm_wave — Neon Pulse Frequency (148 BPM, C# minor synth-disco pulse)
  // --------------------------------------------------------------------------
  bgm_wave: {
    bpm: 148,
    loop: true,
    leadGain: 0.24,
    bassGain: 0.29,
    arpGain: 0.16,
    drumGain: 0.31,
    leadStyle: 'pulse12',
    arpStyle: 'pulse12',
    echoMix: 0.18,
    intro: makeSection(
      [
        'G#5 . . E5 . G#5 . B5 | C#6 - B5 . G#5 . F#5 .',
        'E5 . . C#5 . E5 . F#5 | G#5 - - . D#5 . G#5 .',
      ].join(' | '),
      [
        'C#2 C#3 C#2 C#3 B1 B2 B1 B2 | A1 A2 A1 A2 B1 B2 B1 B2',
        'C#2 C#3 C#2 C#3 E2 E3 E2 E3 | G#1 G#2 G#1 G#2 G#1 . C2 .',
      ].join(' | '),
      [
        'C#4 E4 G#4 C#5 B3 D#4 F#4 B4 | A3 C#4 E4 A4 B3 D#4 F#4 B4',
        'C#4 E4 G#4 C#5 E4 G#4 B4 E5 | G#3 C4 D#4 G#4 D#4 C4 G#3 D#4',
      ].join(' | '),
      [
        'X.h.Y.B.X.h.Y.BH',
        'X.h.Y.B.X.T.t.R.',
      ].join(' | '),
    ),
    main: makeSection(
      [
        'C#5 . E5 . G#5 - F#5 . | E5 . D#5 . C#5 - B4 .',
        'A4 . C#5 . E5 - F#5 . | G#5 - F#5 . D#5 - . .',
        'C#5 . E5 . G#5 . B5 . | C#6 - B5 . A5 . G#5 .',
        'F#5 . G#5 . A5 - B5 . | G#5 - - . D#5 . C5 .',
      ].join(' | '),
      [
        'C#2 C#3 C#2 C#3 C#2 C#3 B1 B2 | C#2 C#3 C#2 C#3 E2 E3 D#2 D#3',
        'A1 A2 A1 A2 A1 A2 B1 B2 | G#1 G#2 G#1 G#2 C2 C3 G#1 G#2',
        'C#2 C#3 C#2 C#3 B1 B2 B1 B2 | A1 A2 A1 A2 G#1 G#2 F#1 F#2',
        'F#1 F#2 F#1 F#2 A1 A2 B1 B2 | G#1 G#2 G#1 G#2 C2 . G#1 .',
      ].join(' | '),
      [
        'C#4 E4 G#4 C#5 G#4 E4 C#4 G#4 | C#4 E4 G#4 C#5 B3 D#4 F#4 B4',
        'A3 C#4 E4 A4 E4 C#4 A3 E4 | G#3 C4 D#4 G#4 D#4 C4 G#3 D#4',
        'C#4 E4 G#4 C#5 B3 D#4 F#4 B4 | A3 C#4 E4 A4 G#3 B3 E4 G#4',
        'F#3 A3 C#4 F#4 A3 C#4 E4 A4 | G#3 C4 D#4 G#4 C4 D#4 G#4 C5',
      ].join(' | '),
      [
        'C.h.Y.B.X.h.Y.BH',
        'X.h.Y.B.X.hKT.t.',
        'C.h.Y.B.X.h.Y.BH',
        'X.h.Y.B.T.t.R.H.',
      ].join(' | '),
    ),
  },

  // --------------------------------------------------------------------------
  // 11. bgm_break — Basalt Quarry Breaker (140 BPM, G minor heavy metal stomp)
  // --------------------------------------------------------------------------
  bgm_break: {
    bpm: 140,
    loop: true,
    leadGain: 0.25,
    bassGain: 0.33,
    arpGain: 0.13,
    drumGain: 0.35,
    leadStyle: 'saw',
    arpStyle: 'triangle',
    echoMix: 0.11,
    intro: makeSection(
      'G4 . G4 . Bb4 . C5 Db5 | D5 - C5 . Bb4 . F4 .',
      'G1 G1 . G1 Bb1 . C2 Db2 | D2 - C2 . Bb1 . F1 .',
      'G3 Bb3 D4 G4 G3 Bb3 D4 G4 | D3 F#3 A3 D4 F3 A3 C4 F4',
      'C.K.S.A.K.T.t.R.',
    ),
    main: makeSection(
      [
        'G4 - Bb4 . D5 - C5 . | Bb4 . A4 . G4 - F4 .',
        'Eb4 - G4 . Bb4 - A4 . | D5 - C5 . A4 - F#4 .',
        'G4 . Bb4 . D5 . F5 . | G5 - F5 . Eb5 . D5 .',
        'C5 - Bb4 . A4 . G4 . | D5 - - . F#4 . A4 .',
      ].join(' | '),
      [
        'G1 G1 G2 G1 G1 . F1 . | G1 G1 G2 G1 Bb1 . A1 .',
        'Eb1 Eb1 Eb2 Eb1 Eb1 . F1 . | D1 D1 D2 D1 F#1 . D1 .',
        'G1 G1 G2 G1 F1 . G1 . | Eb1 Eb1 Eb2 Eb1 D1 . C1 .',
        'C2 C2 C3 C2 A1 . G1 . | D1 D1 D2 D1 F#1 . A1 .',
      ].join(' | '),
      [
        'G3 Bb3 D4 G4 D4 Bb3 G3 D4 | G3 Bb3 D4 G4 F3 A3 C4 F4',
        'Eb3 G3 Bb3 Eb4 Bb3 G3 Eb3 Bb3 | D3 F#3 A3 D4 A3 F#3 D3 A3',
        'G3 Bb3 D4 G4 F3 A3 C4 F4 | Eb3 G3 Bb3 Eb4 D3 F3 A3 D4',
        'C4 Eb4 G4 C5 A3 C4 Eb4 A4 | D3 F#3 A3 D4 F#3 A3 D4 F#4',
      ].join(' | '),
      [
        'C.K.S.A.K.K.S.t.',
        'K.K.S.A.K.T.t.H.',
        'C.K.S.A.K.K.S.t.',
        'K.A.S.K.T.t.R.H.',
      ].join(' | '),
    ),
  },

  // --------------------------------------------------------------------------
  // 12. bgm_cipher — Cipher Matrix Infiltration (154 BPM, Ab minor stealth-tech)
  // --------------------------------------------------------------------------
  bgm_cipher: {
    bpm: 154,
    loop: true,
    leadGain: 0.23,
    bassGain: 0.28,
    arpGain: 0.16,
    drumGain: 0.3,
    leadStyle: 'pulse12',
    arpStyle: 'pulse12',
    echoMix: 0.17,
    intro: makeSection(
      [
        'Eb6 . B5 . Ab5 . Eb5 . | E5 . Ab5 . B5 . Db6 .',
        'Eb6 . Db6 . B5 . Bb5 . | Eb5 - G5 . Bb5 - - .',
      ].join(' | '),
      [
        'Ab1 . Ab2 . Ab1 . Gb1 . | E1 . E2 . E1 . Gb1 .',
        'Ab1 . Ab2 . B1 . Bb1 . | Eb1 Eb1 Eb2 Eb1 G1 . Eb1 .',
      ].join(' | '),
      [
        'Ab4 B4 Eb5 Ab5 Eb5 B4 Ab4 Eb5 | E4 Ab4 B4 E5 B4 Ab4 E4 B4',
        'Ab4 B4 Eb5 Ab5 Gb4 Bb4 Db5 Gb5 | Eb4 G4 Bb4 Eb5 Bb4 G4 Eb4 Bb4',
      ].join(' | '),
      [
        'C.B.h.B.K.h.S.B.',
        'K.B.S.h.T.t.R.H.',
      ].join(' | '),
    ),
    main: makeSection(
      [
        'Ab5 . B5 . Eb6 - Db6 . | B5 . Bb5 . Ab5 - Gb5 .',
        'E5 . Ab5 . B5 - Db6 . | Eb6 - Db6 . Bb5 - . .',
        'Ab5 . . B5 Db6 . Eb6 . | Gb6 - E6 . Eb6 . Db6 .',
        'B5 . Db6 . Eb6 - B5 . | Bb5 - G5 . Eb5 - . .',
      ].join(' | '),
      [
        'Ab1 Ab1 Ab2 Ab1 Ab1 . Gb1 . | Ab1 Ab1 Ab2 Ab1 B1 . Bb1 .',
        'E1 E1 E2 E1 E1 . Gb1 . | Eb1 Eb1 Eb2 Eb1 G1 . Eb1 .',
        'Ab1 Ab1 Ab2 Ab1 Gb1 . Ab1 . | E1 E1 E2 E1 Gb1 . Ab1 .',
        'B1 B1 B2 B1 E1 . Gb1 . | Eb1 Eb1 Eb2 Eb1 G1 . Bb1 .',
      ].join(' | '),
      [
        'Ab4 B4 Eb5 Ab5 Eb5 B4 Ab4 Eb5 | Ab4 B4 Eb5 Ab5 Gb4 Bb4 Db5 Gb5',
        'E4 Ab4 B4 E5 B4 Ab4 E4 B4 | Eb4 G4 Bb4 Eb5 Bb4 G4 Eb4 Bb4',
        'Ab4 B4 Eb5 Ab5 Gb4 Bb4 Db5 Gb5 | E4 Ab4 B4 E5 Gb4 Bb4 Db5 Gb5',
        'B3 Eb4 Gb4 B4 E4 Ab4 B4 E5 | Eb4 G4 Bb4 Eb5 G4 Bb4 Eb5 G5',
      ].join(' | '),
      [
        'C.hKS.B.K.hKS.BH',
        'K.h.S.B.K.K.T.t.',
        'C.hKS.B.K.hKS.BH',
        'K.h.S.T.t.S.R.H.',
      ].join(' | '),
    ),
  },

  // --------------------------------------------------------------------------
  // 13. bgm_final_1 — Citadel Perimeter (160 BPM, D minor fortress assault)
  // --------------------------------------------------------------------------
  bgm_final_1: {
    bpm: 160,
    loop: true,
    leadGain: 0.26,
    bassGain: 0.31,
    arpGain: 0.15,
    drumGain: 0.33,
    leadStyle: 'pulse25',
    arpStyle: 'pulse12',
    echoMix: 0.14,
    intro: makeSection(
      [
        'D5 . . A5 Bb5 - A5 . | G5 . F5 . E5 . A5 .',
        'D6 - C6 . Bb5 . A5 . | G5 . F5 . E5 - A5 .',
      ].join(' | '),
      [
        'D2 D2 D3 D2 Bb1 Bb1 Bb2 Bb1 | G1 G1 G2 G1 A1 . C#2 .',
        'D2 D2 D3 D2 C2 C2 C3 C2 | Bb1 Bb1 Bb2 Bb1 A1 . C#2 .',
      ].join(' | '),
      [
        'D4 F4 A4 D5 Bb3 D4 F4 Bb4 | G3 Bb3 D4 G4 A3 C#4 E4 A4',
        'D4 F4 A4 D5 C4 E4 G4 C5 | Bb3 D4 F4 Bb4 A3 C#4 E4 A4',
      ].join(' | '),
      [
        'C.K.S.h.K.K.S.hH',
        'K.K.S.K.T.t.R.R.',
      ].join(' | '),
    ),
    main: makeSection(
      [
        'D5 . A5 . Bb5 - A5 . | G5 . F5 . E5 - D5 .',
        'C5 . G5 . A5 - G5 . | F5 . E5 . A5 - C#6 .',
        'D6 . C6 . Bb5 - A5 . | G5 . A5 . Bb5 - D6 .',
        'C6 . Bb5 . A5 - G5 . | E5 - G5 . A5 - C#6 .',
      ].join(' | '),
      [
        'D2 D2 D3 D2 D2 D2 D3 D2 | Bb1 Bb1 Bb2 Bb1 Bb1 . A1 .',
        'C2 C2 C3 C2 C2 C2 C3 C2 | A1 A1 A2 A1 A1 . C#2 .',
        'D2 D2 D3 D2 C2 C2 C3 C2 | Bb1 Bb1 Bb2 Bb1 G1 . Bb1 .',
        'C2 C2 C3 C2 A1 A1 A2 A1 | A1 A1 A2 A1 C#2 . E2 .',
      ].join(' | '),
      [
        'D4 F4 A4 D5 A4 F4 D4 A4 | Bb3 D4 F4 Bb4 F4 D4 Bb3 F4',
        'C4 E4 G4 C5 G4 E4 C4 G4 | A3 C#4 E4 A4 E4 C#4 A3 E4',
        'D4 F4 A4 D5 C4 E4 G4 C5 | Bb3 D4 F4 Bb4 G3 Bb3 D4 G4',
        'C4 E4 G4 C5 A3 C#4 E4 A4 | A3 C#4 E4 A4 C#4 E4 A4 C#5',
      ].join(' | '),
      [
        'C.K.S.h.K.K.S.hH',
        'K.K.S.h.K.K.T.t.',
        'C.K.S.K.K.K.S.hH',
        'K.K.S.T.t.S.R.H.',
      ].join(' | '),
    ),
  },

  // --------------------------------------------------------------------------
  // 14. bgm_final_2 — Reactor Core Ascent (162 BPM, F# minor — 100% original!)
  // --------------------------------------------------------------------------
  bgm_final_2: {
    bpm: 162,
    loop: true,
    leadGain: 0.26,
    bassGain: 0.31,
    arpGain: 0.16,
    drumGain: 0.33,
    leadStyle: 'saw',
    arpStyle: 'pulse12',
    echoMix: 0.15,
    intro: makeSection(
      [
        'F#5 . C#5 . G5 . C#5 . | G#5 . C#5 . A5 . G#5 .',
        'F#5 . E5 . D5 . C#5 . | B4 . D5 . C#5 - F5 .',
      ].join(' | '),
      [
        'F#2 F#2 F#3 F#2 G2 G2 G3 G2 | G#2 G#2 G#3 G#2 A2 . G#2 .',
        'F#2 F#2 E2 E2 D2 D2 C#2 C#2 | B1 B1 B2 B1 C#2 . F2 .',
      ].join(' | '),
      [
        'F#4 A4 C#5 F#5 G4 B4 D5 G5 | G#4 B4 D5 G#5 A4 C#5 E5 A5',
        'F#4 A4 C#5 F#5 D4 F#4 A4 D5 | B3 D4 F#4 B4 C#4 F4 G#4 C#5',
      ].join(' | '),
      [
        'C.K.S.A.K.K.S.A.',
        'K.S.K.S.T.t.R.R.',
      ].join(' | '),
    ),
    main: makeSection(
      [
        'F#5 . A5 . C#6 - B5 . | A5 . G#5 . F#5 . E5 .',
        'D5 . F#5 . B5 - A5 . | G#5 - F#5 . F5 - G#5 .',
        'A5 . B5 . C#6 - D6 . | E6 - D6 . C#6 . B5 .',
        'A5 . G#5 . F#5 - D5 . | C#5 - F5 . G#5 - C#6 .',
      ].join(' | '),
      [
        'F#2 F#2 F#3 F#2 F#2 F#2 F#3 F#2 | E2 E2 E3 E2 D2 . E2 .',
        'D2 D2 D3 D2 B1 B1 B2 B1 | C#2 C#2 C#3 C#2 F2 . G#2 .',
        'A1 A1 A2 A1 B1 B1 B2 B1 | C#2 C#2 C#3 C#2 E2 . D2 .',
        'D2 D2 D3 D2 B1 B1 B2 B1 | C#2 C#2 C#3 C#2 F2 . C#2 .',
      ].join(' | '),
      [
        'F#4 A4 C#5 F#5 C#5 A4 F#4 C#5 | E4 G#4 B4 E5 D4 F#4 A4 D5',
        'D4 F#4 A4 D5 B3 D4 F#4 B4 | C#4 F4 G#4 C#5 G#4 F4 C#4 G#4',
        'A3 C#4 E4 A4 B3 D4 F#4 B4 | C#4 E4 G#4 C#5 E4 G#4 B4 E5',
        'D4 F#4 A4 D5 B3 D4 F#4 B4 | C#4 F4 G#4 C#5 F4 G#4 C#5 F5',
      ].join(' | '),
      [
        'C.K.S.K.K.K.S.AH',
        'K.K.S.K.T.t.S.A.',
        'C.K.S.K.K.K.S.AH',
        'K.S.K.S.T.t.R.H.',
      ].join(' | '),
    ),
  },

  // --------------------------------------------------------------------------
  // 15. bgm_final_3 — Orbital Spire Zenith (166 BPM, E minor heroic finale)
  // --------------------------------------------------------------------------
  bgm_final_3: {
    bpm: 166,
    loop: true,
    leadGain: 0.27,
    bassGain: 0.31,
    arpGain: 0.16,
    drumGain: 0.34,
    leadStyle: 'pulse25',
    arpStyle: 'pulse12',
    echoMix: 0.16,
    intro: makeSection(
      [
        'B5 . E6 . F#6 - G6 . | F#6 . E6 . D6 . B5 .',
        'C6 . B5 . A5 . G5 . | F#5 - A5 . B5 - D#6 .',
      ].join(' | '),
      [
        'E2 E2 E3 E2 D2 D2 D3 D2 | C2 C2 C3 C2 B1 . D2 .',
        'A1 A1 A2 A1 C2 C2 C3 C2 | B1 B1 B2 B1 D#2 . F#2 .',
      ].join(' | '),
      [
        'E4 G4 B4 E5 D4 F#4 A4 D5 | C4 E4 G4 C5 B3 D4 G4 B4',
        'A3 C4 E4 A4 C4 E4 G4 C5 | B3 D#4 F#4 B4 D#4 F#4 B4 D#5',
      ].join(' | '),
      [
        'C.K.S.K.K.K.S.hH',
        'K.K.S.K.T.t.R.R.',
      ].join(' | '),
    ),
    main: makeSection(
      [
        'E5 . B5 . E6 - D6 . | C6 . B5 . A5 - G5 .',
        'A5 . C6 . E6 - D6 . | B5 - A5 . F#5 - B5 .',
        'G5 . B5 . D6 - G6 . | F#6 . E6 . D6 - C6 .',
        'B5 . C6 . D6 - E6 . | F#6 - D#6 . B5 - . .',
      ].join(' | '),
      [
        'E2 E2 E3 E2 E2 E2 E3 E2 | C2 C2 C3 C2 C2 . D2 .',
        'A1 A1 A2 A1 A1 . C2 . | B1 B1 B2 B1 D#2 . B1 .',
        'G2 G2 G3 G2 G2 G2 G3 G2 | D2 D2 D3 D2 C2 . D2 .',
        'C2 C2 C3 C2 A1 A1 A2 A1 | B1 B1 B2 B1 D#2 . F#2 .',
      ].join(' | '),
      [
        'E4 G4 B4 E5 B4 G4 E4 B4 | C4 E4 G4 C5 G4 E4 C4 G4',
        'A3 C4 E4 A4 E4 C4 A3 E4 | B3 D#4 F#4 B4 F#4 D#4 B3 F#4',
        'G4 B4 D5 G5 D5 B4 G4 D5 | D4 F#4 A4 D5 C4 E4 G4 C5',
        'C4 E4 G4 C5 A3 C4 E4 A4 | B3 D#4 F#4 B4 D#4 F#4 B4 D#5',
      ].join(' | '),
      [
        'C.K.S.K.K.K.S.hH',
        'K.K.S.K.K.K.T.t.',
        'C.K.S.K.K.K.S.hH',
        'K.K.S.T.t.S.R.H.',
      ].join(' | '),
    ),
  },

  // --------------------------------------------------------------------------
  // 16. bgm_boss_opening — Armored Siege Intercept (164 BPM, C minor)
  // --------------------------------------------------------------------------
  bgm_boss_opening: {
    bpm: 164,
    loop: true,
    leadGain: 0.26,
    bassGain: 0.32,
    arpGain: 0.14,
    drumGain: 0.34,
    leadStyle: 'saw',
    arpStyle: 'pulse12',
    echoMix: 0.12,
    intro: makeSection(
      [
        'C5 . C5 . F#5 - . . | C5 . C5 . G5 . F#5 .',
        'Eb5 . D5 . C5 . Bb4 . | G5 - F#5 . G5 - B5 .',
      ].join(' | '),
      [
        'C2 C2 C2 C2 F#2 . C2 . | C2 C2 C2 C2 G2 . F#2 .',
        'Ab1 Ab1 Ab2 Ab1 F1 . Ab1 . | G1 G1 G2 G1 B1 . G1 .',
      ].join(' | '),
      [
        'C4 Eb4 G4 C5 C4 Eb4 F#4 C5 | C4 Eb4 G4 C5 G4 F#4 Eb4 C4',
        'Ab3 C4 Eb4 Ab4 F3 Ab3 C4 F4 | G3 B3 D4 G4 B3 D4 G4 B4',
      ].join(' | '),
      [
        'C.K.S.A.K.K.S.A.',
        'K.K.S.K.T.t.R.R.',
      ].join(' | '),
    ),
    main: makeSection(
      [
        'C5 . Eb5 . F5 F#5 G5 . | Bb5 . G5 . F#5 . F5 .',
        'Eb5 . C5 . Bb4 . C5 . | G4 - - . G4 . B4 .',
        'C5 . Eb5 . G5 . Bb5 . | C6 - Bb5 . Ab5 . G5 .',
        'F#5 - F5 . Eb5 . D5 . | G5 - - . F#5 . G5 .',
      ].join(' | '),
      [
        'C2 C2 C3 C2 C2 C2 C3 C2 | C2 C2 C3 C2 Bb1 . G1 .',
        'Ab1 Ab1 Ab2 Ab1 Ab1 Ab1 Ab2 Ab1 | G1 G1 G2 G1 G1 . B1 .',
        'C2 C2 C3 C2 C2 C2 C3 C2 | Ab1 Ab1 Ab2 Ab1 Bb1 . C2 .',
        'F#1 F#1 F#2 F#1 F1 F1 F2 F1 | G1 G1 G2 G1 G1 . B1 .',
      ].join(' | '),
      [
        'C4 Eb4 G4 C5 G4 Eb4 C4 G4 | C4 Eb4 F#4 C5 F#4 Eb4 C4 G4',
        'Ab3 C4 Eb4 Ab4 Eb4 C4 Ab3 Eb4 | G3 B3 D4 G4 D4 B3 G3 D4',
        'C4 Eb4 G4 C5 G4 Eb4 C4 G4 | Ab3 C4 Eb4 Ab4 Bb3 D4 F4 Bb4',
        'F#3 A3 C4 F#4 F3 Ab3 C4 F4 | G3 B3 D4 G4 B3 D4 G4 B4',
      ].join(' | '),
      [
        'C.K.S.K.K.K.S.AH',
        'K.K.S.K.T.t.S.R.',
        'C.K.S.K.K.K.S.AH',
        'K.S.K.S.T.t.R.H.',
      ].join(' | '),
    ),
  },

  // --------------------------------------------------------------------------
  // 17. bgm_boss_master — Circuit Master Showdown (168 BPM, E minor)
  // --------------------------------------------------------------------------
  bgm_boss_master: {
    bpm: 168,
    loop: true,
    leadGain: 0.26,
    bassGain: 0.32,
    arpGain: 0.16,
    drumGain: 0.34,
    leadStyle: 'pulse25',
    arpStyle: 'pulse12',
    echoMix: 0.14,
    intro: makeSection(
      [
        'E5 F#5 G5 A5 B5 A5 G5 F#5 | E5 G5 B5 E6 D6 B5 A5 G5',
        'C6 B5 A5 G5 F#5 G5 A5 C6 | B5 - - . D#6 . B5 .',
      ].join(' | '),
      [
        'E2 E2 E3 E2 E2 E2 E3 E2 | D2 D2 D3 D2 B1 B1 D2 B1',
        'C2 C2 C3 C2 A1 A1 A2 A1 | B1 B1 B2 B1 D#2 . F#2 .',
      ].join(' | '),
      [
        'E4 G4 B4 E5 G4 B4 E5 G5 | D4 F#4 A4 D5 B3 D4 F#4 B4',
        'C4 E4 G4 C5 A3 C4 E4 A4 | B3 D#4 F#4 B4 D#4 F#4 B4 D#5',
      ].join(' | '),
      [
        'C.K.S.K.K.K.S.hH',
        'K.K.S.T.t.S.R.R.',
      ].join(' | '),
    ),
    main: makeSection(
      [
        'E5 . B5 . A5 . G5 . | F#5 . G5 . A5 . B5 .',
        'C6 - B5 . A5 . G5 . | F#5 - - . D#5 . F#5 .',
        'E5 . G5 . B5 . E6 . | D6 - C6 . B5 . A5 .',
        'G5 . A5 . B5 . C6 . | B5 - - . A5 . F#5 .',
      ].join(' | '),
      [
        'E2 E2 E3 E2 E2 E2 E3 E2 | D2 D2 D3 D2 D2 D2 D3 D2',
        'C2 C2 C3 C2 C2 C2 C3 C2 | B1 B1 B2 B1 B1 . D#2 .',
        'E2 E2 E3 E2 E2 E2 E3 E2 | G2 G2 G3 G2 F#2 . E2 .',
        'C2 C2 C3 C2 D2 D2 D3 D2 | B1 B1 B2 B1 B1 . D#2 .',
      ].join(' | '),
      [
        'E4 G4 B4 E5 B4 G4 E4 B4 | D4 F#4 A4 D5 A4 F#4 D4 A4',
        'C4 E4 G4 C5 G4 E4 C4 G4 | B3 D#4 F#4 B4 F#4 D#4 B3 F#4',
        'E4 G4 B4 E5 G4 B4 E5 G5 | G4 B4 D5 G5 F#4 A4 D5 F#5',
        'C4 E4 G4 C5 D4 F#4 A4 D5 | B3 D#4 F#4 B4 D#4 F#4 B4 D#5',
      ].join(' | '),
      [
        'C.K.S.K.K.K.S.hH',
        'K.K.S.K.T.t.R.K.',
        'C.K.S.K.K.K.S.hH',
        'K.S.T.t.S.R.R.H.',
      ].join(' | '),
    ),
  },

  // --------------------------------------------------------------------------
  // 18. bgm_boss_final_1 — Mirror Signal Duel (166 BPM, C# minor rival duel)
  // --------------------------------------------------------------------------
  bgm_boss_final_1: {
    bpm: 166,
    loop: true,
    leadGain: 0.27,
    bassGain: 0.32,
    arpGain: 0.16,
    drumGain: 0.34,
    leadStyle: 'saw',
    arpStyle: 'pulse12',
    echoMix: 0.14,
    intro: makeSection(
      [
        'C#6 . G#5 . E5 . C#5 . | D#5 . F#5 . G#5 . B5 .',
        'C#6 . B5 . A5 . G#5 . | G5 . G#5 . C6 - G#5 .',
      ].join(' | '),
      [
        'C#2 C#2 C#3 C#2 B1 B1 B2 B1 | A1 A1 A2 A1 B1 . C#2 .',
        'F#1 F#1 F#2 F#1 A1 A1 A2 A1 | G#1 G#1 G#2 G#1 C2 . G#1 .',
      ].join(' | '),
      [
        'C#4 E4 G#4 C#5 B3 D#4 F#4 B4 | A3 C#4 E4 A4 B3 D#4 F#4 B4',
        'F#3 A3 C#4 F#4 A3 C#4 E4 A4 | G#3 C4 D#4 G#4 C4 D#4 G#4 C5',
      ].join(' | '),
      [
        'C.K.S.K.K.K.S.hH',
        'K.S.K.S.T.t.R.R.',
      ].join(' | '),
    ),
    main: makeSection(
      [
        'C#5 . E5 . G#5 . B5 . | C#6 - B5 . A5 . G#5 .',
        'F#5 . A5 . C#6 . B5 . | G#5 - F#5 . D#5 . G#5 .',
        'E5 . G#5 . B5 . E6 . | D#6 - C#6 . B5 . A5 .',
        'G#5 . A5 . B5 . C#6 . | C6 - G#5 . D#5 - G#5 .',
      ].join(' | '),
      [
        'C#2 C#2 C#3 C#2 C#2 C#2 C#3 C#2 | A1 A1 A2 A1 B1 . C#2 .',
        'F#1 F#1 F#2 F#1 F#1 . A1 . | G#1 G#1 G#2 G#1 C2 . G#1 .',
        'E2 E2 E3 E2 E2 E2 E3 E2 | B1 B1 B2 B1 A1 . G#1 .',
        'F#1 F#1 F#2 F#1 A1 A1 A2 A1 | G#1 G#1 G#2 G#1 C2 . D#2 .',
      ].join(' | '),
      [
        'C#4 E4 G#4 C#5 G#4 E4 C#4 G#4 | A3 C#4 E4 A4 B3 D#4 F#4 B4',
        'F#3 A3 C#4 F#4 C#4 A3 F#3 C#4 | G#3 C4 D#4 G#4 D#4 C4 G#3 D#4',
        'E4 G#4 B4 E5 B4 G#4 E4 B4 | B3 D#4 F#4 B4 A3 C#4 E4 A4',
        'F#3 A3 C#4 F#4 A3 C#4 E4 A4 | G#3 C4 D#4 G#4 C4 D#4 G#4 C5',
      ].join(' | '),
      [
        'C.K.S.K.K.K.S.hH',
        'K.K.S.K.T.t.S.R.',
        'C.K.S.K.K.K.S.hH',
        'K.S.T.t.S.R.R.H.',
      ].join(' | '),
    ),
  },

  // --------------------------------------------------------------------------
  // 19. bgm_boss_final_2 — Prism Core Overload (164 BPM, Bb minor crystalline)
  // --------------------------------------------------------------------------
  bgm_boss_final_2: {
    bpm: 164,
    loop: true,
    leadGain: 0.26,
    bassGain: 0.32,
    arpGain: 0.17,
    drumGain: 0.34,
    leadStyle: 'pulse12',
    arpStyle: 'pulse12',
    echoMix: 0.18,
    intro: makeSection(
      [
        'Bb5 Db6 F6 Bb6 Ab6 F6 Db6 F6 | Gb6 F6 Eb6 Db6 C6 Db6 Eb6 Gb6',
        'F6 . Eb6 . Db6 . C6 . | A5 - C6 . F6 - - .',
      ].join(' | '),
      [
        'Bb1 Bb1 Bb2 Bb1 Ab1 Ab1 Ab2 Ab1 | Gb1 Gb1 Gb2 Gb1 Eb1 . Gb1 .',
        'F1 F1 F2 F1 Gb1 Gb1 Gb2 Gb1 | F1 F1 F2 F1 A1 . C2 .',
      ].join(' | '),
      [
        'Bb4 Db5 F5 Bb5 Ab4 C5 Eb5 Ab5 | Gb4 Bb4 Db5 Gb5 Eb4 Gb4 Bb4 Eb5',
        'F4 A4 C5 F5 Gb4 Bb4 Db5 Gb5 | F4 A4 C5 F5 A4 C5 F5 A5',
      ].join(' | '),
      [
        'C.B.S.K.K.K.S.BH',
        'K.K.S.B.T.t.R.R.',
      ].join(' | '),
    ),
    main: makeSection(
      [
        'Bb5 . Db6 . F6 - Eb6 . | Db6 . C6 . Bb5 . Ab5 .',
        'Gb5 . Bb5 . Db6 - C6 . | F6 - Eb6 . C6 - A5 .',
        'Bb5 . F6 . Gb6 - F6 . | Eb6 . Db6 . C6 - Bb5 .',
        'Ab5 . Bb5 . C6 - Db6 . | F6 - C6 . A5 - F5 .',
      ].join(' | '),
      [
        'Bb1 Bb1 Bb2 Bb1 Bb1 Bb1 Bb2 Bb1 | Ab1 Ab1 Ab2 Ab1 Ab1 . Bb1 .',
        'Gb1 Gb1 Gb2 Gb1 Gb1 . Ab1 . | F1 F1 F2 F1 A1 . F1 .',
        'Bb1 Bb1 Bb2 Bb1 Gb1 Gb1 Gb2 Gb1 | Eb1 Eb1 Eb2 Eb1 F1 . Gb1 .',
        'Ab1 Ab1 Ab2 Ab1 Gb1 Gb1 Gb2 Gb1 | F1 F1 F2 F1 A1 . C2 .',
      ].join(' | '),
      [
        'Bb4 Db5 F5 Bb5 F5 Db5 Bb4 F5 | Ab4 C5 Eb5 Ab5 Eb5 C5 Ab4 Eb5',
        'Gb4 Bb4 Db5 Gb5 Db5 Bb4 Gb4 Db5 | F4 A4 C5 F5 C5 A4 F4 C5',
        'Bb4 Db5 F5 Bb5 Gb4 Bb4 Db5 Gb5 | Eb4 Gb4 Bb4 Eb5 F4 A4 C5 F5',
        'Ab4 C5 Eb5 Ab5 Gb4 Bb4 Db5 Gb5 | F4 A4 C5 F5 A4 C5 F5 A5',
      ].join(' | '),
      [
        'C.K.S.B.K.K.S.BH',
        'K.K.S.K.T.t.S.R.',
        'C.K.S.B.K.K.S.BH',
        'K.K.S.T.t.S.R.H.',
      ].join(' | '),
    ),
  },

  // --------------------------------------------------------------------------
  // 20. bgm_boss_final_3_p1 — Overlord Apex Phase I (162 BPM, D minor dread)
  // --------------------------------------------------------------------------
  bgm_boss_final_3_p1: {
    bpm: 162,
    loop: true,
    leadGain: 0.27,
    bassGain: 0.33,
    arpGain: 0.15,
    drumGain: 0.35,
    leadStyle: 'saw',
    arpStyle: 'saw',
    echoMix: 0.15,
    intro: makeSection(
      [
        'D5 - . D5 Ab5 - G5 . | F5 - . D5 Eb5 - D5 .',
        'C#5 . E5 . G5 . Bb5 . | A5 - - . E5 . C#5 .',
      ].join(' | '),
      [
        'D2 D2 D3 D2 Ab1 Ab1 Ab2 Ab1 | G1 G1 G2 G1 Eb1 . D1 .',
        'A1 A1 A2 A1 G1 G1 G2 G1 | A1 A1 A2 A1 C#2 . A1 .',
      ].join(' | '),
      [
        'D4 F4 Ab4 D5 Ab3 D4 F4 Ab4 | G3 Bb3 D4 G4 Eb3 G3 Bb3 Eb4',
        'A3 C#4 E4 A4 G3 Bb3 C#4 G4 | A3 C#4 E4 A4 E4 C#4 A3 E4',
      ].join(' | '),
      [
        'C.K.S.A.K.K.S.A.',
        'K.K.S.K.T.t.R.R.',
      ].join(' | '),
    ),
    main: makeSection(
      [
        'D5 . F5 . Ab5 - G5 . | F5 . D5 . C5 . D5 .',
        'Bb4 . D5 . F5 - E5 . | A5 - G5 . E5 - C#5 .',
        'D5 . Ab5 . A5 - G5 . | F5 . G5 . Ab5 - Bb5 .',
        'A5 - G5 . F5 . E5 . | C#5 - E5 . A5 - G5 .',
      ].join(' | '),
      [
        'D2 D2 D3 D2 D2 D2 D3 D2 | D2 D2 D3 D2 C2 . D2 .',
        'Bb1 Bb1 Bb2 Bb1 Bb1 . G1 . | A1 A1 A2 A1 C#2 . A1 .',
        'D2 D2 D3 D2 C2 C2 C3 C2 | Bb1 Bb1 Bb2 Bb1 Ab1 . Bb1 .',
        'G1 G1 G2 G1 Bb1 Bb1 Bb2 Bb1 | A1 A1 A2 A1 C#2 . E2 .',
      ].join(' | '),
      [
        'D4 F4 Ab4 D5 Ab4 F4 D4 Ab4 | D4 F4 A4 D5 C4 E4 G4 C5',
        'Bb3 D4 F4 Bb4 F4 D4 Bb3 F4 | A3 C#4 E4 A4 E4 C#4 A3 E4',
        'D4 F4 Ab4 D5 C4 Eb4 G4 C5 | Bb3 D4 F4 Bb4 Ab3 C4 Eb4 Ab4',
        'G3 Bb3 D4 G4 Bb3 D4 F4 Bb4 | A3 C#4 E4 A4 C#4 E4 A4 C#5',
      ].join(' | '),
      [
        'C.K.S.K.K.K.S.AH',
        'K.K.S.K.T.t.S.R.',
        'C.K.S.K.K.K.S.AH',
        'K.S.K.S.T.t.R.R.',
      ].join(' | '),
    ),
  },

  // --------------------------------------------------------------------------
  // 21. bgm_boss_final_3_p2 — Overlord Apex Final Circuit (168 BPM, E minor)
  // --------------------------------------------------------------------------
  bgm_boss_final_3_p2: {
    bpm: 168,
    loop: true,
    leadGain: 0.28,
    bassGain: 0.33,
    arpGain: 0.17,
    drumGain: 0.35,
    leadStyle: 'pulse25',
    arpStyle: 'pulse12',
    echoMix: 0.16,
    intro: makeSection(
      [
        'E5 G5 B5 E6 D6 B5 G5 B5 | E6 - F#6 - G6 - F#6 E6',
        'D6 C6 B5 A5 G5 A5 B5 D6 | E6 - - . D#6 . B5 .',
      ].join(' | '),
      [
        'E2 E2 E3 E2 D2 D2 D3 D2 | C2 C2 C3 C2 B1 B1 D#2 B1',
        'A1 A1 A2 A1 G1 G1 G2 G1 | B1 B1 B2 B1 D#2 . F#2 .',
      ].join(' | '),
      [
        'E4 G4 B4 E5 D4 F#4 A4 D5 | C4 E4 G4 C5 B3 D#4 F#4 B4',
        'A3 C4 E4 A4 G3 B3 D4 G4 | B3 D#4 F#4 B4 D#4 F#4 B4 D#5',
      ].join(' | '),
      [
        'C.K.S.K.K.K.S.hH',
        'K.K.S.K.T.t.R.R.',
      ].join(' | '),
    ),
    main: makeSection(
      [
        'E6 - D6 . B5 . G5 . | A5 . B5 . C6 - B5 .',
        'A5 - G5 . F#5 . E5 . | D#5 - F#5 . B5 - . .',
        'E6 . D6 . C6 . B5 . | A5 . G5 . F#5 . G5 .',
        'A5 . B5 . C6 . D6 . | E6 - - . D#6 . B5 .',
      ].join(' | '),
      [
        'E2 E2 E3 E2 E2 E2 E3 E2 | C2 C2 C3 C2 C2 C2 C3 C2',
        'A1 A1 A2 A1 A1 A1 A2 A1 | B1 B1 B2 B1 B1 . D#2 .',
        'E2 E2 E3 E2 D2 D2 D3 D2 | C2 C2 C3 C2 B1 . A1 .',
        'A1 A1 A2 A1 C2 C2 C3 C2 | B1 B1 B2 B1 D#2 . B1 .',
      ].join(' | '),
      [
        'E4 G4 B4 E5 G4 B4 E5 G5 | C4 E4 G4 C5 E4 G4 C5 E5',
        'A3 C4 E4 A4 C4 E4 A4 C5 | B3 D#4 F#4 B4 D#4 F#4 B4 D#5',
        'E4 G4 B4 E5 D4 F#4 A4 D5 | C4 E4 G4 C5 B3 D4 G4 B4',
        'A3 C4 E4 A4 C4 E4 G4 C5 | B3 D#4 F#4 B4 F#4 D#4 B3 F#4',
      ].join(' | '),
      [
        'C.K.S.K.K.K.S.hH',
        'K.K.S.K.T.t.R.K.',
        'C.K.S.K.K.K.S.hH',
        'K.S.T.t.S.R.R.H.',
      ].join(' | '),
    ),
  },

  // --------------------------------------------------------------------------
  // 22. bgm_stage_clear — Triumphant Mission Complete Fanfare (154 BPM, C maj)
  // --------------------------------------------------------------------------
  bgm_stage_clear: {
    bpm: 154,
    loop: false,
    leadGain: 0.28,
    bassGain: 0.26,
    arpGain: 0.16,
    drumGain: 0.3,
    leadStyle: 'pulse25',
    arpStyle: 'pulse12',
    echoMix: 0.18,
    main: makeSection(
      [
        'C5 E5 G5 C6 . G5 A5 B5 | C6 - G5 . A5 . B5 .',
        'D6 - C6 . B5 . G5 . | C6 - - - - - - .',
      ].join(' | '),
      [
        'C2 . G2 . C3 . G2 . | F1 . C2 . G1 . D2 .',
        'Ab1 . Eb2 . Bb1 . F2 . | C2 - - - - - - .',
      ].join(' | '),
      [
        'C4 E4 G4 C5 E4 G4 C5 E5 | F4 A4 C5 F5 G4 B4 D5 G5',
        'Ab4 C5 Eb5 Ab5 Bb4 D5 F5 Bb5 | C5 E5 G5 C6 - - - .',
      ].join(' | '),
      [
        'K.S.K.R.C.h.S.h.',
        'K.S.T.t.C...H...',
      ].join(' | '),
    ),
  },

  // --------------------------------------------------------------------------
  // 23. bgm_gameover — Melancholic Circuit Offline Cadence (135 BPM, D minor)
  // --------------------------------------------------------------------------
  bgm_gameover: {
    bpm: 135,
    loop: false,
    leadGain: 0.24,
    bassGain: 0.26,
    arpGain: 0.14,
    drumGain: 0.22,
    leadStyle: 'triangle',
    arpStyle: 'triangle',
    echoMix: 0.22,
    main: makeSection(
      [
        'A5 - G5 . F5 - E5 . | D5 - C5 . Bb4 - A4 .',
        'G4 - F4 . E4 - C#4 . | D4 - - - - - - .',
      ].join(' | '),
      [
        'D2 - C2 . Bb1 - A1 . | G1 - F1 . Eb1 - D1 .',
        'G1 - Bb1 . A1 - A1 . | D1 - - - - - - .',
      ].join(' | '),
      [
        'D4 F4 A4 . C4 E4 G4 . | Bb3 D4 F4 . A3 C4 F4 .',
        'G3 Bb3 D4 . A3 C#4 E4 . | D3 F3 A3 D4 - - - .',
      ].join(' | '),
      [
        'K.h.S.h.K.h.S.h.',
        'K.T.t.S.C.......',
      ].join(' | '),
    ),
  },
};

// ============================================================================
// ProceduralSynth Class
// ============================================================================

interface ActiveTrackSession {
  readonly key: BgmKey;
  readonly song: SongComposition;
  readonly busGain: GainNode;
  readonly echoSend?: GainNode;
  readonly echoDelay?: DelayNode;
  readonly echoFeedback?: GainNode;
  readonly stemGains?: Readonly<Record<HubStem, GainNode>>;
  timerId: ReturnType<typeof setInterval> | null;
  phase: 'intro' | 'main';
  stepIndex: number;
  nextNoteTime: number;
  stopped: boolean;
}

export class ProceduralSynth {
  private readonly ctx: AudioContext;
  private readonly bgmOutput: AudioNode;
  private readonly sfxOutput: AudioNode;
  private readonly noiseBuffer: AudioBuffer;
  private readonly pulse25Wave: PeriodicWave | null;
  private readonly pulse12Wave: PeriodicWave | null;

  private activeSession: ActiveTrackSession | null = null;
  private currentHubStem: HubStem = 'command';

  constructor(ctx: AudioContext, bgmOutput: AudioNode, sfxOutput: AudioNode) {
    this.ctx = ctx;
    this.bgmOutput = bgmOutput;
    this.sfxOutput = sfxOutput;
    this.noiseBuffer = this.createNoiseBuffer();
    this.pulse25Wave = this.createPulseWave(0.25);
    this.pulse12Wave = this.createPulseWave(0.125);
  }

  public getCurrentBgmKey(): BgmKey | null {
    return this.activeSession && !this.activeSession.stopped ? this.activeSession.key : null;
  }

  public getHubStem(): HubStem {
    return this.currentHubStem;
  }

  public startBgm(key: string, fadeMs = 300): BgmKey | null {
    const resolved = resolveBgmKey(key);
    if (!resolved) return null;
    const song = SONGS[resolved];
    const spec = BGM_TRACKS[resolved];

    // Stop any previous procedural BGM smoothly
    this.stopBgm(fadeMs);

    const now = this.ctx.currentTime;
    const busGain = this.ctx.createGain();
    const targetGain = Math.max(0.0001, spec.gain);
    const fadeSec = Math.max(0.015, fadeMs / 1000);

    busGain.gain.setValueAtTime(0.0001, now);
    busGain.gain.exponentialRampToValueAtTime(targetGain, now + fadeSec);
    busGain.connect(this.bgmOutput);

    // Subtle SNES SPC700-style slapback echo bus for rich 16-bit atmosphere
    let echoSend: GainNode | undefined;
    let echoDelay: DelayNode | undefined;
    let echoFeedback: GainNode | undefined;
    if (song.echoMix > 0 && typeof this.ctx.createDelay === 'function') {
      try {
        const stepSec = 60 / song.bpm / 4;
        echoSend = this.ctx.createGain();
        echoSend.gain.setValueAtTime(song.echoMix, now);
        echoDelay = this.ctx.createDelay(1.0);
        echoDelay.delayTime.setValueAtTime(stepSec * 3, now);
        echoFeedback = this.ctx.createGain();
        echoFeedback.gain.setValueAtTime(0.24, now);

        echoSend.connect(echoDelay);
        echoDelay.connect(echoFeedback);
        echoFeedback.connect(echoDelay);
        echoDelay.connect(busGain);
      } catch {
        echoSend = undefined;
        echoDelay = undefined;
        echoFeedback = undefined;
      }
    }

    // 3-stem dynamic crossfade bus for bgm_hub
    let stemGains: Record<HubStem, GainNode> | undefined;
    if (song.hubStems) {
      const cmdGain = this.ctx.createGain();
      const medGain = this.ctx.createGain();
      const dojoGain = this.ctx.createGain();
      cmdGain.gain.setValueAtTime(this.currentHubStem === 'command' ? 1.0 : 0.0001, now);
      medGain.gain.setValueAtTime(this.currentHubStem === 'medbay' ? 1.0 : 0.0001, now);
      dojoGain.gain.setValueAtTime(this.currentHubStem === 'dojo' ? 1.0 : 0.0001, now);
      cmdGain.connect(busGain);
      medGain.connect(busGain);
      dojoGain.connect(busGain);
      stemGains = { command: cmdGain, medbay: medGain, dojo: dojoGain };
    }

    const session: ActiveTrackSession = {
      key: resolved,
      song,
      busGain,
      echoSend,
      echoDelay,
      echoFeedback,
      stemGains,
      timerId: null,
      phase: song.intro ? 'intro' : 'main',
      stepIndex: 0,
      nextNoteTime: now + 0.03,
      stopped: false,
    };

    this.activeSession = session;

    const scheduleTick = (): void => {
      if (session.stopped) return;
      const lookaheadSec = 0.12;
      const stepSec = 60 / session.song.bpm / 4;

      // Guard against long tab background pauses causing a huge catch-up burst
      if (session.nextNoteTime < this.ctx.currentTime - 0.25) {
        session.nextNoteTime = this.ctx.currentTime + 0.02;
      }

      while (session.nextNoteTime < this.ctx.currentTime + lookaheadSec) {
        this.scheduleStep(session, session.nextNoteTime, stepSec);
        if (session.stopped) break;
        session.nextNoteTime += stepSec;
      }
    };

    scheduleTick();
    session.timerId = setInterval(scheduleTick, 25);
    return resolved;
  }

  public setHubStem(stem: HubStem): void {
    this.currentHubStem = stem;
    const session = this.activeSession;
    if (!session || session.stopped || !session.stemGains) return;

    const now = this.ctx.currentTime;
    const tau = 0.14; // smooth ~420ms musical crossfade
    const stems: readonly HubStem[] = ['command', 'medbay', 'dojo'];
    for (const s of stems) {
      const node = session.stemGains[s];
      node.gain.cancelScheduledValues(now);
      node.gain.setTargetAtTime(s === stem ? 1.0 : 0.0001, now, tau);
    }
  }

  public stopBgm(fadeMs = 220): void {
    const session = this.activeSession;
    if (!session) return;
    this.activeSession = null;
    session.stopped = true;
    if (session.timerId !== null) {
      clearInterval(session.timerId);
      session.timerId = null;
    }

    const now = this.ctx.currentTime;
    const fadeSec = Math.max(0.015, fadeMs / 1000);
    try {
      session.busGain.gain.cancelScheduledValues(now);
      session.busGain.gain.setTargetAtTime(0.0001, now, fadeSec / 3);
    } catch {
      // ignore closed context errors
    }

    setTimeout(() => {
      try {
        session.busGain.disconnect();
        session.echoSend?.disconnect();
        session.echoDelay?.disconnect();
        session.echoFeedback?.disconnect();
        if (session.stemGains) {
          session.stemGains.command.disconnect();
          session.stemGains.medbay.disconnect();
          session.stemGains.dojo.disconnect();
        }
      } catch {
        // already disconnected
      }
    }, Math.ceil(fadeMs + 140));
  }

  public dispose(): void {
    this.stopBgm(20);
  }

  // --------------------------------------------------------------------------
  // Sequencer Step Scheduler
  // --------------------------------------------------------------------------

  private scheduleStep(session: ActiveTrackSession, time: number, stepSec: number): void {
    const { song } = session;
    const section = session.phase === 'intro' && song.intro ? song.intro : song.main;
    const idx = session.stepIndex;

    if (idx >= section.length) {
      if (session.phase === 'intro') {
        session.phase = 'main';
        session.stepIndex = 0;
        this.scheduleStep(session, time, stepSec);
        return;
      }
      if (song.loop) {
        session.stepIndex = 0;
        this.scheduleStep(session, time, stepSec);
        return;
      }
      // One-shot fanfare finished
      session.stopped = true;
      if (session.timerId !== null) {
        clearInterval(session.timerId);
        session.timerId = null;
      }
      return;
    }

    // Standard lead / bass / arp / drums
    const leadNote = idx < section.lead.length ? section.lead[idx] : NOTE_REST;
    if (leadNote >= 0) {
      const hold = noteHoldSteps(section.lead, idx);
      this.triggerLeadVoice(
        midiToHz(leadNote),
        time,
        hold * stepSec,
        song.leadGain,
        song.leadStyle,
        session.busGain,
        session.echoSend,
      );
    }

    const bassNote = idx < section.bass.length ? section.bass[idx] : NOTE_REST;
    if (bassNote >= 0) {
      const hold = noteHoldSteps(section.bass, idx);
      this.triggerFmBassVoice(
        midiToHz(bassNote),
        time,
        Math.max(stepSec * 0.85, hold * stepSec * 0.92),
        song.bassGain,
        session.busGain,
      );
    }

    const arpNote = idx < section.arp.length ? section.arp[idx] : NOTE_REST;
    if (arpNote >= 0) {
      const hold = noteHoldSteps(section.arp, idx);
      this.triggerArpVoice(
        midiToHz(arpNote),
        time,
        hold * stepSec * 0.85,
        song.arpGain,
        song.arpStyle,
        session.busGain,
        session.echoSend,
      );
    }

    const drumCh = idx < section.drums.length ? section.drums[idx] : '.';
    if (drumCh !== '.') {
      this.triggerDrumHit(drumCh, time, song.drumGain, session.busGain);
    }

    // Dynamic 3-stem layers for bgm_hub (all 3 locked to exact same beat clock!)
    if (song.hubStems && session.stemGains && session.phase === 'main') {
      const hs = song.hubStems;
      const sg = session.stemGains;

      const cmdLead = idx < hs.commandLead.length ? hs.commandLead[idx] : NOTE_REST;
      if (cmdLead >= 0) {
        const hold = noteHoldSteps(hs.commandLead, idx);
        this.triggerLeadVoice(
          midiToHz(cmdLead),
          time,
          hold * stepSec,
          0.23,
          'pulse25',
          sg.command,
          undefined,
        );
      }
      const cmdArp = idx < hs.commandArp.length ? hs.commandArp[idx] : NOTE_REST;
      if (cmdArp >= 0) {
        this.triggerArpVoice(midiToHz(cmdArp), time, stepSec * 0.8, 0.13, 'pulse12', sg.command);
      }

      const medLead = idx < hs.medbayLead.length ? hs.medbayLead[idx] : NOTE_REST;
      if (medLead >= 0) {
        const hold = noteHoldSteps(hs.medbayLead, idx);
        this.triggerLeadVoice(
          midiToHz(medLead),
          time,
          hold * stepSec,
          0.24,
          'triangle',
          sg.medbay,
          undefined,
        );
      }
      const medArp = idx < hs.medbayArp.length ? hs.medbayArp[idx] : NOTE_REST;
      if (medArp >= 0) {
        this.triggerArpVoice(midiToHz(medArp), time, stepSec * 1.4, 0.15, 'triangle', sg.medbay);
      }

      const dojoLead = idx < hs.dojoLead.length ? hs.dojoLead[idx] : NOTE_REST;
      if (dojoLead >= 0) {
        const hold = noteHoldSteps(hs.dojoLead, idx);
        this.triggerLeadVoice(
          midiToHz(dojoLead),
          time,
          hold * stepSec * 0.9,
          0.23,
          'saw',
          sg.dojo,
          undefined,
        );
      }
      const dojoArp = idx < hs.dojoArp.length ? hs.dojoArp[idx] : NOTE_REST;
      if (dojoArp >= 0) {
        this.triggerArpVoice(midiToHz(dojoArp), time, stepSec * 0.72, 0.13, 'pulse12', sg.dojo);
      }
      const dojoDrum = idx < hs.dojoDrums.length ? hs.dojoDrums[idx] : '.';
      if (dojoDrum !== '.') {
        this.triggerDrumHit(dojoDrum, time, 0.22, sg.dojo);
      }
    }

    session.stepIndex++;
  }

  // --------------------------------------------------------------------------
  // 16-Bit Music Instrument Voices
  // --------------------------------------------------------------------------

  private applyOscStyle(osc: OscillatorNode, style: 'pulse25' | 'pulse12' | 'saw' | 'triangle'): void {
    if (style === 'pulse25' && this.pulse25Wave) {
      osc.setPeriodicWave(this.pulse25Wave);
    } else if (style === 'pulse12' && this.pulse12Wave) {
      osc.setPeriodicWave(this.pulse12Wave);
    } else if (style === 'saw') {
      osc.type = 'sawtooth';
    } else if (style === 'triangle') {
      osc.type = 'triangle';
    } else {
      osc.type = 'square';
    }
  }

  private triggerLeadVoice(
    freq: number,
    time: number,
    duration: number,
    gainLevel: number,
    style: 'pulse25' | 'pulse12' | 'saw' | 'triangle',
    dest: AudioNode,
    echoSend?: AudioNode,
  ): void {
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const env = this.ctx.createGain();

    this.applyOscStyle(osc1, style);
    osc2.type = style === 'triangle' ? 'sine' : 'sawtooth';

    osc1.frequency.setValueAtTime(freq, time);
    osc2.frequency.setValueAtTime(freq * 1.0035, time); // rich 16-bit chorus detune

    // Expressive vibrato on longer held notes
    let vibOsc: OscillatorNode | null = null;
    if (duration > 0.24) {
      vibOsc = this.ctx.createOscillator();
      const vibGain = this.ctx.createGain();
      vibOsc.frequency.setValueAtTime(5.8, time);
      vibGain.gain.setValueAtTime(0, time);
      vibGain.gain.linearRampToValueAtTime(freq * 0.011, time + 0.16);
      vibOsc.connect(vibGain);
      vibGain.connect(osc1.frequency);
      vibGain.connect(osc2.frequency);
      vibOsc.start(time);
      vibOsc.stop(time + duration + 0.08);
    }

    filter.type = 'lowpass';
    filter.Q.setValueAtTime(2.2, time);
    const startCutoff = style === 'triangle' ? 3200 : 4800;
    const holdCutoff = style === 'triangle' ? 1900 : 2100;
    filter.frequency.setValueAtTime(startCutoff, time);
    filter.frequency.exponentialRampToValueAtTime(holdCutoff, time + Math.min(0.09, duration));

    const osc2Mix = this.ctx.createGain();
    osc2Mix.gain.setValueAtTime(style === 'triangle' ? 0.28 : 0.35, time);

    const release = 0.05;
    env.gain.setValueAtTime(0.0001, time);
    env.gain.linearRampToValueAtTime(gainLevel, time + 0.008);
    env.gain.exponentialRampToValueAtTime(gainLevel * 0.72, time + Math.min(0.07, duration));
    env.gain.setValueAtTime(gainLevel * 0.68, time + Math.max(0.02, duration - 0.015));
    env.gain.exponentialRampToValueAtTime(0.0001, time + duration + release);

    osc1.connect(filter);
    osc2.connect(osc2Mix);
    osc2Mix.connect(filter);
    filter.connect(env);
    env.connect(dest);
    if (echoSend) {
      env.connect(echoSend);
    }

    osc1.start(time);
    osc2.start(time);
    osc1.stop(time + duration + release + 0.02);
    osc2.stop(time + duration + release + 0.02);
  }

  private triggerFmBassVoice(
    freq: number,
    time: number,
    duration: number,
    gainLevel: number,
    dest: AudioNode,
  ): void {
    // Genesis YM2612 / Mega Man X style FM slap bass
    const carrier = this.ctx.createOscillator();
    const mod = this.ctx.createOscillator();
    const modGain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    const env = this.ctx.createGain();

    carrier.type = 'sawtooth';
    carrier.frequency.setValueAtTime(freq, time);

    mod.type = 'sine';
    mod.frequency.setValueAtTime(freq * 2, time);
    modGain.gain.setValueAtTime(freq * 2.4, time);
    modGain.gain.exponentialRampToValueAtTime(freq * 0.18, time + Math.min(0.065, duration));

    filter.type = 'lowpass';
    filter.Q.setValueAtTime(3.0, time);
    filter.frequency.setValueAtTime(1650, time);
    filter.frequency.exponentialRampToValueAtTime(520, time + Math.min(0.11, duration));

    const release = 0.03;
    env.gain.setValueAtTime(0.0001, time);
    env.gain.linearRampToValueAtTime(gainLevel, time + 0.005);
    env.gain.exponentialRampToValueAtTime(gainLevel * 0.62, time + Math.min(0.08, duration));
    env.gain.exponentialRampToValueAtTime(0.0001, time + duration + release);

    mod.connect(modGain);
    modGain.connect(carrier.frequency);
    carrier.connect(filter);
    filter.connect(env);
    env.connect(dest);

    mod.start(time);
    carrier.start(time);
    mod.stop(time + duration + release + 0.02);
    carrier.stop(time + duration + release + 0.02);
  }

  private triggerArpVoice(
    freq: number,
    time: number,
    duration: number,
    gainLevel: number,
    style: 'pulse12' | 'triangle' | 'saw',
    dest: AudioNode,
    echoSend?: AudioNode,
  ): void {
    const osc = this.ctx.createOscillator();
    const hp = this.ctx.createBiquadFilter();
    const env = this.ctx.createGain();

    this.applyOscStyle(osc, style);
    osc.frequency.setValueAtTime(freq, time);

    hp.type = 'highpass';
    hp.frequency.setValueAtTime(280, time);

    const release = 0.03;
    env.gain.setValueAtTime(0.0001, time);
    env.gain.linearRampToValueAtTime(gainLevel, time + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, time + duration + release);

    osc.connect(hp);
    hp.connect(env);
    env.connect(dest);
    if (echoSend) {
      env.connect(echoSend);
    }

    osc.start(time);
    osc.stop(time + duration + release + 0.02);
  }

  private triggerDrumHit(ch: string, time: number, gainLevel: number, dest: AudioNode): void {
    switch (ch) {
      case 'K':
        this.triggerKick(time, gainLevel * 1.15, dest);
        break;
      case 'S':
        this.triggerSnare(time, gainLevel * 0.95, dest);
        break;
      case 'h':
        this.triggerHiHat(time, gainLevel * 0.42, false, dest);
        break;
      case 'H':
        this.triggerHiHat(time, gainLevel * 0.56, true, dest);
        break;
      case 'X':
        this.triggerKick(time, gainLevel * 1.1, dest);
        this.triggerHiHat(time, gainLevel * 0.36, false, dest);
        break;
      case 'Y':
        this.triggerSnare(time, gainLevel * 0.95, dest);
        this.triggerHiHat(time, gainLevel * 0.36, false, dest);
        break;
      case 'C':
        this.triggerKick(time, gainLevel * 1.15, dest);
        this.triggerCrash(time, gainLevel * 0.7, dest);
        break;
      case 'T':
        this.triggerTom(time, 250, 125, gainLevel * 0.85, dest);
        break;
      case 't':
        this.triggerTom(time, 175, 78, gainLevel * 0.88, dest);
        break;
      case 'R':
        this.triggerSnare(time, gainLevel * 0.78, dest);
        this.triggerSnare(time + 0.045, gainLevel * 0.92, dest);
        break;
      case 'A':
        this.triggerAnvil(time, gainLevel * 0.68, dest);
        break;
      case 'B':
        this.triggerBellRide(time, gainLevel * 0.44, dest);
        break;
      default:
        break;
    }
  }

  private triggerKick(time: number, gainLevel: number, dest: AudioNode): void {
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(168, time);
    osc.frequency.exponentialRampToValueAtTime(42, time + 0.075);

    env.gain.setValueAtTime(gainLevel, time);
    env.gain.exponentialRampToValueAtTime(0.0001, time + 0.11);

    osc.connect(env);
    env.connect(dest);
    osc.start(time);
    osc.stop(time + 0.12);

    // Subtle 8ms click transient for punch
    const click = this.ctx.createBufferSource();
    click.buffer = this.noiseBuffer;
    const clickFilter = this.ctx.createBiquadFilter();
    clickFilter.type = 'bandpass';
    clickFilter.frequency.setValueAtTime(2200, time);
    const clickEnv = this.ctx.createGain();
    clickEnv.gain.setValueAtTime(gainLevel * 0.32, time);
    clickEnv.gain.exponentialRampToValueAtTime(0.0001, time + 0.012);

    click.connect(clickFilter);
    clickFilter.connect(clickEnv);
    clickEnv.connect(dest);
    click.start(time);
    click.stop(time + 0.016);
  }

  private triggerSnare(time: number, gainLevel: number, dest: AudioNode): void {
    // Crisp bandpass noise snap
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1950, time);
    bp.Q.setValueAtTime(0.85, time);
    const nEnv = this.ctx.createGain();
    nEnv.gain.setValueAtTime(gainLevel * 0.85, time);
    nEnv.gain.exponentialRampToValueAtTime(0.0001, time + 0.125);

    noise.connect(bp);
    bp.connect(nEnv);
    nEnv.connect(dest);
    noise.start(time);
    noise.stop(time + 0.135);

    // Snappy drum body
    const body = this.ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(225, time);
    body.frequency.exponentialRampToValueAtTime(120, time + 0.048);
    const bEnv = this.ctx.createGain();
    bEnv.gain.setValueAtTime(gainLevel * 0.6, time);
    bEnv.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);

    body.connect(bEnv);
    bEnv.connect(dest);
    body.start(time);
    body.stop(time + 0.068);
  }

  private triggerHiHat(time: number, gainLevel: number, open: boolean, dest: AudioNode): void {
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(open ? 6500 : 7800, time);
    const env = this.ctx.createGain();
    const dur = open ? 0.13 : 0.03;
    env.gain.setValueAtTime(gainLevel, time);
    env.gain.exponentialRampToValueAtTime(0.0001, time + dur);

    noise.connect(hp);
    hp.connect(env);
    env.connect(dest);
    noise.start(time);
    noise.stop(time + dur + 0.01);
  }

  private triggerTom(
    time: number,
    startHz: number,
    endHz: number,
    gainLevel: number,
    dest: AudioNode,
  ): void {
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(startHz, time);
    osc.frequency.exponentialRampToValueAtTime(endHz, time + 0.11);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(gainLevel, time);
    env.gain.exponentialRampToValueAtTime(0.0001, time + 0.13);

    osc.connect(env);
    env.connect(dest);
    osc.start(time);
    osc.stop(time + 0.14);
  }

  private triggerCrash(time: number, gainLevel: number, dest: AudioNode): void {
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(4800, time);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(gainLevel, time);
    env.gain.exponentialRampToValueAtTime(0.0001, time + 0.34);

    noise.connect(hp);
    hp.connect(env);
    env.connect(dest);
    noise.start(time);
    noise.stop(time + 0.36);
  }

  private triggerAnvil(time: number, gainLevel: number, dest: AudioNode): void {
    // Metallic 16-bit foundry anvil / industrial rim-clang
    const o1 = this.ctx.createOscillator();
    const o2 = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    o1.type = 'square';
    o2.type = 'triangle';
    o1.frequency.setValueAtTime(610, time);
    o1.frequency.exponentialRampToValueAtTime(520, time + 0.065);
    o2.frequency.setValueAtTime(935, time);
    o2.frequency.exponentialRampToValueAtTime(790, time + 0.065);

    env.gain.setValueAtTime(gainLevel * 0.65, time);
    env.gain.exponentialRampToValueAtTime(0.0001, time + 0.085);

    o1.connect(env);
    o2.connect(env);
    env.connect(dest);
    o1.start(time);
    o2.start(time);
    o1.stop(time + 0.095);
    o2.stop(time + 0.095);

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(3400, time);
    bp.Q.setValueAtTime(2.6, time);
    const nEnv = this.ctx.createGain();
    nEnv.gain.setValueAtTime(gainLevel * 0.55, time);
    nEnv.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);

    noise.connect(bp);
    bp.connect(nEnv);
    nEnv.connect(dest);
    noise.start(time);
    noise.stop(time + 0.07);
  }

  private triggerBellRide(time: number, gainLevel: number, dest: AudioNode): void {
    // Shimmering 16-bit cyber ride / crystal bell tick
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(3120, time);
    env.gain.setValueAtTime(gainLevel * 0.55, time);
    env.gain.exponentialRampToValueAtTime(0.0001, time + 0.085);

    osc.connect(env);
    env.connect(dest);
    osc.start(time);
    osc.stop(time + 0.095);

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(6200, time);
    const nEnv = this.ctx.createGain();
    nEnv.gain.setValueAtTime(gainLevel * 0.45, time);
    nEnv.gain.exponentialRampToValueAtTime(0.0001, time + 0.07);

    noise.connect(hp);
    hp.connect(nEnv);
    nEnv.connect(dest);
    noise.start(time);
    noise.stop(time + 0.08);
  }

  // --------------------------------------------------------------------------
  // Synthesized SFX Library (Every Key in SFX_SPECS)
  // --------------------------------------------------------------------------

  public playSfx(key: string, pitchRate = 1.0, destination?: AudioNode): boolean {
    const resolved = resolveSfxKey(key);
    if (!resolved) return false;

    const dest = destination ?? this.sfxOutput;
    const now = this.ctx.currentTime;
    const p = Math.max(0.5, Math.min(2.0, pitchRate));

    this.synthesizeSfx(resolved, now, p, dest);
    return true;
  }

  private synthTone(
    time: number,
    dur: number,
    startHz: number,
    endHz: number,
    gain: number,
    style: 'pulse25' | 'pulse12' | 'saw' | 'triangle' | 'sine',
    dest: AudioNode,
  ): void {
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    if (style === 'sine') {
      osc.type = 'sine';
    } else {
      this.applyOscStyle(osc, style);
    }

    osc.frequency.setValueAtTime(Math.max(20, startHz), time);
    if (endHz !== startHz) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endHz), time + Math.max(0.008, dur));
    }

    env.gain.setValueAtTime(0.0001, time);
    env.gain.linearRampToValueAtTime(gain, time + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, time + dur);

    osc.connect(env);
    env.connect(dest);
    osc.start(time);
    osc.stop(time + dur + 0.015);
  }

  private synthNoise(
    time: number,
    dur: number,
    filterType: BiquadFilterType,
    startHz: number,
    endHz: number,
    q: number,
    gain: number,
    dest: AudioNode,
  ): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.Q.setValueAtTime(q, time);
    filter.frequency.setValueAtTime(Math.max(40, startHz), time);
    if (endHz !== startHz) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, endHz), time + dur);
    }

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, time);
    env.gain.linearRampToValueAtTime(gain, time + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, time + dur);

    src.connect(filter);
    filter.connect(env);
    env.connect(dest);
    src.start(time);
    src.stop(time + dur + 0.015);
  }

  private synthesizeSfx(key: SfxKey, t: number, p: number, dest: AudioNode): void {
    switch (key) {
      case 'jump':
        this.synthTone(t, 0.095, 220 * p, 640 * p, 0.45, 'pulse25', dest);
        this.synthTone(t, 0.05, 330 * p, 720 * p, 0.2, 'triangle', dest);
        break;

      case 'double_jump':
        this.synthTone(t, 0.055, 340 * p, 760 * p, 0.42, 'pulse25', dest);
        this.synthTone(t + 0.035, 0.085, 520 * p, 1080 * p, 0.36, 'pulse12', dest);
        this.synthNoise(t, 0.055, 'highpass', 3200, 5400, 1.0, 0.16, dest);
        break;

      case 'land':
        this.synthTone(t, 0.055, 130 * p, 52 * p, 0.44, 'triangle', dest);
        this.synthNoise(t, 0.045, 'lowpass', 950, 260, 0.9, 0.28, dest);
        break;

      case 'slide':
        this.synthNoise(t, 0.155, 'bandpass', 1550 * p, 420 * p, 1.4, 0.44, dest);
        this.synthTone(t, 0.12, 180 * p, 82 * p, 0.26, 'saw', dest);
        break;

      case 'wall_jump':
        this.synthNoise(t, 0.025, 'bandpass', 2400, 1400, 1.5, 0.32, dest);
        this.synthTone(t, 0.095, 290 * p, 800 * p, 0.44, 'pulse25', dest);
        break;

      case 'ledge_grab':
        this.synthTone(t, 0.032, 920 * p, 520 * p, 0.36, 'pulse12', dest);
        this.synthNoise(t, 0.03, 'bandpass', 2800, 1800, 2.2, 0.25, dest);
        break;

      case 'jab':
        this.synthNoise(t, 0.068, 'bandpass', 2100 * p, 680 * p, 1.2, 0.44, dest);
        this.synthTone(t, 0.06, 360 * p, 125 * p, 0.36, 'pulse25', dest);
        break;

      case 'sprint_kick':
        this.synthNoise(t, 0.115, 'bandpass', 2600 * p, 520 * p, 1.1, 0.52, dest);
        this.synthTone(t, 0.11, 460 * p, 110 * p, 0.44, 'saw', dest);
        break;

      case 'dive_kick':
        this.synthTone(t, 0.135, 980 * p, 270 * p, 0.4, 'pulse25', dest);
        this.synthNoise(t, 0.12, 'bandpass', 3000 * p, 900 * p, 1.6, 0.32, dest);
        break;

      case 'hit':
        // Punchy melee thwack with crisp noise transient
        this.synthNoise(t, 0.065, 'bandpass', 1800 * p, 480 * p, 0.9, 0.62, dest);
        this.synthTone(t, 0.075, 340 * p, 88 * p, 0.58, 'pulse25', dest);
        this.synthTone(t, 0.05, 190 * p, 60 * p, 0.45, 'triangle', dest);
        break;

      case 'heavy_hit':
        this.synthNoise(t, 0.145, 'bandpass', 2200 * p, 280 * p, 0.8, 0.72, dest);
        this.synthTone(t, 0.15, 220 * p, 44 * p, 0.68, 'saw', dest);
        this.synthTone(t, 0.09, 440 * p, 110 * p, 0.44, 'pulse25', dest);
        break;

      case 'armor_break':
        // Resonant crystalline / metallic guard-break shatter!
        this.synthTone(t, 0.18, 1520 * p, 1120 * p, 0.42, 'pulse12', dest);
        this.synthTone(t, 0.22, 2180 * p, 1620 * p, 0.34, 'triangle', dest);
        this.synthTone(t + 0.025, 0.2, 890 * p, 420 * p, 0.44, 'saw', dest);
        this.synthNoise(t, 0.12, 'highpass', 3200, 1800, 1.2, 0.56, dest);
        this.synthNoise(t + 0.06, 0.18, 'bandpass', 4600, 1200, 1.8, 0.4, dest);
        break;

      case 'hook_fire':
        // Metallic grapple zip & cable click
        this.synthTone(t, 0.045, 620 * p, 1620 * p, 0.4, 'pulse12', dest);
        this.synthTone(t + 0.04, 0.075, 1380 * p, 820 * p, 0.34, 'saw', dest);
        this.synthNoise(t, 0.095, 'highpass', 3600, 2200, 1.4, 0.28, dest);
        break;

      case 'hook_latch':
        // Crisp metallic grapple clink!
        this.synthTone(t, 0.08, 1920 * p, 1780 * p, 0.42, 'pulse12', dest);
        this.synthTone(t, 0.095, 2860 * p, 2480 * p, 0.3, 'triangle', dest);
        this.synthTone(t, 0.045, 260 * p, 95 * p, 0.38, 'triangle', dest);
        break;

      case 'hook_grab':
        this.synthTone(t, 0.055, 360 * p, 720 * p, 0.42, 'pulse25', dest);
        this.synthTone(t + 0.04, 0.075, 720 * p, 1180 * p, 0.38, 'pulse12', dest);
        this.synthNoise(t, 0.04, 'bandpass', 2400, 1400, 1.4, 0.24, dest);
        break;

      case 'throw':
        this.synthTone(t, 0.05, 280 * p, 680 * p, 0.42, 'pulse25', dest);
        this.synthTone(t + 0.04, 0.09, 640 * p, 210 * p, 0.38, 'saw', dest);
        this.synthNoise(t, 0.11, 'bandpass', 1800 * p, 600 * p, 1.2, 0.38, dest);
        break;

      case 'bounce':
        this.synthTone(t, 0.055, 240 * p, 780 * p, 0.46, 'pulse25', dest);
        this.synthTone(t + 0.045, 0.07, 780 * p, 490 * p, 0.32, 'triangle', dest);
        break;

      case 'burst': {
        // Heroic rising 16-bit burst chime + super flash!
        const notes = [523.25, 659.25, 783.99, 1046.5];
        for (let i = 0; i < notes.length; i++) {
          this.synthTone(t + i * 0.032, 0.14, notes[i] * p, notes[i] * 1.01 * p, 0.36, 'pulse25', dest);
        }
        this.synthNoise(t, 0.24, 'bandpass', 4200, 900, 1.0, 0.42, dest);
        this.synthTone(t, 0.18, 180 * p, 64 * p, 0.4, 'sine', dest);
        break;
      }

      case 'burst_freeze':
        this.synthTone(t, 0.26, 440 * p, 58 * p, 0.5, 'saw', dest);
        this.synthTone(t + 0.03, 0.3, 1760 * p, 1320 * p, 0.28, 'triangle', dest);
        this.synthTone(t + 0.06, 0.28, 2217 * p, 1760 * p, 0.24, 'pulse12', dest);
        this.synthNoise(t, 0.28, 'highpass', 4800, 1400, 1.2, 0.32, dest);
        break;

      case 'hurt':
        this.synthTone(t, 0.065, 280 * p, 145 * p, 0.56, 'saw', dest);
        this.synthTone(t + 0.055, 0.12, 195 * p, 92 * p, 0.52, 'pulse25', dest);
        this.synthNoise(t, 0.14, 'bandpass', 1400, 380, 1.0, 0.44, dest);
        break;

      case 'death':
        this.synthTone(t, 0.18, 420 * p, 110 * p, 0.52, 'saw', dest);
        this.synthTone(t + 0.14, 0.24, 240 * p, 52 * p, 0.56, 'pulse25', dest);
        this.synthNoise(t + 0.06, 0.46, 'lowpass', 1600, 140, 0.8, 0.68, dest);
        this.synthTone(t + 0.26, 0.3, 110 * p, 34 * p, 0.5, 'sine', dest);
        break;

      case 'pickup_bit':
        // Classic crisp arcade bit coin double-ding!
        this.synthTone(t, 0.055, 987.77 * p, 987.77 * p, 0.38, 'pulse25', dest);
        this.synthTone(t + 0.048, 0.085, 1318.51 * p, 1318.51 * p, 0.42, 'pulse25', dest);
        break;

      case 'pickup_hp':
        this.synthTone(t, 0.06, 659.25 * p, 659.25 * p, 0.36, 'triangle', dest);
        this.synthTone(t + 0.055, 0.065, 830.61 * p, 830.61 * p, 0.38, 'triangle', dest);
        this.synthTone(t + 0.11, 0.095, 987.77 * p, 987.77 * p, 0.42, 'pulse25', dest);
        break;

      case 'pickup_burst':
        this.synthTone(t, 0.06, 440 * p, 880 * p, 0.36, 'pulse12', dest);
        this.synthTone(t + 0.05, 0.12, 880 * p, 1320 * p, 0.4, 'pulse25', dest);
        break;

      case 'rescue': {
        const notes = [523.25, 659.25, 783.99, 987.77, 1046.5];
        for (let i = 0; i < notes.length; i++) {
          this.synthTone(t + i * 0.052, 0.12, notes[i], notes[i], 0.38, 'pulse25', dest);
        }
        break;
      }

      case 'checkpoint': {
        const notes = [392.0, 523.25, 659.25, 783.99];
        for (let i = 0; i < notes.length; i++) {
          this.synthTone(t + i * 0.055, 0.14, notes[i], notes[i], 0.36, 'pulse12', dest);
        }
        break;
      }

      case 'switch':
        this.synthTone(t, 0.04, 520 * p, 520 * p, 0.38, 'pulse25', dest);
        this.synthTone(t + 0.035, 0.065, 780 * p, 780 * p, 0.4, 'pulse12', dest);
        break;

      case 'breakable':
        this.synthNoise(t, 0.16, 'bandpass', 1450 * p, 320 * p, 0.9, 0.58, dest);
        this.synthTone(t, 0.09, 170 * p, 58 * p, 0.5, 'triangle', dest);
        this.synthNoise(t + 0.05, 0.12, 'highpass', 2200, 900, 1.2, 0.34, dest);
        break;

      case 'boss_intro':
        this.synthTone(t, 0.18, 220, 440, 0.48, 'saw', dest);
        this.synthTone(t + 0.2, 0.18, 261.63, 523.25, 0.5, 'saw', dest);
        this.synthTone(t + 0.4, 0.22, 329.63, 659.25, 0.52, 'pulse25', dest);
        this.synthTone(t, 0.55, 110, 82.4, 0.4, 'triangle', dest);
        break;

      case 'boss_desperation':
        // Dramatic boss desperation siren + resonant sub boom!
        this.synthTone(t, 0.18, 560, 920, 0.46, 'saw', dest);
        this.synthTone(t + 0.18, 0.18, 920, 560, 0.46, 'saw', dest);
        this.synthTone(t + 0.36, 0.24, 560, 1120, 0.52, 'pulse25', dest);
        this.synthTone(t, 0.55, 130, 42, 0.58, 'sine', dest);
        this.synthNoise(t, 0.45, 'bandpass', 1800, 620, 1.2, 0.34, dest);
        break;

      case 'explosion':
        // Deep, meaty 16-bit explosion!
        this.synthNoise(t, 0.42, 'lowpass', 1100 * p, 115 * p, 0.75, 0.78, dest);
        this.synthTone(t, 0.34, 130 * p, 28 * p, 0.68, 'sine', dest);
        this.synthTone(t, 0.16, 210 * p, 48 * p, 0.44, 'saw', dest);
        break;

      case 'menu_move':
        this.synthTone(t, 0.036, 860 * p, 1080 * p, 0.34, 'pulse12', dest);
        break;

      case 'menu_confirm':
        this.synthTone(t, 0.045, 660, 660, 0.38, 'pulse25', dest);
        this.synthTone(t + 0.042, 0.075, 990, 990, 0.42, 'pulse25', dest);
        break;

      case 'menu_cancel':
        this.synthTone(t, 0.045, 520, 440, 0.36, 'pulse25', dest);
        this.synthTone(t + 0.04, 0.07, 380, 290, 0.38, 'triangle', dest);
        break;

      case 'loadout_swap':
        this.synthTone(t, 0.035, 480 * p, 640 * p, 0.34, 'pulse12', dest);
        this.synthTone(t + 0.032, 0.04, 720 * p, 960 * p, 0.36, 'pulse25', dest);
        this.synthTone(t + 0.068, 0.055, 1080 * p, 1180 * p, 0.38, 'pulse25', dest);
        break;
    }
  }

  // --------------------------------------------------------------------------
  // Buffer & Waveform Builders (Deterministic, Alias-Free)
  // --------------------------------------------------------------------------

  private createNoiseBuffer(): AudioBuffer {
    const sampleRate = this.ctx.sampleRate || 44100;
    const length = Math.max(1024, Math.floor(sampleRate * 1.0));
    const buffer = this.ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    // Deterministic 32-bit LCG noise (zero Math.random)
    let seed = 0x1337c0de;
    for (let i = 0; i < length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      data[i] = (seed / 0x80000000) - 1;
    }
    return buffer;
  }

  private createPulseWave(duty: number): PeriodicWave | null {
    if (typeof this.ctx.createPeriodicWave !== 'function') {
      return null;
    }
    try {
      const harmonics = 28;
      const real = new Float32Array(harmonics + 1);
      const imag = new Float32Array(harmonics + 1);
      for (let n = 1; n <= harmonics; n++) {
        // Band-limited pulse wave Fourier series
        real[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty);
        imag[n] = 0;
      }
      return this.ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    } catch {
      return null;
    }
  }
}
