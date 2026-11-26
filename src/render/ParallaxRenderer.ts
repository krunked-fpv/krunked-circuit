// ============================================================================
// Krunked Circuit — Crisp 15-Biome Multi-Layer Pixel Parallax Renderer
// Emits pure integer-aligned pixel quads via a lightweight draw target so both
// WebGL2Renderer and Canvas2DFallback render identical atmospheric 16-bit
// vistas across all 15 biomes with ZERO per-frame GPU/gradient/array allocations.
// ============================================================================

import {
  ENGINE_CONSTANTS,
  type BiomeGimmick,
  type StageDefinition,
} from '../contracts/index';
import { parseHexColor } from './shaders';

export interface ParallaxDrawTarget {
  fillRect(x: number, y: number, w: number, h: number, hexColor: string, alpha?: number): void;
  fillRgb?(x: number, y: number, w: number, h: number, r: number, g: number, b: number, a: number): void;
}

export interface ParallaxOptions {
  readonly camX: number;
  readonly camY: number;
  readonly tick: number;
  readonly palette: StageDefinition['palette'];
  readonly biomeGimmick?: BiomeGimmick;
  readonly hasStars?: boolean;
  readonly heatHaze?: boolean;
  readonly rhythmBeat?: number;
}

interface StarDef {
  readonly x: number;
  readonly y: number;
  readonly phase: number;
  readonly bright: boolean;
}

interface ParticleSeed {
  readonly x: number;
  readonly y: number;
  readonly speed: number;
  readonly phase: number;
  readonly size: number;
}

interface EqualizerTowerDef {
  readonly width: number;
  readonly maxBars: number;
  readonly phase: number;
  readonly tint: number;
}

const W = ENGINE_CONSTANTS.GAME_WIDTH;
const H = ENGINE_CONSTANTS.GAME_HEIGHT;

// Precomputed deterministic starfield (zero per-frame allocation)
const STARS: readonly StarDef[] = (() => {
  const list: StarDef[] = [];
  let s = 133742;
  for (let i = 0; i < 56; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const x = s % W;
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const y = 4 + (s % 146);
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    list.push({ x, y, phase: s % 120, bright: (s & 3) === 0 });
  }
  return list;
})();

// Precomputed rising foundry embers & drifting cryo snowflakes (zero per-frame allocation)
const EMBERS: readonly ParticleSeed[] = (() => {
  const list: ParticleSeed[] = [];
  let s = 884219;
  for (let i = 0; i < 28; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const x = s % W;
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const y = s % H;
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    list.push({ x, y, speed: 1 + (s % 2), phase: s % 64, size: (s & 3) === 0 ? 2 : 1 });
  }
  return list;
})();

const SNOWFLAKES: readonly ParticleSeed[] = (() => {
  const list: ParticleSeed[] = [];
  let s = 519273;
  for (let i = 0; i < 32; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const x = s % W;
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const y = s % H;
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    list.push({ x, y, speed: 1 + (s % 3), phase: s % 48, size: (s & 3) === 0 ? 2 : 1 });
  }
  return list;
})();

// Precomputed deterministic horizon profiles
const FAR_SILHOUETTES = [54, 72, 46, 86, 62, 42, 78, 56, 92, 50, 68, 44, 80, 60, 48, 70] as const;
const MID_SILHOUETTES = [34, 48, 28, 56, 38, 62, 30, 46, 40, 52, 32, 44] as const;
const CAVE_CEIL_HEIGHTS = [24, 38, 18, 44, 28, 34, 16, 42, 30, 22, 40, 26] as const;
const CAVE_FLOOR_HEIGHTS = [34, 52, 40, 64, 36, 58, 44, 70, 48, 38, 56, 42] as const;

// Precomputed Pulse Rhythm equalizer tower profiles
const EQ_TOWERS: readonly EqualizerTowerDef[] = [
  { width: 22, maxBars: 14, phase: 0, tint: 0 },
  { width: 18, maxBars: 11, phase: 1, tint: 1 },
  { width: 26, maxBars: 17, phase: 2, tint: 2 },
  { width: 20, maxBars: 12, phase: 3, tint: 0 },
  { width: 24, maxBars: 16, phase: 0, tint: 1 },
  { width: 18, maxBars: 10, phase: 2, tint: 2 },
  { width: 26, maxBars: 18, phase: 1, tint: 0 },
  { width: 20, maxBars: 13, phase: 3, tint: 1 },
  { width: 22, maxBars: 15, phase: 0, tint: 2 },
  { width: 18, maxBars: 11, phase: 2, tint: 0 },
  { width: 24, maxBars: 16, phase: 1, tint: 1 },
  { width: 22, maxBars: 14, phase: 3, tint: 2 },
] as const;

const EQ_COLORS = ['#2dd4bf', '#f472b6', '#a855f7'] as const;
const EQ_PEAK_COLORS = ['#ccfbf1', '#fce7f3', '#f3e8ff'] as const;

// Precomputed Orbital Spire curved planetary horizon (40 columns of 10px each)
const PLANET_ARC_COLS = 40;
const PLANET_ARC_Y: readonly number[] = (() => {
  const arr: number[] = [];
  for (let i = 0; i < PLANET_ARC_COLS; i++) {
    const nx = (i + 0.5) / PLANET_ARC_COLS - 0.5; // -0.5 .. +0.5
    // Gentle convex planetary curvature arching across lower horizon
    arr.push(Math.round(148 + nx * nx * 172));
  }
  return arr;
})();

// Precomputed storm cloud strips
const CLOUD_STRIPS = [
  { x: 10, y: 18, w: 94, h: 16 },
  { x: 132, y: 12, w: 118, h: 20 },
  { x: 274, y: 22, w: 104, h: 16 },
  { x: 46, y: 42, w: 112, h: 14 },
  { x: 196, y: 38, w: 126, h: 18 },
  { x: 332, y: 46, w: 86, h: 14 },
] as const;

// Precomputed jagged lightning bolt offsets
const LIGHTNING_DX = [0, -4, 3, -5, 4, -2, 6, -3, 2, -4] as const;

function posMod(v: number, m: number): number {
  const r = v % m;
  return r < 0 ? r + m : r;
}

function rgbToHex(r: number, g: number, b: number): string {
  const ri = Math.max(0, Math.min(255, Math.round(r * 255)));
  const gi = Math.max(0, Math.min(255, Math.round(g * 255)));
  const bi = Math.max(0, Math.min(255, Math.round(b * 255)));
  return '#' + ((1 << 24) | (ri << 16) | (gi << 8) | bi).toString(16).slice(1);
}

export class ParallaxRenderer {
  private cachedSkyKey = '';
  private readonly skyBands: string[] = new Array(8).fill('#0b0f1a');

  private ensureSkyBands(skyTop: string, skyBottom: string): void {
    const key = `${skyTop}|${skyBottom}`;
    if (key === this.cachedSkyKey) return;
    this.cachedSkyKey = key;

    const c0 = parseHexColor(skyTop);
    const c1 = parseHexColor(skyBottom);
    const bands = this.skyBands.length;
    for (let i = 0; i < bands; i++) {
      const t = i / (bands - 1);
      this.skyBands[i] = rgbToHex(
        c0.r + (c1.r - c0.r) * t,
        c0.g + (c1.g - c0.g) * t,
        c0.b + (c1.b - c0.b) * t,
      );
    }
  }

  public render(target: ParallaxDrawTarget, opts: ParallaxOptions): void {
    const { camX, camY, tick, palette, biomeGimmick, hasStars, heatHaze, rhythmBeat } = opts;
    this.ensureSkyBands(palette.skyTop, palette.skyBottom);

    // 1. Stepped 16-bit sky gradient with crisp 2px pixel-dither seams
    const bandCount = this.skyBands.length;
    const bandH = Math.ceil(H / bandCount);
    for (let i = 0; i < bandCount; i++) {
      const y = i * bandH;
      target.fillRect(0, y, W, bandH, this.skyBands[i], 1);
      if (i > 0) {
        for (let dx = 0; dx < W; dx += 4) {
          target.fillRect(dx, y, 2, 1, this.skyBands[i - 1], 0.85);
          target.fillRect(dx + 2, y + 1, 2, 1, this.skyBands[i - 1], 0.55);
        }
      }
    }

    // 2. Twinkling 16-bit starfield for night, cosmic, cyber & rhythm biomes
    const showStars =
      Boolean(hasStars) ||
      biomeGimmick === 'orbital_spire' ||
      biomeGimmick === 'metro_train' ||
      biomeGimmick === 'neon_matrix' ||
      biomeGimmick === 'skyway_convoy' ||
      biomeGimmick === 'pulse_rhythm' ||
      biomeGimmick === 'citadel_gauntlet' ||
      biomeGimmick === 'boss_rush_arena' ||
      biomeGimmick === 'hub_command';

    if (showStars) {
      const starShift = Math.floor(camX * 0.04);
      const starCount = biomeGimmick === 'orbital_spire' || biomeGimmick === 'pulse_rhythm' ? STARS.length : 42;
      for (let i = 0; i < starCount; i++) {
        const st = STARS[i];
        const sx = posMod(st.x - starShift, W);
        const twinkle = ((tick + st.phase) & 63) < 48;
        if (st.bright) {
          target.fillRect(sx, st.y, 2, 2, '#ffffff', twinkle ? 0.92 : 0.45);
          if (twinkle) {
            target.fillRect(sx - 1, st.y, 4, 1, palette.accent, 0.4);
          }
        } else {
          target.fillRect(sx, st.y, 1, 1, '#dbeeff', twinkle ? 0.75 : 0.3);
        }
      }
    }

    // 3. Dispatch to unmistakable bespoke multi-layer backdrop for ALL 15 biomes
    switch (biomeGimmick) {
      case 'hub_command':
        this.drawHubCommandBg(target, camX, tick, palette);
        break;
      case 'tutorial_course':
        this.drawTutorialCourseBg(target, camX, tick, palette);
        break;
      case 'metro_train':
        this.drawMetroCityBg(target, camX, camY, tick, palette);
        break;
      case 'solar_lasers':
        this.drawSolarLandmark(target, camX, tick, palette);
        break;
      case 'scrap_crushers':
        this.drawScrapFoundryBg(target, camX, tick, palette);
        break;
      case 'cryo_wind':
        this.drawCryoWindBg(target, camX, tick, palette);
        break;
      case 'surge_rails':
        this.drawSurgeRailsBg(target, camX, tick, palette);
        break;
      case 'skyway_convoy':
        this.drawSkywayConvoyBg(target, camX, tick, palette);
        break;
      case 'pulse_rhythm':
        this.drawPulseRhythmBg(target, camX, tick, palette, rhythmBeat);
        break;
      case 'quarry_walker':
        this.drawQuarryWalkerBg(target, camX, camY, tick, palette);
        break;
      case 'neon_matrix':
        this.drawNeonMatrixBg(target, camX, tick, palette);
        break;
      case 'citadel_gauntlet':
        this.drawCitadelGauntletBg(target, camX, camY, tick, palette);
        break;
      case 'core_reactor':
        this.drawCoreReactorBg(target, camX, tick, palette);
        break;
      case 'orbital_spire':
        this.drawOrbitalSpireBg(target, camX, tick, palette);
        break;
      case 'boss_rush_arena':
        this.drawBossRushArenaBg(target, camX, tick, palette);
        break;
      default:
        if (heatHaze) {
          this.drawSolarLandmark(target, camX, tick, palette);
        } else {
          this.drawMetroCityBg(target, camX, camY, tick, palette);
        }
        break;
    }
  }

  // --------------------------------------------------------------------------
  // 1. hub_command — Animated Cyber Command Bay Monitors & Floating Data Holos
  // --------------------------------------------------------------------------
  private drawHubCommandBg(
    target: ParallaxDrawTarget,
    camX: number,
    tick: number,
    palette: StageDefinition['palette'],
  ): void {
    const baySpan = 80;
    const bayOff = posMod(Math.floor(camX * 0.24), baySpan);

    // Upper steel command ceiling beam + glowing trim
    target.fillRect(0, 0, W, 20, palette.farBg, 0.94);
    target.fillRect(0, 20, W, 2, palette.accent, 0.55);

    for (let x = -baySpan; x < W + baySpan; x += baySpan) {
      const sx = x - bayOff;
      const bayIdx = Math.floor((x + Math.floor(camX * 0.24)) / baySpan);

      // Structural arched rib columns
      target.fillRect(sx, 20, 12, H - 20, palette.farBg, 1);
      target.fillRect(sx + 2, 22, 2, H - 22, palette.midBg, 0.8);
      target.fillRect(sx + 10, 22, 1, H - 22, palette.accent, 0.25);

      // Panoramic command viewport / tactical monitor bay
      target.fillRect(sx + 18, 34, 54, 44, palette.midBg, 0.95);
      target.fillRect(sx + 20, 36, 50, 40, '#071326', 0.92);
      target.fillRect(sx + 20, 36, 50, 1, palette.accent, 0.65);

      // Animated waveform / radar telemetry bars inside command screen
      for (let b = 0; b < 6; b++) {
        const bh = 5 + ((tick + b * 11 + bayIdx * 7) % 20);
        const col = (b & 1) === 0 ? palette.accent : '#4dffb5';
        target.fillRect(sx + 24 + b * 7, 72 - bh, 5, bh, col, 0.55);
        target.fillRect(sx + 24 + b * 7, 72 - bh, 5, 1, '#ffffff', 0.75);
      }

      // Sweeping monitor scanline
      const scanY = 38 + ((tick + bayIdx * 13) % 34);
      target.fillRect(sx + 20, scanY, 50, 1, palette.accent, 0.35);

      // Lower console wall paneling & blinking diagnostic LEDs
      target.fillRect(sx + 16, 90, 58, H - 90, palette.midBg, 0.72);
      target.fillRect(sx + 16, 90, 58, 2, palette.accent, 0.32);
      for (let led = 0; led < 4; led++) {
        const lit = ((tick >> 3) + led + bayIdx) % 4 === 0;
        target.fillRect(sx + 24 + led * 12, 98, 5, 3, lit ? '#4dffb5' : palette.farBg, 0.85);
      }
    }

    // Floating holographic data panels & rotating telemetry cubes (0.42x)
    const holoSpan = 104;
    const holoOff = posMod(Math.floor(camX * 0.42), holoSpan);
    for (let x = -holoSpan; x < W + holoSpan; x += holoSpan) {
      const hx = x - holoOff + 34;
      const bob = Math.round(Math.sin(tick * 0.07 + x * 0.05) * 4);
      const hy = 114 + bob;
      // Translucent holo frame
      target.fillRect(hx, hy, 28, 18, palette.accent, 0.14);
      target.fillRect(hx, hy, 28, 1, palette.accent, 0.72);
      target.fillRect(hx, hy + 17, 28, 1, palette.accent, 0.55);
      target.fillRect(hx, hy, 1, 18, palette.accent, 0.45);
      target.fillRect(hx + 27, hy, 1, 18, palette.accent, 0.45);
      // Scrolling data lines inside floating holo
      const barW = 8 + ((tick >> 2) % 14);
      target.fillRect(hx + 4, hy + 4, barW, 2, '#9cf0ff', 0.8);
      target.fillRect(hx + 4, hy + 9, 18, 1, '#4dffb5', 0.65);
      target.fillRect(hx + 4, hy + 12, 12, 1, palette.accent, 0.55);
      // Projector emitter beam downward
      target.fillRect(hx + 12, hy + 19, 4, 14, palette.accent, 0.12);
    }
  }

  // --------------------------------------------------------------------------
  // 2. tutorial_course — Clean VR Holographic Grid & Depth Beacons
  // --------------------------------------------------------------------------
  private drawTutorialCourseBg(
    target: ParallaxDrawTarget,
    camX: number,
    tick: number,
    palette: StageDefinition['palette'],
  ): void {
    const horizonY = 128;

    // Clean upper VR diagnostic telemetry lines
    for (let y = 24; y < horizonY; y += 26) {
      target.fillRect(0, y, W, 1, palette.midBg, 0.42);
    }
    target.fillRect(0, horizonY, W, 2, palette.accent, 0.68);
    target.fillRect(0, horizonY - 4, W, 4, palette.accent, 0.12);

    // Receding VR depth beacons along the horizon (0.16x)
    const beaconSpan = 64;
    const beaconOff = posMod(Math.floor(camX * 0.16), beaconSpan * 8);
    for (let x = -beaconSpan; x < W + beaconSpan; x += beaconSpan) {
      const idx = posMod(Math.floor((x + beaconOff) / beaconSpan), 8);
      const sx = x - (beaconOff % beaconSpan);
      const bh = 38 + (idx % 3) * 18;
      const topY = horizonY - bh;

      // Wireframe depth pylon
      target.fillRect(sx + 18, topY, 12, bh, palette.farBg, 0.85);
      target.fillRect(sx + 18, topY, 1, bh, palette.accent, 0.5);
      target.fillRect(sx + 29, topY, 1, bh, palette.accent, 0.5);
      // Pulsing distance calibration rings
      for (let ry = topY + 6; ry < horizonY - 6; ry += 12) {
        target.fillRect(sx + 16, ry, 16, 1, palette.accent, 0.45);
      }
      // Glowing floating diamond beacon tip
      const pulse = ((tick + idx * 11) & 31) < 16 ? 0.95 : 0.48;
      target.fillRect(sx + 22, topY - 8, 4, 4, palette.accent, pulse);
      target.fillRect(sx + 23, topY - 7, 2, 2, '#ffffff', pulse);
    }

    // Perspective VR holographic floor grid (accelerating horizontal lines + receding columns)
    const gridScroll = posMod(Math.floor(tick * 0.7), 16);
    for (let i = 0; i < 8; i++) {
      const t = (i + gridScroll / 16) / 8;
      const gy = Math.round(horizonY + t * t * (H - horizonY));
      if (gy >= horizonY && gy < H) {
        target.fillRect(0, gy, W, 1, palette.accent, 0.2 + t * 0.45);
      }
    }

    const colSpan = 36;
    const colOff = posMod(Math.floor(camX * 0.35), colSpan);
    for (let x = -colSpan; x < W + colSpan; x += colSpan) {
      const bx = x - colOff;
      // Stepped perspective ray from horizon toward bottom screen edge
      const dx = (bx - W * 0.5) * 0.65;
      for (let seg = 0; seg < 6; seg++) {
        const t = seg / 6;
        const px = Math.round(bx + dx * t);
        const py = Math.round(horizonY + t * (H - horizonY));
        const sh = Math.ceil((H - horizonY) / 6) + 1;
        target.fillRect(px, py, 1, sh, palette.accent, 0.25 + t * 0.3);
      }
    }

    // Floating holographic VR crosshair markers
    for (let i = 0; i < 4; i++) {
      const mx = posMod(i * 110 + 40 - Math.floor(camX * 0.28), W + 40) - 20;
      const my = 46 + (i % 2) * 28 + Math.round(Math.sin(tick * 0.06 + i) * 3);
      target.fillRect(mx - 6, my, 4, 1, '#4dffb5', 0.55);
      target.fillRect(mx + 3, my, 4, 1, '#4dffb5', 0.55);
      target.fillRect(mx, my - 6, 1, 4, '#4dffb5', 0.55);
      target.fillRect(mx, my + 3, 1, 4, '#4dffb5', 0.55);
    }
  }

  // --------------------------------------------------------------------------
  // 3. metro_train — Midnight Skyline & Moving Expressway Speeder Streaks
  // --------------------------------------------------------------------------
  private drawMetroCityBg(
    target: ParallaxDrawTarget,
    camX: number,
    camY: number,
    tick: number,
    palette: StageDefinition['palette'],
  ): void {
    const vOff = Math.round(camY * 0.06);

    // Far cyber-megacity skyline with lit pixel windows & blinking spires (0.18x)
    const farSpan = 36;
    const farOff = posMod(Math.floor(camX * 0.18), farSpan * FAR_SILHOUETTES.length);
    for (let x = -farSpan; x < W + farSpan; x += farSpan) {
      const idx = posMod(Math.floor((x + farOff) / farSpan), FAR_SILHOUETTES.length);
      const sx = x - (farOff % farSpan);
      const bh = FAR_SILHOUETTES[idx] + 24;
      const topY = H - 24 - bh - (vOff % 18);
      target.fillRect(sx, topY, farSpan - 4, bh + 44, palette.farBg, 1);
      target.fillRect(sx + 2, topY, farSpan - 8, 2, palette.midBg, 0.9);
      // Spire antenna + red/cyan warning beacon
      if (idx % 2 === 0) {
        target.fillRect(sx + 14, topY - 14, 2, 14, palette.farBg, 1);
        const blink = ((tick + idx * 17) & 63) < 28;
        target.fillRect(sx + 14, topY - 16, 2, 2, blink ? '#ff4b6e' : palette.accent, 0.92);
      }
      // Crisp lit window matrix
      for (let wy = topY + 6; wy < H - 48; wy += 8) {
        for (let wx = sx + 4; wx < sx + farSpan - 10; wx += 6) {
          if (((wx + wy + idx) & 7) !== 0) {
            target.fillRect(wx, wy, 3, 2, palette.accent, 0.38);
          }
        }
      }
    }

    // Midground expressway deck & support viaduct pillars (0.42x)
    const deckY = H - 64;
    target.fillRect(0, deckY, W, 7, palette.midBg, 1);
    target.fillRect(0, deckY, W, 1, palette.accent, 0.55);

    const pillarSpan = 56;
    const pillarOff = posMod(Math.floor(camX * 0.42), pillarSpan);
    for (let x = -pillarSpan; x < W + pillarSpan; x += pillarSpan) {
      const sx = x - pillarOff;
      target.fillRect(sx + 16, deckY + 7, 10, H - deckY, palette.midBg, 1);
      target.fillRect(sx + 18, deckY + 9, 2, H - deckY, palette.farBg, 0.8);
      // Curved overhead highway streetlamp
      target.fillRect(sx + 20, deckY - 26, 2, 26, palette.midBg, 1);
      target.fillRect(sx + 16, deckY - 26, 10, 2, palette.accent, 0.78);
      target.fillRect(sx + 18, deckY - 24, 6, 3, '#ffd166', 0.18);
    }

    // Fast-moving multi-lane expressway speeder streaks
    for (let i = 0; i < 8; i++) {
      const dir = i % 2 === 0 ? 1 : -1;
      const speed = dir === 1 ? 4 + (i & 1) : -3 - (i & 1);
      const lx = posMod(i * 61 + tick * speed - Math.floor(camX * 0.42), W + 56) - 28;
      const ly = deckY - 3 - (i % 3) * 3;
      const col = dir === 1 ? '#5ce1ff' : '#ff4d6d';
      target.fillRect(lx, ly, 14, 2, col, 0.88);
      target.fillRect(dir === 1 ? lx + 11 : lx, ly, 3, 2, '#ffffff', 0.9);
    }
  }

  // --------------------------------------------------------------------------
  // 4. solar_lasers — Desert Mesas, Solar Relay Dishes & Radiant Pixel Sun
  // --------------------------------------------------------------------------
  private drawSolarLandmark(
    target: ParallaxDrawTarget,
    camX: number,
    tick: number,
    palette: StageDefinition['palette'],
  ): void {
    // Blazing stepped pixelated sun with pulsing corona rings
    const sunX = 290 - (Math.floor(camX * 0.03) % 80);
    const sunY = 56;
    const coronaPulse = (tick & 16) !== 0 ? 2 : 0;
    target.fillRect(sunX - 34 - coronaPulse, sunY - 22, 68 + coronaPulse * 2, 44, palette.accent, 0.14);
    target.fillRect(sunX - 24, sunY - 28 - coronaPulse, 48, 56 + coronaPulse * 2, palette.accent, 0.16);
    target.fillRect(sunX - 18, sunY - 14, 36, 28, '#ffd166', 0.94);
    target.fillRect(sunX - 14, sunY - 18, 28, 36, '#ffd166', 0.94);
    target.fillRect(sunX - 12, sunY - 10, 24, 20, '#fff7cc', 0.98);

    // Distant stratified desert mesas + towering solar relay dishes (0.16x)
    const farSpan = 48;
    const farOff = posMod(Math.floor(camX * 0.16), farSpan * FAR_SILHOUETTES.length);
    for (let x = -farSpan; x < W + farSpan; x += farSpan) {
      const idx = posMod(Math.floor((x + farOff) / farSpan), FAR_SILHOUETTES.length);
      const sx = x - (farOff % farSpan);
      const h = 36 + (FAR_SILHOUETTES[idx] % 44);
      const topY = H - 36 - h;
      target.fillRect(sx, topY, farSpan + 1, h + 36, palette.farBg, 1);
      target.fillRect(sx + 6, topY - 6, farSpan - 12, 6, palette.farBg, 1);
      target.fillRect(sx + 8, topY - 6, farSpan - 16, 2, palette.accent, 0.38);
      // Mesa sedimentary strata stripe
      target.fillRect(sx + 2, topY + 12, farSpan - 4, 2, palette.midBg, 0.45);

      // Towering solar relay dish every 2nd mesa
      if (idx % 2 === 0) {
        const px = sx + 22;
        target.fillRect(px, topY - 34, 4, 30, palette.farBg, 1);
        // Parabolic dish arc
        target.fillRect(px - 8, topY - 32, 20, 3, palette.midBg, 1);
        target.fillRect(px - 6, topY - 35, 16, 3, '#ffe999', 0.7);
        const pulse = ((tick + idx * 11) & 31) < 16 ? 0.95 : 0.48;
        target.fillRect(px + 1, topY - 40, 2, 5, '#fff7cc', pulse);
        target.fillRect(px + 2, topY - 38, 1, 26, palette.accent, 0.3);
      }
    }

    // Midground heliostat reflector pylons & crossbeams (0.38x)
    const midSpan = 64;
    const midOff = posMod(Math.floor(camX * 0.38), midSpan * MID_SILHOUETTES.length);
    for (let x = -midSpan; x < W + midSpan; x += midSpan) {
      const idx = posMod(Math.floor((x + midOff) / midSpan), MID_SILHOUETTES.length);
      const sx = x - (midOff % midSpan);
      const h = 24 + (MID_SILHOUETTES[idx] % 34);
      const topY = H - 16 - h;
      target.fillRect(sx + 10, topY, 16, h + 16, palette.midBg, 1);
      target.fillRect(sx + 12, topY + 2, 12, 2, palette.accent, 0.55);
      target.fillRect(sx + 6, topY - 8, 24, 5, palette.midBg, 1);
      target.fillRect(sx + 8, topY - 7, 20, 2, '#ffe999', 0.65);
      target.fillRect(sx + 26, topY + 12, midSpan - 16, 2, palette.midBg, 0.8);
    }

    target.fillRect(0, H - 22, W, 22, palette.accent, 0.09);
  }

  // --------------------------------------------------------------------------
  // 5. scrap_crushers — Molten Foundry Furnace Glow, Rising Embers & Chains
  // --------------------------------------------------------------------------
  private drawScrapFoundryBg(
    target: ParallaxDrawTarget,
    camX: number,
    tick: number,
    palette: StageDefinition['palette'],
  ): void {
    // Pulsing molten furnace glow from below
    const glowPulse = 0.14 + Math.sin(tick * 0.08) * 0.05;
    target.fillRect(0, H - 72, W, 72, '#ff5400', glowPulse);
    target.fillRect(0, H - 36, W, 36, '#ff9e00', glowPulse + 0.08);
    target.fillRect(0, H - 14, W, 14, '#ffd166', 0.25);

    // Far blast furnaces & smelter smokestacks (0.16x)
    const farSpan = 56;
    const farOff = posMod(Math.floor(camX * 0.16), farSpan * FAR_SILHOUETTES.length);
    for (let x = -farSpan; x < W + farSpan; x += farSpan) {
      const idx = posMod(Math.floor((x + farOff) / farSpan), FAR_SILHOUETTES.length);
      const sx = x - (farOff % farSpan);
      const bh = 50 + (FAR_SILHOUETTES[idx] % 48);
      const topY = H - 20 - bh;
      target.fillRect(sx + 4, topY, 36, bh + 20, palette.farBg, 1);
      // Tall exhaust chimney
      target.fillRect(sx + 10, topY - 26, 10, 26, palette.farBg, 1);
      target.fillRect(sx + 8, topY - 28, 14, 3, palette.midBg, 1);
      // Glowing molten furnace grates
      const grateGlow = ((tick + idx * 13) & 31) < 18 ? 0.85 : 0.45;
      target.fillRect(sx + 10, topY + 14, 24, 6, '#ff6b1a', grateGlow);
      target.fillRect(sx + 12, topY + 16, 20, 2, '#ffe066', grateGlow);
    }

    // Midground heavy steel foundry girders & hanging industrial chains (0.36x)
    const chainSpan = 64;
    const chainOff = posMod(Math.floor(camX * 0.36), chainSpan);
    target.fillRect(0, 14, W, 6, palette.midBg, 0.92);
    target.fillRect(0, 20, W, 2, '#1c1410', 0.85);

    for (let x = -chainSpan; x < W + chainSpan; x += chainSpan) {
      const sx = x - chainOff;
      const sway = Math.round(Math.sin(tick * 0.05 + x * 0.04) * 2);
      const chainLen = 74 + (posMod(x, 3) * 18);
      // Hanging linked industrial chain
      for (let cy = 22; cy < 22 + chainLen; cy += 6) {
        const lx = sx + 28 + Math.round((sway * (cy - 22)) / chainLen);
        target.fillRect(lx, cy, 4, 4, '#261e1a', 0.95);
        target.fillRect(lx + 1, cy + 1, 2, 2, palette.midBg, 0.95);
      }
      // Heavy iron hook / crusher weight at chain tip
      const hx = sx + 25 + sway;
      const hy = 22 + chainLen;
      target.fillRect(hx, hy, 10, 8, palette.midBg, 0.95);
      target.fillRect(hx + 2, hy + 2, 6, 2, '#f97316', 0.65);
    }

    // Rising molten foundry embers (zero allocation, deterministic table)
    for (let i = 0; i < EMBERS.length; i++) {
      const em = EMBERS[i];
      const ex = posMod(
        em.x - Math.floor(camX * 0.48) + Math.round(Math.sin((tick + em.phase) * 0.08) * 6),
        W,
      );
      const ey = posMod(em.y - tick * em.speed, H);
      const hot = ((tick + em.phase) & 15) < 8;
      target.fillRect(ex, ey, em.size, em.size, hot ? '#ffe066' : '#ff6b1a', 0.85);
    }
  }

  // --------------------------------------------------------------------------
  // 6. cryo_wind — Crystalline Glacier Peaks, Aurora Ribbons & Drifting Snow
  // --------------------------------------------------------------------------
  private drawCryoWindBg(
    target: ParallaxDrawTarget,
    camX: number,
    tick: number,
    palette: StageDefinition['palette'],
  ): void {
    // Shimmering undulating aurora borealis ribbons in upper arctic sky
    for (let col = 0; col < W; col += 8) {
      const wave1 = Math.round(Math.sin(col * 0.032 + tick * 0.035) * 10);
      const wave2 = Math.round(Math.cos(col * 0.022 - tick * 0.025) * 7);
      const ay1 = 26 + wave1;
      const ay2 = 44 + wave2;
      target.fillRect(col, ay1, 8, 12, '#2dd4bf', 0.16);
      target.fillRect(col, ay1 + 4, 8, 4, '#67e8f9', 0.24);
      target.fillRect(col, ay2, 8, 10, '#818cf8', 0.14);
      target.fillRect(col, ay2 + 3, 8, 3, '#a7f3d0', 0.2);
    }

    // Far jagged crystalline glacier mountain peaks (0.14x)
    const span = 56;
    const farOff = posMod(Math.floor(camX * 0.14), span * FAR_SILHOUETTES.length);
    for (let x = -span; x < W + span; x += span) {
      const idx = posMod(Math.floor((x + farOff) / span), FAR_SILHOUETTES.length);
      const sx = x - (farOff % span);
      const peakH = 52 + (FAR_SILHOUETTES[idx] % 54);
      for (let step = 0; step < 7; step++) {
        const w = span - step * 7;
        const y = H - 22 - Math.floor((peakH * (step + 1)) / 7);
        target.fillRect(sx + step * 3, y, w, 18, palette.farBg, 1);
        // Faceted crystalline ice highlight on left slope
        target.fillRect(sx + step * 3, y, Math.max(2, Math.floor(w * 0.28)), 6, palette.midBg, 0.72);
      }
      // Gleaming snow-capped summit
      target.fillRect(sx + 21, H - 22 - peakH, 10, 5, '#e6fbff', 0.82);
    }

    // Midground translucent ice crystal spires (0.34x)
    const midSpan = 72;
    const midOff = posMod(Math.floor(camX * 0.34), midSpan * MID_SILHOUETTES.length);
    for (let x = -midSpan; x < W + midSpan; x += midSpan) {
      const idx = posMod(Math.floor((x + midOff) / midSpan), MID_SILHOUETTES.length);
      const sx = x - (midOff % midSpan);
      const ch = 26 + (MID_SILHOUETTES[idx] % 34);
      const topY = H - 14 - ch;
      target.fillRect(sx + 16, topY, 14, ch + 14, palette.midBg, 0.9);
      target.fillRect(sx + 18, topY - 6, 10, 6, '#67e8f9', 0.55);
      target.fillRect(sx + 17, topY + 2, 3, ch, '#e0f2fe', 0.4);
    }

    // Drifting pixel snow & brisk horizontal wind streaks (zero allocation)
    for (let i = 0; i < SNOWFLAKES.length; i++) {
      const sn = SNOWFLAKES[i];
      const sx = posMod(sn.x - tick * (sn.speed + 1) - Math.floor(camX * 0.52), W);
      const sy = posMod(sn.y + Math.floor(tick * 0.75) + Math.round(Math.sin((tick + sn.phase) * 0.09) * 2), H);
      if ((i & 3) === 0) {
        target.fillRect(sx, sy, 5, 1, '#e6fbff', 0.55); // arctic wind streak
      } else {
        target.fillRect(sx, sy, sn.size, sn.size, '#ffffff', 0.72); // drifting pixel snowflake
      }
    }
  }

  // --------------------------------------------------------------------------
  // 7. surge_rails — Stormy Clouds, High-Voltage Pylons & Distant Lightning
  // --------------------------------------------------------------------------
  private drawSurgeRailsBg(
    target: ParallaxDrawTarget,
    camX: number,
    tick: number,
    palette: StageDefinition['palette'],
  ): void {
    // Periodic dramatic distant sky lightning flash & bolt (every 180 ticks)
    const stormCycle = tick % 180;
    const flashActive = stormCycle === 160 || stormCycle === 161 || stormCycle === 164 || stormCycle === 165;
    if (flashActive) {
      target.fillRect(0, 0, W, H, '#dbeafe', stormCycle === 160 ? 0.24 : 0.14);
      const boltX = 80 + ((Math.floor(tick / 180) * 137) % 240);
      let bx = boltX;
      for (let seg = 0; seg < LIGHTNING_DX.length; seg++) {
        const nextX = bx + LIGHTNING_DX[seg];
        const by = 14 + seg * 12;
        target.fillRect(Math.min(bx, nextX) - 1, by, Math.abs(nextX - bx) + 4, 13, '#60a5fa', 0.55);
        target.fillRect(Math.min(bx, nextX), by, Math.abs(nextX - bx) + 2, 12, '#ffffff', 0.95);
        bx = nextX;
      }
    }

    // Layered stormy midnight clouds (0.1x + drift)
    const cloudOff = posMod(Math.floor(camX * 0.1 + tick * 0.25), W + 80);
    for (let i = 0; i < CLOUD_STRIPS.length; i++) {
      const cl = CLOUD_STRIPS[i];
      const cx = posMod(cl.x - cloudOff, W + 80) - 40;
      target.fillRect(cx, cl.y, cl.w, cl.h, palette.farBg, 0.82);
      target.fillRect(cx + 10, cl.y - 4, cl.w - 20, 6, palette.midBg, 0.72);
      if (flashActive) {
        target.fillRect(cx + 8, cl.y + cl.h - 2, cl.w - 16, 2, '#93c5fd', 0.65);
      }
    }

    // Towering high-voltage transmission pylon silhouettes & sagging cables (0.28x)
    const pylonSpan = 88;
    const pylonOff = posMod(Math.floor(camX * 0.28), pylonSpan);
    for (let x = -pylonSpan; x < W + pylonSpan; x += pylonSpan) {
      const sx = x - pylonOff;
      const baseTop = 76;
      // Tapered steel lattice tower legs
      target.fillRect(sx + 18, baseTop, 4, H - baseTop, palette.farBg, 1);
      target.fillRect(sx + 14, baseTop + 42, 4, H - baseTop - 42, palette.farBg, 1);
      target.fillRect(sx + 22, baseTop + 42, 4, H - baseTop - 42, palette.farBg, 1);
      // Cross-arms
      target.fillRect(sx + 2, baseTop + 12, 36, 3, palette.farBg, 1);
      target.fillRect(sx + 6, baseTop + 30, 28, 3, palette.farBg, 1);
      // Glowing ceramic insulators + spark pulse
      const arcLit = ((tick + x) & 31) < 8;
      target.fillRect(sx + 3, baseTop + 15, 3, 4, arcLit ? '#ffffff' : palette.accent, 0.9);
      target.fillRect(sx + 34, baseTop + 15, 3, 4, arcLit ? '#ffffff' : palette.accent, 0.9);
      // Stepped catenary power cables spanning to next pylon
      for (let s = 0; s < 8; s++) {
        const sag = s === 0 || s === 7 ? 0 : s === 1 || s === 6 ? 3 : s === 2 || s === 5 ? 6 : 8;
        const cx = sx + 36 + s * 7;
        target.fillRect(cx, baseTop + 17 + sag, 7, 1, palette.midBg, 0.85);
        target.fillRect(cx, baseTop + 34 + sag, 7, 1, palette.midBg, 0.72);
      }
    }

    // Midground substation transformer housings (0.45x)
    const subSpan = 72;
    const subOff = posMod(Math.floor(camX * 0.45), subSpan);
    for (let x = -subSpan; x < W + subSpan; x += subSpan) {
      const sx = x - subOff;
      target.fillRect(sx + 12, H - 44, 28, 44, palette.midBg, 0.92);
      target.fillRect(sx + 16, H - 52, 4, 8, palette.accent, 0.65);
      target.fillRect(sx + 32, H - 52, 4, 8, palette.accent, 0.65);
      const pulse = ((tick >> 2) + x) % 12 === 0;
      if (pulse) {
        target.fillRect(sx + 18, H - 51, 16, 2, '#38f8ff', 0.85);
      }
    }
  }

  // --------------------------------------------------------------------------
  // 8. skyway_convoy — Racing Clouds, Distant Airships & Streaking Girders
  // --------------------------------------------------------------------------
  private drawSkywayConvoyBg(
    target: ParallaxDrawTarget,
    camX: number,
    tick: number,
    palette: StageDefinition['palette'],
  ): void {
    // High-altitude fast-racing cloud decks (0.14x + fast wind drift)
    const cloudShift = posMod(Math.floor(camX * 0.14 + tick * 1.4), W + 120);
    for (let i = 0; i < 6; i++) {
      const cy = 148 + (i % 3) * 26;
      const cw = 90 + (i % 3) * 34;
      const cx = posMod(i * 88 - cloudShift, W + 120) - 60;
      target.fillRect(cx, cy, cw, 16, palette.midBg, 0.55);
      target.fillRect(cx + 12, cy - 5, cw - 24, 7, '#fda4af', 0.25);
      target.fillRect(cx + 6, cy + 12, cw - 12, 6, palette.farBg, 0.7);
    }

    // Distant patrolling convoy airships (0.12x + slow hover cruise)
    for (let i = 0; i < 3; i++) {
      const ax = posMod(i * 155 + 40 - Math.floor(camX * 0.12 + tick * 0.35), W + 96) - 48;
      const ay = 42 + i * 28 + Math.round(Math.sin(tick * 0.05 + i * 2) * 3);
      // Streamlined hull
      target.fillRect(ax + 4, ay, 36, 10, palette.farBg, 0.95);
      target.fillRect(ax, ay + 3, 44, 5, palette.midBg, 0.95);
      target.fillRect(ax + 8, ay - 3, 18, 3, palette.midBg, 0.9);
      // Lower gondola & illuminated portholes
      target.fillRect(ax + 12, ay + 10, 16, 4, palette.farBg, 0.95);
      target.fillRect(ax + 8, ay + 4, 3, 2, palette.accent, 0.9);
      target.fillRect(ax + 15, ay + 4, 3, 2, palette.accent, 0.9);
      target.fillRect(ax + 22, ay + 4, 3, 2, palette.accent, 0.9);
      // Flickering rear thruster plume
      const flame = 6 + ((tick + i * 5) & 7);
      target.fillRect(ax + 44, ay + 4, flame, 3, '#34d399', 0.8);
      target.fillRect(ax + 44, ay + 5, Math.max(2, flame - 3), 1, '#ffffff', 0.9);
    }

    // Fast-streaking midground skyway bridge girders & suspension cables (0.55x)
    const girderSpan = 96;
    const girderOff = posMod(Math.floor(camX * 0.55 + tick * 2), girderSpan);
    // Horizontal skyway truss deck
    target.fillRect(0, H - 46, W, 6, palette.farBg, 0.92);
    target.fillRect(0, H - 46, W, 1, palette.accent, 0.6);

    for (let x = -girderSpan; x < W + girderSpan; x += girderSpan) {
      const sx = x - girderOff;
      // Vertical steel suspension pier
      target.fillRect(sx + 10, 0, 8, H, palette.farBg, 0.72);
      target.fillRect(sx + 12, 0, 2, H, palette.midBg, 0.65);
      // Diagonal bracing truss
      for (let d = 0; d < 4; d++) {
        target.fillRect(sx + 18 + d * 18, H - 40 + d * 8, 18, 3, palette.midBg, 0.7);
      }
      // Speed-streak marker beacon
      target.fillRect(sx + 12, H - 52, 4, 4, '#34d399', 0.9);
    }
  }

  // --------------------------------------------------------------------------
  // 9. pulse_rhythm — Deep Starry Sky & Beat-Synced Neon Equalizer Towers
  // --------------------------------------------------------------------------
  private drawPulseRhythmBg(
    target: ParallaxDrawTarget,
    camX: number,
    tick: number,
    palette: StageDefinition['palette'],
    rhythmBeat?: number,
  ): void {
    const beat = rhythmBeat ?? (Math.floor(tick / 30) % 4);
    const beatTick = tick % 30;
    const beatDecay = Math.max(0, 1 - beatTick / 16); // Sharp punch on every 30-tick beat!

    // Pulsing synthwave horizon glow synced to rhythmBeat
    target.fillRect(0, H - 60, W, 60, '#d946ef', 0.1 + beatDecay * 0.12);
    target.fillRect(0, H - 24, W, 24, '#2dd4bf', 0.08 + beatDecay * 0.1);

    // Beat-synced Neon Equalizer Skyscraper Towers (0.22x)
    const towerSpan = 34;
    const towerOff = posMod(Math.floor(camX * 0.22), towerSpan * EQ_TOWERS.length);
    for (let x = -towerSpan; x < W + towerSpan; x += towerSpan) {
      const idx = posMod(Math.floor((x + towerOff) / towerSpan), EQ_TOWERS.length);
      const sx = x - (towerOff % towerSpan);
      const td = EQ_TOWERS[idx];

      // Dark skyscraper housing behind LED equalizer
      const housingH = td.maxBars * 6 + 18;
      const baseBottom = H - 14;
      target.fillRect(sx + 2, baseBottom - housingH, td.width, housingH + 14, palette.farBg, 0.92);

      // Compute beat-reactive bar count (strong surge on matching beat phase!)
      const phaseMatch = td.phase === beat ? 1.0 : td.phase === ((beat + 2) & 3) ? 0.62 : 0.35;
      const activeRatio = 0.28 + phaseMatch * (0.35 + beatDecay * 0.37);
      const activeBars = Math.max(2, Math.min(td.maxBars, Math.round(td.maxBars * activeRatio)));
      const barCol = EQ_COLORS[td.tint];
      const peakCol = EQ_PEAK_COLORS[td.tint];

      for (let b = 0; b < activeBars; b++) {
        const by = baseBottom - 6 - b * 6;
        const isTop = b === activeBars - 1;
        target.fillRect(sx + 5, by, td.width - 6, 4, isTop ? peakCol : barCol, isTop ? 0.96 : 0.72);
      }
      // Subtle peak-hold cap floating 1 bar above active level
      const peakY = baseBottom - 6 - Math.min(td.maxBars, activeBars + 1) * 6;
      target.fillRect(sx + 5, peakY, td.width - 6, 2, '#ffffff', 0.45 + beatDecay * 0.45);
    }

    // Foreground neon rhythm pulse bars along bottom deck (0.45x)
    const pulseLineY = H - 18;
    target.fillRect(0, pulseLineY, W, 2, beat === 0 ? '#ffffff' : palette.accent, 0.5 + beatDecay * 0.48);
    const beatMarkerSpan = 48;
    const beatOff = posMod(Math.floor(camX * 0.45), beatMarkerSpan);
    for (let x = -beatMarkerSpan; x < W + beatMarkerSpan; x += beatMarkerSpan) {
      const mx = x - beatOff;
      target.fillRect(mx + 16, pulseLineY - 4, 16, 4, '#f5a6ff', 0.35 + beatDecay * 0.55);
    }
  }

  // --------------------------------------------------------------------------
  // 10. quarry_walker — Subterranean Basalt Caverns, Trusses & Ore Veins
  // --------------------------------------------------------------------------
  private drawQuarryWalkerBg(
    target: ParallaxDrawTarget,
    camX: number,
    camY: number,
    tick: number,
    palette: StageDefinition['palette'],
  ): void {
    const vShift = Math.round(camY * 0.04) % 16;

    // Upper subterranean basalt ceiling stalactites (0.16x)
    const ceilSpan = 36;
    const ceilOff = posMod(Math.floor(camX * 0.16), ceilSpan * CAVE_CEIL_HEIGHTS.length);
    for (let x = -ceilSpan; x < W + ceilSpan; x += ceilSpan) {
      const idx = posMod(Math.floor((x + ceilOff) / ceilSpan), CAVE_CEIL_HEIGHTS.length);
      const sx = x - (ceilOff % ceilSpan);
      const ch = CAVE_CEIL_HEIGHTS[idx];
      target.fillRect(sx, 0, ceilSpan + 1, ch, palette.farBg, 1);
      target.fillRect(sx + 8, ch, ceilSpan - 16, 10, palette.farBg, 1);
      target.fillRect(sx + 14, ch + 10, ceilSpan - 28, 8, palette.farBg, 1);
    }

    // Far layered basalt cavern walls with pulsing glowing ore veins (0.2x)
    const farSpan = 40;
    const farOff = posMod(Math.floor(camX * 0.2), farSpan * CAVE_FLOOR_HEIGHTS.length);
    const orePulse = 0.55 + Math.sin(tick * 0.08) * 0.3;
    for (let x = -farSpan; x < W + farSpan; x += farSpan) {
      const idx = posMod(Math.floor((x + farOff) / farSpan), CAVE_FLOOR_HEIGHTS.length);
      const sx = x - (farOff % farSpan);
      const fh = CAVE_FLOOR_HEIGHTS[idx] + 40;
      const topY = H - fh - vShift;
      target.fillRect(sx, topY, farSpan + 1, fh + 24, palette.farBg, 1);
      // Basalt terraced ridge highlight
      target.fillRect(sx + 4, topY + 2, farSpan - 8, 3, palette.midBg, 0.8);
      // Glowing crystalline amber/orange ore vein embedded in basalt strata
      if ((idx & 1) === 0) {
        const oy = topY + 18 + (idx % 3) * 10;
        target.fillRect(sx + 8, oy, 10, 3, '#f97316', orePulse);
        target.fillRect(sx + 14, oy + 3, 12, 3, '#ffd166', orePulse);
        target.fillRect(sx + 16, oy + 4, 4, 1, '#fff7cc', 0.9);
      }
    }

    // Midground heavy steel mining support trusses & worklamps (0.4x)
    const trussSpan = 84;
    const trussOff = posMod(Math.floor(camX * 0.4), trussSpan);
    for (let x = -trussSpan; x < W + trussSpan; x += trussSpan) {
      const sx = x - trussOff;
      // Vertical steel I-beam support column
      target.fillRect(sx + 14, 16, 10, H - 16, palette.midBg, 0.92);
      target.fillRect(sx + 16, 16, 2, H - 16, '#261a18', 0.85);
      // Crossbeam truss header + diagonal braces
      target.fillRect(sx, 24, trussSpan, 5, palette.midBg, 0.9);
      target.fillRect(sx + 24, 29, 10, 4, palette.midBg, 0.85);
      target.fillRect(sx + 30, 33, 8, 4, palette.midBg, 0.85);
      // Hanging warm mining worklamp
      target.fillRect(sx + 52, 29, 2, 10, '#261a18', 1);
      target.fillRect(sx + 49, 39, 8, 4, '#ffd166', 0.92);
      target.fillRect(sx + 43, 43, 20, 26, '#f97316', 0.11);
    }
  }

  // --------------------------------------------------------------------------
  // 11. neon_matrix — Perspective Scrolling Wireframe Grid & Cyber Glyphs
  // --------------------------------------------------------------------------
  private drawNeonMatrixBg(
    target: ParallaxDrawTarget,
    camX: number,
    tick: number,
    palette: StageDefinition['palette'],
  ): void {
    const horizonY = 122;

    // Glowing matrix horizon band
    target.fillRect(0, horizonY - 2, W, 4, palette.accent, 0.35);
    target.fillRect(0, horizonY, W, 1, '#86efac', 0.85);

    // Perspective scrolling wireframe grid (both ceiling & floor planes!)
    const scrollPhase = posMod(tick * 0.9, 16) / 16;
    for (let i = 0; i < 7; i++) {
      const t = (i + scrollPhase) / 7;
      const dist = Math.round(t * t * 116);
      const floorY = horizonY + dist;
      const ceilY = horizonY - dist;
      const alpha = 0.14 + t * 0.45;
      if (floorY < H) target.fillRect(0, floorY, W, 1, '#10b981', alpha);
      if (ceilY > 0) target.fillRect(0, ceilY, W, 1, palette.accent, alpha * 0.72);
    }

    // Perspective vertical wireframe lines scrolling with camera
    const colSpan = 28;
    const colOff = posMod(Math.floor(camX * 0.24), colSpan);
    for (let x = -colSpan; x < W + colSpan; x += colSpan) {
      const sx = x - colOff;
      target.fillRect(sx, 0, 1, H, palette.midBg, 0.42);
      // Stepped floor perspective fan line
      const fanDx = (sx - W * 0.5) * 0.55;
      for (let seg = 0; seg < 5; seg++) {
        const t = seg / 5;
        const px = Math.round(sx + fanDx * t);
        const py = Math.round(horizonY + t * (H - horizonY));
        target.fillRect(px, py, 1, 25, '#10b981', 0.22 + t * 0.32);
      }
    }

    // Cascading digital cyber-glyph data rain streams (0.32x)
    const rainSpan = 22;
    const rainOff = posMod(Math.floor(camX * 0.32), rainSpan);
    for (let i = 0; i < 20; i++) {
      const gx = i * rainSpan - rainOff + 6;
      if (gx < -6 || gx > W + 6) continue;
      const speed = 1 + (i % 3);
      const dropY = posMod(tick * speed + i * 37, H + 56) - 48;
      // Trail of segmented glowing pixel glyphs
      for (let g = 0; g < 5; g++) {
        const gy = dropY - g * 7;
        if (gy < -6 || gy > H) continue;
        const glyphW = ((i + g + (tick >> 3)) & 1) === 0 ? 3 : 2;
        const alpha = 0.78 - g * 0.14;
        target.fillRect(gx, gy, glyphW, 4, g === 0 ? '#ffffff' : (i & 2) === 0 ? '#86efac' : palette.accent, alpha);
      }
    }
  }

  // --------------------------------------------------------------------------
  // 12. citadel_gauntlet — Ominous Fortress Spires & Sweeping Searchlights
  // --------------------------------------------------------------------------
  private drawCitadelGauntletBg(
    target: ParallaxDrawTarget,
    camX: number,
    camY: number,
    tick: number,
    palette: StageDefinition['palette'],
  ): void {
    const vShift = Math.round(camY * 0.05) % 18;

    // Sweeping diagonal crimson/amber fortress searchlight beams
    for (let s = 0; s < 3; s++) {
      const originX = 70 + s * 130;
      const sweep = Math.sin(tick * 0.025 + s * 2.1) * 76;
      for (let step = 0; step < 12; step++) {
        const t = step / 12;
        const bx = Math.round(originX + sweep * t);
        const by = Math.round(H - 20 - t * 180);
        const bw = 6 + Math.round(t * 16);
        target.fillRect(bx - Math.floor(bw / 2), by, bw, 16, palette.accent, 0.08);
      }
    }

    // Ominous gothic-cyber citadel fortress spires (0.16x)
    const spireSpan = 46;
    const spireOff = posMod(Math.floor(camX * 0.16), spireSpan * FAR_SILHOUETTES.length);
    for (let x = -spireSpan; x < W + spireSpan; x += spireSpan) {
      const idx = posMod(Math.floor((x + spireOff) / spireSpan), FAR_SILHOUETTES.length);
      const sx = x - (spireOff % spireSpan);
      const sh = 56 + FAR_SILHOUETTES[idx];
      const topY = H - 20 - sh - vShift;

      // Armored bastion body + jagged spire needle
      target.fillRect(sx + 4, topY, 34, sh + 36, palette.farBg, 1);
      target.fillRect(sx + 10, topY - 16, 22, 16, palette.farBg, 1);
      target.fillRect(sx + 16, topY - 30, 10, 14, palette.farBg, 1);
      target.fillRect(sx + 19, topY - 42, 4, 12, palette.farBg, 1);
      // Glowing vertical fortress energy slits
      const pulse = ((tick + idx * 9) & 31) < 20 ? 0.85 : 0.45;
      target.fillRect(sx + 13, topY + 10, 3, 22, palette.accent, pulse);
      target.fillRect(sx + 26, topY + 10, 3, 22, '#ff4d6d', pulse);
      target.fillRect(sx + 20, topY - 44, 2, 4, '#ff4d6d', 0.92);
    }

    // Midground armored citadel rampart buttresses (0.38x)
    const midSpan = 64;
    const midOff = posMod(Math.floor(camX * 0.38), midSpan);
    for (let x = -midSpan; x < W + midSpan; x += midSpan) {
      const sx = x - midOff;
      target.fillRect(sx + 6, H - 56, 24, 56, palette.midBg, 0.95);
      target.fillRect(sx + 6, H - 62, 8, 6, palette.midBg, 0.95);
      target.fillRect(sx + 22, H - 62, 8, 6, palette.midBg, 0.95);
      target.fillRect(sx + 10, H - 48, 16, 2, palette.accent, 0.55);
    }
  }

  // --------------------------------------------------------------------------
  // 13. core_reactor — Pulsing Energy Core Conduits & Containment Rings
  // --------------------------------------------------------------------------
  private drawCoreReactorBg(
    target: ParallaxDrawTarget,
    camX: number,
    tick: number,
    palette: StageDefinition['palette'],
  ): void {
    const corePulse = 0.5 + Math.sin(tick * 0.12) * 0.35;

    // Distant colossal central plasma reactor column (0.08x)
    const coreX = posMod(200 - Math.floor(camX * 0.08), W + 80) - 40;
    target.fillRect(coreX - 28, 0, 56, H, palette.farBg, 0.88);
    target.fillRect(coreX - 18, 0, 36, H, '#3b82f6', 0.25 + corePulse * 0.2);
    target.fillRect(coreX - 10, 0, 20, H, palette.accent, 0.38 + corePulse * 0.3);
    target.fillRect(coreX - 4, 0, 8, H, '#ffffff', 0.55 + corePulse * 0.35);

    // Concentric containment rings clasping the central reactor core
    for (let ry = 18; ry < H; ry += 32) {
      target.fillRect(coreX - 34, ry, 68, 6, palette.midBg, 0.95);
      target.fillRect(coreX - 30, ry + 2, 60, 2, '#bae6fd', 0.55);
    }

    // Midground vertical energy conduit pipes & surging plasma packets (0.34x)
    const pipeSpan = 64;
    const pipeOff = posMod(Math.floor(camX * 0.34), pipeSpan);
    for (let x = -pipeSpan; x < W + pipeSpan; x += pipeSpan) {
      const sx = x - pipeOff;
      // Heavy containment conduit column
      target.fillRect(sx + 10, 0, 14, H, palette.farBg, 0.94);
      target.fillRect(sx + 13, 0, 8, H, palette.midBg, 0.9);
      target.fillRect(sx + 16, 0, 2, H, '#38bdf8', 0.55);
      // Surging energy charge packet climbing conduit
      const packetY = posMod(H - tick * 3 - x * 3, H + 32) - 16;
      target.fillRect(sx + 13, packetY, 8, 14, palette.accent, 0.85);
      target.fillRect(sx + 15, packetY + 2, 4, 10, '#ffffff', 0.9);
      // Horizontal stabilizer bridge
      target.fillRect(sx, 72, pipeSpan, 4, palette.farBg, 0.85);
      target.fillRect(sx, 168, pipeSpan, 4, palette.farBg, 0.85);
    }
  }

  // --------------------------------------------------------------------------
  // 14. orbital_spire — Deep Orbital Starfield & Curved Planet Horizon
  // --------------------------------------------------------------------------
  private drawOrbitalSpireBg(
    target: ParallaxDrawTarget,
    camX: number,
    tick: number,
    palette: StageDefinition['palette'],
  ): void {
    // Distant orbital halo ring / satellite arc in upper space (0.05x)
    const satX = posMod(310 - Math.floor(camX * 0.05), W + 60) - 30;
    const satY = 46;
    target.fillRect(satX - 18, satY, 36, 3, '#c084fc', 0.55);
    target.fillRect(satX - 6, satY - 6, 12, 15, palette.midBg, 0.9);
    target.fillRect(satX - 2, satY - 2, 4, 4, palette.accent, ((tick & 16) !== 0) ? 0.95 : 0.45);

    // Sweeping stepped curved planetary horizon along lower vista (precomputed curve!)
    const colW = Math.ceil(W / PLANET_ARC_COLS);
    const atmPulse = 0.24 + Math.sin(tick * 0.06) * 0.06;
    for (let i = 0; i < PLANET_ARC_COLS; i++) {
      const px = i * colW;
      const py = PLANET_ARC_Y[i];
      // Outer atmospheric cyan/violet glow rim
      target.fillRect(px, py - 10, colW, 10, '#38bdf8', atmPulse * 0.45);
      target.fillRect(px, py - 4, colW, 4, '#a855f7', atmPulse + 0.25);
      target.fillRect(px, py, colW, 2, '#e9d5ff', 0.88);
      // Planet body with subtle orbital city-light clusters
      target.fillRect(px, py + 2, colW, H - py, palette.farBg, 1);
      if ((i % 3) === 0 && py + 16 < H) {
        target.fillRect(px + 2, py + 14, 4, 2, palette.accent, 0.48);
      }
      if ((i % 5) === 1 && py + 28 < H) {
        target.fillRect(px + 3, py + 26, 5, 2, '#38bdf8', 0.4);
      }
    }

    // Sleek foreground orbital spire observation struts & window frames (0.32x)
    const strutSpan = 96;
    const strutOff = posMod(Math.floor(camX * 0.32), strutSpan);
    for (let x = -strutSpan; x < W + strutSpan; x += strutSpan) {
      const sx = x - strutOff;
      target.fillRect(sx + 8, 0, 10, H, '#17082b', 0.82);
      target.fillRect(sx + 10, 0, 2, H, palette.midBg, 0.78);
      target.fillRect(sx + 17, 0, 1, H, palette.accent, 0.42);
      // Observation spire beacon node
      target.fillRect(sx + 11, 84, 4, 8, palette.accent, ((tick + x) & 31) < 16 ? 0.9 : 0.4);
    }
  }

  // --------------------------------------------------------------------------
  // 15. boss_rush_arena — High-Tech Coliseum Spotlights & Championship Pillars
  // --------------------------------------------------------------------------
  private drawBossRushArenaBg(
    target: ParallaxDrawTarget,
    camX: number,
    tick: number,
    palette: StageDefinition['palette'],
  ): void {
    // Sweeping crossing high-tech coliseum spotlight beams
    for (let s = 0; s < 4; s++) {
      const baseX = 48 + s * 102;
      const sway = Math.sin(tick * 0.04 + s * 1.6) * 68;
      const beamCol = (s & 1) === 0 ? '#f43f5e' : '#a78bfa';
      for (let step = 0; step < 12; step++) {
        const t = step / 12;
        const bx = Math.round(baseX + sway * t);
        const by = Math.round(H - 12 - t * 210);
        const bw = 6 + Math.round(t * 20);
        target.fillRect(bx - Math.floor(bw / 2), by, bw, 18, beamCol, 0.09);
      }
    }

    // Tiered cyber-coliseum stadium balconies & cheering light matrix
    for (let tier = 0; tier < 3; tier++) {
      const ty = 136 + tier * 24;
      target.fillRect(0, ty, W, 14, palette.farBg, 0.92);
      target.fillRect(0, ty, W, 2, palette.midBg, 0.95);
      // Animated stadium light pixels
      for (let lx = 8; lx < W - 8; lx += 14) {
        const sparkle = ((tick + lx + tier * 17) & 31) < 14;
        if (sparkle) {
          target.fillRect(lx, ty + 5, 3, 2, (lx & 16) !== 0 ? '#ffd166' : '#5ce1ff', 0.72);
        }
      }
    }

    // Towering championship plasma energy pillars (0.28x)
    const pillarSpan = 88;
    const pillarOff = posMod(Math.floor(camX * 0.28), pillarSpan);
    const pulse = 0.55 + Math.sin(tick * 0.14) * 0.35;
    for (let x = -pillarSpan; x < W + pillarSpan; x += pillarSpan) {
      const sx = x - pillarOff;
      // Armored pillar frame
      target.fillRect(sx + 16, 18, 22, H - 18, palette.farBg, 0.96);
      target.fillRect(sx + 18, 18, 18, H - 18, palette.midBg, 0.9);
      // Pulsing championship gold/crimson plasma energy core
      target.fillRect(sx + 23, 26, 8, H - 36, palette.accent, 0.45 + pulse * 0.35);
      target.fillRect(sx + 25, 26, 4, H - 36, '#ffd166', 0.65 + pulse * 0.3);
      // Crown capital cap
      target.fillRect(sx + 12, 16, 30, 6, palette.midBg, 1);
      target.fillRect(sx + 14, 16, 26, 2, '#ffd166', 0.85);
    }
  }
}
