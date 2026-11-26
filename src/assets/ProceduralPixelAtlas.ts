// ============================================================================
// Krunked Circuit — 16-Bit Procedural Pixel Art Atlas (100% DOM-Safe in Node)
// Generates crisp RGBA pixel buffers with 1px dark outlines (#0d101b), 3-tone
// metallic shading, highlights, 6-color palette-swappable hero frames, 15
// biome tilesets, enemies, bosses, props, pickups, HUD icons, and a 6x8
// outlined ASCII bitmap font.
// ============================================================================

import {
  OFFICIAL_STAGE_IDS,
  TileType,
  type BossId,
  type EnemyFamily,
  type MinibossId,
  type Palette6,
  type StageId,
} from '../contracts/index';

/**
 * Canonical 6-color reference palette used for Volt (`player_hero`) frames so
 * the WebGL2 6-color palette swapper cleanly recolors Volt across all 12 Armor Paints.
 * Slot order: [outline, dark, primary, highlight, accent, visorGlow]
 */
export const PALETTE_KEY_COLORS: Palette6 = [
  '#0d101b', // 0: crisp 1px dark outline
  '#1e3660', // 1: deep metallic shadow
  '#3b82f6', // 2: primary armor plate
  '#93c5fd', // 3: specular armor highlight
  '#f59e0b', // 4: amber-gold trim & scarf collar
  '#38f9ff', // 5: glowing electric visor & energy core
] as const;

export const HERO_FRAME_NAMES = [
  'idle_0',
  'idle_1',
  'walk_0',
  'walk_1',
  'walk_2',
  'walk_3',
  'sprint_0',
  'sprint_1',
  'sprint_2',
  'sprint_3',
  'jump',
  'fall',
  'wall_slide',
  'ledge_hang',
  'slide',
  'attack_jab',
  'attack_kick',
  'attack_up',
  'dive_kick',
  'burst',
  'hurt',
] as const;

export type HeroFrameName = (typeof HERO_FRAME_NAMES)[number];

export interface PixelSurface {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray;
}

export interface AtlasRegion {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface BitmapFontAtlas {
  readonly glyphWidth: number;
  readonly glyphHeight: number;
  readonly firstChar: number;
  readonly lastChar: number;
  readonly glyphs: Readonly<Record<number, AtlasRegion>>;
  getGlyph(charCode: number): AtlasRegion | null;
  measureText(text: string, scale?: number): { width: number; height: number };
}

type RGBA = readonly [number, number, number, number];

const TRANSPARENT: RGBA = [0, 0, 0, 0];
const OUTLINE_HEX = '#0d101b';

function parseHexColor(hex: string): RGBA {
  const clean = hex.startsWith('#') ? hex.slice(1) : hex;
  if (clean.length === 6) {
    return [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16),
      255,
    ];
  }
  if (clean.length === 8) {
    return [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16),
      parseInt(clean.slice(6, 8), 16),
    ];
  }
  return [255, 0, 255, 255];
}

function mixRgba(a: RGBA, b: RGBA, t: number): RGBA {
  const inv = 1 - t;
  return [
    Math.round(a[0] * inv + b[0] * t),
    Math.round(a[1] * inv + b[1] * t),
    Math.round(a[2] * inv + b[2] * t),
    Math.round(a[3] * inv + b[3] * t),
  ];
}

const OUTLINE: RGBA = parseHexColor(OUTLINE_HEX);
const KEY_RGBA: readonly [RGBA, RGBA, RGBA, RGBA, RGBA, RGBA] = [
  parseHexColor(PALETTE_KEY_COLORS[0]),
  parseHexColor(PALETTE_KEY_COLORS[1]),
  parseHexColor(PALETTE_KEY_COLORS[2]),
  parseHexColor(PALETTE_KEY_COLORS[3]),
  parseHexColor(PALETTE_KEY_COLORS[4]),
  parseHexColor(PALETTE_KEY_COLORS[5]),
];

// ============================================================================
// Pure RGBA PixelCanvas Helper (100% DOM-Free)
// ============================================================================

class PixelCanvas {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8ClampedArray(width * height * 4);
  }

  px(x: number, y: number, c: RGBA): void {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= this.width || iy >= this.height || c[3] === 0) return;
    const idx = (iy * this.width + ix) * 4;
    if (c[3] === 255 || this.pixels[idx + 3] === 0) {
      this.pixels[idx] = c[0];
      this.pixels[idx + 1] = c[1];
      this.pixels[idx + 2] = c[2];
      this.pixels[idx + 3] = c[3];
    } else {
      const a = c[3] / 255;
      const inv = 1 - a;
      this.pixels[idx] = Math.round(c[0] * a + this.pixels[idx] * inv);
      this.pixels[idx + 1] = Math.round(c[1] * a + this.pixels[idx + 1] * inv);
      this.pixels[idx + 2] = Math.round(c[2] * a + this.pixels[idx + 2] * inv);
      this.pixels[idx + 3] = Math.min(255, Math.round(c[3] + this.pixels[idx + 3] * inv));
    }
  }

  getAlpha(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.pixels[(y * this.width + x) * 4 + 3];
  }

  fillRect(x: number, y: number, w: number, h: number, c: RGBA): void {
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        this.px(x + xx, y + yy, c);
      }
    }
  }

  strokeRect(x: number, y: number, w: number, h: number, c: RGBA): void {
    this.hline(x, y, w, c);
    this.hline(x, y + h - 1, w, c);
    this.vline(x, y, h, c);
    this.vline(x + w - 1, y, h, c);
  }

  hline(x: number, y: number, len: number, c: RGBA): void {
    for (let i = 0; i < len; i++) this.px(x + i, y, c);
  }

  vline(x: number, y: number, len: number, c: RGBA): void {
    for (let i = 0; i < len; i++) this.px(x, y + i, c);
  }

  line(x0: number, y0: number, x1: number, y1: number, c: RGBA): void {
    let ix0 = Math.round(x0);
    let iy0 = Math.round(y0);
    const ix1 = Math.round(x1);
    const iy1 = Math.round(y1);
    const dx = Math.abs(ix1 - ix0);
    const dy = Math.abs(iy1 - iy0);
    const sx = ix0 < ix1 ? 1 : -1;
    const sy = iy0 < iy1 ? 1 : -1;
    let err = dx - dy;
    while (true) {
      this.px(ix0, iy0, c);
      if (ix0 === ix1 && iy0 === iy1) break;
      const e2 = err * 2;
      if (e2 > -dy) {
        err -= dy;
        ix0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        iy0 += sy;
      }
    }
  }

  fillCircle(cx: number, cy: number, r: number, c: RGBA): void {
    const r2 = r * r;
    const minX = Math.floor(cx - r);
    const maxX = Math.ceil(cx + r);
    const minY = Math.floor(cy - r);
    const maxY = Math.ceil(cy + r);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r2 + 0.25) {
          this.px(x, y, c);
        }
      }
    }
  }

  fillEllipse(cx: number, cy: number, rx: number, ry: number, c: RGBA): void {
    const minX = Math.floor(cx - rx);
    const maxX = Math.ceil(cx + rx);
    const minY = Math.floor(cy - ry);
    const maxY = Math.ceil(cy + ry);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const nx = (x - cx) / rx;
        const ny = (y - cy) / ry;
        if (nx * nx + ny * ny <= 1.05) {
          this.px(x, y, c);
        }
      }
    }
  }

  paintGrid(rows: readonly string[], palette: Readonly<Record<string, RGBA>>, ox = 0, oy = 0): void {
    for (let y = 0; y < rows.length; y++) {
      const row = rows[y];
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (ch === '.' || ch === ' ') continue;
        const color = palette[ch];
        if (color) this.px(ox + x, oy + y, color);
      }
    }
  }

  /** Draws a crisp 1px dark outline around all opaque pixels (4-neighborhood). */
  addOutline(outlineColor: RGBA = OUTLINE): void {
    const mask = new Uint8Array(this.width * this.height);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.getAlpha(x, y) > 0) continue;
        if (
          this.getAlpha(x - 1, y) > 0 ||
          this.getAlpha(x + 1, y) > 0 ||
          this.getAlpha(x, y - 1) > 0 ||
          this.getAlpha(x, y + 1) > 0
        ) {
          mask[y * this.width + x] = 1;
        }
      }
    }
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (mask[y * this.width + x] === 1) {
          this.px(x, y, outlineColor);
        }
      }
    }
  }

  blit(src: PixelCanvas, dx: number, dy: number): void {
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const idx = (y * src.width + x) * 4;
        const a = src.pixels[idx + 3];
        if (a === 0) continue;
        this.px(dx + x, dy + y, [
          src.pixels[idx],
          src.pixels[idx + 1],
          src.pixels[idx + 2],
          a,
        ]);
      }
    }
  }

  toSurface(): PixelSurface {
    return {
      width: this.width,
      height: this.height,
      pixels: this.pixels,
    };
  }
}

// ============================================================================
// 1. Hero (`player_hero`) 32x32 Frames — Strictly 6-Color PALETTE_KEY_COLORS
// ============================================================================

const HERO_MAP: Record<string, RGBA> = {
  O: KEY_RGBA[0],
  D: KEY_RGBA[1],
  P: KEY_RGBA[2],
  H: KEY_RGBA[3],
  A: KEY_RGBA[4],
  V: KEY_RGBA[5],
};

const HERO_HELMET: readonly string[] = [
  '....OOOO....',
  '...OHHPPO...',
  '..OHPPPPPO..',
  '.OHPPPPPDDO.',
  '.OPPAOVVVVO.',
  '.OPPAOVVVHO.',
  '.ODPAOVVVVO.',
  '..ODPDDDDO..',
];

const HERO_HELMET_TILT: readonly string[] = [
  '.....OOOO...',
  '....OHHPPO..',
  '...OHPPPPPO.',
  '..OHPPPPPDDO',
  '..OPPAOVVVVO',
  '..ODPAOVVVHO',
  '...ODPDDDDO.',
];

const HERO_TORSO: readonly string[] = [
  '.OOAAAAOO.',
  'OAHPPHPAO.',
  'OAPVVVPAO.',
  '.ODPPPDO..',
  '.OODPPDO..',
  '..OAAAAO..',
  '.OODPPDOO.',
];

function drawHeroLeg(
  c: PixelCanvas,
  hipX: number,
  hipY: number,
  kneeX: number,
  kneeY: number,
  footX: number,
  footY: number,
  isFront: boolean,
): void {
  const thighC = isFront ? KEY_RGBA[2] : KEY_RGBA[1];
  const shinC = isFront ? KEY_RGBA[2] : KEY_RGBA[1];
  const hiC = isFront ? KEY_RGBA[3] : KEY_RGBA[2];
  const darkC = KEY_RGBA[1];
  const accC = KEY_RGBA[4];

  // Thigh
  c.line(hipX, hipY, kneeX, kneeY, thighC);
  c.line(hipX + 1, hipY, kneeX + 1, kneeY, hiC);
  c.line(hipX - 1, hipY, kneeX - 1, kneeY, darkC);

  // Knee guard
  c.fillRect(kneeX - 1, kneeY - 1, 3, 2, accC);
  c.px(kneeX + 1, kneeY - 1, hiC);

  // Shin greave
  c.line(kneeX - 1, kneeY + 1, footX - 1, footY - 2, darkC);
  c.line(kneeX, kneeY + 1, footX, footY - 2, shinC);
  c.line(kneeX + 1, kneeY + 1, footX + 1, footY - 2, hiC);

  // Heavy cyber boot
  c.fillRect(footX - 2, footY - 2, 5, 2, shinC);
  c.fillRect(footX - 2, footY, 6, 1, darkC);
  c.px(footX + 2, footY - 2, hiC);
  c.px(footX + 3, footY - 1, hiC);
  c.px(footX - 1, footY - 2, accC);
}

function drawHeroArm(
  c: PixelCanvas,
  shX: number,
  shY: number,
  elX: number,
  elY: number,
  handX: number,
  handY: number,
  isFront: boolean,
  glowFist = false,
): void {
  const armC = isFront ? KEY_RGBA[2] : KEY_RGBA[1];
  const hiC = isFront ? KEY_RGBA[3] : KEY_RGBA[2];
  const darkC = KEY_RGBA[1];
  const accC = KEY_RGBA[4];
  const visorC = KEY_RGBA[5];

  // Upper arm
  c.line(shX, shY, elX, elY, armC);
  c.line(shX, shY - 1, elX, elY - 1, hiC);
  // Forearm gauntlet
  c.line(elX, elY, handX, handY, armC);
  c.line(elX, elY + 1, handX, handY + 1, darkC);
  c.px(elX, elY, accC);
  // Fist / Gauntlet
  c.fillRect(handX - 1, handY - 1, 3, 3, glowFist ? visorC : armC);
  c.px(handX + 1, handY - 1, glowFist ? KEY_RGBA[3] : hiC);
  c.px(handX - 1, handY, accC);
}

interface HeroPose {
  headX: number;
  headY: number;
  tiltHead?: boolean;
  torsoX: number;
  torsoY: number;
  backLeg: [number, number, number, number, number, number];
  frontLeg: [number, number, number, number, number, number];
  backArm: [number, number, number, number, number, number];
  frontArm: [number, number, number, number, number, number];
  glowFrontFist?: boolean;
  glowBackFist?: boolean;
  scarfTail?: ReadonlyArray<readonly [number, number]>;
  fx?: (c: PixelCanvas) => void;
}

function renderHeroPose(pose: HeroPose): PixelCanvas {
  const c = new PixelCanvas(32, 32);

  // Contiguous flowing scarf knot attached cleanly to amber collar
  if (pose.scarfTail && pose.scarfTail.length > 0) {
    let prevX = pose.torsoX + 1;
    let prevY = pose.torsoY + 1;
    for (const [sx, sy] of pose.scarfTail) {
      c.line(prevX, prevY, sx, sy, KEY_RGBA[4]);
      c.line(prevX, prevY + 1, sx, sy + 1, KEY_RGBA[4]);
      c.px(sx, sy, KEY_RGBA[3]);
      prevX = sx;
      prevY = sy;
    }
  }

  // Back arm & back leg first
  drawHeroLeg(c, ...pose.backLeg, false);
  drawHeroArm(c, ...pose.backArm, false, pose.glowBackFist);

  // Torso
  c.paintGrid(HERO_TORSO, HERO_MAP, pose.torsoX, pose.torsoY);

  // Front leg
  drawHeroLeg(c, ...pose.frontLeg, true);

  // Helmet
  c.paintGrid(pose.tiltHead ? HERO_HELMET_TILT : HERO_HELMET, HERO_MAP, pose.headX, pose.headY);

  // Front arm
  drawHeroArm(c, ...pose.frontArm, true, pose.glowFrontFist);

  // Optional combat energy FX (using strictly PALETTE_KEY_COLORS!)
  if (pose.fx) pose.fx(c);

  // Crisp 1px dark outline
  c.addOutline(KEY_RGBA[0]);
  return c;
}

function buildHeroSlide(): PixelCanvas {
  const c = new PixelCanvas(32, 32);
  // Aerodynamic 14px-tall low ground slide occupying y=17..30 (fits 1-tile 16px tunnel!)
  // Trailing speed sparks (visor cyan + highlight)
  c.hline(2, 26, 4, KEY_RGBA[5]);
  c.hline(3, 28, 3, KEY_RGBA[3]);
  // Reclined helmet at rear-left
  c.paintGrid(HERO_HELMET_TILT, HERO_MAP, 5, 18);
  // Reclined torso & collar
  c.fillRect(12, 23, 8, 5, KEY_RGBA[2]);
  c.hline(12, 23, 8, KEY_RGBA[3]);
  c.hline(12, 27, 8, KEY_RGBA[1]);
  c.fillRect(11, 23, 2, 3, KEY_RGBA[4]); // scarf collar
  c.fillRect(15, 24, 3, 2, KEY_RGBA[5]); // chest core
  // Trailing hand bracing floor
  c.fillRect(9, 27, 4, 3, KEY_RGBA[1]);
  c.px(10, 27, KEY_RGBA[4]);
  // Tucked rear leg
  c.fillRect(14, 28, 5, 2, KEY_RGBA[1]);
  // Extended front slide leg & gleaming cyber boot
  c.fillRect(19, 25, 7, 4, KEY_RGBA[2]);
  c.hline(19, 25, 7, KEY_RGBA[3]);
  c.fillRect(21, 25, 2, 2, KEY_RGBA[4]); // knee guard
  c.fillRect(25, 24, 4, 5, KEY_RGBA[2]);
  c.fillRect(27, 24, 2, 3, KEY_RGBA[3]);
  c.vline(28, 25, 4, KEY_RGBA[5]); // sliding impact gleam
  c.hline(19, 29, 9, KEY_RGBA[1]);
  c.addOutline(KEY_RGBA[0]);
  return c;
}

function buildHeroWallSlide(): PixelCanvas {
  const c = new PixelCanvas(32, 32);
  // Braced against right wall (x~23..25), head looking left/back, sparks at wall contact
  c.paintGrid(HERO_HELMET, HERO_MAP, 10, 4);
  c.paintGrid(HERO_TORSO, HERO_MAP, 11, 12);
  // Right hand flat against wall
  drawHeroArm(c, 19, 13, 22, 11, 24, 9, true, false);
  // Left arm out for balance
  drawHeroArm(c, 12, 14, 9, 17, 7, 19, false, false);
  // Front leg tucked high against wall
  drawHeroLeg(c, 17, 19, 20, 22, 22, 26, true);
  // Rear leg braced lower
  drawHeroLeg(c, 14, 19, 15, 25, 19, 29, false);
  // Wall friction sparks
  c.px(25, 25, KEY_RGBA[5]);
  c.px(26, 23, KEY_RGBA[3]);
  c.px(25, 28, KEY_RGBA[4]);
  c.addOutline(KEY_RGBA[0]);
  return c;
}

function buildHeroLedgeHang(): PixelCanvas {
  const c = new PixelCanvas(32, 32);
  // Hands gripping upper-right ledge at y=4, body hanging tightly below
  drawHeroArm(c, 17, 14, 20, 9, 23, 5, true, false);
  drawHeroArm(c, 13, 14, 15, 9, 19, 5, false, false);
  c.paintGrid(HERO_TORSO, HERO_MAP, 10, 14);
  c.paintGrid(HERO_HELMET, HERO_MAP, 10, 6);
  // Hanging legs bent slightly toward wall
  drawHeroLeg(c, 13, 21, 14, 25, 15, 29, false);
  drawHeroLeg(c, 16, 21, 18, 25, 17, 30, true);
  c.addOutline(KEY_RGBA[0]);
  return c;
}

function buildHeroDiveKick(): PixelCanvas {
  const c = new PixelCanvas(32, 32);
  // Fierce 45-degree downward meteor kick!
  c.paintGrid(HERO_HELMET_TILT, HERO_MAP, 8, 3);
  c.paintGrid(HERO_TORSO, HERO_MAP, 9, 10);
  // Back arm swept upward
  drawHeroArm(c, 11, 12, 7, 9, 5, 7, false, false);
  // Front arm braced
  drawHeroArm(c, 17, 12, 20, 14, 21, 16, true, false);
  // Back leg tucked
  drawHeroLeg(c, 12, 17, 9, 20, 10, 23, false);
  // Front leg thrust diagonally downward-right with glowing plasma lance
  drawHeroLeg(c, 15, 17, 20, 22, 25, 27, true);
  // Meteor kick plasma cone (strictly PALETTE_KEY_COLORS)
  c.line(18, 26, 28, 29, KEY_RGBA[5]);
  c.line(21, 22, 29, 28, KEY_RGBA[5]);
  c.line(22, 24, 28, 28, KEY_RGBA[3]);
  c.fillRect(26, 26, 3, 3, KEY_RGBA[5]);
  c.px(27, 27, KEY_RGBA[3]);
  c.addOutline(KEY_RGBA[0]);
  return c;
}

function buildHeroBurst(): PixelCanvas {
  const c = new PixelCanvas(32, 32);
  // Radiant Burst Technique power-kata stance with blazing cyan/amber aura
  // Aura ring behind hero
  c.line(4, 20, 8, 6, KEY_RGBA[5]);
  c.line(27, 20, 23, 6, KEY_RGBA[5]);
  c.line(6, 26, 9, 10, KEY_RGBA[4]);
  c.line(25, 26, 22, 10, KEY_RGBA[4]);
  c.px(15, 2, KEY_RGBA[5]);
  c.px(16, 2, KEY_RGBA[3]);
  c.px(5, 12, KEY_RGBA[3]);
  c.px(26, 12, KEY_RGBA[3]);

  drawHeroLeg(c, 13, 20, 10, 25, 9, 30, false);
  drawHeroLeg(c, 18, 20, 21, 25, 22, 30, true);
  drawHeroArm(c, 11, 13, 7, 10, 6, 6, false, true);
  c.paintGrid(HERO_TORSO, HERO_MAP, 11, 12);
  c.paintGrid(HERO_HELMET, HERO_MAP, 10, 4);
  drawHeroArm(c, 19, 13, 23, 10, 25, 6, true, true);
  c.addOutline(KEY_RGBA[0]);
  return c;
}

function buildHeroHurt(): PixelCanvas {
  const c = new PixelCanvas(32, 32);
  // Staggered recoil backward with impact star
  drawHeroLeg(c, 14, 20, 11, 25, 10, 30, false);
  drawHeroLeg(c, 17, 20, 20, 25, 21, 29, true);
  drawHeroArm(c, 12, 14, 8, 13, 6, 11, false, false);
  c.paintGrid(HERO_TORSO, HERO_MAP, 10, 13);
  c.paintGrid(HERO_HELMET, HERO_MAP, 8, 5);
  drawHeroArm(c, 18, 14, 22, 16, 24, 18, true, false);
  // Recoil impact sparks
  c.px(25, 8, KEY_RGBA[4]);
  c.px(27, 10, KEY_RGBA[5]);
  c.px(24, 12, KEY_RGBA[3]);
  c.addOutline(KEY_RGBA[0]);
  return c;
}

function buildAllHeroFrames(): Record<HeroFrameName, PixelCanvas> {
  return {
    idle_0: renderHeroPose({
      headX: 10,
      headY: 4,
      torsoX: 11,
      torsoY: 12,
      backLeg: [14, 19, 12, 24, 11, 30],
      frontLeg: [17, 19, 19, 24, 20, 30],
      backArm: [12, 14, 9, 17, 10, 20],
      frontArm: [18, 14, 20, 17, 22, 16],
      scarfTail: [[8, 12], [6, 13]],
    }),
    idle_1: renderHeroPose({
      headX: 10,
      headY: 5,
      torsoX: 11,
      torsoY: 13,
      backLeg: [14, 20, 12, 25, 11, 30],
      frontLeg: [17, 20, 19, 25, 20, 30],
      backArm: [12, 15, 9, 18, 10, 21],
      frontArm: [18, 15, 20, 18, 22, 17],
      scarfTail: [[8, 13], [6, 14], [4, 14]],
    }),
    walk_0: renderHeroPose({
      headX: 11,
      headY: 4,
      torsoX: 11,
      torsoY: 12,
      backLeg: [14, 19, 11, 24, 9, 30],
      frontLeg: [17, 19, 20, 24, 22, 30],
      backArm: [12, 14, 15, 17, 18, 18],
      frontArm: [18, 14, 15, 18, 12, 19],
      scarfTail: [[8, 12], [5, 12]],
    }),
    walk_1: renderHeroPose({
      headX: 11,
      headY: 3,
      torsoX: 11,
      torsoY: 11,
      backLeg: [14, 18, 15, 24, 15, 30],
      frontLeg: [17, 18, 19, 23, 17, 28],
      backArm: [12, 13, 11, 17, 11, 20],
      frontArm: [18, 13, 19, 17, 20, 19],
      scarfTail: [[8, 11], [6, 12]],
    }),
    walk_2: renderHeroPose({
      headX: 11,
      headY: 4,
      torsoX: 11,
      torsoY: 12,
      backLeg: [15, 19, 19, 24, 21, 30],
      frontLeg: [16, 19, 12, 24, 10, 30],
      backArm: [12, 14, 9, 17, 8, 19],
      frontArm: [18, 14, 21, 17, 23, 16],
      scarfTail: [[8, 12], [5, 13]],
    }),
    walk_3: renderHeroPose({
      headX: 11,
      headY: 3,
      torsoX: 11,
      torsoY: 11,
      backLeg: [15, 18, 17, 23, 15, 28],
      frontLeg: [16, 18, 15, 24, 16, 30],
      backArm: [12, 13, 13, 17, 14, 19],
      frontArm: [18, 13, 17, 17, 16, 19],
      scarfTail: [[8, 11], [5, 11]],
    }),
    sprint_0: renderHeroPose({
      headX: 13,
      headY: 5,
      tiltHead: true,
      torsoX: 12,
      torsoY: 12,
      backLeg: [14, 19, 10, 23, 6, 27],
      frontLeg: [17, 19, 22, 23, 25, 29],
      backArm: [13, 14, 18, 16, 22, 15],
      frontArm: [18, 14, 13, 17, 9, 18],
      scarfTail: [[9, 12], [6, 12], [3, 11]],
      fx: (c) => {
        c.hline(2, 26, 3, KEY_RGBA[5]);
      },
    }),
    sprint_1: renderHeroPose({
      headX: 13,
      headY: 4,
      tiltHead: true,
      torsoX: 12,
      torsoY: 11,
      backLeg: [14, 18, 15, 24, 12, 29],
      frontLeg: [17, 18, 21, 22, 20, 26],
      backArm: [13, 13, 12, 17, 10, 19],
      frontArm: [18, 13, 20, 16, 23, 16],
      scarfTail: [[9, 11], [6, 11], [3, 12]],
    }),
    sprint_2: renderHeroPose({
      headX: 13,
      headY: 5,
      tiltHead: true,
      torsoX: 12,
      torsoY: 12,
      backLeg: [15, 19, 21, 23, 24, 29],
      frontLeg: [15, 19, 10, 24, 7, 28],
      backArm: [13, 14, 9, 16, 6, 17],
      frontArm: [18, 14, 22, 16, 25, 15],
      scarfTail: [[9, 12], [6, 11], [3, 11]],
      fx: (c) => {
        c.hline(3, 27, 3, KEY_RGBA[5]);
      },
    }),
    sprint_3: renderHeroPose({
      headX: 13,
      headY: 4,
      tiltHead: true,
      torsoX: 12,
      torsoY: 11,
      backLeg: [15, 18, 19, 22, 18, 26],
      frontLeg: [16, 18, 15, 24, 14, 29],
      backArm: [13, 13, 16, 16, 18, 17],
      frontArm: [18, 13, 15, 17, 12, 18],
      scarfTail: [[9, 11], [6, 12], [3, 12]],
    }),
    jump: renderHeroPose({
      headX: 11,
      headY: 3,
      torsoX: 11,
      torsoY: 11,
      backLeg: [14, 18, 12, 23, 11, 28],
      frontLeg: [17, 18, 21, 20, 19, 25],
      backArm: [12, 13, 9, 11, 8, 9],
      frontArm: [18, 13, 22, 11, 23, 9],
      scarfTail: [[8, 12], [6, 14], [5, 16]],
      fx: (c) => {
        c.px(11, 30, KEY_RGBA[5]);
        c.px(19, 27, KEY_RGBA[5]);
      },
    }),
    fall: renderHeroPose({
      headX: 11,
      headY: 4,
      torsoX: 11,
      torsoY: 12,
      backLeg: [14, 19, 12, 24, 10, 29],
      frontLeg: [17, 19, 19, 24, 21, 28],
      backArm: [12, 13, 8, 11, 6, 8],
      frontArm: [18, 13, 22, 11, 24, 8],
      scarfTail: [[8, 10], [6, 8], [5, 6]],
    }),
    wall_slide: buildHeroWallSlide(),
    ledge_hang: buildHeroLedgeHang(),
    slide: buildHeroSlide(),
    attack_jab: renderHeroPose({
      headX: 11,
      headY: 4,
      tiltHead: true,
      torsoX: 11,
      torsoY: 12,
      backLeg: [13, 19, 10, 24, 8, 30],
      frontLeg: [17, 19, 20, 24, 22, 30],
      backArm: [12, 14, 9, 16, 8, 18],
      frontArm: [18, 14, 23, 14, 27, 14],
      glowFrontFist: true,
      scarfTail: [[8, 12], [5, 12]],
      fx: (c) => {
        c.hline(24, 12, 6, KEY_RGBA[5]);
        c.hline(26, 13, 5, KEY_RGBA[3]);
        c.hline(26, 14, 5, KEY_RGBA[5]);
        c.hline(24, 16, 6, KEY_RGBA[5]);
      },
    }),
    attack_kick: renderHeroPose({
      headX: 10,
      headY: 5,
      tiltHead: true,
      torsoX: 10,
      torsoY: 12,
      backLeg: [13, 19, 11, 24, 10, 30],
      frontLeg: [16, 18, 22, 18, 27, 18],
      backArm: [11, 14, 7, 13, 5, 12],
      frontArm: [17, 14, 14, 17, 12, 19],
      scarfTail: [[7, 12], [4, 11]],
      fx: (c) => {
        c.line(23, 13, 29, 16, KEY_RGBA[5]);
        c.line(25, 14, 30, 18, KEY_RGBA[3]);
        c.line(23, 22, 29, 19, KEY_RGBA[5]);
      },
    }),
    attack_up: renderHeroPose({
      headX: 11,
      headY: 5,
      torsoX: 11,
      torsoY: 13,
      backLeg: [14, 20, 12, 25, 11, 30],
      frontLeg: [17, 20, 20, 24, 21, 29],
      backArm: [12, 15, 9, 18, 8, 20],
      frontArm: [18, 14, 21, 9, 22, 5],
      glowFrontFist: true,
      scarfTail: [[8, 14], [6, 16]],
      fx: (c) => {
        c.line(18, 3, 25, 4, KEY_RGBA[5]);
        c.line(21, 2, 27, 7, KEY_RGBA[3]);
        c.line(24, 5, 27, 12, KEY_RGBA[5]);
      },
    }),
    dive_kick: buildHeroDiveKick(),
    burst: buildHeroBurst(),
    hurt: buildHeroHurt(),
  };
}

// ============================================================================
// 2. Hookshot & Reticle Sprites
// ============================================================================

function buildHookTip(): PixelCanvas {
  const c = new PixelCanvas(12, 12);
  const pal: Record<string, RGBA> = {
    O: OUTLINE,
    D: parseHexColor('#334155'),
    M: parseHexColor('#94a3b8'),
    H: parseHexColor('#f1f5f9'),
    A: parseHexColor('#f59e0b'),
    V: parseHexColor('#38f9ff'),
  };
  c.paintGrid(
    [
      '......OO....',
      '.....OHMO...',
      '....OHMDOO..',
      '..OOAMMOHOO.',
      '.OAMVVVMMHO.',
      '.OAMVVVVVHO.',
      '.OAMVVVVVHO.',
      '.OAMVVVMMHO.',
      '..OOAMMOHOO.',
      '....ODMDOO..',
      '.....ODMO...',
      '......OO....',
    ],
    pal,
  );
  return c;
}

function buildHookChain(): PixelCanvas {
  const c = new PixelCanvas(6, 6);
  const pal: Record<string, RGBA> = {
    O: OUTLINE,
    D: parseHexColor('#334155'),
    M: parseHexColor('#cbd5e1'),
    V: parseHexColor('#38f9ff'),
  };
  c.paintGrid(
    [
      '.OOOO.',
      'OMMMMO',
      'OMVVMO',
      'ODVVDO',
      'ODDDDO',
      '.OOOO.',
    ],
    pal,
  );
  return c;
}

function buildAimReticle(): PixelCanvas {
  const c = new PixelCanvas(12, 12);
  const pal: Record<string, RGBA> = {
    O: OUTLINE,
    V: parseHexColor('#38f9ff'),
    H: parseHexColor('#ffffff'),
    A: parseHexColor('#facc15'),
  };
  c.paintGrid(
    [
      'OOOO....OOOO',
      'OVVO....OVVO',
      'OV.O....O.VO',
      'OOO......OOO',
      '.....OO.....',
      '....OAHO....',
      '....OHAO....',
      '.....OO.....',
      'OOO......OOO',
      'OV.O....O.VO',
      'OVVO....OVVO',
      'OOOO....OOOO',
    ],
    pal,
  );
  return c;
}

// ============================================================================
// 3. 16x16 Biome Tilesets for All 15 StageIds & Every TileType
// ============================================================================

interface BiomeTilePalette {
  readonly dark: RGBA;
  readonly mid: RGBA;
  readonly light: RGBA;
  readonly accent: RGBA;
  readonly trim: RGBA;
  readonly pattern: 'tech' | 'metro' | 'solar' | 'cryo' | 'industrial' | 'matrix' | 'citadel';
}

const BIOME_PALETTES: Record<StageId, BiomeTilePalette> = {
  hub: {
    dark: parseHexColor('#1f3149'),
    mid: parseHexColor('#3d5a80'),
    light: parseHexColor('#7ca8d6'),
    accent: parseHexColor('#38f9ff'),
    trim: parseHexColor('#f59e0b'),
    pattern: 'tech',
  },
  tutorial: {
    dark: parseHexColor('#1e293b'),
    mid: parseHexColor('#475569'),
    light: parseHexColor('#94a3b8'),
    accent: parseHexColor('#34d399'),
    trim: parseHexColor('#38bdf8'),
    pattern: 'tech',
  },
  opening: {
    dark: parseHexColor('#262f42'),
    mid: parseHexColor('#4f5d78'),
    light: parseHexColor('#8b9bb8'),
    accent: parseHexColor('#fb923c'),
    trim: parseHexColor('#facc15'),
    pattern: 'metro',
  },
  optic: {
    dark: parseHexColor('#6b3b18'),
    mid: parseHexColor('#c47e35'),
    light: parseHexColor('#f3bd68'),
    accent: parseHexColor('#38f9ff'),
    trim: parseHexColor('#fde047'),
    pattern: 'solar',
  },
  patch: {
    dark: parseHexColor('#47251a'),
    mid: parseHexColor('#8c5239'),
    light: parseHexColor('#c98863'),
    accent: parseHexColor('#4ade80'),
    trim: parseHexColor('#fbbf24'),
    pattern: 'industrial',
  },
  cooler: {
    dark: parseHexColor('#193d54'),
    mid: parseHexColor('#3b82a6'),
    light: parseHexColor('#93e2ff'),
    accent: parseHexColor('#67e8f9'),
    trim: parseHexColor('#e0f2fe'),
    pattern: 'cryo',
  },
  elec: {
    dark: parseHexColor('#332a12'),
    mid: parseHexColor('#6b5b2a'),
    light: parseHexColor('#d4b54a'),
    accent: parseHexColor('#facc15'),
    trim: parseHexColor('#38f9ff'),
    pattern: 'industrial',
  },
  shift: {
    dark: parseHexColor('#163e42'),
    mid: parseHexColor('#2f7a78'),
    light: parseHexColor('#76d1cb'),
    accent: parseHexColor('#fb7185'),
    trim: parseHexColor('#e2e8f0'),
    pattern: 'metro',
  },
  wave: {
    dark: parseHexColor('#331a59'),
    mid: parseHexColor('#6d3ea8'),
    light: parseHexColor('#b784f7'),
    accent: parseHexColor('#f472b6'),
    trim: parseHexColor('#38f9ff'),
    pattern: 'matrix',
  },
  break: {
    dark: parseHexColor('#3d2119'),
    mid: parseHexColor('#7a4c3b'),
    light: parseHexColor('#bd8268'),
    accent: parseHexColor('#f97316'),
    trim: parseHexColor('#facc15'),
    pattern: 'industrial',
  },
  cipher: {
    dark: parseHexColor('#121c30'),
    mid: parseHexColor('#263b5e'),
    light: parseHexColor('#4f7fc4'),
    accent: parseHexColor('#22d3ee'),
    trim: parseHexColor('#4ade80'),
    pattern: 'matrix',
  },
  final_1: {
    dark: parseHexColor('#291727'),
    mid: parseHexColor('#54374f'),
    light: parseHexColor('#966b8e'),
    accent: parseHexColor('#f43f5e'),
    trim: parseHexColor('#fbbf24'),
    pattern: 'citadel',
  },
  final_2: {
    dark: parseHexColor('#19263a'),
    mid: parseHexColor('#384f6e'),
    light: parseHexColor('#7aa4d6'),
    accent: parseHexColor('#fbbf24'),
    trim: parseHexColor('#38f9ff'),
    pattern: 'citadel',
  },
  final_3: {
    dark: parseHexColor('#1d2436'),
    mid: parseHexColor('#4c5c7a'),
    light: parseHexColor('#b8cbe6'),
    accent: parseHexColor('#a78bfa'),
    trim: parseHexColor('#38f9ff'),
    pattern: 'citadel',
  },
  boss_rush: {
    dark: parseHexColor('#332419'),
    mid: parseHexColor('#6b4f3a'),
    light: parseHexColor('#c49c78'),
    accent: parseHexColor('#facc15'),
    trim: parseHexColor('#f43f5e'),
    pattern: 'citadel',
  },
};

export const SOLID_TILE_TYPES: readonly TileType[] = [
  TileType.SOLID,
  TileType.ONE_WAY,
  TileType.SPIKE,
  TileType.BREAKABLE,
  TileType.ICE,
  TileType.CONVEYOR_L,
  TileType.CONVEYOR_R,
  TileType.ELECTRIC_RAIL,
  TileType.TOGGLE_A,
  TileType.TOGGLE_B,
  TileType.BOUNCE_PAD,
  TileType.LASER_MIRROR,
  TileType.CAMERA_BLOCKER,
  TileType.CHECKPOINT,
  TileType.GOAL_DOOR,
  TileType.CRUSHER,
  TileType.PROXIMITY_SOLID,
] as const;

function buildBiomeTile(stageId: StageId, tileType: TileType): PixelCanvas {
  const c = new PixelCanvas(16, 16);
  const bp = BIOME_PALETTES[stageId];
  const white = parseHexColor('#f8fafc');
  const steelDark = parseHexColor('#1e293b');
  const steelMid = parseHexColor('#64748b');
  const steelHi = parseHexColor('#cbd5e1');

  switch (tileType) {
    case TileType.SOLID: {
      c.fillRect(0, 0, 16, 16, bp.mid);
      c.strokeRect(0, 0, 16, 16, OUTLINE);
      // 3-tone metallic/stone bevel
      c.hline(1, 1, 14, bp.light);
      c.hline(1, 2, 14, mixRgba(bp.light, bp.mid, 0.45));
      c.vline(1, 1, 14, bp.light);
      c.hline(1, 14, 14, bp.dark);
      c.hline(2, 13, 12, bp.dark);
      c.vline(14, 1, 14, bp.dark);

      // Biome architectural detailing
      if (bp.pattern === 'solar') {
        // Sun-baked sandstone masonry + photovoltaic inlay
        c.hline(1, 8, 14, bp.dark);
        c.vline(8, 1, 7, bp.dark);
        c.vline(4, 8, 6, bp.dark);
        c.fillRect(10, 4, 3, 2, bp.trim);
        c.px(11, 4, white);
      } else if (bp.pattern === 'metro') {
        // Heavy riveted girder + hazard edge dots
        c.strokeRect(3, 4, 10, 8, bp.dark);
        c.hline(4, 5, 8, bp.light);
        c.px(3, 3, bp.trim);
        c.px(12, 3, bp.trim);
        c.px(3, 12, bp.accent);
        c.px(12, 12, bp.accent);
      } else if (bp.pattern === 'cryo') {
        // Frosted crystalline facets
        c.line(2, 12, 12, 2, bp.light);
        c.line(4, 13, 13, 4, white);
        c.fillRect(3, 3, 2, 2, bp.accent);
      } else if (bp.pattern === 'matrix') {
        // Cyber circuit board trace
        c.hline(2, 6, 6, bp.accent);
        c.vline(8, 6, 5, bp.accent);
        c.hline(8, 11, 5, bp.accent);
        c.px(13, 11, white);
        c.px(3, 11, bp.trim);
      } else if (bp.pattern === 'industrial') {
        // Riveted iron plate with cross seam
        c.hline(2, 8, 12, bp.dark);
        c.px(3, 3, bp.light);
        c.px(12, 3, bp.light);
        c.px(3, 11, bp.light);
        c.px(12, 11, bp.light);
        c.fillRect(6, 5, 4, 2, bp.trim);
      } else if (bp.pattern === 'citadel') {
        // Armored fortress paneling with emblem line
        c.strokeRect(3, 3, 10, 10, bp.dark);
        c.hline(5, 7, 6, bp.accent);
        c.px(7, 6, bp.trim);
        c.px(8, 6, bp.trim);
      } else {
        // Tech Command Deck paneling
        c.strokeRect(3, 3, 10, 9, bp.dark);
        c.hline(4, 4, 8, bp.light);
        c.hline(5, 8, 6, bp.accent);
        c.px(4, 10, bp.trim);
        c.px(11, 10, bp.trim);
      }
      break;
    }

    case TileType.ONE_WAY: {
      // Crisp metallic catwalk grate (top 6px structural deck)
      c.fillRect(0, 0, 16, 6, bp.dark);
      c.hline(0, 0, 16, OUTLINE);
      c.hline(0, 1, 16, bp.light);
      c.hline(0, 2, 16, bp.accent);
      c.hline(0, 5, 16, OUTLINE);
      // Cross-truss lattice
      for (let x = 1; x < 15; x += 4) {
        c.vline(x, 3, 2, bp.light);
        c.px(x + 2, 4, bp.mid);
        c.vline(x, 6, 2, bp.dark);
        c.px(x, 8, OUTLINE);
      }
      break;
    }

    case TileType.SPIKE: {
      const tipHi = white;
      const bladeMid = parseHexColor('#cbd5e1');
      const bladeDark = parseHexColor('#475569');
      const warnRed = parseHexColor('#ef4444');
      const warnGold = parseHexColor('#facc15');
      // Base hazard bar
      c.fillRect(0, 12, 16, 4, steelDark);
      c.hline(0, 12, 16, OUTLINE);
      c.hline(0, 15, 16, OUTLINE);
      for (let x = 1; x < 15; x += 4) {
        c.fillRect(x, 13, 2, 2, warnRed);
        c.fillRect(x + 2, 13, 2, 2, warnGold);
      }
      // Two gleaming razor spikes
      for (const sx of [0, 8]) {
        for (let row = 0; row < 11; row++) {
          const half = Math.floor((row * 3.6) / 10);
          const cx = sx + 4;
          for (let dx = -half; dx <= half; dx++) {
            const col = dx < 0 ? tipHi : dx === 0 ? bladeMid : bladeDark;
            c.px(cx + dx, 1 + row, col);
          }
          c.px(cx - half - 1, 1 + row, OUTLINE);
          c.px(cx + half + 1, 1 + row, OUTLINE);
        }
        c.px(sx + 4, 0, OUTLINE);
        c.px(sx + 4, 1, tipHi);
      }
      break;
    }

    case TileType.BREAKABLE: {
      const rockDark = mixRgba(bp.dark, parseHexColor('#3b2416'), 0.4);
      const rockMid = mixRgba(bp.mid, parseHexColor('#9a633e'), 0.35);
      const rockHi = mixRgba(bp.light, parseHexColor('#e2b182'), 0.35);
      c.fillRect(0, 0, 16, 16, rockMid);
      c.strokeRect(0, 0, 16, 16, OUTLINE);
      c.hline(1, 1, 14, rockHi);
      c.vline(1, 1, 14, rockHi);
      c.hline(1, 14, 14, rockDark);
      c.vline(14, 1, 14, rockDark);
      // Warning corner brackets
      c.fillRect(2, 2, 2, 2, bp.trim);
      c.fillRect(12, 2, 2, 2, bp.trim);
      c.fillRect(2, 12, 2, 2, bp.trim);
      c.fillRect(12, 12, 2, 2, bp.trim);
      // Bold jagged fracture cracks
      c.line(3, 4, 7, 7, OUTLINE);
      c.line(7, 7, 6, 11, OUTLINE);
      c.line(7, 7, 12, 5, OUTLINE);
      c.line(8, 8, 12, 12, OUTLINE);
      c.line(4, 4, 7, 6, rockHi);
      break;
    }

    case TileType.ICE: {
      const iceDeep = parseHexColor('#0e7490');
      const iceMid = parseHexColor('#22d3ee');
      const iceHi = parseHexColor('#a5f3fc');
      c.fillRect(0, 0, 16, 16, iceMid);
      c.strokeRect(0, 0, 16, 16, OUTLINE);
      c.hline(1, 1, 14, white);
      c.hline(1, 2, 14, iceHi);
      c.vline(1, 1, 14, iceHi);
      c.hline(1, 14, 14, iceDeep);
      c.vline(14, 1, 14, iceDeep);
      // Diagonal crystalline specular streaks
      c.line(2, 9, 9, 2, white);
      c.line(3, 10, 10, 3, iceHi);
      c.line(6, 13, 13, 6, white);
      c.line(9, 13, 13, 9, iceDeep);
      break;
    }

    case TileType.CONVEYOR_L:
    case TileType.CONVEYOR_R: {
      const isLeft = tileType === TileType.CONVEYOR_L;
      const beltDark = parseHexColor('#181c28');
      const beltMid = parseHexColor('#334155');
      const chevron = isLeft ? parseHexColor('#38f9ff') : parseHexColor('#facc15');
      c.fillRect(0, 0, 16, 16, beltDark);
      c.strokeRect(0, 0, 16, 16, OUTLINE);
      c.hline(1, 1, 14, steelHi);
      c.hline(1, 2, 14, beltMid);
      c.hline(1, 13, 14, beltMid);
      c.hline(1, 14, 14, steelDark);
      // Mechanical rollers
      c.fillCircle(3, 8, 2, steelMid);
      c.px(3, 8, steelHi);
      c.fillCircle(12, 8, 2, steelMid);
      c.px(12, 8, steelHi);
      // Bold directional chevrons (<< or >>)
      for (const cx of [5, 10]) {
        if (isLeft) {
          c.px(cx + 2, 5, chevron);
          c.px(cx + 1, 6, chevron);
          c.px(cx, 7, white);
          c.px(cx, 8, white);
          c.px(cx + 1, 9, chevron);
          c.px(cx + 2, 10, chevron);
        } else {
          c.px(cx - 2, 5, chevron);
          c.px(cx - 1, 6, chevron);
          c.px(cx, 7, white);
          c.px(cx, 8, white);
          c.px(cx - 1, 9, chevron);
          c.px(cx - 2, 10, chevron);
        }
      }
      break;
    }

    case TileType.ELECTRIC_RAIL: {
      const copper = parseHexColor('#d97706');
      const copperHi = parseHexColor('#fcd34d');
      const arcCyan = parseHexColor('#38f9ff');
      c.fillRect(0, 0, 16, 16, steelDark);
      c.strokeRect(0, 0, 16, 16, OUTLINE);
      // Copper coil insulators left & right
      c.fillRect(1, 2, 3, 12, copper);
      c.vline(2, 2, 12, copperHi);
      c.fillRect(12, 2, 3, 12, copper);
      c.vline(13, 2, 12, copperHi);
      // Crackling electric arc across center
      c.line(4, 7, 7, 4, arcCyan);
      c.line(7, 4, 9, 10, white);
      c.line(9, 10, 12, 7, arcCyan);
      c.px(6, 11, arcCyan);
      c.px(10, 4, arcCyan);
      break;
    }

    case TileType.TOGGLE_A:
    case TileType.TOGGLE_B: {
      const isA = tileType === TileType.TOGGLE_A;
      const core = isA ? parseHexColor('#0284c7') : parseHexColor('#db2777');
      const neon = isA ? parseHexColor('#38f9ff') : parseHexColor('#fb7185');
      c.fillRect(0, 0, 16, 16, parseHexColor('#111827'));
      c.strokeRect(0, 0, 16, 16, OUTLINE);
      c.strokeRect(1, 1, 14, 14, neon);
      c.strokeRect(2, 2, 12, 12, core);
      // Corner nodes
      c.fillRect(1, 1, 2, 2, white);
      c.fillRect(13, 1, 2, 2, white);
      c.fillRect(1, 13, 2, 2, white);
      c.fillRect(13, 13, 2, 2, white);
      if (isA) {
        // Phase A inner circuit square
        c.strokeRect(5, 5, 6, 6, neon);
        c.fillRect(7, 7, 2, 2, white);
      } else {
        // Phase B inner diamond
        c.line(8, 4, 11, 7, neon);
        c.line(11, 8, 8, 11, neon);
        c.line(7, 11, 4, 8, neon);
        c.line(4, 7, 7, 4, neon);
        c.fillRect(7, 7, 2, 2, white);
      }
      break;
    }

    case TileType.BOUNCE_PAD: {
      const padGreen = parseHexColor('#22c55e');
      const padHi = parseHexColor('#bbf7d0');
      const padGold = parseHexColor('#facc15');
      // Base housing
      c.fillRect(1, 12, 14, 4, steelDark);
      c.strokeRect(1, 12, 14, 4, OUTLINE);
      // Coiled spring
      c.line(4, 11, 11, 9, steelHi);
      c.line(11, 9, 4, 7, steelMid);
      c.line(4, 7, 11, 5, steelHi);
      // Cushioned top bumper plate
      c.fillRect(1, 1, 14, 5, padGreen);
      c.strokeRect(1, 1, 14, 5, OUTLINE);
      c.hline(2, 2, 12, padHi);
      c.fillRect(6, 3, 4, 2, padGold);
      break;
    }

    case TileType.LASER_MIRROR: {
      const gold = parseHexColor('#f59e0b');
      const prismHi = parseHexColor('#e0f2fe');
      const prismMid = parseHexColor('#38f9ff');
      c.fillRect(0, 0, 16, 16, steelDark);
      c.strokeRect(0, 0, 16, 16, OUTLINE);
      c.strokeRect(1, 1, 14, 14, bp.mid);
      // Gold lens brackets
      c.fillRect(2, 2, 3, 3, gold);
      c.fillRect(11, 11, 3, 3, gold);
      // Angled 45-deg prism mirror
      for (let i = 0; i < 10; i++) {
        c.px(3 + i, 12 - i, prismMid);
        c.px(3 + i, 11 - i, white);
        c.px(4 + i, 12 - i, prismHi);
      }
      break;
    }

    case TileType.CHECKPOINT: {
      const pylonGlow = parseHexColor('#38f9ff');
      const pylonGold = parseHexColor('#facc15');
      // Pedestal base
      c.fillRect(3, 12, 10, 4, steelMid);
      c.strokeRect(3, 12, 10, 4, OUTLINE);
      c.hline(4, 13, 8, steelHi);
      // Slim vertical emitter mast
      c.fillRect(6, 5, 4, 7, steelDark);
      c.vline(7, 5, 7, pylonGlow);
      c.vline(8, 5, 7, white);
      // Glowing diamond hologram crest
      c.fillRect(6, 1, 4, 4, pylonGlow);
      c.fillRect(7, 2, 2, 2, pylonGold);
      c.px(7, 1, white);
      c.addOutline(OUTLINE);
      break;
    }

    case TileType.GOAL_DOOR: {
      const doorGlow = parseHexColor('#34d399');
      const hazardGold = parseHexColor('#facc15');
      c.fillRect(0, 0, 16, 16, steelDark);
      c.strokeRect(0, 0, 16, 16, OUTLINE);
      // Armored bulkhead frame
      c.fillRect(1, 1, 3, 14, steelMid);
      c.fillRect(12, 1, 3, 14, steelMid);
      c.vline(2, 2, 12, steelHi);
      c.vline(13, 2, 12, steelHi);
      // Center blast door seam + lock core
      c.vline(7, 1, 14, OUTLINE);
      c.vline(8, 1, 14, OUTLINE);
      c.fillRect(5, 5, 6, 6, doorGlow);
      c.strokeRect(5, 5, 6, 6, OUTLINE);
      c.fillRect(7, 7, 2, 2, white);
      // Top & bottom hazard accents
      c.hline(4, 2, 8, hazardGold);
      c.hline(4, 13, 8, hazardGold);
      break;
    }

    case TileType.CRUSHER: {
      const warnYellow = parseHexColor('#facc15');
      const pistonHi = parseHexColor('#e2e8f0');
      c.fillRect(0, 0, 16, 16, steelMid);
      c.strokeRect(0, 0, 16, 16, OUTLINE);
      c.hline(1, 1, 14, pistonHi);
      // Hydraulic vertical piston grooves
      c.fillRect(3, 2, 3, 8, steelDark);
      c.vline(4, 2, 8, pistonHi);
      c.fillRect(10, 2, 3, 8, steelDark);
      c.vline(11, 2, 8, pistonHi);
      // Caution striped crusher underside
      c.fillRect(1, 11, 14, 4, OUTLINE);
      for (let x = 1; x < 14; x += 4) {
        c.fillRect(x, 12, 2, 2, warnYellow);
      }
      break;
    }

    case TileType.PROXIMITY_SOLID: {
      const holo = parseHexColor('#38f9ff');
      const holoFill = parseHexColor('#0e4a6b');
      c.fillRect(1, 1, 14, 14, holoFill);
      c.strokeRect(0, 0, 16, 16, OUTLINE);
      c.strokeRect(1, 1, 14, 14, holo);
      // Holographic scanline grid
      for (let y = 4; y <= 12; y += 4) {
        c.hline(2, y, 12, holo);
      }
      c.vline(8, 2, 12, holo);
      c.fillRect(1, 1, 2, 2, white);
      c.fillRect(13, 1, 2, 2, white);
      c.fillRect(1, 13, 2, 2, white);
      c.fillRect(13, 13, 2, 2, white);
      break;
    }

    case TileType.CAMERA_BLOCKER:
    default: {
      // Minimal subtle boundary sensor pip (typically invisible in gameplay)
      c.px(0, 0, bp.accent);
      c.px(15, 0, bp.accent);
      c.px(0, 15, bp.accent);
      c.px(15, 15, bp.accent);
      break;
    }
  }

  return c;
}

// ============================================================================
// 4. Enemy & Boss Sprites (Crisp 16-Bit Character Pixel Art)
// ============================================================================

function buildEnemySprite(family: EnemyFamily): PixelCanvas {
  const red = parseHexColor('#ef4444');
  const redDark = parseHexColor('#7f1d1d');
  const redHi = parseHexColor('#fca5a5');
  const slateDark = parseHexColor('#1e293b');
  const slateMid = parseHexColor('#475569');
  const slateHi = parseHexColor('#94a3b8');
  const white = parseHexColor('#f8fafc');
  const gold = parseHexColor('#f59e0b');
  const goldHi = parseHexColor('#fde047');
  const cyan = parseHexColor('#38f9ff');
  const lime = parseHexColor('#4ade80');
  const limeDark = parseHexColor('#166534');
  const purple = parseHexColor('#a855f7');

  switch (family) {
    case 'trooper': {
      // 24x24 Corrupt Legion Battle Trooper — sculpted helmet, visor & arm cannon
      const c = new PixelCanvas(24, 24);
      // Swept helmet dome with top crest
      c.fillRect(8, 2, 7, 2, redHi);
      c.fillRect(7, 4, 10, 5, red);
      c.hline(7, 8, 10, redDark);
      c.px(9, 4, white);
      // Sleek recessed visor + glowing amber-red cyclops optic
      c.fillRect(11, 5, 6, 3, slateDark);
      c.hline(12, 6, 5, gold);
      c.px(15, 6, white);
      // Sculpted armored chest & shoulder pauldron
      c.fillRect(7, 9, 9, 7, slateMid);
      c.hline(8, 9, 7, slateHi);
      c.fillRect(6, 9, 3, 4, red);
      c.px(7, 9, redHi);
      c.fillRect(10, 11, 4, 2, red);
      c.hline(8, 15, 7, gold);
      // Arm blaster pointing forward
      c.fillRect(14, 10, 7, 4, slateDark);
      c.hline(14, 10, 6, slateHi);
      c.fillRect(19, 11, 3, 2, goldHi);
      // Articulated legs & armored greaves
      c.fillRect(7, 16, 3, 5, slateDark);
      c.fillRect(12, 16, 4, 5, slateMid);
      c.vline(14, 16, 4, slateHi);
      c.fillRect(6, 20, 5, 2, redDark);
      c.fillRect(12, 20, 6, 2, red);
      c.px(16, 20, redHi);
      c.addOutline(OUTLINE);
      return c;
    }

    case 'shield_guard': {
      // 28x28 Heavy Riot Shield Guard with glowing beveled cyan energy shield
      const c = new PixelCanvas(28, 28);
      // Heavy angular helmet + crest
      c.fillRect(8, 3, 8, 2, gold);
      c.fillRect(7, 5, 10, 6, slateMid);
      c.hline(8, 5, 8, slateHi);
      c.fillRect(11, 7, 6, 2, slateDark);
      c.hline(12, 7, 4, red);
      c.px(15, 7, goldHi);
      // Broad armored torso & golden pauldrons
      c.fillRect(5, 11, 13, 9, slateDark);
      c.fillRect(4, 11, 5, 5, gold);
      c.hline(5, 11, 4, goldHi);
      c.fillRect(9, 12, 7, 6, slateMid);
      c.hline(10, 12, 5, slateHi);
      c.fillRect(11, 14, 3, 2, cyan);
      // Heavy articulated greaves & sabatons
      c.fillRect(6, 20, 4, 6, slateMid);
      c.fillRect(12, 20, 5, 6, slateMid);
      c.vline(15, 20, 5, slateHi);
      c.fillRect(5, 24, 6, 2, gold);
      c.fillRect(12, 24, 6, 2, gold);
      c.hline(13, 24, 4, goldHi);
      // Beveled translucent-look cyan riot energy shield (x=19..25)
      c.fillRect(19, 4, 6, 21, parseHexColor('#0369a1'));
      c.fillRect(20, 3, 4, 2, gold);
      c.fillRect(20, 24, 4, 2, gold);
      c.vline(20, 5, 19, cyan);
      c.vline(23, 5, 19, cyan);
      c.line(20, 8, 24, 12, white);
      c.line(20, 14, 24, 18, white);
      c.fillRect(18, 11, 2, 6, gold); // shield bracket
      c.addOutline(OUTLINE);
      return c;
    }

    case 'turret': {
      // 24x24 Fortified Twin-Barrel Defense Turret
      const c = new PixelCanvas(24, 24);
      // Armored bunker tripod base
      c.fillRect(4, 17, 16, 5, slateDark);
      c.hline(5, 17, 14, slateHi);
      c.fillRect(2, 20, 4, 2, gold);
      c.fillRect(18, 20, 4, 2, gold);
      // Rotating turret dome
      c.fillRect(6, 7, 11, 10, slateMid);
      c.hline(7, 7, 9, slateHi);
      c.fillRect(8, 10, 4, 3, red);
      c.px(10, 10, goldHi);
      // Dual heavy cannon barrels
      c.fillRect(15, 8, 7, 3, slateDark);
      c.hline(16, 8, 6, slateHi);
      c.px(21, 9, goldHi);
      c.fillRect(15, 12, 7, 3, slateDark);
      c.hline(16, 12, 6, slateHi);
      c.px(21, 13, goldHi);
      c.addOutline(OUTLINE);
      return c;
    }

    case 'hopper': {
      // 24x24 Spring-Legged Cyber Hopper
      const c = new PixelCanvas(24, 24);
      // Sloped lime/slate carapace
      c.fillEllipse(12, 10, 7, 5, lime);
      c.hline(8, 6, 8, parseHexColor('#bbf7d0'));
      c.hline(7, 13, 10, limeDark);
      // Glowing amber twin optics
      c.fillRect(14, 8, 4, 3, slateDark);
      c.fillRect(15, 9, 3, 2, goldHi);
      c.px(17, 9, white);
      // Coiled spring piston legs
      c.line(7, 14, 4, 18, slateHi);
      c.line(4, 18, 9, 21, gold);
      c.line(15, 14, 19, 18, slateHi);
      c.line(19, 18, 15, 21, gold);
      c.fillRect(6, 20, 5, 2, slateDark);
      c.fillRect(14, 20, 5, 2, slateDark);
      c.addOutline(OUTLINE);
      return c;
    }

    case 'flyer': {
      // 24x24 Hovering Recon Drone
      const c = new PixelCanvas(24, 24);
      // Top rotor / wing fins
      c.fillRect(3, 5, 18, 3, slateMid);
      c.hline(4, 5, 16, slateHi);
      // Central armored sensor orb
      c.fillCircle(12, 11, 5, red);
      c.fillCircle(11, 9, 2, redHi);
      c.fillRect(13, 10, 4, 3, slateDark);
      c.fillRect(14, 11, 3, 1, cyan);
      c.px(16, 11, white);
      // Side hover thrusters with blue flame jets
      c.fillRect(4, 9, 3, 5, slateDark);
      c.fillRect(17, 9, 3, 5, slateDark);
      c.fillRect(5, 15, 2, 4, cyan);
      c.px(5, 16, white);
      c.fillRect(17, 15, 2, 4, cyan);
      c.px(17, 16, white);
      // Underslung plasma pod
      c.fillRect(10, 16, 4, 3, gold);
      c.addOutline(OUTLINE);
      return c;
    }

    case 'crawler': {
      // 24x20 Armored Spiked Beetle Crawler
      const c = new PixelCanvas(24, 20);
      // Domed armored shell
      c.fillEllipse(12, 11, 8, 5, purple);
      c.hline(7, 7, 10, parseHexColor('#e9d5ff'));
      c.hline(5, 13, 14, parseHexColor('#581c87'));
      // Dorsal spikes
      c.fillRect(8, 4, 2, 3, slateHi);
      c.fillRect(13, 4, 2, 3, slateHi);
      // Front optic
      c.fillRect(16, 9, 3, 3, goldHi);
      c.px(18, 10, white);
      // Glowing crawler treads
      c.fillRect(4, 15, 16, 3, slateDark);
      for (let x = 6; x <= 18; x += 3) {
        c.px(x, 16, cyan);
      }
      c.addOutline(OUTLINE);
      return c;
    }

    case 'spawner': {
      // 28x28 Octagonal Drone Fabricator Hive
      const c = new PixelCanvas(28, 28);
      c.fillRect(4, 4, 20, 20, slateMid);
      c.hline(5, 4, 18, slateHi);
      c.hline(5, 23, 18, slateDark);
      // Corner warning chevrons
      c.fillRect(5, 5, 3, 3, gold);
      c.fillRect(20, 5, 3, 3, gold);
      c.fillRect(5, 20, 3, 3, gold);
      c.fillRect(20, 20, 3, 3, gold);
      // Pulsing magenta/cyan fabricator bay
      c.fillRect(8, 8, 12, 12, parseHexColor('#3b0764'));
      c.strokeRect(8, 8, 12, 12, purple);
      c.fillCircle(14, 14, 4, parseHexColor('#ec4899'));
      c.fillCircle(14, 14, 2, white);
      c.addOutline(OUTLINE);
      return c;
    }

    case 'hazard': {
      // 20x20 Floating Spiked Plasma Mine / Saw
      const c = new PixelCanvas(20, 20);
      // 8 outer razor blades
      c.fillRect(9, 1, 2, 18, slateHi);
      c.fillRect(1, 9, 18, 2, slateHi);
      c.line(3, 3, 16, 16, slateMid);
      c.line(16, 3, 3, 16, slateMid);
      // Core casing & glowing red plasma eye
      c.fillCircle(10, 10, 5, slateDark);
      c.fillCircle(10, 10, 3, red);
      c.fillRect(9, 9, 2, 2, goldHi);
      c.px(9, 9, white);
      c.addOutline(OUTLINE);
      return c;
    }

    case 'dummy': {
      // 24x28 Hub Training Room Combat Dummy
      const c = new PixelCanvas(24, 28);
      // Spring pedestal base
      c.fillRect(6, 23, 12, 3, slateMid);
      c.hline(7, 23, 10, slateHi);
      c.fillRect(10, 18, 4, 5, gold);
      c.hline(10, 20, 4, slateDark);
      // Padded target torso with bullseye
      c.fillRect(6, 10, 12, 9, parseHexColor('#e2e8f0'));
      c.fillRect(8, 12, 8, 5, red);
      c.fillRect(10, 13, 4, 3, white);
      c.fillRect(11, 14, 2, 1, red);
      // Friendly target head with amber visor
      c.fillRect(8, 3, 8, 7, slateMid);
      c.hline(9, 3, 6, slateHi);
      c.fillRect(10, 5, 5, 2, cyan);
      c.px(13, 5, white);
      c.addOutline(OUTLINE);
      return c;
    }
  }
}

function buildBossSiegeTread(): PixelCanvas {
  // 48x40 Heavy Armored Tread Assault Mech
  const c = new PixelCanvas(48, 40);
  const hullDark = parseHexColor('#1e293b');
  const hullMid = parseHexColor('#475569');
  const hullHi = parseHexColor('#94a3b8');
  const orange = parseHexColor('#ea580c');
  const gold = parseHexColor('#facc15');
  const red = parseHexColor('#ef4444');
  const white = parseHexColor('#f8fafc');
  const track = parseHexColor('#0f172a');

  // Dorsal mortar tubes & radar
  c.fillRect(12, 3, 7, 7, hullDark);
  c.hline(13, 3, 5, hullHi);
  c.fillRect(14, 2, 3, 2, orange);
  c.vline(9, 2, 10, hullHi);
  c.px(9, 2, red);

  // Upper rotary cannon turret
  c.fillRect(14, 8, 18, 8, hullMid);
  c.hline(15, 8, 16, hullHi);
  c.fillRect(18, 10, 6, 4, orange);
  // Twin heavy forward cannon barrels (pointing right)
  c.fillRect(31, 9, 13, 3, hullDark);
  c.hline(32, 9, 11, hullHi);
  c.fillRect(42, 9, 2, 3, gold);
  c.fillRect(31, 13, 11, 2, hullDark);
  c.hline(32, 13, 9, hullHi);

  // Main armored chassis hull
  c.fillRect(6, 15, 34, 13, hullMid);
  c.hline(7, 15, 32, hullHi);
  c.hline(7, 26, 32, hullDark);
  // Sloped armor panels & orange hazard stripes
  c.fillRect(8, 17, 6, 8, orange);
  c.hline(9, 18, 4, gold);
  c.hline(9, 21, 4, hullDark);
  // Blazing crimson cyclops bridge sensor
  c.fillRect(24, 17, 13, 6, hullDark);
  c.fillRect(26, 18, 10, 4, red);
  c.hline(28, 19, 7, white);
  // Front armored dozer spikes
  c.fillRect(39, 19, 5, 8, orange);
  c.fillRect(43, 20, 3, 2, hullHi);
  c.fillRect(43, 24, 3, 2, hullHi);

  // Massive caterpillar tread unit
  c.fillRect(4, 27, 39, 11, track);
  c.hline(5, 28, 37, hullMid);
  c.hline(5, 36, 37, hullMid);
  // 5 roadwheels with golden hub bolts
  for (let i = 0; i < 5; i++) {
    const wx = 9 + i * 7;
    c.fillCircle(wx, 32, 3, hullMid);
    c.fillCircle(wx, 32, 1, gold);
    c.px(wx - 1, 31, hullHi);
  }
  c.addOutline(OUTLINE);
  return c;
}

function buildBossPrism(): PixelCanvas {
  // 36x40 Solar Prism Master with crystalline solar cape & radiant visor
  const c = new PixelCanvas(36, 40);
  const ivoryDark = parseHexColor('#94a3b8');
  const ivoryMid = parseHexColor('#e2e8f0');
  const ivoryHi = parseHexColor('#ffffff');
  const goldDark = parseHexColor('#b45309');
  const goldMid = parseHexColor('#f59e0b');
  const goldHi = parseHexColor('#fef08a');
  const cyanDark = parseHexColor('#0284c7');
  const cyanMid = parseHexColor('#38f9ff');
  const cyanHi = parseHexColor('#e0f2fe');

  // Flowing faceted crystal cape behind (left side)
  for (let y = 13; y <= 35; y++) {
    const left = Math.max(2, 14 - Math.floor((y - 12) * 0.55));
    const right = 16;
    for (let x = left; x <= right; x++) {
      const col = (x + y) % 5 === 0 ? cyanHi : x < left + 3 ? goldMid : cyanMid;
      c.px(x, y, col);
    }
  }
  c.line(12, 14, 4, 34, goldHi);

  // Tall armored white-and-gold legs
  c.fillRect(13, 25, 4, 13, ivoryDark);
  c.fillRect(19, 25, 5, 13, ivoryMid);
  c.vline(22, 25, 12, ivoryHi);
  c.fillRect(12, 35, 6, 3, goldMid);
  c.fillRect(19, 35, 7, 3, goldMid);
  c.hline(20, 35, 5, goldHi);
  // Knee prism gems
  c.fillRect(20, 29, 3, 2, cyanMid);

  // Sculpted solar armor torso
  c.fillRect(13, 13, 11, 12, ivoryMid);
  c.hline(14, 13, 9, ivoryHi);
  c.fillRect(11, 13, 4, 4, goldMid); // back pauldron
  c.fillRect(22, 13, 4, 4, goldMid); // front pauldron
  c.px(23, 13, goldHi);
  // Radiant chest sun-core
  c.fillRect(16, 15, 5, 5, goldDark);
  c.fillRect(17, 16, 3, 3, cyanMid);
  c.px(18, 17, ivoryHi);
  // Golden belt
  c.hline(13, 23, 11, goldMid);
  c.fillRect(17, 22, 3, 3, goldHi);

  // Regal crowned helmet with sun-crest horns
  c.fillRect(14, 5, 10, 8, ivoryMid);
  c.hline(15, 5, 8, ivoryHi);
  // Twin solar crown horns
  c.line(16, 5, 13, 1, goldMid);
  c.line(17, 5, 14, 1, goldHi);
  c.line(21, 5, 25, 1, goldMid);
  c.line(22, 5, 26, 1, goldHi);
  c.fillRect(18, 2, 2, 4, cyanMid);
  // Glowing visor
  c.fillRect(17, 8, 7, 3, cyanDark);
  c.hline(18, 9, 6, cyanMid);
  c.hline(20, 9, 3, ivoryHi);

  // Forward extended hand & floating crystal emitter blade
  c.fillRect(23, 17, 5, 3, goldMid);
  // Orbiting diamond prism blade (right side)
  c.line(31, 8, 28, 16, cyanMid);
  c.line(31, 8, 34, 16, goldHi);
  c.line(28, 16, 31, 26, cyanDark);
  c.line(34, 16, 31, 26, cyanMid);
  c.fillRect(30, 12, 2, 10, ivoryHi);
  c.fillRect(30, 15, 2, 4, goldHi);

  c.addOutline(OUTLINE);
  return c;
}

function buildGenericBossVariant(
  bossId: Exclude<BossId, 'siege_tread' | 'prism'>,
): PixelCanvas {
  const specs: Record<
    Exclude<BossId, 'siege_tread' | 'prism'>,
    { w: number; h: number; dark: string; mid: string; hi: string; acc: string; glow: string; style: 'knight' | 'heavy' | 'crystal' | 'apex' }
  > = {
    stitch: { w: 36, h: 40, dark: '#14532d', mid: '#22c55e', hi: '#86efac', acc: '#f59e0b', glow: '#38f9ff', style: 'knight' },
    frostfang: { w: 36, h: 40, dark: '#1e3a8a', mid: '#38bdf8', hi: '#e0f2fe', acc: '#cbd5e1', glow: '#67e8f9', style: 'knight' },
    arcbolt: { w: 36, h: 40, dark: '#3b0764', mid: '#9333ea', hi: '#d8b4fe', acc: '#facc15', glow: '#fef08a', style: 'knight' },
    strider: { w: 36, h: 40, dark: '#134e4a', mid: '#14b8a6', hi: '#99f6e4', acc: '#fb7185', glow: '#f8fafc', style: 'knight' },
    tempo: { w: 36, h: 40, dark: '#701a75', mid: '#ec4899', hi: '#fbcfe8', acc: '#38f9ff', glow: '#fde047', style: 'knight' },
    crag: { w: 44, h: 40, dark: '#431407', mid: '#c2410c', hi: '#fdba74', acc: '#78716c', glow: '#facc15', style: 'heavy' },
    phantom: { w: 36, h: 40, dark: '#1e1b4b', mid: '#4f46e5', hi: '#a5b4fc', acc: '#10b981', glow: '#34d399', style: 'knight' },
    mirror_rival: { w: 36, h: 40, dark: '#3f0a1d', mid: '#be123c', hi: '#fda4af', acc: '#a855f7', glow: '#ff2e63', style: 'knight' },
    prism_core: { w: 44, h: 40, dark: '#1e3a5f', mid: '#38bdf8', hi: '#e0f2fe', acc: '#fbbf24', glow: '#ffffff', style: 'crystal' },
    overlord_apex: { w: 48, h: 40, dark: '#27133a', mid: '#6d28d9', hi: '#c4b5fd', acc: '#f59e0b', glow: '#f43f5e', style: 'apex' },
  };
  const s = specs[bossId];
  const c = new PixelCanvas(s.w, s.h);
  const dark = parseHexColor(s.dark);
  const mid = parseHexColor(s.mid);
  const hi = parseHexColor(s.hi);
  const acc = parseHexColor(s.acc);
  const glow = parseHexColor(s.glow);

  if (s.style === 'crystal') {
    // Floating crystalline core monolith + orbiting shields
    c.fillEllipse(22, 20, 10, 15, mid);
    c.fillEllipse(21, 18, 6, 10, hi);
    c.fillCircle(22, 20, 4, dark);
    c.fillCircle(22, 20, 2, glow);
    // Orbiting left/right diamond shield shards
    c.fillRect(4, 12, 5, 14, acc);
    c.vline(6, 13, 12, hi);
    c.fillRect(35, 12, 5, 14, acc);
    c.vline(37, 13, 12, hi);
    c.addOutline(OUTLINE);
    return c;
  }

  if (s.style === 'apex') {
    // Colossal final overlord commander with twin floating gauntlets
    // Crown & head
    c.fillRect(16, 4, 16, 11, mid);
    c.hline(17, 4, 14, hi);
    c.fillRect(14, 1, 3, 6, acc);
    c.fillRect(31, 1, 3, 6, acc);
    c.fillRect(21, 6, 6, 3, glow); // forehead reactor eye
    c.fillRect(18, 11, 12, 2, dark);
    // Broad armored chest
    c.fillRect(11, 15, 26, 17, mid);
    c.hline(12, 15, 24, hi);
    c.fillRect(19, 19, 10, 8, dark);
    c.fillRect(21, 21, 6, 4, glow);
    c.fillRect(14, 32, 8, 6, dark);
    c.fillRect(26, 32, 8, 6, dark);
    // Floating colossal gauntlets left & right
    c.fillRect(2, 16, 7, 13, acc);
    c.vline(4, 17, 11, hi);
    c.fillRect(39, 16, 7, 13, acc);
    c.vline(41, 17, 11, hi);
    c.addOutline(OUTLINE);
    return c;
  }

  if (s.style === 'heavy') {
    // Hulking beveled demolition juggernaut with hydraulic shoulders & pile-driver fists
    c.fillRect(14, 4, 14, 8, mid);
    c.hline(15, 4, 12, hi);
    c.fillRect(16, 2, 10, 2, acc);
    c.fillRect(18, 7, 8, 3, dark);
    c.hline(19, 8, 6, glow);
    // Broad sloped chestplate
    c.fillRect(9, 12, 24, 14, mid);
    c.hline(10, 12, 22, hi);
    c.hline(10, 25, 22, dark);
    c.fillRect(14, 15, 14, 7, dark);
    c.fillRect(17, 16, 8, 5, acc);
    c.fillRect(19, 17, 4, 3, glow);
    // Hydraulic shoulder pauldrons & pile-driver fists
    c.fillRect(4, 11, 6, 7, acc);
    c.hline(5, 11, 4, hi);
    c.fillRect(32, 11, 6, 7, acc);
    c.hline(33, 11, 4, hi);
    c.fillRect(2, 18, 8, 10, dark);
    c.fillRect(3, 19, 6, 8, acc);
    c.vline(4, 19, 8, hi);
    c.fillRect(32, 18, 10, 10, dark);
    c.fillRect(33, 19, 8, 8, acc);
    c.vline(39, 19, 8, hi);
    c.vline(41, 20, 6, glow);
    // Armored pillar legs & knee pistons
    c.fillRect(11, 26, 7, 11, dark);
    c.vline(13, 26, 10, mid);
    c.fillRect(24, 26, 7, 11, dark);
    c.vline(27, 26, 10, hi);
    c.fillRect(10, 35, 9, 3, acc);
    c.fillRect(23, 35, 10, 3, acc);
    c.hline(24, 35, 8, hi);
    c.addOutline(OUTLINE);
    return c;
  }

  // Agile Circuit Master boss rig with sculpted silhouette, flowing angled cape & signature weapon
  // Flowing tapered energy cape draping left
  for (let y = 13; y <= 34; y++) {
    const left = Math.max(2, 13 - Math.floor((y - 12) * 0.45));
    for (let x = left; x <= 14; x++) {
      c.px(x, y, x < left + 2 ? acc : (x + y) % 4 === 0 ? hi : dark);
    }
  }
  // Articulated cyber legs with knee guards & armored sabatons
  c.line(14, 24, 12, 35, dark);
  c.line(15, 24, 13, 35, dark);
  c.line(16, 24, 14, 35, mid);
  c.line(20, 24, 22, 35, mid);
  c.line(21, 24, 23, 35, mid);
  c.line(22, 24, 24, 35, hi);
  c.fillRect(20, 28, 4, 2, acc); // knee guard
  c.fillRect(10, 35, 6, 3, acc);
  c.fillRect(20, 35, 7, 3, acc);
  c.hline(21, 35, 5, hi);

  // Tapered V-shaped chestplate & angled pauldrons
  c.fillRect(13, 13, 10, 8, mid);
  c.fillRect(14, 21, 8, 4, dark);
  c.hline(14, 13, 8, hi);
  c.fillRect(10, 12, 4, 4, acc);
  c.px(11, 12, hi);
  c.fillRect(22, 12, 5, 4, acc);
  c.hline(23, 12, 3, hi);
  // Glowing torso core + belt
  c.fillRect(16, 15, 4, 4, dark);
  c.fillRect(17, 16, 2, 2, glow);
  c.hline(14, 22, 8, acc);

  // Sculpted angular helmet with boss-specific crest horns/fins
  c.fillRect(14, 5, 10, 8, mid);
  c.hline(15, 5, 8, hi);
  if (bossId === 'frostfang' || bossId === 'mirror_rival') {
    c.line(15, 5, 12, 1, acc);
    c.line(21, 5, 25, 1, hi);
  } else if (bossId === 'arcbolt' || bossId === 'tempo') {
    c.fillRect(12, 3, 2, 5, glow);
    c.fillRect(23, 3, 2, 5, glow);
    c.fillRect(17, 2, 3, 3, acc);
  } else if (bossId === 'strider') {
    // Swept aerodynamic jet wings
    c.line(11, 14, 2, 7, hi);
    c.line(11, 15, 3, 9, mid);
    c.line(15, 5, 10, 2, acc);
  } else {
    c.fillRect(16, 2, 5, 3, acc);
    c.hline(17, 2, 3, hi);
  }
  // Recessed dark visor with gleaming slit
  c.fillRect(17, 8, 7, 3, dark);
  c.hline(18, 9, 6, glow);
  c.hline(20, 9, 3, hi);

  // Signature front weapon arm / energy blade
  c.fillRect(23, 16, 6, 3, mid);
  c.hline(24, 16, 5, hi);
  if (bossId === 'frostfang' || bossId === 'phantom' || bossId === 'mirror_rival') {
    // Swept energy blade
    c.line(28, 17, 34, 11, glow);
    c.line(28, 18, 34, 12, hi);
    c.line(28, 19, 33, 14, acc);
  } else if (bossId === 'arcbolt') {
    // Crackling lightning lance
    c.line(28, 17, 31, 14, glow);
    c.line(31, 14, 33, 18, hi);
    c.line(33, 18, 35, 15, glow);
  } else {
    // Heavy cyber cannon / gauntlet emitter
    c.fillRect(28, 15, 5, 5, acc);
    c.fillRect(31, 16, 3, 3, glow);
    c.px(32, 17, hi);
  }
  c.addOutline(OUTLINE);
  return c;
}

function buildMinibossSprite(id: MinibossId): PixelCanvas {
  const c = new PixelCanvas(40, 36);
  const dark = parseHexColor('#1e293b');
  const mid = parseHexColor('#475569');
  const hi = parseHexColor('#94a3b8');
  const acc =
    id === 'junk_colossus'
      ? parseHexColor('#ea580c')
      : id === 'sky_gunship'
        ? parseHexColor('#0284c7')
        : parseHexColor('#eab308');
  const accHi =
    id === 'junk_colossus'
      ? parseHexColor('#fdba74')
      : id === 'sky_gunship'
        ? parseHexColor('#7dd3fc')
        : parseHexColor('#fef08a');
  const glow = parseHexColor('#f43f5e');
  const cyan = parseHexColor('#38f9ff');
  const white = parseHexColor('#f8fafc');

  if (id === 'sky_gunship') {
    // Sleek coaxial armored assault gunship
    c.fillRect(3, 4, 34, 2, hi);
    c.hline(12, 3, 16, white);
    c.fillRect(18, 6, 4, 4, dark);
    c.fillEllipse(20, 16, 15, 7, acc);
    c.hline(10, 10, 20, accHi);
    c.hline(9, 21, 22, dark);
    // Tail boom & stabilizer
    c.fillRect(2, 13, 8, 4, mid);
    c.fillRect(2, 9, 3, 6, acc);
    // Armored glass cockpit
    c.fillRect(24, 12, 9, 5, dark);
    c.hline(25, 13, 7, cyan);
    c.hline(27, 14, 4, white);
    // Twin underslung missile pods & rotary turret
    c.fillRect(11, 22, 16, 5, mid);
    c.hline(12, 22, 14, hi);
    c.fillRect(27, 22, 9, 4, dark);
    c.hline(28, 23, 7, glow);
    c.px(35, 23, white);
  } else if (id === 'wrecker_tank') {
    // Compact heavy assault wrecker tank with treads & mortar turret
    c.fillRect(11, 4, 16, 8, acc);
    c.hline(12, 4, 14, accHi);
    c.fillRect(26, 6, 10, 3, dark);
    c.hline(27, 6, 8, hi);
    c.px(35, 7, glow);
    // Sloped hull
    c.fillRect(6, 12, 28, 12, mid);
    c.hline(7, 12, 26, hi);
    c.fillRect(20, 15, 10, 5, dark);
    c.hline(22, 17, 7, glow);
    c.fillRect(8, 15, 6, 6, acc);
    // Caterpillar tread bed + 4 wheels
    c.fillRect(4, 24, 32, 9, dark);
    c.hline(5, 25, 30, mid);
    for (let i = 0; i < 4; i++) {
      c.fillCircle(9 + i * 7, 28, 3, mid);
      c.px(9 + i * 7, 28, accHi);
    }
  } else {
    // Junk Colossus heavy scrap-iron golem mech
    c.fillRect(13, 3, 14, 8, acc);
    c.hline(14, 3, 12, accHi);
    c.fillRect(19, 6, 7, 3, dark);
    c.hline(20, 7, 5, glow);
    // Riveted torso & furnace core
    c.fillRect(8, 11, 24, 14, mid);
    c.hline(9, 11, 22, hi);
    c.fillRect(15, 15, 10, 6, dark);
    c.fillRect(17, 16, 6, 4, acc);
    c.fillRect(19, 17, 2, 2, white);
    // Oversized scrap claws
    c.fillRect(2, 13, 6, 12, acc);
    c.vline(3, 14, 10, accHi);
    c.fillRect(32, 13, 6, 12, acc);
    c.vline(36, 14, 10, accHi);
    // Heavy piston legs
    c.fillRect(10, 25, 7, 9, dark);
    c.vline(12, 25, 8, hi);
    c.fillRect(23, 25, 7, 9, dark);
    c.vline(25, 25, 8, hi);
  }
  c.addOutline(OUTLINE);
  return c;
}

// ============================================================================
// 5. Props, Pickups, Walker & HUD Icons
// ============================================================================

function buildPropsAndPickups(): Record<string, PixelCanvas> {
  const out: Record<string, PixelCanvas> = {};
  const white = parseHexColor('#f8fafc');
  const steelDark = parseHexColor('#1e293b');
  const steelMid = parseHexColor('#64748b');
  const steelHi = parseHexColor('#cbd5e1');
  const cyan = parseHexColor('#38f9ff');
  const gold = parseHexColor('#f59e0b');
  const goldHi = parseHexColor('#fef08a');
  const red = parseHexColor('#ef4444');
  const redHi = parseHexColor('#fda4af');
  const green = parseHexColor('#22c55e');
  const greenHi = parseHexColor('#bbf7d0');
  const blue = parseHexColor('#3b82f6');
  const magenta = parseHexColor('#e879f9');

  // crate (16x16)
  {
    const c = new PixelCanvas(16, 16);
    const woodDark = parseHexColor('#78350f');
    const woodMid = parseHexColor('#b45309');
    const woodHi = parseHexColor('#f59e0b');
    c.fillRect(0, 0, 16, 16, woodMid);
    c.strokeRect(0, 0, 16, 16, OUTLINE);
    c.strokeRect(1, 1, 14, 14, woodDark);
    c.hline(2, 2, 12, woodHi);
    c.line(3, 3, 12, 12, woodDark);
    c.line(12, 3, 3, 12, woodDark);
    c.line(3, 2, 13, 12, woodHi);
    // Steel corner plates
    c.fillRect(1, 1, 3, 3, steelMid);
    c.fillRect(12, 1, 3, 3, steelMid);
    c.fillRect(1, 12, 3, 3, steelMid);
    c.fillRect(12, 12, 3, 3, steelMid);
    out.crate = c;
  }

  // barrel (16x16)
  {
    const c = new PixelCanvas(16, 16);
    const drumDark = parseHexColor('#991b1b');
    c.fillRect(2, 1, 12, 14, red);
    c.vline(3, 2, 12, redHi);
    c.vline(12, 2, 12, drumDark);
    // Steel ribs
    c.hline(2, 4, 12, steelHi);
    c.hline(2, 11, 12, steelHi);
    // Hazard yellow emblem
    c.fillRect(6, 6, 4, 4, goldHi);
    c.fillRect(7, 7, 2, 2, red);
    c.addOutline(OUTLINE);
    out.barrel = c;
  }

  // switch_off & switch_on (16x16)
  for (const on of [false, true]) {
    const c = new PixelCanvas(16, 16);
    c.fillRect(2, 11, 12, 4, steelMid);
    c.hline(3, 11, 10, steelHi);
    c.fillRect(5, 8, 6, 3, steelDark);
    if (on) {
      c.line(8, 8, 12, 3, steelHi);
      c.fillCircle(12, 3, 2, green);
      c.px(12, 2, white);
      c.fillRect(7, 9, 2, 1, cyan);
    } else {
      c.line(8, 8, 4, 3, steelHi);
      c.fillCircle(4, 3, 2, red);
      c.px(4, 2, redHi);
      c.fillRect(7, 9, 2, 1, red);
    }
    c.addOutline(OUTLINE);
    out[on ? 'switch_on' : 'switch_off'] = c;
  }

  // hub_terminal (24x32)
  {
    const c = new PixelCanvas(24, 32);
    // Pedestal base
    c.fillRect(4, 26, 16, 5, steelDark);
    c.hline(5, 26, 14, steelHi);
    c.fillRect(7, 17, 10, 9, steelMid);
    c.vline(8, 18, 7, steelHi);
    // Keyboard console lip
    c.fillRect(3, 15, 18, 3, steelDark);
    c.hline(4, 15, 16, gold);
    // Angled cyber holo screen
    c.fillRect(2, 3, 20, 12, steelDark);
    c.strokeRect(2, 3, 20, 12, steelHi);
    c.fillRect(4, 5, 16, 8, parseHexColor('#083344'));
    c.hline(5, 6, 10, cyan);
    c.hline(5, 8, 14, cyan);
    c.hline(5, 10, 7, goldHi);
    c.fillRect(15, 9, 4, 3, green);
    // Top antenna LED
    c.vline(19, 1, 2, steelHi);
    c.px(19, 1, cyan);
    c.addOutline(OUTLINE);
    out.hub_terminal = c;
  }

  // rescue_bot (16x20)
  {
    const c = new PixelCanvas(16, 20);
    // SOS Antenna
    c.vline(8, 1, 3, steelHi);
    c.fillRect(7, 1, 3, 2, goldHi);
    // Cute round blue-white helmet
    c.fillRect(4, 4, 8, 6, blue);
    c.hline(5, 4, 6, parseHexColor('#93c5fd'));
    c.fillRect(6, 6, 5, 3, steelDark);
    c.px(7, 7, cyan);
    c.px(9, 7, cyan);
    // Waving arms & mini body
    c.fillRect(5, 10, 6, 5, steelHi);
    c.fillRect(2, 8, 3, 3, gold);
    c.fillRect(11, 8, 3, 3, gold);
    c.fillRect(5, 15, 2, 4, steelDark);
    c.fillRect(9, 15, 2, 4, steelDark);
    c.addOutline(OUTLINE);
    out.rescue_bot = c;
  }

  // health_booster (16x16)
  {
    const c = new PixelCanvas(16, 16);
    c.fillRect(3, 2, 10, 12, red);
    c.vline(4, 3, 10, redHi);
    c.fillRect(4, 1, 8, 2, steelHi);
    c.fillRect(4, 13, 8, 2, steelMid);
    // Crisp white cross
    c.fillRect(7, 5, 2, 6, white);
    c.fillRect(5, 7, 6, 2, white);
    c.addOutline(OUTLINE);
    out.health_booster = c;
  }

  // burst_booster (16x16)
  {
    const c = new PixelCanvas(16, 16);
    c.fillRect(3, 2, 10, 12, parseHexColor('#0369a1'));
    c.fillRect(4, 1, 8, 2, gold);
    c.fillRect(4, 13, 8, 2, gold);
    c.fillRect(5, 4, 6, 8, cyan);
    // Lightning bolt core
    c.line(9, 4, 6, 8, goldHi);
    c.hline(6, 8, 4, white);
    c.line(9, 8, 6, 12, goldHi);
    c.addOutline(OUTLINE);
    out.burst_booster = c;
  }

  // palette_chip (16x16)
  {
    const c = new PixelCanvas(16, 16);
    // Gold pins
    for (let x = 4; x <= 11; x += 2) {
      c.px(x, 1, goldHi);
      c.px(x, 14, goldHi);
    }
    c.fillRect(2, 2, 12, 12, steelDark);
    c.strokeRect(2, 2, 12, 12, steelHi);
    // Prismatic 3-band die
    c.fillRect(4, 4, 8, 3, red);
    c.fillRect(4, 7, 8, 3, green);
    c.fillRect(4, 10, 8, 2, cyan);
    c.px(5, 5, white);
    c.addOutline(OUTLINE);
    out.palette_chip = c;
  }

  // bit_1 (10x10), bit_5 (10x10), bit_10 (12x12), bit_50 (14x14)
  {
    const makeBit = (size: number, dark: RGBA, mid: RGBA, hi: RGBA): PixelCanvas => {
      const c = new PixelCanvas(size, size);
      const half = Math.floor(size / 2);
      const r = half - 2;
      for (let y = -r; y <= r; y++) {
        const span = r - Math.abs(y);
        for (let x = -span; x <= span; x++) {
          const col = x < 0 && y < 0 ? white : x <= 0 ? hi : y > 0 ? dark : mid;
          c.px(half + x, half + y, col);
        }
      }
      c.addOutline(OUTLINE);
      return c;
    };
    out.bit_1 = makeBit(10, parseHexColor('#92400e'), gold, goldHi);
    out.bit_5 = makeBit(10, parseHexColor('#166534'), green, greenHi);
    out.bit_10 = makeBit(12, parseHexColor('#1d4ed8'), blue, cyan);
    out.bit_50 = makeBit(14, parseHexColor('#a21caf'), magenta, goldHi);
  }

  // health_small (10x10) & health_large (14x14)
  {
    const sm = new PixelCanvas(10, 10);
    sm.fillCircle(5, 5, 3, red);
    sm.px(4, 3, white);
    sm.px(4, 4, redHi);
    sm.addOutline(OUTLINE);
    out.health_small = sm;

    const lg = new PixelCanvas(14, 14);
    lg.fillRect(3, 2, 8, 10, red);
    lg.fillRect(2, 3, 10, 8, red);
    lg.vline(4, 3, 8, redHi);
    lg.fillRect(6, 4, 2, 6, white);
    lg.fillRect(4, 6, 6, 2, white);
    lg.addOutline(OUTLINE);
    out.health_large = lg;
  }

  // burst_orb (12x12)
  {
    const c = new PixelCanvas(12, 12);
    c.fillCircle(6, 6, 4, cyan);
    c.fillCircle(6, 6, 2, goldHi);
    c.px(5, 4, white);
    c.addOutline(OUTLINE);
    out.burst_orb = c;
  }

  // walker (32x32) armored ride-mech with sloped cockpit canopy & twin cannons
  {
    const c = new PixelCanvas(32, 32);
    const goldDark = parseHexColor('#b45309');
    // Armored roll-cage canopy & dome
    c.fillRect(8, 3, 15, 14, gold);
    c.hline(9, 3, 13, goldHi);
    c.hline(9, 16, 13, goldDark);
    c.fillRect(14, 6, 9, 7, parseHexColor('#083344'));
    c.hline(15, 7, 7, cyan);
    c.hline(17, 8, 4, white);
    // Rear engine exhaust & front hydraulic punch arm
    c.fillRect(4, 7, 4, 7, steelMid);
    c.vline(5, 8, 5, steelHi);
    c.fillRect(22, 13, 8, 5, steelMid);
    c.hline(23, 13, 6, steelHi);
    c.fillRect(28, 14, 2, 3, goldHi);
    // Reverse-joint articulated walker legs
    c.line(11, 17, 8, 23, steelDark);
    c.line(12, 17, 9, 23, steelMid);
    c.line(9, 23, 11, 28, steelDark);
    c.line(18, 17, 16, 23, steelMid);
    c.line(19, 17, 17, 23, steelHi);
    c.line(17, 23, 20, 28, steelMid);
    c.fillRect(7, 27, 8, 3, gold);
    c.fillRect(17, 27, 9, 3, gold);
    c.hline(18, 27, 7, goldHi);
    c.addOutline(OUTLINE);
    out.walker = c;
  }

  // HUD icons (10x10)
  {
    const heart = new PixelCanvas(10, 10);
    heart.paintGrid(
      [
        '..OO..OO..',
        '.ORROORRO.',
        'ORHHRRRRRO',
        'ORHRRRRRRO',
        'ORRRRRRRRO',
        '.ORRRRRRO.',
        '..ORRRRO..',
        '...ORRO...',
        '....OO....',
      ],
      { O: OUTLINE, R: red, H: white },
      0,
      0,
    );
    out.hud_heart = heart;

    const burst = new PixelCanvas(10, 10);
    burst.paintGrid(
      [
        '....OOOO..',
        '...OYYHO..',
        '..OYYHO...',
        '.OYYHYYYO.',
        '.OCCCCYYO.',
        '...OYYHO..',
        '..OYYHO...',
        '..OYYO....',
        '..OOO.....',
      ],
      { O: OUTLINE, Y: goldHi, H: white, C: cyan },
      0,
      0,
    );
    out.hud_burst = burst;

    const rescue = new PixelCanvas(10, 10);
    rescue.paintGrid(
      [
        '....OO....',
        '..OOBBOO..',
        '.OBHHHBB0.',
        '.OBDCCDBO.',
        '.OBCCCCBO.',
        '..OBBBBO..',
        '...OOOO...',
      ],
      { O: OUTLINE, '0': OUTLINE, B: blue, H: parseHexColor('#93c5fd'), D: steelDark, C: cyan },
      0,
      1,
    );
    out.hud_rescue = rescue;

    const bit = new PixelCanvas(10, 10);
    bit.paintGrid(
      [
        '....OO....',
        '...OHYO...',
        '..OHYYYO..',
        '.OHYYYYGO.',
        '.OYYYYGGO.',
        '..OYYGGO..',
        '...OGGO...',
        '....OO....',
      ],
      { O: OUTLINE, H: white, Y: goldHi, G: gold },
      0,
      1,
    );
    out.hud_bit = bit;
  }

  return out;
}

// ============================================================================
// 6. Crisp 6x8 Outlined Pixel Bitmap Font (ASCII 32..126)
// Each glyph is encoded as 6 rows of 4-bit (or 5-bit) pixel masks, rendered
// into a 6x8 cell with a crisp 1px dark outline (#0d101b) and subtle 16-bit
// top-white / lower-silver bevel.
// ============================================================================

const FONT_GLYPH_MASKS: Readonly<Record<number, readonly string[]>> = {
  32: ['....', '....', '....', '....', '....', '....'], // ' '
  33: ['.X..', '.X..', '.X..', '.X..', '....', '.X..'], // !
  34: ['X.X.', 'X.X.', '....', '....', '....', '....'], // "
  35: ['X.X.', 'XXXX', 'X.X.', 'XXXX', 'X.X.', '....'], // #
  36: ['.XX.', 'X...', '.XX.', '...X', 'XXX.', '.X..'], // $
  37: ['X..X', '..X.', '.X..', 'X..X', '....', '....'], // %
  38: ['.XX.', 'X..X', '.XX.', 'X.X.', 'X..X', '.XX.'], // &
  39: ['.X..', '.X..', '....', '....', '....', '....'], // '
  40: ['..X.', '.X..', '.X..', '.X..', '.X..', '..X.'], // (
  41: ['.X..', '..X.', '..X.', '..X.', '..X.', '.X..'], // )
  42: ['....', 'X.X.', '.X..', 'X.X.', '....', '....'], // *
  43: ['....', '.X..', 'XXX.', '.X..', '....', '....'], // +
  44: ['....', '....', '....', '....', '.X..', 'X...'], // ,
  45: ['....', '....', 'XXX.', '....', '....', '....'], // -
  46: ['....', '....', '....', '....', '....', '.X..'], // .
  47: ['...X', '..X.', '..X.', '.X..', '.X..', 'X...'], // /
  48: ['.XX.', 'X..X', 'X.XX', 'XX.X', 'X..X', '.XX.'], // 0
  49: ['.X..', 'XX..', '.X..', '.X..', '.X..', 'XXX.'], // 1
  50: ['XXX.', '...X', '.XX.', 'X...', 'X...', 'XXXX'], // 2
  51: ['XXX.', '...X', '.XX.', '...X', '...X', 'XXX.'], // 3
  52: ['X..X', 'X..X', 'XXXX', '...X', '...X', '...X'], // 4
  53: ['XXXX', 'X...', 'XXX.', '...X', '...X', 'XXX.'], // 5
  54: ['.XXX', 'X...', 'XXX.', 'X..X', 'X..X', '.XX.'], // 6
  55: ['XXXX', '...X', '..X.', '.X..', '.X..', '.X..'], // 7
  56: ['.XX.', 'X..X', '.XX.', 'X..X', 'X..X', '.XX.'], // 8
  57: ['.XX.', 'X..X', '.XXX', '...X', '..X.', 'XX..'], // 9
  58: ['....', '.X..', '....', '....', '.X..', '....'], // :
  59: ['....', '.X..', '....', '....', '.X..', 'X...'], // ;
  60: ['..X.', '.X..', 'X...', '.X..', '..X.', '....'], // <
  61: ['....', 'XXXX', '....', 'XXXX', '....', '....'], // =
  62: ['.X..', '..X.', '...X', '..X.', '.X..', '....'], // >
  63: ['.XX.', 'X..X', '..X.', '.X..', '....', '.X..'], // ?
  64: ['.XX.', 'X..X', 'X.XX', 'X.XX', 'X...', '.XXX'], // @
  65: ['.XX.', 'X..X', 'X..X', 'XXXX', 'X..X', 'X..X'], // A
  66: ['XXX.', 'X..X', 'XXX.', 'X..X', 'X..X', 'XXX.'], // B
  67: ['.XXX', 'X...', 'X...', 'X...', 'X...', '.XXX'], // C
  68: ['XXX.', 'X..X', 'X..X', 'X..X', 'X..X', 'XXX.'], // D
  69: ['XXXX', 'X...', 'XXX.', 'X...', 'X...', 'XXXX'], // E
  70: ['XXXX', 'X...', 'XXX.', 'X...', 'X...', 'X...'], // F
  71: ['.XXX', 'X...', 'X.XX', 'X..X', 'X..X', '.XXX'], // G
  72: ['X..X', 'X..X', 'XXXX', 'X..X', 'X..X', 'X..X'], // H
  73: ['XXX.', '.X..', '.X..', '.X..', '.X..', 'XXX.'], // I
  74: ['..XX', '...X', '...X', '...X', 'X..X', '.XX.'], // J
  75: ['X..X', 'X.X.', 'XX..', 'X.X.', 'X..X', 'X..X'], // K
  76: ['X...', 'X...', 'X...', 'X...', 'X...', 'XXXX'], // L
  77: ['X..X', 'XXXX', 'XXXX', 'X..X', 'X..X', 'X..X'], // M
  78: ['X..X', 'XX.X', 'XXXX', 'X.XX', 'X..X', 'X..X'], // N
  79: ['.XX.', 'X..X', 'X..X', 'X..X', 'X..X', '.XX.'], // O
  80: ['XXX.', 'X..X', 'X..X', 'XXX.', 'X...', 'X...'], // P
  81: ['.XX.', 'X..X', 'X..X', 'X.XX', 'X..X', '.XXX'], // Q
  82: ['XXX.', 'X..X', 'X..X', 'XXX.', 'X.X.', 'X..X'], // R
  83: ['.XXX', 'X...', '.XX.', '...X', '...X', 'XXX.'], // S
  84: ['XXXX', '.XX.', '.XX.', '.XX.', '.XX.', '.XX.'], // T
  85: ['X..X', 'X..X', 'X..X', 'X..X', 'X..X', '.XX.'], // U
  86: ['X..X', 'X..X', 'X..X', 'X..X', '.XX.', '.XX.'], // V
  87: ['X..X', 'X..X', 'X..X', 'XXXX', 'XXXX', 'X..X'], // W
  88: ['X..X', 'X..X', '.XX.', '.XX.', 'X..X', 'X..X'], // X
  89: ['X..X', 'X..X', '.XX.', '.XX.', '.XX.', '.XX.'], // Y
  90: ['XXXX', '...X', '..X.', '.X..', 'X...', 'XXXX'], // Z
  91: ['.XX.', '.X..', '.X..', '.X..', '.X..', '.XX.'], // [
  92: ['X...', '.X..', '.X..', '..X.', '..X.', '...X'], // \
  93: ['.XX.', '..X.', '..X.', '..X.', '..X.', '.XX.'], // ]
  94: ['.XX.', 'X..X', '....', '....', '....', '....'], // ^
  95: ['....', '....', '....', '....', '....', 'XXXX'], // _
  96: ['X...', '.X..', '....', '....', '....', '....'], // `
  97: ['....', '.XX.', '...X', '.XXX', 'X..X', '.XXX'], // a
  98: ['X...', 'X...', 'XXX.', 'X..X', 'X..X', 'XXX.'], // b
  99: ['....', '.XXX', 'X...', 'X...', 'X...', '.XXX'], // c
  100: ['...X', '...X', '.XXX', 'X..X', 'X..X', '.XXX'], // d
  101: ['....', '.XX.', 'X..X', 'XXXX', 'X...', '.XXX'], // e
  102: ['..XX', '.X..', 'XXX.', '.X..', '.X..', '.X..'], // f
  103: ['....', '.XXX', 'X..X', '.XXX', '...X', 'XXX.'], // g
  104: ['X...', 'X...', 'XXX.', 'X..X', 'X..X', 'X..X'], // h
  105: ['.X..', '....', '.X..', '.X..', '.X..', '.X..'], // i
  106: ['..X.', '....', '..X.', '..X.', 'X.X.', '.X..'], // j
  107: ['X...', 'X..X', 'X.X.', 'XX..', 'X.X.', 'X..X'], // k
  108: ['.X..', '.X..', '.X..', '.X..', '.X..', '..X.'], // l
  109: ['....', 'XXXX', 'XXXX', 'X..X', 'X..X', 'X..X'], // m
  110: ['....', 'XXX.', 'X..X', 'X..X', 'X..X', 'X..X'], // n
  111: ['....', '.XX.', 'X..X', 'X..X', 'X..X', '.XX.'], // o
  112: ['....', 'XXX.', 'X..X', 'XXX.', 'X...', 'X...'], // p
  113: ['....', '.XXX', 'X..X', '.XXX', '...X', '...X'], // q
  114: ['....', 'X.XX', 'XX..', 'X...', 'X...', 'X...'], // r
  115: ['....', '.XXX', 'X...', '.XX.', '...X', 'XXX.'], // s
  116: ['.X..', 'XXX.', '.X..', '.X..', '.X..', '..X.'], // t
  117: ['....', 'X..X', 'X..X', 'X..X', 'X..X', '.XXX'], // u
  118: ['....', 'X..X', 'X..X', 'X..X', '.XX.', '.XX.'], // v
  119: ['....', 'X..X', 'X..X', 'XXXX', 'XXXX', 'X..X'], // w
  120: ['....', 'X..X', '.XX.', '.XX.', 'X..X', 'X..X'], // x
  121: ['....', 'X..X', 'X..X', '.XXX', '...X', 'XXX.'], // y
  122: ['....', 'XXXX', '..X.', '.X..', 'X...', 'XXXX'], // z
  123: ['..XX', '.X..', 'XX..', '.X..', '.X..', '..XX'], // {
  124: ['.X..', '.X..', '.X..', '.X..', '.X..', '.X..'], // |
  125: ['XX..', '..X.', '..XX', '..X.', '..X.', 'XX..'], // }
  126: ['....', '.X.X', 'X.X.', '....', '....', '....'], // ~
};

function buildGlyphCanvas(
  charCode: number,
  fgTop: RGBA = parseHexColor('#f8fafc'),
  fgBottom: RGBA = parseHexColor('#cbd5e1'),
  outlineColor: RGBA = OUTLINE,
): PixelCanvas {
  const c = new PixelCanvas(6, 8);
  const mask = FONT_GLYPH_MASKS[charCode] ?? FONT_GLYPH_MASKS[63];
  for (let row = 0; row < mask.length; row++) {
    const line = mask[row];
    const col = row < 3 ? fgTop : fgBottom;
    for (let colIdx = 0; colIdx < line.length; colIdx++) {
      if (line[colIdx] === 'X') {
        c.px(colIdx + 1, row + 1, col);
      }
    }
  }
  c.addOutline(outlineColor);
  return c;
}

// ============================================================================
// Shelf Atlas Packer (1px Transparent Gutter, Power-of-Two Dimensions)
// ============================================================================

interface PendingSprite {
  readonly key: string;
  readonly canvas: PixelCanvas;
}

function nextPowerOfTwo(n: number): number {
  let p = 64;
  while (p < n) p *= 2;
  return p;
}

function packSprites(items: readonly PendingSprite[]): {
  sheet: PixelSurface;
  regions: Map<string, AtlasRegion>;
} {
  // Sort tallest first for compact shelf packing
  const sorted = [...items].sort((a, b) => b.canvas.height - a.canvas.height || b.canvas.width - a.canvas.width);

  const padding = 1;
  const maxWidth = 512;

  let curX = padding;
  let curY = padding;
  let shelfH = 0;

  const placements: Array<{ key: string; canvas: PixelCanvas; x: number; y: number }> = [];

  for (const item of sorted) {
    const w = item.canvas.width;
    const h = item.canvas.height;
    if (curX + w + padding > maxWidth) {
      curX = padding;
      curY += shelfH + padding;
      shelfH = 0;
    }
    placements.push({ key: item.key, canvas: item.canvas, x: curX, y: curY });
    curX += w + padding;
    if (h > shelfH) shelfH = h;
  }

  const sheetW = maxWidth;
  const sheetH = nextPowerOfTwo(curY + shelfH + padding);
  const sheetCanvas = new PixelCanvas(sheetW, sheetH);
  const regions = new Map<string, AtlasRegion>();

  for (const p of placements) {
    sheetCanvas.blit(p.canvas, p.x, p.y);
    regions.set(p.key, {
      key: p.key,
      x: p.x,
      y: p.y,
      w: p.canvas.width,
      h: p.canvas.height,
    });
  }

  return { sheet: sheetCanvas.toSurface(), regions };
}

// ============================================================================
// ProceduralPixelAtlas Class
// ============================================================================

const ENEMY_FAMILIES: readonly EnemyFamily[] = [
  'trooper',
  'shield_guard',
  'turret',
  'hopper',
  'flyer',
  'crawler',
  'spawner',
  'hazard',
  'dummy',
];

const GENERIC_BOSS_IDS: readonly Exclude<BossId, 'siege_tread' | 'prism'>[] = [
  'stitch',
  'frostfang',
  'arcbolt',
  'strider',
  'tempo',
  'crag',
  'phantom',
  'mirror_rival',
  'prism_core',
  'overlord_apex',
];

const MINIBOSS_IDS: readonly MinibossId[] = ['junk_colossus', 'sky_gunship', 'wrecker_tank'];

export class ProceduralPixelAtlas {
  private readonly sheet: PixelSurface;
  private readonly regions: Map<string, AtlasRegion>;
  private readonly aliases: Map<string, string>;
  private readonly font: BitmapFontAtlas;
  private cachedCanvas: HTMLCanvasElement | null = null;
  private cachedBitmap: ImageBitmap | null = null;

  constructor() {
    const items: PendingSprite[] = [];
    const aliases = new Map<string, string>();

    // 1. Hero frames (21 frames, 32x32, strictly PALETTE_KEY_COLORS)
    const heroFrames = buildAllHeroFrames();
    for (const frameName of HERO_FRAME_NAMES) {
      items.push({ key: `player_hero_${frameName}`, canvas: heroFrames[frameName] });
      aliases.set(`hero_${frameName}`, `player_hero_${frameName}`);
      aliases.set(`player_${frameName}`, `player_hero_${frameName}`);
    }
    aliases.set('player_hero', 'player_hero_idle_0');

    // 2. Hookshot & aim reticle
    items.push({ key: 'hook_tip', canvas: buildHookTip() });
    items.push({ key: 'hook_chain', canvas: buildHookChain() });
    items.push({ key: 'aim_reticle', canvas: buildAimReticle() });
    aliases.set('hookshot', 'hook_tip');

    // 3. 16x16 Biome tilesets for all 15 StageIds & all non-empty TileTypes
    for (const stageId of OFFICIAL_STAGE_IDS) {
      for (const tileType of SOLID_TILE_TYPES) {
        items.push({
          key: `tile_${stageId}_${tileType}`,
          canvas: buildBiomeTile(stageId, tileType),
        });
      }
    }

    // 4. Enemies (all 9 EnemyFamilies)
    for (const family of ENEMY_FAMILIES) {
      const key = `enemy_${family}`;
      items.push({ key, canvas: buildEnemySprite(family) });
      aliases.set(family, key);
    }

    // 5. Bosses (bespoke Siege Tread & Prism + all 10 other bosses) & Minibosses
    items.push({ key: 'boss_siege_tread', canvas: buildBossSiegeTread() });
    items.push({ key: 'boss_prism', canvas: buildBossPrism() });
    for (const bossId of GENERIC_BOSS_IDS) {
      items.push({ key: `boss_${bossId}`, canvas: buildGenericBossVariant(bossId) });
    }
    for (const mbId of MINIBOSS_IDS) {
      items.push({ key: `miniboss_${mbId}`, canvas: buildMinibossSprite(mbId) });
    }

    // 6. Props, pickups, walker & HUD icons
    const props = buildPropsAndPickups();
    for (const [key, canvas] of Object.entries(props)) {
      items.push({ key, canvas });
    }
    aliases.set('rescue', 'rescue_bot');

    // 7. Outlined 6x8 BitmapFontAtlas glyphs (ASCII 32..126)
    for (let code = 32; code <= 126; code++) {
      items.push({ key: `font_${code}`, canvas: buildGlyphCanvas(code) });
    }

    const packed = packSprites(items);
    this.sheet = packed.sheet;
    this.regions = packed.regions;
    this.aliases = aliases;

    // Build BitmapFontAtlas lookup facade
    const glyphRecord: Record<number, AtlasRegion> = {};
    for (let code = 32; code <= 126; code++) {
      const reg = this.regions.get(`font_${code}`);
      if (reg) glyphRecord[code] = reg;
    }

    this.font = {
      glyphWidth: 6,
      glyphHeight: 8,
      firstChar: 32,
      lastChar: 126,
      glyphs: glyphRecord,
      getGlyph(charCode: number): AtlasRegion | null {
        return glyphRecord[charCode] ?? glyphRecord[63] ?? null;
      },
      measureText(text: string, scale = 1): { width: number; height: number } {
        const lines = text.split('\n');
        let maxCols = 0;
        for (const line of lines) {
          if (line.length > maxCols) maxCols = line.length;
        }
        return {
          width: maxCols * 6 * scale,
          height: lines.length * 8 * scale,
        };
      },
    };
  }

  getSheet(): PixelSurface {
    return this.sheet;
  }

  getRegion(key: string): AtlasRegion | null {
    const direct = this.regions.get(key);
    if (direct) return direct;
    const aliased = this.aliases.get(key);
    if (aliased) return this.regions.get(aliased) ?? null;
    return null;
  }

  hasKey(key: string): boolean {
    return this.regions.has(key) || this.aliases.has(key);
  }

  getAllKeys(): string[] {
    const keys = new Set<string>(this.regions.keys());
    for (const alias of this.aliases.keys()) {
      keys.add(alias);
    }
    return Array.from(keys);
  }

  getRegionsRecord(): Record<string, AtlasRegion> {
    const record: Record<string, AtlasRegion> = {};
    for (const [k, v] of this.regions.entries()) {
      record[k] = v;
    }
    for (const [alias, target] of this.aliases.entries()) {
      const reg = this.regions.get(target);
      if (reg) record[alias] = { ...reg, key: alias };
    }
    return record;
  }

  getTileRegion(stageId: StageId, tileType: TileType): AtlasRegion | null {
    if (tileType === TileType.EMPTY) return null;
    return (
      this.regions.get(`tile_${stageId}_${tileType}`) ??
      this.regions.get(`tile_opening_${tileType}`) ??
      this.regions.get(`tile_opening_${TileType.SOLID}`) ??
      null
    );
  }

  getFont(): BitmapFontAtlas {
    return this.font;
  }

  /**
   * Renders crisp 6x8 outlined pixel text into a standalone DOM-free PixelSurface.
   */
  renderTextToBuffer(
    text: string,
    color = '#f8fafc',
    outlineColor = OUTLINE_HEX,
  ): PixelSurface {
    const lines = text.split('\n');
    let maxCols = 1;
    for (const l of lines) {
      if (l.length > maxCols) maxCols = l.length;
    }
    const width = maxCols * 6;
    const height = Math.max(1, lines.length) * 8;
    const canvas = new PixelCanvas(width, height);
    const fgTop = parseHexColor(color);
    const fgBot = mixRgba(fgTop, parseHexColor('#94a3b8'), 0.22);
    const out = parseHexColor(outlineColor);

    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      for (let ci = 0; ci < line.length; ci++) {
        const code = line.charCodeAt(ci);
        const glyph = buildGlyphCanvas(code >= 32 && code <= 126 ? code : 63, fgTop, fgBot, out);
        canvas.blit(glyph, ci * 6, li * 8);
      }
    }
    return canvas.toSurface();
  }

  /**
   * Lazily converts the RGBA PixelSurface into an HTMLCanvasElement in browser
   * environments. Returns null safely in Node (Vitest / verify:assets).
   */
  toCanvas(): HTMLCanvasElement | null {
    if (this.cachedCanvas) return this.cachedCanvas;
    if (typeof document === 'undefined') return null;

    const canvas = document.createElement('canvas');
    canvas.width = this.sheet.width;
    canvas.height = this.sheet.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const imageData = ctx.createImageData(this.sheet.width, this.sheet.height);
    imageData.data.set(this.sheet.pixels);
    ctx.putImageData(imageData, 0, 0);
    this.cachedCanvas = canvas;
    return canvas;
  }

  /**
   * Lazily converts the RGBA PixelSurface into an ImageBitmap in browser
   * environments. Returns null safely in Node.
   */
  async toImageBitmap(): Promise<ImageBitmap | null> {
    if (this.cachedBitmap) return this.cachedBitmap;
    if (typeof createImageBitmap !== 'function') return null;
    const canvas = this.toCanvas();
    if (!canvas) return null;
    this.cachedBitmap = await createImageBitmap(canvas);
    return this.cachedBitmap;
  }

  dispose(): void {
    if (this.cachedBitmap && typeof this.cachedBitmap.close === 'function') {
      this.cachedBitmap.close();
    }
    this.cachedBitmap = null;
    this.cachedCanvas = null;
  }
}

/**
 * Utility helper to palette-swap any PixelSurface in CPU/Node contexts using
 * exact 6-color matching (mirrors the WebGL2 6-color palette swap shader).
 */
export function remapSurfacePalette(
  surface: PixelSurface,
  srcPalette: Palette6,
  dstPalette: Palette6,
): PixelSurface {
  const srcRgba = srcPalette.map(parseHexColor);
  const dstRgba = dstPalette.map(parseHexColor);
  const out = new Uint8ClampedArray(surface.pixels);

  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] === 0) continue;
    const r = out[i];
    const g = out[i + 1];
    const b = out[i + 2];
    for (let p = 0; p < 6; p++) {
      if (r === srcRgba[p][0] && g === srcRgba[p][1] && b === srcRgba[p][2]) {
        out[i] = dstRgba[p][0];
        out[i + 1] = dstRgba[p][1];
        out[i + 2] = dstRgba[p][2];
        break;
      }
    }
  }

  return { width: surface.width, height: surface.height, pixels: out };
}

export { TRANSPARENT };
