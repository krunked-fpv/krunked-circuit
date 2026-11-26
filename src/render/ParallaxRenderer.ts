// ============================================================================
// Krunked Circuit — Crisp Multi-Layer Pixel Parallax Renderer
// Emits pure integer-aligned pixel quads via a lightweight draw target so both
// WebGL2Renderer and Canvas2DFallback render identical 16-bit vistas with ZERO
// per-frame GPU texture or gradient allocations.
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
}

interface StarDef {
  readonly x: number;
  readonly y: number;
  readonly phase: number;
  readonly bright: boolean;
}

const W = ENGINE_CONSTANTS.GAME_WIDTH;
const H = ENGINE_CONSTANTS.GAME_HEIGHT;

// Precomputed deterministic starfield (zero per-frame allocation)
const STARS: readonly StarDef[] = (() => {
  const list: StarDef[] = [];
  let s = 133742;
  for (let i = 0; i < 44; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const x = s % W;
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const y = 6 + (s % 128);
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    list.push({ x, y, phase: s % 120, bright: (s & 3) === 0 });
  }
  return list;
})();

// Precomputed deterministic building/mesa heights for far & mid horizons
const FAR_SILHOUETTES = [54, 72, 46, 86, 62, 42, 78, 56, 92, 50, 68, 44, 80, 60, 48, 70] as const;
const MID_SILHOUETTES = [34, 48, 28, 56, 38, 62, 30, 46, 40, 52, 32, 44] as const;

function posMod(v: number, m: number): number {
  const r = v % m;
  return r < 0 ? r + m : r;
}

function rgbToHex(r: number, g: number, b: number): string {
  const ri = Math.max(0, Math.min(255, Math.round(r * 255)));
  const gi = Math.max(0, Math.min(255, Math.round(g * 255)));
  const bi = Math.max(0, Math.min(255, Math.round(b * 255)));
  return (
    '#' +
    ((1 << 24) | (ri << 16) | (gi << 8) | bi).toString(16).slice(1)
  );
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
    const { camX, camY, tick, palette, biomeGimmick, hasStars, heatHaze } = opts;
    this.ensureSkyBands(palette.skyTop, palette.skyBottom);

    // 1. Stepped 16-bit sky gradient with crisp 2px pixel-dither seams
    const bandCount = this.skyBands.length;
    const bandH = Math.ceil(H / bandCount);
    for (let i = 0; i < bandCount; i++) {
      const y = i * bandH;
      target.fillRect(0, y, W, bandH, this.skyBands[i], 1);
      if (i > 0) {
        // 16-bit horizontal checkerboard dither strip along seam
        for (let dx = 0; dx < W; dx += 4) {
          target.fillRect(dx, y, 2, 1, this.skyBands[i - 1], 0.85);
          target.fillRect(dx + 2, y + 1, 2, 1, this.skyBands[i - 1], 0.55);
        }
      }
    }

    // 2. Stars or celestial focal landmark
    const showStars =
      hasStars ||
      biomeGimmick === 'orbital_spire' ||
      biomeGimmick === 'metro_train' ||
      biomeGimmick === 'neon_matrix' ||
      biomeGimmick === 'skyway_convoy';

    if (showStars) {
      const starShift = Math.floor(camX * 0.04);
      for (let i = 0; i < STARS.length; i++) {
        const st = STARS[i];
        const sx = posMod(st.x - starShift, W);
        const twinkle = ((tick + st.phase) & 63) < 48;
        if (st.bright) {
          target.fillRect(sx, st.y, 2, 2, '#ffffff', twinkle ? 0.9 : 0.45);
          if (twinkle) {
            target.fillRect(sx - 1, st.y, 4, 1, palette.accent, 0.35);
          }
        } else {
          target.fillRect(sx, st.y, 1, 1, '#dbeeff', twinkle ? 0.72 : 0.3);
        }
      }
    }

    // Biome-specific distant landmark (0.06x scroll)
    if (biomeGimmick === 'solar_lasers' || heatHaze) {
      this.drawSolarLandmark(target, camX, tick, palette);
    } else if (biomeGimmick === 'hub_command') {
      this.drawHubCommandBg(target, camX, tick, palette);
    } else if (biomeGimmick === 'metro_train') {
      this.drawMetroCityBg(target, camX, camY, tick, palette);
    } else if (biomeGimmick === 'neon_matrix') {
      this.drawNeonMatrixBg(target, camX, tick, palette);
    } else if (biomeGimmick === 'cryo_wind') {
      this.drawCryoWindBg(target, camX, tick, palette);
    } else {
      this.drawDefaultSciFiBg(target, camX, camY, tick, palette);
    }
  }

  private drawSolarLandmark(
    target: ParallaxDrawTarget,
    camX: number,
    tick: number,
    palette: StageDefinition['palette'],
  ): void {
    // Blazing pixelated solar orb + orbital mirror rings
    const sunX = 290 - Math.floor(camX * 0.03) % 80;
    const sunY = 58;
    // Outer corona
    target.fillRect(sunX - 30, sunY - 22, 60, 44, palette.accent, 0.16);
    target.fillRect(sunX - 24, sunY - 26, 48, 52, palette.accent, 0.18);
    // Core stepped sun disc
    target.fillRect(sunX - 18, sunY - 14, 36, 28, '#ffd166', 0.92);
    target.fillRect(sunX - 14, sunY - 18, 28, 36, '#ffd166', 0.92);
    target.fillRect(sunX - 12, sunY - 10, 24, 20, '#fff7cc', 0.96);

    // Distant desert mesas + solar collector dishes (0.16x)
    const farSpan = 48;
    const farOff = posMod(Math.floor(camX * 0.16), farSpan * FAR_SILHOUETTES.length);
    for (let x = -farSpan; x < W + farSpan; x += farSpan) {
      const idx = posMod(Math.floor((x + farOff) / farSpan), FAR_SILHOUETTES.length);
      const sx = x - (farOff % farSpan);
      const h = 36 + (FAR_SILHOUETTES[idx] % 44);
      const topY = H - 36 - h;
      target.fillRect(sx, topY, farSpan + 1, h + 36, palette.farBg, 1);
      // Mesa flat cap & sloped shoulder
      target.fillRect(sx + 6, topY - 6, farSpan - 12, 6, palette.farBg, 1);
      target.fillRect(sx + 8, topY - 6, farSpan - 16, 2, palette.accent, 0.35);

      // Towering solar relay antenna every 3rd mesa
      if (idx % 3 === 0) {
        const px = sx + 22;
        target.fillRect(px, topY - 34, 4, 30, palette.farBg, 1);
        target.fillRect(px - 6, topY - 30, 16, 3, palette.midBg, 1);
        const pulse = ((tick + idx * 11) & 31) < 16 ? 0.9 : 0.45;
        target.fillRect(px + 1, topY - 37, 2, 4, '#fff29c', pulse);
        // Thin diagonal solar reflection beam
        target.fillRect(px + 2, topY - 36, 1, 24, palette.accent, 0.25);
      }
    }

    // Midground reflector pylons & heat-glint horizon (0.38x)
    const midSpan = 64;
    const midOff = posMod(Math.floor(camX * 0.38), midSpan * MID_SILHOUETTES.length);
    for (let x = -midSpan; x < W + midSpan; x += midSpan) {
      const idx = posMod(Math.floor((x + midOff) / midSpan), MID_SILHOUETTES.length);
      const sx = x - (midOff % midSpan);
      const h = 24 + (MID_SILHOUETTES[idx] % 34);
      const topY = H - 16 - h;
      target.fillRect(sx + 10, topY, 16, h + 16, palette.midBg, 1);
      target.fillRect(sx + 12, topY + 2, 12, 2, palette.accent, 0.55);
      // Angled mirror panel
      target.fillRect(sx + 6, topY - 8, 24, 5, palette.midBg, 1);
      target.fillRect(sx + 8, topY - 7, 20, 2, '#ffe999', 0.6);
      // Crossbeam connecting pylons
      target.fillRect(sx + 26, topY + 12, midSpan - 16, 2, palette.midBg, 0.8);
    }

    // Shimmering horizon haze bar
    target.fillRect(0, H - 22, W, 22, palette.accent, 0.08);
  }

  private drawMetroCityBg(
    target: ParallaxDrawTarget,
    camX: number,
    camY: number,
    tick: number,
    palette: StageDefinition['palette'],
  ): void {
    const vOff = Math.round(camY * 0.06);

    // Far cyber-megacity towers with lit pixel windows (0.18x)
    const farSpan = 36;
    const farOff = posMod(Math.floor(camX * 0.18), farSpan * FAR_SILHOUETTES.length);
    for (let x = -farSpan; x < W + farSpan; x += farSpan) {
      const idx = posMod(Math.floor((x + farOff) / farSpan), FAR_SILHOUETTES.length);
      const sx = x - (farOff % farSpan);
      const bh = FAR_SILHOUETTES[idx] + 24;
      const topY = H - 24 - bh - (vOff % 18);
      target.fillRect(sx, topY, farSpan - 4, bh + 44, palette.farBg, 1);
      // Spire antenna
      if (idx % 2 === 0) {
        target.fillRect(sx + 14, topY - 14, 2, 14, palette.farBg, 1);
        const blink = ((tick + idx * 17) & 63) < 28;
        target.fillRect(sx + 14, topY - 16, 2, 2, blink ? '#ff4b6e' : palette.accent, 0.9);
      }
      // Lit pixel window rows
      for (let wy = topY + 6; wy < H - 44; wy += 8) {
        for (let wx = sx + 4; wx < sx + farSpan - 10; wx += 6) {
          if (((wx + wy + idx) & 7) !== 0) {
            target.fillRect(wx, wy, 3, 2, palette.accent, 0.35);
          }
        }
      }
    }

    // Midground expressway deck & streaking cyber traffic lights (0.42x)
    const deckY = H - 64;
    target.fillRect(0, deckY, W, 6, palette.midBg, 1);
    target.fillRect(0, deckY, W, 1, palette.accent, 0.5);

    // Support pillars under expressway
    const pillarSpan = 56;
    const pillarOff = posMod(Math.floor(camX * 0.42), pillarSpan);
    for (let x = -pillarSpan; x < W + pillarSpan; x += pillarSpan) {
      const sx = x - pillarOff;
      target.fillRect(sx + 16, deckY + 6, 10, H - deckY, palette.midBg, 1);
      target.fillRect(sx + 18, deckY + 8, 2, H - deckY, palette.farBg, 0.8);
      // Overhead light pole
      target.fillRect(sx + 20, deckY - 26, 2, 26, palette.midBg, 1);
      target.fillRect(sx + 16, deckY - 26, 10, 2, palette.accent, 0.75);
    }

    // Speeding background metro light streaks
    for (let i = 0; i < 6; i++) {
      const dir = i % 2 === 0 ? 1 : -1;
      const speed = dir === 1 ? 3 : -2;
      const lx = posMod(i * 73 + tick * speed - Math.floor(camX * 0.42), W + 40) - 20;
      const ly = deckY - 3 - (i % 2) * 3;
      target.fillRect(lx, ly, 10, 2, dir === 1 ? '#5ce1ff' : '#ff4d6d', 0.85);
    }
  }

  private drawHubCommandBg(
    target: ParallaxDrawTarget,
    camX: number,
    tick: number,
    palette: StageDefinition['palette'],
  ): void {
    // High-tech command center interior bay with arched girders & wall monitors
    const baySpan = 80;
    const bayOff = posMod(Math.floor(camX * 0.25), baySpan);

    // Upper steel ceiling beams
    target.fillRect(0, 0, W, 22, palette.farBg, 0.9);
    target.fillRect(0, 22, W, 2, palette.accent, 0.45);

    for (let x = -baySpan; x < W + baySpan; x += baySpan) {
      const sx = x - bayOff;
      // Structural rib columns
      target.fillRect(sx, 22, 12, H - 22, palette.farBg, 1);
      target.fillRect(sx + 2, 24, 2, H - 24, palette.midBg, 0.75);

      // Panoramic command viewport window
      target.fillRect(sx + 18, 36, 54, 42, palette.midBg, 0.95);
      target.fillRect(sx + 20, 38, 50, 38, palette.skyTop, 0.9);
      target.fillRect(sx + 20, 38, 50, 1, palette.accent, 0.55);

      // Animated radar / waveform bars inside command screen
      for (let b = 0; b < 5; b++) {
        const bh = 6 + ((tick + b * 9 + Math.floor(x / baySpan) * 5) % 18);
        target.fillRect(sx + 25 + b * 8, 70 - bh, 5, bh, palette.accent, 0.45);
      }

      // Lower wall paneling
      target.fillRect(sx + 16, 92, 58, H - 92, palette.midBg, 0.75);
      target.fillRect(sx + 16, 92, 58, 2, palette.accent, 0.3);
    }
  }

  private drawNeonMatrixBg(
    target: ParallaxDrawTarget,
    camX: number,
    tick: number,
    palette: StageDefinition['palette'],
  ): void {
    // Perspective cyber-grid + falling data columns
    const colSpan = 24;
    const colOff = posMod(Math.floor(camX * 0.2), colSpan);
    for (let x = -colSpan; x < W + colSpan; x += colSpan) {
      const sx = x - colOff;
      target.fillRect(sx, 0, 1, H, palette.midBg, 0.45);
      const dropY = posMod(tick * 2 + x * 7, H + 40) - 40;
      target.fillRect(sx - 1, dropY, 3, 18, palette.accent, 0.35);
      target.fillRect(sx - 1, dropY + 16, 3, 3, '#ffffff', 0.75);
    }
    for (let y = 32; y < H; y += 28) {
      target.fillRect(0, y, W, 1, palette.farBg, 0.5);
    }
  }

  private drawCryoWindBg(
    target: ParallaxDrawTarget,
    camX: number,
    tick: number,
    palette: StageDefinition['palette'],
  ): void {
    // Jagged glacial peaks
    const span = 56;
    const farOff = posMod(Math.floor(camX * 0.16), span * FAR_SILHOUETTES.length);
    for (let x = -span; x < W + span; x += span) {
      const idx = posMod(Math.floor((x + farOff) / span), FAR_SILHOUETTES.length);
      const sx = x - (farOff % span);
      const peakH = 44 + (FAR_SILHOUETTES[idx] % 48);
      for (let step = 0; step < 6; step++) {
        const w = span - step * 8;
        const y = H - 24 - Math.floor((peakH * (step + 1)) / 6);
        target.fillRect(sx + step * 4, y, w, 16, palette.farBg, 1);
      }
      target.fillRect(sx + 22, H - 24 - peakH, 10, 4, '#e6fbff', 0.65);
    }

    // Crisp horizontal wind-blown snow streaks
    for (let i = 0; i < 18; i++) {
      const wx = posMod(i * 41 - tick * 3 - Math.floor(camX * 0.5), W);
      const wy = posMod(i * 29 + Math.floor(tick * 0.6), H);
      target.fillRect(wx, wy, 4, 1, '#e6fbff', 0.55);
    }
  }

  private drawDefaultSciFiBg(
    target: ParallaxDrawTarget,
    camX: number,
    camY: number,
    tick: number,
    palette: StageDefinition['palette'],
  ): void {
    const vShift = Math.round(camY * 0.05) % 24;

    // Far megastructures (0.18x)
    const farSpan = 42;
    const farOff = posMod(Math.floor(camX * 0.18), farSpan * FAR_SILHOUETTES.length);
    for (let x = -farSpan; x < W + farSpan; x += farSpan) {
      const idx = posMod(Math.floor((x + farOff) / farSpan), FAR_SILHOUETTES.length);
      const sx = x - (farOff % farSpan);
      const bh = 38 + FAR_SILHOUETTES[idx];
      const topY = H - 24 - bh - vShift;
      target.fillRect(sx, topY, farSpan - 3, bh + 44, palette.farBg, 1);
      target.fillRect(sx + 3, topY + 3, farSpan - 9, 2, palette.accent, 0.32);
    }

    // Midground industrial gantries (0.4x)
    const midSpan = 60;
    const midOff = posMod(Math.floor(camX * 0.4), midSpan * MID_SILHOUETTES.length);
    for (let x = -midSpan; x < W + midSpan; x += midSpan) {
      const idx = posMod(Math.floor((x + midOff) / midSpan), MID_SILHOUETTES.length);
      const sx = x - (midOff % midSpan);
      const mh = 22 + MID_SILHOUETTES[idx];
      const topY = H - 14 - mh;
      target.fillRect(sx + 8, topY, 24, mh + 18, palette.midBg, 1);
      target.fillRect(sx + 10, topY + 2, 20, 2, palette.accent, 0.45);
      const blink = ((tick + idx * 13) & 47) < 20;
      if (blink) {
        target.fillRect(sx + 18, topY + 8, 4, 2, palette.accent, 0.8);
      }
    }
  }
}
