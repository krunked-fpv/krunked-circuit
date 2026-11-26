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
// 3. 16x16 Bespoke Biome Tilesets for All 15 StageIds & Every TileType
// ============================================================================

interface BiomeTilePalette {
  readonly dark: RGBA;
  readonly mid: RGBA;
  readonly light: RGBA;
  readonly accent: RGBA;
  readonly trim: RGBA;
  readonly glow: RGBA;
}

const BIOME_PALETTES: Record<StageId, BiomeTilePalette> = {
  hub: {
    dark: parseHexColor('#1b2c4a'),
    mid: parseHexColor('#3a5882'),
    light: parseHexColor('#84b4e6'),
    accent: parseHexColor('#38f9ff'),
    trim: parseHexColor('#f59e0b'),
    glow: parseHexColor('#bae6fd'),
  },
  tutorial: {
    dark: parseHexColor('#162a3a'),
    mid: parseHexColor('#385a70'),
    light: parseHexColor('#86b8d4'),
    accent: parseHexColor('#34d399'),
    trim: parseHexColor('#38f9ff'),
    glow: parseHexColor('#a7f3d0'),
  },
  opening: {
    dark: parseHexColor('#232a3b'),
    mid: parseHexColor('#4c5973'),
    light: parseHexColor('#8fa3c7'),
    accent: parseHexColor('#fb923c'),
    trim: parseHexColor('#facc15'),
    glow: parseHexColor('#fed7aa'),
  },
  optic: {
    dark: parseHexColor('#633414'),
    mid: parseHexColor('#c47e35'),
    light: parseHexColor('#f7c978'),
    accent: parseHexColor('#38f9ff'),
    trim: parseHexColor('#fde047'),
    glow: parseHexColor('#fef9c3'),
  },
  patch: {
    dark: parseHexColor('#2b2f26'),
    mid: parseHexColor('#5e664b'),
    light: parseHexColor('#9fa87e'),
    accent: parseHexColor('#f97316'),
    trim: parseHexColor('#facc15'),
    glow: parseHexColor('#fdba74'),
  },
  cooler: {
    dark: parseHexColor('#143a59'),
    mid: parseHexColor('#388ac2'),
    light: parseHexColor('#9ce8ff'),
    accent: parseHexColor('#67e8f9'),
    trim: parseHexColor('#e0f2fe'),
    glow: parseHexColor('#ffffff'),
  },
  elec: {
    dark: parseHexColor('#1a1b47'),
    mid: parseHexColor('#36418f'),
    light: parseHexColor('#7c8ff5'),
    accent: parseHexColor('#facc15'),
    trim: parseHexColor('#f59e0b'),
    glow: parseHexColor('#38f9ff'),
  },
  shift: {
    dark: parseHexColor('#173b42'),
    mid: parseHexColor('#337c80'),
    light: parseHexColor('#8ae0dc'),
    accent: parseHexColor('#fb7185'),
    trim: parseHexColor('#e2e8f0'),
    glow: parseHexColor('#34d399'),
  },
  wave: {
    dark: parseHexColor('#241047'),
    mid: parseHexColor('#582896'),
    light: parseHexColor('#ad72f5'),
    accent: parseHexColor('#f472b6'),
    trim: parseHexColor('#38f9ff'),
    glow: parseHexColor('#fde047'),
  },
  break: {
    dark: parseHexColor('#2c1d1a'),
    mid: parseHexColor('#61443c'),
    light: parseHexColor('#a87e70'),
    accent: parseHexColor('#f97316'),
    trim: parseHexColor('#eab308'),
    glow: parseHexColor('#fde047'),
  },
  cipher: {
    dark: parseHexColor('#140d29'),
    mid: parseHexColor('#2c1e54'),
    light: parseHexColor('#6f4ac7'),
    accent: parseHexColor('#c084fc'),
    trim: parseHexColor('#22d3ee'),
    glow: parseHexColor('#4ade80'),
  },
  final_1: {
    dark: parseHexColor('#261724'),
    mid: parseHexColor('#544459'),
    light: parseHexColor('#a393ab'),
    accent: parseHexColor('#f43f5e'),
    trim: parseHexColor('#fbbf24'),
    glow: parseHexColor('#fda4af'),
  },
  final_2: {
    dark: parseHexColor('#12203b'),
    mid: parseHexColor('#2d4a7d'),
    light: parseHexColor('#76a7e8'),
    accent: parseHexColor('#fb923c'),
    trim: parseHexColor('#38f9ff'),
    glow: parseHexColor('#fef08a'),
  },
  final_3: {
    dark: parseHexColor('#130c24'),
    mid: parseHexColor('#2d1e4d'),
    light: parseHexColor('#7863a8'),
    accent: parseHexColor('#f59e0b'),
    trim: parseHexColor('#fef08a'),
    glow: parseHexColor('#c084fc'),
  },
  boss_rush: {
    dark: parseHexColor('#2b1e16'),
    mid: parseHexColor('#694b34'),
    light: parseHexColor('#d4a772'),
    accent: parseHexColor('#f43f5e'),
    trim: parseHexColor('#facc15'),
    glow: parseHexColor('#fef08a'),
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

function drawBespokeSolidTile(c: PixelCanvas, stageId: StageId, bp: BiomeTilePalette): void {
  const white = parseHexColor('#f8fafc');
  c.fillRect(0, 0, 16, 16, bp.mid);
  c.strokeRect(0, 0, 16, 16, OUTLINE);
  // Crisp 3-tone metallic/stone bevel frame
  c.hline(1, 1, 14, bp.light);
  c.hline(1, 2, 14, mixRgba(bp.light, bp.mid, 0.48));
  c.vline(1, 1, 14, bp.light);
  c.hline(1, 14, 14, bp.dark);
  c.hline(2, 13, 12, bp.dark);
  c.vline(14, 1, 14, bp.dark);

  switch (stageId) {
    case 'hub': {
      // Command Deck naval cobalt steel plating with recessed cyan light bar & amber bridge LEDs
      c.strokeRect(3, 3, 10, 9, bp.dark);
      c.hline(4, 4, 8, bp.light);
      c.fillRect(5, 6, 6, 2, bp.dark);
      c.hline(5, 7, 6, bp.accent);
      c.px(7, 7, white);
      c.px(3, 12, bp.trim);
      c.px(12, 12, bp.trim);
      break;
    }
    case 'tutorial': {
      // Holographic VR calibration grid block with corner registration ticks & emerald crosshair
      c.strokeRect(2, 2, 12, 12, bp.dark);
      c.hline(2, 8, 12, mixRgba(bp.dark, bp.accent, 0.35));
      c.vline(8, 2, 12, mixRgba(bp.dark, bp.accent, 0.35));
      c.fillRect(7, 7, 2, 2, bp.accent);
      c.px(7, 7, white);
      c.px(3, 3, bp.trim);
      c.px(12, 3, bp.trim);
      c.px(3, 12, bp.trim);
      c.px(12, 12, bp.trim);
      break;
    }
    case 'opening': {
      // Metro Expressway riveted rail-car girder with heavy recess & amber transit lights
      c.fillRect(3, 4, 10, 8, bp.dark);
      c.strokeRect(3, 4, 10, 8, OUTLINE);
      c.hline(4, 5, 8, bp.mid);
      c.hline(4, 6, 8, bp.light);
      c.px(2, 2, bp.trim);
      c.px(13, 2, bp.trim);
      c.fillRect(5, 8, 2, 2, bp.accent);
      c.fillRect(9, 8, 2, 2, bp.accent);
      c.px(5, 8, white);
      c.px(9, 8, white);
      break;
    }
    case 'optic': {
      // Sun-baked sandstone masonry + photovoltaic gold-and-cyan mirror inlay
      c.hline(1, 8, 14, bp.dark);
      c.vline(8, 1, 7, bp.dark);
      c.vline(4, 8, 6, bp.dark);
      c.vline(11, 8, 6, bp.dark);
      c.fillRect(10, 3, 3, 4, bp.dark);
      c.fillRect(10, 4, 3, 2, bp.accent);
      c.px(11, 4, white);
      c.hline(2, 3, 5, bp.trim);
      c.hline(5, 10, 5, bp.trim);
      break;
    }
    case 'patch': {
      // Riveted foundry steel & diagonal yellow/black hazard stripes along lower flange
      c.hline(1, 9, 14, OUTLINE);
      c.fillRect(2, 10, 12, 3, OUTLINE);
      for (let x = 2; x < 14; x += 4) {
        c.px(x, 10, bp.trim);
        c.px(x + 1, 10, bp.trim);
        c.px(x + 1, 11, bp.trim);
        c.px(x + 2, 11, bp.trim);
        c.px(x + 2, 12, bp.trim);
        c.px(x + 3, 12, bp.trim);
      }
      // Corner iron rivets & central smelter seam
      c.px(3, 3, bp.light);
      c.px(12, 3, bp.light);
      c.px(3, 7, bp.light);
      c.px(12, 7, bp.light);
      c.fillRect(6, 4, 4, 3, bp.dark);
      c.hline(7, 5, 2, bp.accent);
      break;
    }
    case 'cooler': {
      // Faceted cryo ice block with polygonal diamond facets & sparkling specular streaks
      c.fillRect(2, 2, 12, 12, mixRgba(bp.mid, bp.light, 0.3));
      c.line(2, 11, 11, 2, white);
      c.line(3, 12, 12, 3, bp.trim);
      c.line(7, 13, 13, 7, white);
      c.line(2, 6, 6, 2, bp.trim);
      // Deep crystalline inner bevels
      c.line(5, 13, 13, 5, bp.dark);
      c.fillRect(3, 3, 2, 2, white);
      c.px(10, 10, bp.accent);
      break;
    }
    case 'elec': {
      // High-voltage gold/blue conductor plate with twin golden bus-bars & cyan spark nodes
      c.fillRect(2, 2, 12, 12, bp.dark);
      c.fillRect(2, 4, 12, 3, bp.trim);
      c.hline(2, 4, 12, bp.accent);
      c.fillRect(2, 9, 12, 3, bp.trim);
      c.hline(2, 9, 12, bp.accent);
      // Central blue insulator bridge + electric cyan arc dots
      c.fillRect(6, 3, 4, 10, bp.mid);
      c.strokeRect(6, 3, 4, 10, OUTLINE);
      c.px(7, 5, bp.glow);
      c.px(8, 7, white);
      c.px(7, 10, bp.glow);
      break;
    }
    case 'shift': {
      // Aerodynamic convoy hull panels with wind-swept diagonal chevrons & crimson nav lights
      c.hline(2, 7, 12, bp.dark);
      c.hline(2, 8, 12, bp.trim);
      // Forward aero chevron grooves
      c.line(4, 3, 7, 6, bp.light);
      c.line(8, 3, 11, 6, bp.light);
      c.line(4, 12, 7, 9, bp.dark);
      c.line(8, 12, 11, 9, bp.dark);
      // Twin aircraft running lights
      c.fillRect(11, 4, 2, 2, bp.accent);
      c.px(12, 4, white);
      c.fillRect(3, 10, 2, 2, bp.glow);
      break;
    }
    case 'wave': {
      // Neon equalizer & acoustic speaker tile with 4-band lit synth bars
      c.fillRect(2, 2, 12, 12, bp.dark);
      c.strokeRect(2, 2, 12, 12, bp.mid);
      // 4 neon equalizer bar columns
      const heights = [4, 8, 6, 9];
      for (let i = 0; i < 4; i++) {
        const bx = 3 + i * 3;
        const h = heights[i];
        const col = i % 2 === 0 ? bp.accent : bp.trim;
        c.fillRect(bx, 13 - h, 2, h, col);
        c.hline(bx, 13 - h, 2, i === 3 ? bp.glow : white);
      }
      // Speaker grille corner studs
      c.px(2, 2, bp.light);
      c.px(13, 2, bp.light);
      break;
    }
    case 'break': {
      // Cracked volcanic basalt stone & bolted orange-steel mine struts
      // Jagged basalt rock fissures
      c.line(4, 2, 7, 6, OUTLINE);
      c.line(7, 6, 5, 11, OUTLINE);
      c.line(7, 6, 12, 8, OUTLINE);
      c.line(8, 7, 11, 12, bp.dark);
      // Highlighted mineral/magma ore veins beside fissure
      c.px(6, 5, bp.accent);
      c.px(8, 6, bp.glow);
      c.px(10, 8, bp.accent);
      // Heavy steel mine-strut I-beam corner brackets
      c.fillRect(1, 1, 3, 14, bp.dark);
      c.vline(2, 2, 12, bp.accent);
      c.px(2, 3, bp.trim);
      c.px(2, 12, bp.trim);
      break;
    }
    case 'cipher': {
      // Glowing violet matrix circuit block with orthogonal pathways & logic vias
      c.fillRect(2, 2, 12, 12, bp.dark);
      c.hline(2, 5, 6, bp.accent);
      c.vline(7, 5, 5, bp.accent);
      c.hline(7, 10, 6, bp.trim);
      c.vline(4, 8, 5, bp.light);
      c.hline(10, 3, 4, bp.trim);
      c.vline(10, 3, 5, bp.trim);
      // Glowing IC vias
      c.fillRect(6, 4, 2, 2, white);
      c.fillRect(12, 9, 2, 2, bp.glow);
      c.px(4, 12, bp.accent);
      c.px(13, 3, white);
      break;
    }
    case 'final_1': {
      // Fortress titanium armor with chamfered blast seams, hex bolts & crimson Legion emblem
      c.strokeRect(3, 3, 10, 10, OUTLINE);
      c.hline(4, 4, 8, bp.light);
      c.vline(4, 4, 8, bp.light);
      // Recessed crimson-gold Legion chevron
      c.line(5, 6, 7, 9, bp.accent);
      c.line(10, 6, 8, 9, bp.accent);
      c.px(7, 8, bp.trim);
      c.px(8, 8, bp.trim);
      // Corner titanium hex bolts
      c.px(2, 2, bp.trim);
      c.px(13, 2, bp.trim);
      c.px(2, 13, bp.trim);
      c.px(13, 13, bp.trim);
      break;
    }
    case 'final_2': {
      // Glowing reactor core plating with cobalt containment ribs & molten fusion window
      c.fillRect(4, 2, 8, 12, bp.dark);
      c.fillRect(5, 3, 6, 10, bp.accent);
      c.fillRect(6, 4, 4, 8, bp.glow);
      c.vline(7, 4, 8, white);
      // Containment rib bars crossing reactor window
      c.hline(2, 5, 12, bp.mid);
      c.hline(2, 10, 12, bp.mid);
      c.px(2, 5, bp.trim);
      c.px(13, 5, bp.trim);
      c.px(2, 10, bp.trim);
      c.px(13, 10, bp.trim);
      break;
    }
    case 'final_3': {
      // Obsidian & gold orbital spire monolith with ornate gilded frame & celestial core gem
      c.fillRect(2, 2, 12, 12, bp.dark);
      c.strokeRect(2, 2, 12, 12, bp.accent);
      c.hline(3, 2, 10, bp.trim);
      c.vline(2, 3, 10, bp.trim);
      // Central celestial diamond prism
      c.line(8, 4, 11, 7, bp.glow);
      c.line(11, 8, 8, 11, bp.light);
      c.line(7, 11, 4, 8, bp.light);
      c.line(4, 7, 7, 4, bp.glow);
      c.fillRect(7, 7, 2, 2, white);
      break;
    }
    case 'boss_rush': {
      // Championship arena bronze-gold & slate coliseum plating with crimson chevrons
      c.strokeRect(3, 3, 10, 10, bp.dark);
      c.hline(4, 3, 8, bp.trim);
      c.hline(4, 12, 8, bp.trim);
      // Championship emblem chevrons
      c.line(5, 9, 7, 6, bp.accent);
      c.line(10, 9, 8, 6, bp.accent);
      c.line(6, 10, 7, 8, bp.glow);
      c.line(9, 10, 8, 8, bp.glow);
      c.px(2, 2, bp.glow);
      c.px(13, 2, bp.glow);
      c.px(2, 13, bp.glow);
      c.px(13, 13, bp.glow);
      break;
    }
  }
}

function buildBiomeTile(stageId: StageId, tileType: TileType): PixelCanvas {
  const c = new PixelCanvas(16, 16);
  const bp = BIOME_PALETTES[stageId];
  const white = parseHexColor('#f8fafc');
  const steelDark = parseHexColor('#1e293b');
  const steelMid = parseHexColor('#64748b');
  const steelHi = parseHexColor('#cbd5e1');

  switch (tileType) {
    case TileType.SOLID: {
      drawBespokeSolidTile(c, stageId, bp);
      break;
    }

    case TileType.ONE_WAY: {
      // Biome-themed metallic catwalk grate (top 6px structural deck + under-truss)
      c.fillRect(0, 0, 16, 6, bp.dark);
      c.hline(0, 0, 16, OUTLINE);
      c.hline(0, 1, 16, bp.light);
      c.hline(0, 2, 16, bp.accent);
      c.hline(0, 5, 16, OUTLINE);
      if (stageId === 'cooler') {
        // Frosted icicle crystal teeth beneath cryo bridge
        for (let x = 2; x < 15; x += 4) {
          c.vline(x, 6, 3, bp.light);
          c.px(x, 8, white);
          c.px(x + 1, 6, bp.accent);
        }
      } else if (stageId === 'patch' || stageId === 'break') {
        // Hazard-striped foundry catwalk girder
        for (let x = 1; x < 15; x += 4) {
          c.fillRect(x, 3, 2, 2, bp.trim);
          c.vline(x, 6, 2, bp.dark);
          c.px(x, 8, OUTLINE);
        }
      } else {
        // Cross-truss lattice
        for (let x = 1; x < 15; x += 4) {
          c.vline(x, 3, 2, bp.light);
          c.px(x + 2, 4, bp.trim);
          c.vline(x, 6, 2, bp.dark);
          c.px(x, 8, OUTLINE);
        }
      }
      break;
    }

    case TileType.SPIKE: {
      const tipHi = white;
      const bladeMid = stageId === 'cooler' ? parseHexColor('#bae6fd') : parseHexColor('#cbd5e1');
      const bladeDark = stageId === 'cooler' ? parseHexColor('#0284c7') : parseHexColor('#475569');
      const warnRed = parseHexColor('#ef4444');
      const warnGold = bp.trim;
      // Base hazard bar
      c.fillRect(0, 12, 16, 4, bp.dark);
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
      const rockDark = mixRgba(bp.dark, parseHexColor('#3b2416'), 0.35);
      const rockMid = mixRgba(bp.mid, parseHexColor('#9a633e'), 0.32);
      const rockHi = mixRgba(bp.light, parseHexColor('#e2b182'), 0.32);
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
      c.hline(1, 14, 14, bp.dark);
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
      c.fillRect(0, 0, 16, 16, bp.dark);
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
      c.fillRect(1, 12, 14, 4, bp.dark);
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
      c.fillRect(0, 0, 16, 16, bp.dark);
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
      c.fillRect(3, 12, 10, 4, bp.mid);
      c.strokeRect(3, 12, 10, 4, OUTLINE);
      c.hline(4, 13, 8, bp.light);
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
      c.fillRect(0, 0, 16, 16, bp.dark);
      c.strokeRect(0, 0, 16, 16, OUTLINE);
      // Armored bulkhead frame
      c.fillRect(1, 1, 3, 14, bp.mid);
      c.fillRect(12, 1, 3, 14, bp.mid);
      c.vline(2, 2, 12, bp.light);
      c.vline(13, 2, 12, bp.light);
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
      c.fillRect(0, 0, 16, 16, bp.mid);
      c.strokeRect(0, 0, 16, 16, OUTLINE);
      c.hline(1, 1, 14, pistonHi);
      // Hydraulic vertical piston grooves
      c.fillRect(3, 2, 3, 8, bp.dark);
      c.vline(4, 2, 8, pistonHi);
      c.fillRect(10, 2, 3, 8, bp.dark);
      c.vline(11, 2, 8, pistonHi);
      // Caution striped crusher underside
      c.fillRect(1, 11, 14, 4, OUTLINE);
      for (let x = 1; x < 14; x += 4) {
        c.fillRect(x, 12, 2, 2, warnYellow);
      }
      break;
    }

    case TileType.PROXIMITY_SOLID: {
      const holo = bp.accent;
      const holoFill = mixRgba(bp.dark, holo, 0.28);
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
  // 48x40 Armored Rail Juggernaut — heavy siege tank mech with twin barrels, radar & 5-wheel treads
  const c = new PixelCanvas(48, 40);
  const hullDark = parseHexColor('#1e293b');
  const hullMid = parseHexColor('#475569');
  const hullHi = parseHexColor('#94a3b8');
  const crimDark = parseHexColor('#7f1d1d');
  const crimMid = parseHexColor('#dc2626');
  const orange = parseHexColor('#ea580c');
  const gold = parseHexColor('#facc15');
  const red = parseHexColor('#ff4d6d');
  const white = parseHexColor('#f8fafc');
  const track = parseHexColor('#0f172a');

  // Dorsal mortar tubes & glowing crimson radar mast
  c.fillRect(12, 3, 7, 7, hullDark);
  c.hline(13, 3, 5, hullHi);
  c.fillRect(14, 2, 3, 2, orange);
  c.vline(9, 2, 10, hullHi);
  c.fillRect(8, 1, 3, 2, red);
  c.px(9, 1, white);

  // Upper rotary cannon turret
  c.fillRect(14, 8, 18, 8, hullMid);
  c.hline(15, 8, 16, hullHi);
  c.fillRect(17, 10, 8, 4, crimMid);
  c.hline(18, 10, 6, orange);
  // Twin heavy forward cannon barrels (pointing right)
  c.fillRect(31, 9, 13, 3, hullDark);
  c.hline(32, 9, 11, hullHi);
  c.fillRect(42, 9, 2, 3, gold);
  c.fillRect(31, 13, 11, 2, hullDark);
  c.hline(32, 13, 9, hullHi);
  c.px(41, 13, orange);

  // Main armored chassis hull
  c.fillRect(6, 15, 34, 13, hullMid);
  c.hline(7, 15, 32, hullHi);
  c.hline(7, 26, 32, hullDark);
  // Sloped crimson-orange hazard stripes
  c.fillRect(8, 17, 7, 8, crimDark);
  c.fillRect(9, 18, 5, 2, gold);
  c.fillRect(9, 21, 5, 2, orange);
  // Blazing crimson cyclops bridge sensor
  c.fillRect(24, 17, 13, 6, hullDark);
  c.fillRect(26, 18, 10, 4, red);
  c.hline(28, 19, 7, white);
  c.px(34, 19, gold);
  // Front armored dozer spikes
  c.fillRect(39, 18, 5, 9, crimMid);
  c.fillRect(43, 19, 3, 2, hullHi);
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
  // 36x40 Solar Refraction Circuit — white/gold solar armor, faceted crystal cape & orbiting prism blade
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
  c.fillRect(20, 29, 3, 2, cyanMid);

  // Sculpted solar armor torso
  c.fillRect(13, 13, 11, 12, ivoryMid);
  c.hline(14, 13, 9, ivoryHi);
  c.fillRect(11, 13, 4, 4, goldMid);
  c.fillRect(22, 13, 4, 4, goldMid);
  c.px(23, 13, goldHi);
  // Radiant chest sun-core
  c.fillRect(16, 15, 5, 5, goldDark);
  c.fillRect(17, 16, 3, 3, cyanMid);
  c.px(18, 17, ivoryHi);
  c.hline(13, 23, 11, goldMid);
  c.fillRect(17, 22, 3, 3, goldHi);

  // Regal crowned helmet with twin solar horns
  c.fillRect(14, 5, 10, 8, ivoryMid);
  c.hline(15, 5, 8, ivoryHi);
  c.line(16, 5, 13, 1, goldMid);
  c.line(17, 5, 14, 1, goldHi);
  c.line(21, 5, 25, 1, goldMid);
  c.line(22, 5, 26, 1, goldHi);
  c.fillRect(18, 2, 2, 4, cyanMid);
  // Glowing visor
  c.fillRect(17, 8, 7, 3, cyanDark);
  c.hline(18, 9, 6, cyanMid);
  c.hline(20, 9, 3, ivoryHi);

  // Forward extended emitter hand & orbiting diamond prism blade
  c.fillRect(23, 17, 5, 3, goldMid);
  c.line(31, 8, 28, 16, cyanMid);
  c.line(31, 8, 34, 16, goldHi);
  c.line(28, 16, 31, 26, cyanDark);
  c.line(34, 16, 31, 26, cyanMid);
  c.fillRect(30, 12, 2, 10, ivoryHi);
  c.fillRect(30, 15, 2, 4, goldHi);

  c.addOutline(OUTLINE);
  return c;
}

function buildBossStitch(): PixelCanvas {
  // 36x40 Foundry Seam Circuit — olive/amber welder-smith with twin spools, welder goggles & heavy grapple claw
  const c = new PixelCanvas(36, 40);
  const dark = parseHexColor('#2a361a');
  const mid = parseHexColor('#658237');
  const hi = parseHexColor('#b8db72');
  const orange = parseHexColor('#ea580c');
  const gold = parseHexColor('#fde047');
  const steelDark = parseHexColor('#1e293b');
  const steelHi = parseHexColor('#cbd5e1');
  const cyan = parseHexColor('#38f9ff');
  const white = parseHexColor('#f8fafc');

  // Rear foundry wire-spool backpack & crane hook
  c.fillRect(4, 10, 7, 11, steelDark);
  c.fillRect(5, 12, 5, 7, orange);
  c.hline(5, 13, 5, gold);
  c.hline(5, 16, 5, gold);
  c.line(7, 10, 4, 4, steelHi);
  c.px(4, 4, gold);

  // Heavy articulated foundry legs & orange steel-toe boots
  c.fillRect(11, 25, 5, 11, dark);
  c.vline(13, 25, 10, mid);
  c.fillRect(18, 25, 5, 11, mid);
  c.vline(21, 25, 10, hi);
  c.fillRect(9, 35, 7, 3, orange);
  c.fillRect(18, 35, 8, 3, orange);
  c.hline(19, 35, 6, gold);

  // Riveted welder apron torso + glowing smelter furnace core
  c.fillRect(10, 13, 14, 13, mid);
  c.hline(11, 13, 12, hi);
  c.fillRect(11, 22, 12, 4, steelDark);
  c.fillRect(13, 15, 8, 6, steelDark);
  c.fillRect(15, 16, 4, 4, orange);
  c.fillRect(16, 17, 2, 2, gold);
  c.px(16, 17, white);
  // Twin bolted shoulder spools
  c.fillRect(8, 12, 4, 5, orange);
  c.hline(9, 12, 2, gold);
  c.fillRect(22, 12, 5, 5, orange);
  c.hline(23, 12, 3, gold);

  // Welder-hood helmet with twin glowing goggles
  c.fillRect(12, 4, 11, 9, mid);
  c.hline(13, 4, 9, hi);
  c.fillRect(14, 2, 7, 2, orange);
  c.fillRect(14, 7, 9, 4, steelDark);
  c.fillRect(15, 8, 3, 2, cyan);
  c.fillRect(19, 8, 3, 2, gold);
  c.px(16, 8, white);
  c.px(20, 8, white);

  // Massive articulated industrial grapple-pincer & welder arc right arm
  c.fillRect(24, 16, 5, 4, steelHi);
  c.line(28, 15, 33, 11, orange);
  c.line(29, 16, 34, 12, gold);
  c.line(28, 19, 33, 23, orange);
  c.line(29, 18, 34, 22, gold);
  c.fillRect(30, 16, 3, 3, cyan);
  c.px(31, 17, white);

  c.addOutline(OUTLINE);
  return c;
}

function buildBossFrostfang(): PixelCanvas {
  // 36x40 Cryo-Vault Circuit — wolf-crested glacial hunter with jagged ice pauldrons & crystalline greatsword
  const c = new PixelCanvas(36, 40);
  const dark = parseHexColor('#1e3a8a');
  const mid = parseHexColor('#0284c7');
  const ice = parseHexColor('#38bdf8');
  const hi = parseHexColor('#e0f2fe');
  const violet = parseHexColor('#8b5cf6');
  const cyan = parseHexColor('#67e8f9');
  const white = parseHexColor('#ffffff');

  // Flowing icy aurora scarf streaming left
  c.line(12, 13, 3, 18, ice);
  c.line(12, 14, 2, 20, cyan);
  c.line(12, 15, 4, 23, violet);
  c.line(6, 17, 3, 19, white);

  // Agile lupine cyber legs with jagged frost greaves
  c.line(14, 24, 10, 35, dark);
  c.line(15, 24, 11, 35, mid);
  c.line(19, 24, 22, 35, ice);
  c.line(20, 24, 23, 35, hi);
  c.fillRect(8, 35, 6, 3, dark);
  c.fillRect(20, 35, 7, 3, ice);
  c.hline(21, 35, 5, white);

  // Sleek glacial armor torso & crystalline shoulder icicles
  c.fillRect(12, 13, 10, 11, mid);
  c.hline(13, 13, 8, hi);
  c.fillRect(15, 16, 4, 4, dark);
  c.fillRect(16, 17, 2, 2, cyan);
  c.px(16, 17, white);
  // Jagged upward ice-spike pauldrons
  c.line(12, 13, 7, 8, ice);
  c.line(12, 14, 8, 10, hi);
  c.line(22, 13, 27, 9, ice);
  c.line(22, 14, 26, 10, white);

  // Lupine wolf-eared frost helmet & glowing twin-fang cyan visor
  c.fillRect(13, 5, 10, 8, ice);
  c.hline(14, 5, 8, white);
  c.line(14, 5, 11, 1, dark);
  c.line(15, 5, 12, 1, hi);
  c.line(20, 5, 23, 1, dark);
  c.line(21, 5, 24, 1, hi);
  c.fillRect(16, 8, 7, 3, dark);
  c.hline(17, 9, 6, cyan);
  c.px(19, 9, white);
  c.px(21, 10, white);

  // Swept crystalline frost greatsword held forward-up
  c.fillRect(21, 17, 5, 3, violet);
  c.line(25, 19, 34, 5, ice);
  c.line(26, 19, 34, 7, white);
  c.line(26, 20, 33, 10, cyan);
  c.line(25, 18, 32, 6, hi);

  c.addOutline(OUTLINE);
  return c;
}

function buildBossArcbolt(): PixelCanvas {
  // 36x40 High-Voltage Circuit — indigo/gold Tesla knight with twin shoulder coils & crackling lightning trident
  const c = new PixelCanvas(36, 40);
  const dark = parseHexColor('#1e1b4b');
  const mid = parseHexColor('#4f46e5');
  const hi = parseHexColor('#a5b4fc');
  const goldDark = parseHexColor('#b45309');
  const gold = parseHexColor('#facc15');
  const cyan = parseHexColor('#38f9ff');
  const white = parseHexColor('#ffffff');

  // Twin high-voltage Tesla coil spires on shoulders + overhead arc
  c.fillRect(7, 6, 4, 9, goldDark);
  c.hline(7, 7, 4, gold);
  c.hline(7, 10, 4, gold);
  c.fillCircle(9, 5, 2, cyan);
  c.px(9, 5, white);
  c.fillRect(23, 6, 4, 9, goldDark);
  c.hline(23, 7, 4, gold);
  c.hline(23, 10, 4, gold);
  c.fillCircle(25, 5, 2, cyan);
  c.px(25, 5, white);
  // Crackling overhead plasma arc between Tesla coils
  c.line(10, 4, 15, 2, cyan);
  c.line(15, 2, 19, 4, white);
  c.line(19, 4, 24, 3, cyan);

  // Armored conductor legs with golden coil cuffs
  c.fillRect(11, 25, 4, 11, dark);
  c.vline(13, 25, 10, mid);
  c.fillRect(19, 25, 4, 11, mid);
  c.vline(21, 25, 10, hi);
  c.fillRect(10, 34, 6, 4, gold);
  c.fillRect(18, 34, 7, 4, gold);
  c.hline(19, 34, 5, white);

  // Sculpted indigo/gold capacitor torso
  c.fillRect(11, 13, 12, 12, mid);
  c.hline(12, 13, 10, hi);
  c.fillRect(14, 15, 6, 6, dark);
  c.line(18, 15, 15, 18, gold);
  c.line(15, 18, 19, 18, white);
  c.line(19, 18, 16, 21, gold);
  c.hline(11, 23, 12, gold);

  // Bolt-crested angular helmet + glowing electric visor
  c.fillRect(13, 6, 9, 7, mid);
  c.hline(14, 6, 7, hi);
  c.fillRect(16, 4, 3, 3, gold);
  c.fillRect(15, 8, 7, 3, dark);
  c.hline(16, 9, 6, gold);
  c.hline(18, 9, 3, white);

  // Crackling lightning lance extending right
  c.fillRect(22, 17, 6, 3, gold);
  c.line(27, 18, 30, 14, cyan);
  c.line(30, 14, 32, 20, white);
  c.line(32, 20, 34, 15, gold);
  c.px(34, 14, white);

  c.addOutline(OUTLINE);
  return c;
}

function buildBossStrider(): PixelCanvas {
  // 36x40 Skyway Velocity Circuit — crimson/teal aero jet-valkyrie with swept thruster wings & falcon visor
  const c = new PixelCanvas(36, 40);
  const dark = parseHexColor('#66112d');
  const mid = parseHexColor('#e11d48');
  const hi = parseHexColor('#fda4af');
  const teal = parseHexColor('#14b8a6');
  const cyan = parseHexColor('#38f9ff');
  const mint = parseHexColor('#34d399');
  const white = parseHexColor('#f8fafc');

  // Swept-back twin delta jet wings + glowing emerald thruster plumes
  c.line(13, 14, 2, 5, hi);
  c.line(13, 15, 2, 7, mid);
  c.line(13, 16, 4, 10, dark);
  c.line(12, 18, 2, 14, teal);
  c.line(12, 19, 3, 16, cyan);
  // Thruster exhaust jet flames
  c.line(5, 18, 2, 23, mint);
  c.line(6, 19, 3, 24, white);

  // Sleek aerodynamic bladed sprint legs
  c.line(15, 24, 11, 35, dark);
  c.line(16, 24, 12, 35, mid);
  c.line(19, 24, 24, 35, mid);
  c.line(20, 24, 25, 35, hi);
  c.fillRect(10, 34, 5, 4, teal);
  c.fillRect(22, 34, 7, 4, teal);
  c.hline(23, 35, 5, white);

  // Tapered fuselage chestplate with glowing emerald thruster core
  c.fillRect(13, 13, 10, 11, mid);
  c.hline(14, 13, 8, hi);
  c.fillRect(16, 15, 4, 4, dark);
  c.fillRect(17, 16, 2, 2, mint);
  c.px(17, 16, white);
  c.fillRect(21, 13, 4, 3, teal);

  // Swept falcon aero helmet + gleaming turquoise visor
  c.fillRect(14, 5, 10, 8, mid);
  c.hline(15, 5, 8, hi);
  c.line(15, 5, 9, 2, hi); // swept aero fin
  c.line(15, 6, 10, 4, teal);
  c.fillRect(17, 8, 7, 3, dark);
  c.hline(18, 9, 6, mint);
  c.hline(20, 9, 3, white);

  // Forward twin airfoil energy blade
  c.fillRect(23, 16, 5, 3, teal);
  c.line(27, 16, 34, 13, cyan);
  c.line(27, 17, 34, 14, white);
  c.line(27, 18, 33, 16, mint);

  c.addOutline(OUTLINE);
  return c;
}

function buildBossTempo(): PixelCanvas {
  // 36x40 Resonance Pulse Circuit — magenta/violet synthwave diva with oversized headphones & holo sound-staff
  const c = new PixelCanvas(36, 40);
  const dark = parseHexColor('#4a044e');
  const mid = parseHexColor('#c026d3');
  const hi = parseHexColor('#f5d0fe');
  const cyan = parseHexColor('#38f9ff');
  const gold = parseHexColor('#fde047');
  const teal = parseHexColor('#14b8a6');
  const white = parseHexColor('#ffffff');

  // Floating neon acoustic halo ring behind head
  c.strokeRect(8, 2, 18, 12, cyan);
  c.px(9, 3, white);
  c.px(24, 3, white);

  // Flared sonic speaker boots & agile legs
  c.fillRect(12, 24, 4, 11, dark);
  c.fillRect(18, 24, 4, 11, mid);
  c.fillRect(9, 33, 7, 5, mid);
  c.hline(10, 35, 5, cyan);
  c.fillRect(18, 33, 8, 5, mid);
  c.hline(19, 35, 6, cyan);
  c.hline(19, 33, 6, hi);

  // Synth equalizer torso & glowing waist sash
  c.fillRect(12, 13, 11, 11, dark);
  c.strokeRect(12, 13, 11, 11, mid);
  c.vline(14, 17, 5, cyan);
  c.vline(16, 15, 7, gold);
  c.vline(18, 16, 6, hi);
  c.vline(20, 14, 8, teal);
  c.hline(12, 23, 11, hi);

  // Helmet with oversized glowing DJ headphone ear-cups
  c.fillRect(13, 5, 9, 8, mid);
  c.hline(14, 5, 7, hi);
  c.fillCircle(12, 9, 3, cyan);
  c.px(12, 9, white);
  c.fillCircle(23, 9, 3, cyan);
  c.px(23, 9, white);
  // Wide glowing neon shades visor
  c.fillRect(15, 8, 7, 3, dark);
  c.hline(16, 9, 5, gold);
  c.px(18, 9, white);

  // Holographic sonic keytar / soundwave emitter right side
  c.fillRect(23, 16, 5, 3, hi);
  c.fillRect(27, 11, 4, 13, teal);
  c.vline(28, 12, 11, cyan);
  c.fillRect(31, 13, 3, 9, mid);
  c.px(32, 15, gold);
  c.px(32, 17, white);
  c.px(32, 19, gold);

  c.addOutline(OUTLINE);
  return c;
}

function buildBossCrag(): PixelCanvas {
  // 44x42 Quarry Breaker Circuit — colossal basalt/magma demolition juggernaut with twin hydraulic pile-driver fists
  const c = new PixelCanvas(44, 42);
  const dark = parseHexColor('#292023');
  const mid = parseHexColor('#6e5c62');
  const hi = parseHexColor('#bfb0b6');
  const orange = parseHexColor('#ea580c');
  const gold = parseHexColor('#facc15');
  const magma = parseHexColor('#ff4d2d');
  const white = parseHexColor('#ffffff');

  // Heavy recessed armored dome head with caution crest
  c.fillRect(15, 4, 14, 8, mid);
  c.hline(16, 4, 12, hi);
  c.fillRect(17, 2, 10, 2, orange);
  c.hline(18, 2, 8, gold);
  c.fillRect(18, 7, 9, 3, dark);
  c.hline(19, 8, 7, magma);
  c.hline(21, 8, 3, gold);

  // Broad monolithic quarry torso + molten core furnace
  c.fillRect(10, 12, 24, 15, mid);
  c.hline(11, 12, 22, hi);
  c.hline(11, 26, 22, dark);
  c.fillRect(15, 15, 14, 8, dark);
  c.fillRect(17, 16, 10, 6, orange);
  c.fillRect(19, 17, 6, 4, gold);
  c.fillRect(21, 18, 2, 2, white);

  // Towering caution-striped boulder pauldrons
  c.fillRect(4, 10, 7, 8, orange);
  c.hline(5, 10, 5, gold);
  c.hline(5, 14, 5, dark);
  c.fillRect(33, 10, 7, 8, orange);
  c.hline(34, 10, 5, gold);
  c.hline(34, 14, 5, dark);

  // Colossal hydraulic pile-driver fists (left & right)
  c.fillRect(2, 18, 8, 12, dark);
  c.fillRect(3, 19, 6, 10, mid);
  c.vline(4, 19, 10, hi);
  c.fillRect(3, 27, 6, 3, orange);
  c.fillRect(34, 18, 8, 12, dark);
  c.fillRect(35, 19, 6, 10, mid);
  c.vline(39, 19, 10, hi);
  c.fillRect(35, 27, 6, 3, orange);
  c.vline(41, 20, 7, gold);

  // Seismic shock-piston pillar legs
  c.fillRect(11, 27, 8, 11, dark);
  c.vline(14, 27, 10, hi);
  c.fillRect(25, 27, 8, 11, dark);
  c.vline(28, 27, 10, hi);
  c.fillRect(9, 36, 11, 4, orange);
  c.fillRect(24, 36, 11, 4, orange);
  c.hline(25, 36, 9, gold);

  c.addOutline(OUTLINE);
  return c;
}

function buildBossPhantom(): PixelCanvas {
  // 36x40 Neon Mirage Circuit — shadowy emerald/violet cyber-shinobi with glitch-cloak & twin phase kunai
  const c = new PixelCanvas(36, 40);
  const dark = parseHexColor('#0d262b');
  const mid = parseHexColor('#10b981');
  const hi = parseHexColor('#a7f3d0');
  const violet = parseHexColor('#a855f7');
  const lime = parseHexColor('#d9f99d');
  const white = parseHexColor('#ffffff');

  // Billowing holographic glitch-cloak & detached data pixels
  for (let y = 13; y <= 35; y++) {
    const left = Math.max(2, 13 - Math.floor((y - 12) * 0.5));
    for (let x = left; x <= 15; x++) {
      const col = (x * 3 + y) % 7 === 0 ? violet : (x + y) % 4 === 0 ? mid : dark;
      c.px(x, y, col);
    }
  }
  c.fillRect(3, 12, 2, 2, lime);
  c.fillRect(2, 24, 2, 2, violet);

  // Stealth shinobi legs
  c.line(15, 24, 12, 35, dark);
  c.line(16, 24, 13, 35, mid);
  c.line(19, 24, 22, 35, mid);
  c.line(20, 24, 23, 35, hi);
  c.fillRect(10, 35, 5, 3, violet);
  c.fillRect(20, 35, 6, 3, violet);

  // Sleek ninja vest torso + violet matrix glyph core
  c.fillRect(13, 13, 10, 11, dark);
  c.strokeRect(13, 13, 10, 11, mid);
  c.fillRect(16, 15, 4, 5, violet);
  c.fillRect(17, 16, 2, 3, lime);
  c.hline(13, 22, 10, mid);

  // Horned cyber-shinobi mask & piercing neon lime twin optics
  c.fillRect(14, 5, 9, 8, dark);
  c.hline(15, 5, 7, mid);
  c.line(14, 5, 11, 2, violet);
  c.line(22, 5, 25, 2, violet);
  c.fillRect(17, 8, 6, 2, mid);
  c.px(18, 8, lime);
  c.px(21, 8, white);

  // Dual glowing phase-daggers (upper & lower right)
  c.fillRect(22, 16, 5, 3, mid);
  c.line(26, 16, 34, 10, lime);
  c.line(27, 17, 34, 11, white);
  c.line(26, 19, 33, 24, violet);
  c.line(27, 18, 33, 23, hi);

  c.addOutline(OUTLINE);
  return c;
}

function buildBossMirrorRival(): PixelCanvas {
  // 36x40 Unit K-00 Mirror (Dark Prototype Circuit) — dark crimson Volt mirror doppelgänger with blazing scarf & plasma gauntlet
  const c = new PixelCanvas(36, 40);
  const dark = parseHexColor('#3d0a1a');
  const mid = parseHexColor('#be123c');
  const hi = parseHexColor('#fda4af');
  const gold = parseHexColor('#facc15');
  const violet = parseHexColor('#a855f7');
  const white = parseHexColor('#ffffff');

  // Whip-like crimson-violet prototype energy scarf trailing left
  c.line(13, 13, 5, 11, mid);
  c.line(13, 14, 3, 13, hi);
  c.line(5, 11, 2, 15, violet);
  c.line(6, 13, 3, 17, mid);

  // Agile martial-artist stance mirroring Volt
  c.line(14, 24, 10, 35, dark);
  c.line(15, 24, 11, 35, dark);
  c.line(16, 24, 12, 35, mid);
  c.line(19, 24, 22, 35, mid);
  c.line(20, 24, 23, 35, mid);
  c.line(21, 24, 24, 35, hi);
  c.fillRect(9, 35, 6, 3, mid);
  c.fillRect(20, 35, 7, 3, mid);
  c.hline(21, 35, 5, hi);
  c.fillRect(20, 29, 3, 2, gold);

  // Dark prototype armor torso with fractured golden chest reactor
  c.fillRect(13, 13, 10, 11, mid);
  c.hline(14, 13, 8, hi);
  c.fillRect(12, 12, 12, 2, gold);
  c.fillRect(16, 15, 4, 4, dark);
  c.fillRect(17, 16, 2, 2, white);
  c.hline(14, 22, 8, gold);

  // Prototype Volt-style helmet with sharp twin obsidian horns & blazing white-crimson visor
  c.fillRect(14, 5, 10, 8, mid);
  c.hline(15, 5, 8, hi);
  c.line(15, 5, 12, 1, dark);
  c.line(16, 5, 13, 1, gold);
  c.line(21, 5, 24, 1, dark);
  c.line(22, 5, 25, 1, gold);
  c.fillRect(17, 8, 7, 3, dark);
  c.hline(18, 9, 6, white);
  c.px(18, 9, gold);

  // Overcharged jagged crimson plasma fist extended forward
  c.fillRect(22, 16, 6, 3, dark);
  c.fillRect(27, 14, 5, 6, mid);
  c.fillRect(28, 15, 3, 4, hi);
  c.line(31, 13, 34, 17, white);
  c.line(31, 20, 34, 16, gold);

  c.addOutline(OUTLINE);
  return c;
}

function buildBossPrismCore(): PixelCanvas {
  // 52x48 Central Relay Sentinel — towering floating octagonal crystal fortress monolith + twin levitating prism wings
  const c = new PixelCanvas(52, 48);
  const dark = parseHexColor('#10234d');
  const mid = parseHexColor('#2563eb');
  const cyan = parseHexColor('#38f9ff');
  const hi = parseHexColor('#e0f2fe');
  const gold = parseHexColor('#facc15');
  const red = parseHexColor('#f43f5e');
  const white = parseHexColor('#ffffff');

  // Outer gyroscopic golden-steel halo rings
  c.strokeRect(13, 5, 26, 38, gold);
  c.strokeRect(14, 6, 24, 36, dark);
  c.fillRect(23, 2, 6, 4, gold);
  c.fillRect(23, 42, 6, 4, gold);

  // Central faceted crystal monolith core
  c.fillEllipse(26, 24, 11, 17, mid);
  c.fillEllipse(25, 22, 8, 13, cyan);
  c.fillEllipse(24, 19, 4, 8, hi);
  // Facet bevel lines
  c.line(18, 14, 34, 34, dark);
  c.line(34, 14, 18, 34, dark);
  // Central blazing crimson/gold sentinel eye
  c.fillCircle(26, 24, 6, dark);
  c.fillCircle(26, 24, 4, red);
  c.fillCircle(26, 24, 2, gold);
  c.px(25, 23, white);

  // Twin levitating mirror-prism wing pylons (left & right)
  for (const side of [-1, 1]) {
    const bx = side < 0 ? 5 : 42;
    c.fillRect(bx, 13, 5, 22, dark);
    c.fillRect(bx + 1, 14, 3, 20, mid);
    c.vline(bx + 2, 15, 18, cyan);
    c.fillRect(bx, 11, 5, 3, gold);
    c.fillRect(bx, 34, 5, 3, gold);
    // Emitter lens tips
    c.fillRect(side < 0 ? 2 : 47, 22, 3, 4, red);
    c.px(side < 0 ? 2 : 49, 23, white);
  }

  c.addOutline(OUTLINE);
  return c;
}

function buildBossOverlordApex(): PixelCanvas {
  // 56x52 Corrupt Legion Sovereign — towering final boss with imperial horned crown, forehead reactor, chest core & twin detached floating cyber-gauntlets!
  const c = new PixelCanvas(56, 52);
  const dark = parseHexColor('#240c42');
  const mid = parseHexColor('#6d28d9');
  const hi = parseHexColor('#c4b5fd');
  const goldDark = parseHexColor('#b45309');
  const gold = parseHexColor('#f59e0b');
  const goldHi = parseHexColor('#fef08a');
  const crim = parseHexColor('#f43f5e');
  const white = parseHexColor('#ffffff');

  // Sweeping imperial crimson-gold mantle behind torso
  c.fillRect(14, 18, 28, 28, dark);
  c.vline(15, 20, 25, gold);
  c.vline(40, 20, 25, gold);

  // Imperial horned sovereign crown & sculpted head
  c.fillRect(19, 6, 18, 12, mid);
  c.hline(20, 6, 16, hi);
  // Sweeping golden crown horns
  c.line(20, 7, 14, 2, gold);
  c.line(21, 7, 15, 2, goldHi);
  c.line(35, 7, 41, 2, gold);
  c.line(34, 7, 40, 2, goldHi);
  c.fillRect(26, 2, 4, 5, gold);
  c.hline(27, 2, 2, goldHi);
  // Blazing forehead reactor eye (Target Part #3)
  c.fillRect(25, 8, 6, 4, dark);
  c.fillRect(26, 9, 4, 2, crim);
  c.px(27, 9, white);
  // Menacing crimson sovereign visor slit
  c.fillRect(21, 13, 14, 3, dark);
  c.hline(22, 14, 12, crim);
  c.hline(25, 14, 6, goldHi);

  // Broad armored sovereign chestplate & shoulder wings
  c.fillRect(13, 18, 30, 19, mid);
  c.hline(14, 18, 28, hi);
  c.fillRect(11, 17, 6, 6, gold);
  c.hline(12, 17, 4, goldHi);
  c.fillRect(39, 17, 6, 6, gold);
  c.hline(40, 17, 4, goldHi);
  // Radiant Sovereign Chest Core
  c.fillRect(22, 22, 12, 10, dark);
  c.strokeRect(22, 22, 12, 10, gold);
  c.fillRect(24, 24, 8, 6, crim);
  c.fillRect(26, 25, 4, 4, goldHi);
  c.fillRect(27, 26, 2, 2, white);

  // Hovering lower armored greave skirts
  c.fillRect(16, 37, 9, 11, dark);
  c.vline(19, 38, 9, mid);
  c.fillRect(31, 37, 9, 11, dark);
  c.vline(35, 38, 9, mid);
  c.hline(16, 46, 9, gold);
  c.hline(31, 46, 9, gold);

  // Colossal detached floating cyber-gauntlets left & right (Target Parts #1 & #2)
  for (const gx of [2, 45]) {
    c.fillRect(gx, 20, 9, 16, goldDark);
    c.fillRect(gx + 1, 21, 7, 14, gold);
    c.vline(gx + 2, 22, 12, goldHi);
    // Glowing crimson knuckle emitters
    c.fillRect(gx + 1, 33, 7, 4, dark);
    c.fillRect(gx + 2, 34, 2, 2, crim);
    c.fillRect(gx + 5, 34, 2, 2, crim);
    c.px(gx + 2, 34, white);
    c.px(gx + 5, 34, white);
  }

  c.addOutline(OUTLINE);
  return c;
}

function buildBossSprite(bossId: BossId): PixelCanvas {
  switch (bossId) {
    case 'siege_tread':
      return buildBossSiegeTread();
    case 'prism':
      return buildBossPrism();
    case 'stitch':
      return buildBossStitch();
    case 'frostfang':
      return buildBossFrostfang();
    case 'arcbolt':
      return buildBossArcbolt();
    case 'strider':
      return buildBossStrider();
    case 'tempo':
      return buildBossTempo();
    case 'crag':
      return buildBossCrag();
    case 'phantom':
      return buildBossPhantom();
    case 'mirror_rival':
      return buildBossMirrorRival();
    case 'prism_core':
      return buildBossPrismCore();
    case 'overlord_apex':
      return buildBossOverlordApex();
  }
}

function buildMinibossSprite(id: MinibossId): PixelCanvas {
  const dark = parseHexColor('#1e293b');
  const mid = parseHexColor('#475569');
  const hi = parseHexColor('#94a3b8');
  const glow = parseHexColor('#f43f5e');
  const cyan = parseHexColor('#38f9ff');
  const gold = parseHexColor('#facc15');
  const white = parseHexColor('#f8fafc');

  if (id === 'sky_gunship') {
    // 44x36 Coaxial Armored Assault VTOL Gunship
    const c = new PixelCanvas(44, 36);
    const acc = parseHexColor('#0284c7');
    const accHi = parseHexColor('#7dd3fc');
    // Twin coaxial rotor blades + mast
    c.fillRect(3, 3, 38, 2, hi);
    c.hline(12, 2, 20, white);
    c.fillRect(20, 5, 4, 4, dark);
    // Streamlined armored fuselage
    c.fillEllipse(22, 16, 16, 7, acc);
    c.hline(11, 10, 22, accHi);
    c.hline(10, 21, 24, dark);
    // Tail boom & stabilizer fin
    c.fillRect(2, 13, 9, 4, mid);
    c.fillRect(2, 8, 3, 7, acc);
    c.px(3, 8, glow);
    // Gleaming armored cyan glass cockpit
    c.fillRect(26, 12, 10, 5, dark);
    c.hline(27, 13, 8, cyan);
    c.hline(29, 14, 5, white);
    // Twin underslung missile pods & glowing rotary autocannon
    c.fillRect(11, 22, 17, 6, mid);
    c.hline(12, 22, 15, hi);
    c.fillRect(14, 24, 3, 2, gold);
    c.fillRect(20, 24, 3, 2, gold);
    c.fillRect(28, 22, 12, 4, dark);
    c.hline(29, 23, 10, glow);
    c.px(39, 23, white);
    c.addOutline(OUTLINE);
    return c;
  }

  if (id === 'wrecker_tank') {
    // 44x36 Heavy Siege Wrecker Tank with dorsal mortar, spiked ram plow & 4-wheel treads
    const c = new PixelCanvas(44, 36);
    const acc = parseHexColor('#eab308');
    const accHi = parseHexColor('#fef08a');
    // Dorsal mortar turret + radar antenna
    c.fillRect(11, 4, 17, 8, acc);
    c.hline(12, 4, 15, accHi);
    c.vline(9, 2, 8, hi);
    c.px(9, 2, glow);
    c.fillRect(27, 6, 12, 3, dark);
    c.hline(28, 6, 10, hi);
    c.fillRect(37, 6, 2, 3, glow);
    // Sloped hull & glowing cyclops optic
    c.fillRect(6, 12, 30, 12, mid);
    c.hline(7, 12, 28, hi);
    c.fillRect(21, 15, 11, 5, dark);
    c.hline(23, 17, 8, glow);
    c.hline(25, 17, 4, white);
    c.fillRect(8, 15, 7, 6, acc);
    c.hline(9, 17, 5, dark);
    // Spiked front demolition plow
    c.fillRect(36, 15, 5, 9, acc);
    c.fillRect(40, 16, 2, 2, white);
    c.fillRect(40, 21, 2, 2, white);
    // Caterpillar tread bed + 4 roadwheels
    c.fillRect(4, 24, 35, 9, dark);
    c.hline(5, 25, 33, mid);
    for (let i = 0; i < 4; i++) {
      c.fillCircle(9 + i * 8, 28, 3, mid);
      c.px(9 + i * 8, 28, accHi);
    }
    c.addOutline(OUTLINE);
    return c;
  }

  // 42x38 Junk Colossus heavy scrap-iron foundry golem mech
  const c = new PixelCanvas(42, 38);
  const acc = parseHexColor('#ea580c');
  const accHi = parseHexColor('#fdba74');
  // Twin smokestacks behind shoulders
  c.fillRect(9, 2, 3, 8, dark);
  c.px(10, 2, glow);
  c.fillRect(30, 2, 3, 8, dark);
  c.px(31, 2, glow);
  // Heavy riveted scrap head & blazing crimson eye
  c.fillRect(14, 4, 14, 8, acc);
  c.hline(15, 4, 12, accHi);
  c.fillRect(19, 7, 8, 3, dark);
  c.hline(20, 8, 6, glow);
  c.px(23, 8, white);
  // Riveted furnace torso
  c.fillRect(9, 12, 24, 14, mid);
  c.hline(10, 12, 22, hi);
  c.fillRect(15, 15, 12, 7, dark);
  c.fillRect(17, 16, 8, 5, acc);
  c.fillRect(19, 17, 4, 3, gold);
  c.fillRect(20, 18, 2, 1, white);
  // Oversized scrap crusher pincers
  c.fillRect(2, 13, 7, 13, acc);
  c.vline(3, 14, 11, accHi);
  c.fillRect(3, 24, 5, 3, hi);
  c.fillRect(33, 13, 7, 13, acc);
  c.vline(37, 14, 11, accHi);
  c.fillRect(34, 24, 5, 3, hi);
  // Heavy hydraulic legs
  c.fillRect(11, 26, 7, 10, dark);
  c.vline(13, 26, 9, hi);
  c.fillRect(24, 26, 7, 10, dark);
  c.vline(26, 26, 9, hi);
  c.fillRect(10, 34, 9, 2, acc);
  c.fillRect(23, 34, 9, 2, acc);
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
// 5B. Equippable Icons: 20 Burst Technique Icons + 20 Booster Chip Icons (12x12)
// ============================================================================

const BURST_ICON_META: ReadonlyArray<{ readonly id: number; readonly alias: string; readonly color: string; readonly accent: string }> = [
  { id: 1, alias: 'burst_flying_strike', color: '#38d9ff', accent: '#ffffff' },
  { id: 2, alias: 'burst_rising_upper', color: '#ff6b4a', accent: '#fef08a' },
  { id: 3, alias: 'burst_heavenly_piledrive', color: '#ffc83d', accent: '#ffffff' },
  { id: 4, alias: 'burst_gravity_freeze', color: '#8f7cff', accent: '#e0f2fe' },
  { id: 5, alias: 'burst_surface_render', color: '#ff8a3d', accent: '#fde047' },
  { id: 6, alias: 'burst_catch_interrupt', color: '#4de8a4', accent: '#ffffff' },
  { id: 7, alias: 'burst_screen_interrupt', color: '#ffee55', accent: '#ffffff' },
  { id: 8, alias: 'burst_cycle_kick', color: '#ff5c8a', accent: '#fbcfe8' },
  { id: 9, alias: 'burst_clone_array', color: '#7cffcb', accent: '#38f9ff' },
  { id: 10, alias: 'burst_burst_spark', color: '#52e5ff', accent: '#fef08a' },
  { id: 11, alias: 'burst_hardware_barrier', color: '#44b8ff', accent: '#e0f2fe' },
  { id: 12, alias: 'burst_gravity_dash', color: '#c06bff', accent: '#ffffff' },
  { id: 13, alias: 'burst_function_overload', color: '#ff3b6b', accent: '#fde047' },
  { id: 14, alias: 'burst_piercing_drill', color: '#ff9e3b', accent: '#ffffff' },
  { id: 15, alias: 'burst_support_platform', color: '#63e2ff', accent: '#ffffff' },
  { id: 16, alias: 'burst_hologram_trap', color: '#95ff5c', accent: '#facc15' },
  { id: 17, alias: 'burst_current_arc', color: '#ffe84d', accent: '#38f9ff' },
  { id: 18, alias: 'burst_emergency_heal', color: '#4eff91', accent: '#ffffff' },
  { id: 19, alias: 'burst_distant_detonation', color: '#ff533b', accent: '#fde047' },
  { id: 20, alias: 'burst_erupting_beam', color: '#ffdf5e', accent: '#ffffff' },
];

const CHIP_ICON_META: ReadonlyArray<{
  readonly id: number;
  readonly alias: string;
  readonly part: 'circuit' | 'head' | 'body' | 'arms' | 'legs';
}> = [
  { id: 1, alias: 'chip_energy_absorber', part: 'circuit' },
  { id: 2, alias: 'chip_air_jumper', part: 'legs' },
  { id: 3, alias: 'chip_power_extender', part: 'arms' },
  { id: 4, alias: 'chip_grip_enhancer', part: 'arms' },
  { id: 5, alias: 'chip_surge_protector', part: 'body' },
  { id: 6, alias: 'chip_catch_block', part: 'arms' },
  { id: 7, alias: 'chip_magnet_chassis', part: 'body' },
  { id: 8, alias: 'chip_emergency_accumulator', part: 'circuit' },
  { id: 9, alias: 'chip_underflow_guard', part: 'circuit' },
  { id: 10, alias: 'chip_energy_multiplier', part: 'circuit' },
  { id: 11, alias: 'chip_light_alloy', part: 'legs' },
  { id: 12, alias: 'chip_frame_amplifier', part: 'head' },
  { id: 13, alias: 'chip_dodge_slider', part: 'legs' },
  { id: 14, alias: 'chip_speed_basher', part: 'legs' },
  { id: 15, alias: 'chip_chain_booster', part: 'arms' },
  { id: 16, alias: 'chip_chain_dasher', part: 'arms' },
  { id: 17, alias: 'chip_repair_enhancer', part: 'body' },
  { id: 18, alias: 'chip_nullifying_layer', part: 'body' },
  { id: 19, alias: 'chip_protection_timer', part: 'head' },
  { id: 20, alias: 'chip_overflow_converter', part: 'circuit' },
];

const BURST_ICON_PATTERNS: Readonly<Record<number, readonly string[]>> = {
  1: [
    '............',
    '.....CC.....',
    '......CC....',
    '..AAAAACC...',
    '.ACCCCCCHHC.',
    '..AAAAACC...',
    '......CC....',
    '.....CC.....',
    '............',
  ],
  2: [
    '.....HH.....',
    '....HCCH....',
    '...HCCCCH...',
    '..CC.CC.CC..',
    '....CCCC....',
    '....CAAC....',
    '....CAAC....',
    '....CCCC....',
    '............',
  ],
  3: [
    '....CCCC....',
    '....CAAC....',
    '....CCCC....',
    '..CC.CC.CC..',
    '...HCCCCH...',
    '....HCCH....',
    '.AA..HH..AA.',
    'AAAA....AAAA',
    '............',
  ],
  4: [
    '.....CC.....',
    '..C..HH..C..',
    '...C.CC.C...',
    '.CHHCCCCCHH.',
    '...C.CC.C...',
    '..C..HH..C..',
    '.....CC.....',
    '............',
    '............',
  ],
  5: [
    '............',
    '............',
    '..HH....HH..',
    '.HCCC..CCCH.',
    'HCCCCCHCCCCH',
    'CAACCCCCCAAC',
    'CCCCCCCCCCCC',
    '............',
    '............',
  ],
  6: [
    '....CCCC....',
    '..CCHHHHCC..',
    '.CCH.AA.HCC.',
    '.CC.AAAA.CC.',
    '.CC..AA..CC.',
    '..CC.HH.CC..',
    '...CC..CC...',
    '....CCCC....',
    '............',
  ],
  7: [
    '.....HH.....',
    '..A..CC..A..',
    '...A.HH.A...',
    '.HCHHHHHHCH.',
    '...A.HH.A...',
    '..A..CC..A..',
    '.....HH.....',
    '............',
    '............',
  ],
  8: [
    '...CCCCCC...',
    '..CCHHHACC..',
    '.CC......CC.',
    '.C..AAAA..C.',
    '.C..AHHA..C.',
    '.CC......CC.',
    '..CCAHHCCC..',
    '...CCCCCC...',
    '............',
  ],
  9: [
    '..CC....AA..',
    '.CHHC..AHHA.',
    '..CC....AA..',
    '.CCCC..AAAA.',
    '.C..C..A..A.',
    '.C..C..A..A.',
    '..CC....AA..',
    '............',
    '............',
  ],
  10: [
    '....AA......',
    '....AA......',
    '.CC....CC...',
    '.CH.HH.HC...',
    '....HH......',
    '.CC....CC...',
    '....AA......',
    '....AA......',
    '............',
  ],
  11: [
    '...CCCCCC...',
    '..CHHHHHHC..',
    '.CH......HC.',
    '.CH.AAAA.HC.',
    '.CH.AAAA.HC.',
    '.CH......HC.',
    '..CHHHHHHC..',
    '...CCCCCC...',
    '............',
  ],
  12: [
    '..A....HH...',
    '...A..HCH...',
    '....AHCCH...',
    '.AA.HCCCHH..',
    '....AHCCH...',
    '...A..HCH...',
    '..A....HH...',
    '............',
    '............',
  ],
  13: [
    '.....AA.....',
    '....ACCA....',
    '...ACCHCA...',
    '..ACCHHCCA..',
    '.ACCHHHHCCA.',
    '..CCCHHCCC..',
    '...CCCCCC...',
    '....AAAA....',
    '............',
  ],
  14: [
    '............',
    '.CC.........',
    '.CHCC.......',
    '.CCHCCC.....',
    '.CHCHCHHH...',
    '.CCHCCC.....',
    '.CHCC.......',
    '.CC.........',
    '............',
  ],
  15: [
    '....AAAA....',
    '.....AA.....',
    '............',
    '.HHHHHHHHHH.',
    '.CCCCCCCCCC.',
    '..CCCCCCCC..',
    '...CC..CC...',
    '............',
    '............',
  ],
  16: [
    '.....AA.....',
    '....AAAA....',
    '...CCCCCC...',
    '..CCCHHCCC..',
    '..CCHHHHCC..',
    '..CCCHHCCC..',
    '.AA.CCCC.AA.',
    '............',
    '............',
  ],
  17: [
    '......HHH...',
    '.....HCCC...',
    '....HCC.....',
    '...HCCCCC...',
    '.....ACCH...',
    '....ACC.....',
    '...ACC......',
    '..AA........',
    '............',
  ],
  18: [
    '....CCCC....',
    '....CHHC....',
    '..CCCHHCCC..',
    '..CHHHHHHC..',
    '..CHHHHHHC..',
    '..CCCHHCCC..',
    '....CHHC....',
    '....CCCC....',
    '............',
  ],
  19: [
    '.....CC.....',
    '..CC.HH.CC..',
    '.C..AAAA..C.',
    '.C.AAHHAA.C.',
    '.C.AAHHAA.C.',
    '.C..AAAA..C.',
    '..CC.HH.CC..',
    '.....CC.....',
    '............',
  ],
  20: [
    '............',
    '.CC..CCCCCC.',
    '.CHHCCCCCCCC',
    '.CHHHHHHHHHH',
    '.CHHHHHHHHHH',
    '.CHHCCCCCCCC',
    '.CC..CCCCCC.',
    '............',
    '............',
  ],
};

const CHIP_GLYPH_PATTERNS: Readonly<Record<number, readonly string[]>> = {
  1: ['..H..H..', '.H.AA.H.', '..AAAA..', '.H.AA.H.', '..H..H..'],
  2: ['...HH...', '..H..H..', '...AA...', '..A..A..', '.A....A.'],
  3: ['..AA....', '..AAHH..', '..AAHHH.', '..AAHH..', '..AA....'],
  4: ['.HH..AA.', '.H..AAA.', '.HH..AA.', '.H..AAA.', '.HH.....'],
  5: ['..HHHH..', '.H.AA.H.', '.H.AA.H.', '..HAAH..', '...HH...'],
  6: ['.HH.....', '.HH.AAA.', '.HH.A.A.', '.HH.AAA.', '.HH.....'],
  7: ['.HH..HH.', '.H....H.', '.A....A.', '.AA..AA.', '..AAAA..'],
  8: ['..AAAA..', '.A.HH.A.', '.A.HH.A.', '.A....A.', '..AAAA..'],
  9: ['.HH..HH.', 'HHHHHHHH', '.H.AA.H.', '..HAAH..', '...HH...'],
  10: ['.H.H..A.', '..H..AAA', '.H.H..A.', '........', '..HHHH..'],
  11: ['....HHH.', '...HAA..', '..HAA...', '.HAA....', '.H......'],
  12: ['..HHHH..', '.HAAAAH.', '.H.HH.H.', '..HHHH..', '...AA...'],
  13: ['........', '...HHHH.', '..AAAAH.', '.HHHH...', '........'],
  14: ['.A..HH..', '..A.HHH.', 'AA..HHHH', '..A.HHH.', '.A..HH..'],
  15: ['.HH..HH.', 'H..AA..H', 'H..AA..H', '.HH..HH.', '........'],
  16: ['....HHH.', '...HAA..', '..HH....', '.AAH....', 'HH......'],
  17: ['...HH...', '...HH...', '.HHHHHH.', '...HH...', '...HH...'],
  18: ['..HHHH..', '.H....H.', '.H.AA.H.', '.H....H.', '..HHHH..'],
  19: ['.HHHHHH.', '..HAAH..', '...HH...', '..HAAH..', '.HHHHHH.'],
  20: ['.HH..A..', '.HH.AAA.', '....A.A.', '..AA....', '..A.....'],
};

function buildEquippableIcons(): {
  readonly sprites: Record<string, PixelCanvas>;
  readonly aliases: Record<string, string>;
} {
  const sprites: Record<string, PixelCanvas> = {};
  const aliases: Record<string, string> = {};

  const bgDark = parseHexColor('#10182b');
  const bgFrame = parseHexColor('#2a3b5c');
  const goldPin = parseHexColor('#facc15');
  const white = parseHexColor('#ffffff');

  const partColors: Record<'circuit' | 'head' | 'body' | 'arms' | 'legs', { mid: RGBA; acc: RGBA }> = {
    circuit: { mid: parseHexColor('#0284c7'), acc: parseHexColor('#38f9ff') },
    head: { mid: parseHexColor('#7c3aed'), acc: parseHexColor('#c4b5fd') },
    body: { mid: parseHexColor('#15803d'), acc: parseHexColor('#4ade80') },
    arms: { mid: parseHexColor('#c2410c'), acc: parseHexColor('#fbbf24') },
    legs: { mid: parseHexColor('#0d9488'), acc: parseHexColor('#5eead4') },
  };

  // 20 Burst Technique 12x12 pixel icons
  for (const meta of BURST_ICON_META) {
    const c = new PixelCanvas(12, 12);
    const col = parseHexColor(meta.color);
    const acc = parseHexColor(meta.accent);
    const hi = mixRgba(col, white, 0.55);

    // Subtle dark beveled square medallion backing
    c.fillRect(1, 1, 10, 10, bgDark);
    c.strokeRect(1, 1, 10, 10, mixRgba(bgFrame, col, 0.45));
    c.strokeRect(0, 0, 12, 12, OUTLINE);

    const grid = BURST_ICON_PATTERNS[meta.id] ?? BURST_ICON_PATTERNS[1];
    c.paintGrid(grid, { C: col, A: acc, H: hi }, 0, 2);

    const key = `icon_burst_${meta.id}`;
    sprites[key] = c;
    aliases[meta.alias] = key;
  }

  // 20 Booster Chip 12x12 pixel icons (microchip PCB with gold connector pins)
  for (const meta of CHIP_ICON_META) {
    const c = new PixelCanvas(12, 12);
    const pc = partColors[meta.part];

    // Gold top & bottom chip connector pins
    for (const px of [3, 5, 7, 9]) {
      c.px(px, 0, OUTLINE);
      c.px(px, 1, goldPin);
      c.px(px, 10, goldPin);
      c.px(px, 11, OUTLINE);
    }
    // Chip ceramic die body
    c.fillRect(1, 2, 10, 8, bgDark);
    c.strokeRect(1, 2, 10, 8, pc.mid);
    c.hline(2, 2, 8, pc.acc);
    c.strokeRect(0, 1, 12, 10, OUTLINE);
    // Re-stamp bright gold edge pins on top/bottom border
    for (const px of [3, 5, 7, 9]) {
      c.px(px, 1, goldPin);
      c.px(px, 10, goldPin);
    }

    const glyph = CHIP_GLYPH_PATTERNS[meta.id] ?? CHIP_GLYPH_PATTERNS[1];
    c.paintGrid(glyph, { H: white, A: pc.acc }, 2, 4);

    const key = `icon_chip_${meta.id}`;
    sprites[key] = c;
    aliases[meta.alias] = key;
  }

  return { sprites, aliases };
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
  // Sort tallest first for compact shelf packing with zero cramp inside 1024x1024 ceiling
  const sorted = [...items].sort((a, b) => b.canvas.height - a.canvas.height || b.canvas.width - a.canvas.width);

  const padding = 1;
  const maxWidth = 1024;

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

const ALL_BOSS_IDS: readonly BossId[] = [
  'siege_tread',
  'prism',
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

    // 3. 16x16 Bespoke Biome tilesets for all 15 StageIds & all non-empty TileTypes
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

    // 5. All 12 Bespoke Bosses & 3 Minibosses
    for (const bossId of ALL_BOSS_IDS) {
      items.push({ key: `boss_${bossId}`, canvas: buildBossSprite(bossId) });
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

    // 7. Equippable Icons (icon_burst_1..20 & icon_chip_1..20, 12x12) + data key aliases
    const equippableIcons = buildEquippableIcons();
    for (const [key, canvas] of Object.entries(equippableIcons.sprites)) {
      items.push({ key, canvas });
    }
    for (const [alias, target] of Object.entries(equippableIcons.aliases)) {
      aliases.set(alias, target);
    }

    // 8. Outlined 6x8 BitmapFontAtlas glyphs (ASCII 32..126)
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
