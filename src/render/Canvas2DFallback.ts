// ============================================================================
// Krunked Circuit — Canvas2DFallback & Shared Pixel-Art Scene Drawer
// Implements the shared `GameRenderer` interface at strictly 400x240 nearest-
// neighbor resolution with 30/60/120 FPS interpolation, procedural 16-bit
// fallbacks, animated tiles, hookshot chain, flowing scarf, boss telegraphs,
// and in-canvas pixel HUD.
// ============================================================================

import {
  ATTACK_DATA,
  ENGINE_CONSTANTS,
  TileType,
  type BiomeGimmick,
  type BossEntity,
  type EnemyEntity,
  type InputModality,
  type Palette6,
  type PickupEntity,
  type PlayerState,
  type ProjectileEntity,
  type PropEntity,
  type RenderSettings,
  type RenderSnapshot,
  type ScaleMode,
  type SimEvent,
  type SimState,
  type StageDefinition,
} from '../contracts/index';
import { HudRenderer } from '../ui/HudRenderer';
import { ParallaxRenderer } from './ParallaxRenderer';
import { ParticlePool } from './ParticlePool';
import { DEFAULT_PALETTE_KEY_COLORS, parseHexColor } from './shaders';

export interface AtlasRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface StageRenderMeta {
  heatHaze?: boolean;
  hasStars?: boolean;
  biomeGimmick?: BiomeGimmick;
  stageName?: string;
  bossTitle?: string;
}

export interface GameRenderer {
  readonly backend: 'webgl2' | 'canvas2d';
  init(
    canvas: HTMLCanvasElement,
    atlasCanvas: HTMLCanvasElement | null,
    atlasRegions: Record<string, AtlasRect>,
    sourcePalette?: Palette6,
  ): void;
  render(
    prev: RenderSnapshot,
    state: SimState,
    interpAlpha: number,
    settings: RenderSettings,
    activePalette: Palette6,
    stagePalette: StageDefinition['palette'],
    stageMeta?: StageRenderMeta,
    activeModality?: InputModality,
    fps?: number,
  ): void;
  spawnEventParticles(event: SimEvent): void;
  setCustomSpriteOverride(key: string, img: HTMLImageElement | null): void;
  setSourcePalette?(palette: Palette6): void;
  setAtlas?(atlasCanvas: HTMLCanvasElement | null, atlasRegions: Record<string, AtlasRect>): void;
  triggerBossIntro?(name: string, title: string): void;
  dispose(): void;
}

export interface SceneBatcher {
  fillRect(
    x: number,
    y: number,
    w: number,
    h: number,
    hexColor: string,
    alpha?: number,
    flash?: number,
  ): void;
  drawAtlas(
    region: AtlasRect,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    flipX: boolean,
    alpha: number,
    flash: number,
    paletteSwap: boolean,
    outline: boolean,
  ): void;
  drawCustom(
    key: string,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    flipX: boolean,
    alpha: number,
    flash: number,
  ): void;
  resolveRegion(key: string): AtlasRect | null;
  resolveTileRegion(stageId: string, tileType: number): AtlasRect | null;
  hasCustomOverride(key: string): boolean;
}

const W = ENGINE_CONSTANTS.GAME_WIDTH;
const H = ENGINE_CONSTANTS.GAME_HEIGHT;
const TS = ENGINE_CONSTANTS.TILE_SIZE;

/**
 * Applies crisp integer / fit / fill scaling to the 400x240 canvas element
 * without altering the canvas internal 400x240 pixel buffer.
 */
export function applyCanvasScale(canvas: HTMLCanvasElement, scaleMode: ScaleMode): void {
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;
  canvas.style.imageRendering = 'pixelated';

  const parent = canvas.parentElement;
  if (!parent) return;
  const pw = parent.clientWidth;
  const ph = parent.clientHeight;
  if (pw <= 0 || ph <= 0) return;

  if (scaleMode === 'integer') {
    const mult = Math.max(1, Math.floor(Math.min(pw / W, ph / H)));
    canvas.style.width = `${W * mult}px`;
    canvas.style.height = `${H * mult}px`;
  } else if (scaleMode === 'fill') {
    const scale = Math.max(pw / W, ph / H);
    canvas.style.width = `${Math.round(W * scale)}px`;
    canvas.style.height = `${Math.round(H * scale)}px`;
  } else {
    // 'fit' — maximum 5:3 viewport containment
    const scale = Math.min(pw / W, ph / H);
    canvas.style.width = `${Math.round(W * scale)}px`;
    canvas.style.height = `${Math.round(H * scale)}px`;
  }
}

export class RegionLookup {
  private regions: Record<string, AtlasRect> = {};
  private tileCache = new Map<string, AtlasRect | null>();

  public setRegions(regions: Record<string, AtlasRect>): void {
    this.regions = regions;
    this.tileCache.clear();
  }

  public get(key: string): AtlasRect | null {
    return this.regions[key] ?? null;
  }

  public getFirst(k1: string, k2?: string, k3?: string): AtlasRect | null {
    const r1 = this.regions[k1];
    if (r1) return r1;
    if (k2) {
      const r2 = this.regions[k2];
      if (r2) return r2;
    }
    if (k3) {
      const r3 = this.regions[k3];
      if (r3) return r3;
    }
    return null;
  }

  public getTile(stageId: string, tileType: number): AtlasRect | null {
    const cacheKey = `${stageId}:${tileType}`;
    const cached = this.tileCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const found =
      this.regions[`tile_${stageId}_${tileType}`] ??
      this.regions[`${stageId}_tile_${tileType}`] ??
      this.regions[`tile_${tileType}`] ??
      null;
    this.tileCache.set(cacheKey, found);
    return found;
  }
}

function lerpClamped(a: number, b: number, t: number): number {
  // Prevent smearing across teleports / warps / respawns
  if (Math.abs(b - a) > 48) return b;
  return a + (b - a) * t;
}

function drawOutlinedRect(
  batch: SceneBatcher,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  outline = '#0d101b',
  alpha = 1,
  flash = 0,
): void {
  const xi = Math.round(x);
  const yi = Math.round(y);
  const wi = Math.round(w);
  const hi = Math.round(h);
  batch.fillRect(xi - 1, yi, wi + 2, hi, outline, alpha, flash * 0.5);
  batch.fillRect(xi, yi - 1, wi, hi + 2, outline, alpha, flash * 0.5);
  batch.fillRect(xi, yi, wi, hi, fill, alpha, flash);
}

function drawPixelLine(
  batch: SceneBatcher,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  thickness: number,
  color: string,
  alpha = 1,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / Math.max(1, thickness)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const px = Math.round(x0 + dx * t - thickness * 0.5);
    const py = Math.round(y0 + dy * t - thickness * 0.5);
    batch.fillRect(px, py, thickness, thickness, color, alpha);
  }
}

function drawProceduralTile(
  batch: SceneBatcher,
  tile: number,
  sx: number,
  sy: number,
  col: number,
  row: number,
  state: SimState,
  palette: StageDefinition['palette'],
): void {
  const tick = state.tick;

  switch (tile) {
    case TileType.SOLID: {
      batch.fillRect(sx, sy, TS, TS, palette.tilePrimary, 1);
      // Beveled 16-bit highlight & shadow edges
      batch.fillRect(sx, sy, TS, 2, palette.tileHighlight, 1);
      batch.fillRect(sx, sy, 1, TS, palette.tileHighlight, 0.55);
      batch.fillRect(sx, sy + TS - 2, TS, 2, palette.tileShadow, 1);
      batch.fillRect(sx + TS - 2, sy, 2, TS, palette.tileShadow, 1);
      // Inner cyber-plate rivets
      batch.fillRect(sx + 3, sy + 4, 2, 2, palette.tileShadow, 0.85);
      batch.fillRect(sx + TS - 5, sy + 4, 2, 2, palette.tileShadow, 0.85);
      if (((col + row) & 3) === 0) {
        batch.fillRect(sx + 4, sy + 9, 8, 2, palette.accent, 0.45);
      }
      break;
    }
    case TileType.ONE_WAY: {
      batch.fillRect(sx, sy, TS, 5, palette.tileHighlight, 1);
      batch.fillRect(sx, sy + 4, TS, 2, palette.tileShadow, 1);
      batch.fillRect(sx + 2, sy + 1, 4, 2, palette.accent, 0.75);
      batch.fillRect(sx + 10, sy + 1, 4, 2, palette.accent, 0.75);
      break;
    }
    case TileType.SPIKE: {
      // Base strip + 3 crisp gleaming hazard spikes
      batch.fillRect(sx, sy + 13, TS, 3, '#262b40', 1);
      for (let i = 0; i < 3; i++) {
        const bx = sx + 1 + i * 5;
        batch.fillRect(bx, sy + 9, 4, 4, '#b8c4d9', 1);
        batch.fillRect(bx + 1, sy + 5, 2, 4, '#eef6ff', 1);
        batch.fillRect(bx + 1, sy + 2, 2, 3, '#ff4b6e', 1);
      }
      break;
    }
    case TileType.BREAKABLE: {
      batch.fillRect(sx, sy, TS, TS, '#6e4c36', 1);
      batch.fillRect(sx, sy, TS, 2, '#b07b54', 1);
      batch.fillRect(sx, sy + TS - 2, TS, 2, '#3b2418', 1);
      // Crisp fracture lines
      batch.fillRect(sx + 3, sy + 3, 4, 1, '#26140c', 1);
      batch.fillRect(sx + 6, sy + 4, 3, 2, '#26140c', 1);
      batch.fillRect(sx + 8, sy + 6, 4, 2, '#26140c', 1);
      batch.fillRect(sx + 4, sy + 9, 5, 2, '#26140c', 1);
      batch.fillRect(sx + 11, sy + 10, 2, 3, '#ffd166', 0.65);
      break;
    }
    case TileType.ICE: {
      batch.fillRect(sx, sy, TS, TS, '#59c7f0', 0.92);
      batch.fillRect(sx, sy, TS, 2, '#e6fbff', 1);
      batch.fillRect(sx, sy + TS - 2, TS, 2, '#277da8', 1);
      batch.fillRect(sx + 3, sy + 4, 4, 2, '#ffffff', 0.85);
      batch.fillRect(sx + 9, sy + 8, 4, 2, '#c8f5ff', 0.75);
      break;
    }
    case TileType.CONVEYOR_L:
    case TileType.CONVEYOR_R: {
      const dir = tile === TileType.CONVEYOR_R ? 1 : -1;
      batch.fillRect(sx, sy, TS, TS, '#262f42', 1);
      batch.fillRect(sx, sy, TS, 2, '#5a6b8c', 1);
      batch.fillRect(sx, sy + TS - 2, TS, 2, '#131824', 1);
      const phase = ((tick >> 1) * dir) & 7;
      for (let i = 0; i < 2; i++) {
        const cx = sx + (((i * 8 + phase) & 15) + 16) % 16;
        if (cx < sx + TS - 2) {
          batch.fillRect(cx, sy + 5, 3, 2, '#ffd166', 1);
          batch.fillRect(cx + dir, sy + 7, 3, 2, '#ff9f1c', 1);
          batch.fillRect(cx, sy + 9, 3, 2, '#ffd166', 1);
        }
      }
      break;
    }
    case TileType.ELECTRIC_RAIL: {
      batch.fillRect(sx, sy, TS, TS, '#1c2438', 1);
      batch.fillRect(sx, sy, TS, 3, '#4e638a', 1);
      batch.fillRect(sx, sy + TS - 2, TS, 2, '#0c101a', 1);
      // Animated crackling electric spark coils
      const arcShift = (tick + col * 5) & 7;
      batch.fillRect(sx + 2, sy + 5, 12, 2, '#5ce1ff', 0.85);
      batch.fillRect(sx + 2 + arcShift, sy + 2, 3, 5, '#fff6a1', 0.95);
      batch.fillRect(sx + ((arcShift + 6) % 12) + 1, sy + 7, 3, 4, '#5ce1ff', 0.9);
      break;
    }
    case TileType.TOGGLE_A:
    case TileType.TOGGLE_B: {
      const isA = tile === TileType.TOGGLE_A;
      const active = isA ? !state.togglePhase : state.togglePhase;
      const colMain = isA ? '#ff4d6d' : '#4ee7ff';
      const colFill = isA ? '#591628' : '#133d54';
      if (active) {
        batch.fillRect(sx, sy, TS, TS, colFill, 1);
        batch.fillRect(sx, sy, TS, 2, colMain, 1);
        batch.fillRect(sx, sy + TS - 2, TS, 2, colMain, 1);
        batch.fillRect(sx, sy, 2, TS, colMain, 1);
        batch.fillRect(sx + TS - 2, sy, 2, TS, colMain, 1);
        batch.fillRect(sx + 5, sy + 5, 6, 6, colMain, 0.85);
      } else {
        // Dotted cyber ghost outline when phased out
        batch.fillRect(sx, sy, 4, 1, colMain, 0.45);
        batch.fillRect(sx + TS - 4, sy, 4, 1, colMain, 0.45);
        batch.fillRect(sx, sy + TS - 1, 4, 1, colMain, 0.45);
        batch.fillRect(sx + TS - 4, sy + TS - 1, 4, 1, colMain, 0.45);
        batch.fillRect(sx, sy, 1, 4, colMain, 0.45);
        batch.fillRect(sx + TS - 1, sy + TS - 4, 1, 4, colMain, 0.45);
      }
      break;
    }
    case TileType.BOUNCE_PAD: {
      const bob = (tick & 16) !== 0 ? 1 : 0;
      batch.fillRect(sx + 1, sy + 12, TS - 2, 4, '#25314a', 1);
      batch.fillRect(sx + 4, sy + 7 + bob, TS - 8, 5 - bob, '#ffd166', 1);
      batch.fillRect(sx, sy + 3 + bob, TS, 4, '#4dffb5', 1);
      batch.fillRect(sx + 2, sy + 3 + bob, TS - 4, 1, '#ffffff', 0.9);
      break;
    }
    case TileType.LASER_MIRROR: {
      batch.fillRect(sx, sy, TS, TS, '#2b2440', 1);
      batch.fillRect(sx + 2, sy + 2, TS - 4, TS - 4, '#473c69', 1);
      // Diagonal glowing prism + pulsing emitter beam
      for (let d = 0; d < 10; d++) {
        batch.fillRect(sx + 3 + d, sy + 12 - d, 2, 2, '#9cf0ff', 0.95);
      }
      const beamAlpha = (tick & 8) !== 0 ? 0.85 : 0.45;
      batch.fillRect(sx + 6, sy + 6, 4, 4, '#ffe15a', beamAlpha);
      break;
    }
    case TileType.CHECKPOINT: {
      batch.fillRect(sx + 6, sy + 4, 4, 12, '#344966', 1);
      batch.fillRect(sx + 3, sy + 14, 10, 2, '#5a769c', 1);
      const pulse = (tick & 16) !== 0 ? '#4dffb5' : '#5ce1ff';
      batch.fillRect(sx + 4, sy + 1, 8, 5, pulse, 1);
      batch.fillRect(sx + 6, sy + 2, 4, 2, '#ffffff', 0.9);
      break;
    }
    case TileType.GOAL_DOOR: {
      batch.fillRect(sx, sy, TS, TS, '#1c283d', 1);
      batch.fillRect(sx, sy, 2, TS, '#6985b3', 1);
      batch.fillRect(sx + TS - 2, sy, 2, TS, '#6985b3', 1);
      batch.fillRect(sx + 7, sy, 2, TS, '#090d16', 1);
      const glow = (tick & 16) !== 0 ? '#ffd166' : '#ff4d6d';
      batch.fillRect(sx + 3, sy + 4, 3, 8, glow, 0.9);
      batch.fillRect(sx + 10, sy + 4, 3, 8, glow, 0.9);
      break;
    }
    case TileType.CRUSHER: {
      batch.fillRect(sx, sy, TS, TS, '#383d4d', 1);
      batch.fillRect(sx, sy, TS, 3, '#ffd166', 1);
      batch.fillRect(sx + 4, sy, 4, 3, '#141722', 1);
      batch.fillRect(sx + 12, sy, 4, 3, '#141722', 1);
      batch.fillRect(sx, sy + TS - 3, TS, 3, '#ff4d6d', 1);
      break;
    }
    case TileType.PROXIMITY_SOLID: {
      const dist = Math.hypot(
        col * TS + 8 - (state.player.x + state.player.w * 0.5),
        row * TS + 8 - (state.player.y + state.player.h * 0.5),
      );
      const alpha = dist < 72 ? 0.92 : 0.25;
      batch.fillRect(sx + 1, sy + 1, TS - 2, TS - 2, '#3d7eff', alpha);
      batch.fillRect(sx + 1, sy + 1, TS - 2, 2, '#b3e5ff', alpha);
      break;
    }
    default:
      break;
  }
}

function drawProps(batch: SceneBatcher, state: SimState, camX: number, camY: number): void {
  const tick = state.tick;
  for (let i = 0; i < state.props.length; i++) {
    const p: PropEntity = state.props[i];
    if (p.grabbed) continue;
    const sx = Math.round(p.x - camX);
    const sy = Math.round(p.y - camY);
    if (sx + p.w < -16 || sx > W + 16 || sy + p.h < -16 || sy > H + 16) continue;

    const regKey =
      p.kind === 'switch' ? (p.activated ? 'switch_on' : 'switch_off') : p.kind;
    const reg = batch.resolveRegion(regKey);
    if (reg) {
      batch.drawAtlas(reg, sx, sy, p.w, p.h, false, 1, 0, false, false);
      continue;
    }

    switch (p.kind) {
      case 'crate':
        drawOutlinedRect(batch, sx, sy, p.w, p.h, '#94633e');
        batch.fillRect(sx + 2, sy + 2, p.w - 4, 2, '#cc915e', 1);
        batch.fillRect(sx + 3, sy + Math.floor(p.h / 2), p.w - 6, 2, '#5e3b22', 1);
        break;
      case 'barrel':
        drawOutlinedRect(batch, sx + 1, sy, p.w - 2, p.h, '#c73642');
        batch.fillRect(sx + 2, sy + 4, p.w - 4, 3, '#ffd166', 1);
        batch.fillRect(sx + 2, sy + p.h - 6, p.w - 4, 2, '#ff8fa3', 0.85);
        break;
      case 'switch': {
        const col = p.activated ? '#4dffb5' : '#ff4d6d';
        drawOutlinedRect(batch, sx + 1, sy + p.h - 6, p.w - 2, 6, '#394661');
        batch.fillRect(sx + 4, sy + 3, p.w - 8, p.h - 9, col, 1);
        batch.fillRect(sx + 5, sy + 4, p.w - 10, 2, '#ffffff', 0.8);
        break;
      }
      case 'checkpoint': {
        const activeCol = p.activated ? '#4dffb5' : '#4a648a';
        batch.fillRect(sx + Math.floor(p.w / 2) - 2, sy + 5, 4, p.h - 5, '#465878', 1);
        batch.fillRect(sx + 2, sy + p.h - 3, p.w - 4, 3, '#6e84ab', 1);
        drawOutlinedRect(batch, sx + 3, sy, p.w - 6, 7, activeCol);
        if (p.activated && (tick & 8) !== 0) {
          batch.fillRect(sx + Math.floor(p.w / 2) - 1, sy - 6, 2, 6, '#b8ffe0', 0.75);
        }
        break;
      }
      case 'hub_terminal': {
        drawOutlinedRect(batch, sx + 1, sy + 2, p.w - 2, p.h - 2, '#24344f');
        batch.fillRect(sx + 3, sy + 4, p.w - 6, Math.max(6, Math.floor(p.h * 0.45)), '#0c1d33', 1);
        const scanY = sy + 5 + ((tick >> 2) % Math.max(3, Math.floor(p.h * 0.35)));
        batch.fillRect(sx + 4, scanY, p.w - 8, 2, '#5ce1ff', 0.9);
        batch.fillRect(sx + 4, sy + p.h - 5, p.w - 8, 2, '#4dffb5', 0.85);
        break;
      }
      case 'walker': {
        drawOutlinedRect(batch, sx, sy, p.w, p.h - 6, '#4b6587');
        batch.fillRect(sx + 3, sy + 3, p.w - 6, 6, '#7ae6ff', 0.85);
        batch.fillRect(sx + 2, sy + p.h - 6, 5, 6, '#27364d', 1);
        batch.fillRect(sx + p.w - 7, sy + p.h - 6, 5, 6, '#27364d', 1);
        break;
      }
    }
  }
}

function drawPickups(batch: SceneBatcher, state: SimState, camX: number, camY: number): void {
  const tick = state.tick;
  for (let i = 0; i < state.pickups.length; i++) {
    const p: PickupEntity = state.pickups[i];
    if (p.collected) continue;
    const bob = Math.round(Math.sin((tick + p.id * 9) * 0.14) * 1.5);
    const sx = Math.round(p.x - camX);
    const sy = Math.round(p.y - camY) + bob;
    if (sx < -16 || sx > W + 16 || sy < -16 || sy > H + 16) continue;

    const regKey = p.kind === 'rescue' ? 'rescue_bot' : p.kind;
    const reg = batch.resolveRegion(regKey);
    if (reg) {
      batch.drawAtlas(reg, sx - 4, sy - 4, reg.w, reg.h, false, 1, 0, false, false);
      continue;
    }

    switch (p.kind) {
      case 'bit_1':
        drawOutlinedRect(batch, sx - 2, sy - 2, 5, 5, '#ffae42');
        batch.fillRect(sx - 1, sy - 1, 2, 2, '#fff5cc', 1);
        break;
      case 'bit_5':
        drawOutlinedRect(batch, sx - 3, sy - 3, 6, 6, '#4ee7ff');
        batch.fillRect(sx - 1, sy - 2, 2, 2, '#ffffff', 1);
        break;
      case 'bit_10':
        drawOutlinedRect(batch, sx - 3, sy - 4, 7, 8, '#ffd166');
        batch.fillRect(sx - 1, sy - 2, 3, 3, '#ffffff', 1);
        break;
      case 'bit_50':
        drawOutlinedRect(batch, sx - 4, sy - 4, 8, 9, '#ff4d94');
        batch.fillRect(sx - 2, sy - 2, 4, 4, '#ffe0ee', 1);
        break;
      case 'health_small':
      case 'health_large': {
        const s = p.kind === 'health_large' ? 9 : 6;
        drawOutlinedRect(batch, sx - Math.floor(s / 2), sy - Math.floor(s / 2), s, s, '#38e89e');
        batch.fillRect(sx - 1, sy - Math.floor(s / 2) + 1, 2, s - 2, '#ffffff', 1);
        batch.fillRect(sx - Math.floor(s / 2) + 1, sy - 1, s - 2, 2, '#ffffff', 1);
        break;
      }
      case 'burst_orb':
        drawOutlinedRect(batch, sx - 3, sy - 3, 7, 7, '#3da5ff');
        batch.fillRect(sx - 1, sy - 1, 3, 3, '#e0f7ff', 1);
        break;
      case 'rescue': {
        // Cute stranded mini-bot + distress pulse ring
        if ((tick & 16) !== 0) {
          batch.fillRect(sx - 8, sy - 8, 16, 1, '#5ce1ff', 0.55);
          batch.fillRect(sx - 8, sy + 7, 16, 1, '#5ce1ff', 0.55);
        }
        drawOutlinedRect(batch, sx - 5, sy - 6, 10, 12, '#7ae6ff');
        batch.fillRect(sx - 3, sy - 4, 6, 4, '#0d101b', 1);
        batch.fillRect(sx - 2, sy - 3, 2, 2, '#4dffb5', 1);
        batch.fillRect(sx + 1, sy - 3, 2, 2, '#4dffb5', 1);
        batch.fillRect(sx - 1, sy - 9, 2, 3, '#ffd166', 1);
        break;
      }
      case 'health_booster':
      case 'burst_booster':
      case 'palette_chip': {
        const col =
          p.kind === 'health_booster'
            ? '#38e89e'
            : p.kind === 'burst_booster'
              ? '#5ce1ff'
              : '#ff6bd6';
        drawOutlinedRect(batch, sx - 5, sy - 5, 10, 10, col);
        batch.fillRect(sx - 2, sy - 2, 4, 4, '#ffffff', 0.9);
        break;
      }
    }
  }
}

function resolveEnemyFamilyKey(archetypeId: string): string {
  const lower = archetypeId.toLowerCase();
  if (lower.includes('shield') || lower.includes('guard')) return 'shield_guard';
  if (lower.includes('turret') || lower.includes('cannon')) return 'turret';
  if (lower.includes('hop') || lower.includes('leap') || lower.includes('spring')) return 'hopper';
  if (lower.includes('fly') || lower.includes('drone') || lower.includes('wing') || lower.includes('jet')) return 'flyer';
  if (lower.includes('crawl') || lower.includes('bug') || lower.includes('spider')) return 'crawler';
  if (lower.includes('spawn') || lower.includes('hive') || lower.includes('pod')) return 'spawner';
  if (lower.includes('dummy') || lower.includes('train')) return 'dummy';
  return 'trooper';
}

function drawEnemies(
  batch: SceneBatcher,
  prev: RenderSnapshot,
  state: SimState,
  alpha: number,
  camX: number,
  camY: number,
): void {
  const tick = state.tick;
  for (let i = 0; i < state.enemies.length; i++) {
    const e: EnemyEntity = state.enemies[i];
    if (e.dead || e.grabbed) continue;
    const prevPos = prev.enemyPos[e.id];
    const ex = prevPos ? lerpClamped(prevPos.x, e.x, alpha) : e.x;
    const ey = prevPos ? lerpClamped(prevPos.y, e.y, alpha) : e.y;
    const sx = Math.round(ex - camX);
    const sy = Math.round(ey - camY);
    if (sx + e.w < -24 || sx > W + 24 || sy + e.h < -24 || sy > H + 24) continue;

    const flash = e.hurtFlash > 0 ? 1 : 0;
    const flipX = e.facing < 0;
    const fam = resolveEnemyFamilyKey(e.archetypeId);
    const reg =
      batch.resolveRegion(e.archetypeId) ??
      batch.resolveRegion(`enemy_${fam}`) ??
      batch.resolveRegion(fam);

    if (reg) {
      const dx = sx + Math.round((e.w - reg.w) * 0.5);
      const dy = sy + e.h - reg.h;
      batch.drawAtlas(reg, dx, dy, reg.w, reg.h, flipX, 1, flash, false, true);
    } else {
      // Crisp procedural 16-bit robot silhouette with 1px dark contrast outline
      const bodyCol = e.isMiniboss
        ? '#b83b5e'
        : fam === 'shield_guard'
          ? '#4b7bec'
          : fam === 'flyer'
            ? '#a55eea'
            : fam === 'turret'
              ? '#fa8231'
              : fam === 'dummy'
                ? '#778ca3'
                : '#eb3b5a';
      const hiCol = e.isMiniboss ? '#ff94b2' : '#ffd5df';
      drawOutlinedRect(batch, sx, sy, e.w, e.h, bodyCol, '#0d101b', 1, flash);
      batch.fillRect(sx + 2, sy + 2, Math.max(2, e.w - 4), 3, hiCol, 0.75, flash);
      // Glowing eye/visor oriented toward facing
      const eyeX = e.facing > 0 ? sx + e.w - 6 : sx + 2;
      batch.fillRect(eyeX, sy + 5, 4, 3, '#ffe15a', 1, flash);
      // Legs / treads animated when moving
      const step = Math.abs(e.vx) > 0.1 && (tick & 8) !== 0 ? 1 : 0;
      batch.fillRect(sx + 2, sy + e.h - 4 - step, 4, 4, '#1b2234', 1, flash);
      batch.fillRect(sx + e.w - 6, sy + e.h - 4 + step, 4, 4, '#1b2234', 1, flash);
    }

    // Energy shield barrier on facing side
    if (e.shielded) {
      const shX = e.facing > 0 ? sx + e.w : sx - 4;
      batch.fillRect(shX, sy + 2, 4, e.h - 4, '#4ee7ff', 0.85, flash);
      batch.fillRect(shX + 1, sy + 3, 2, e.h - 6, '#e8fcff', 0.9, flash);
    }

    // Stunned orbiting stars + hookshot grab-ready brackets!
    if (e.stunTimer > 0) {
      const orbit = Math.round(Math.sin(tick * 0.28) * 5);
      batch.fillRect(sx + Math.floor(e.w / 2) + orbit - 1, sy - 6, 3, 3, '#ffe15a', 1);
      batch.fillRect(sx + Math.floor(e.w / 2) - orbit - 1, sy - 5, 2, 2, '#5ce1ff', 1);
      // Pulsing cyan grapple brackets
      if ((tick & 8) !== 0) {
        batch.fillRect(sx - 3, sy - 3, 4, 1, '#5ce1ff', 0.95);
        batch.fillRect(sx - 3, sy - 3, 1, 4, '#5ce1ff', 0.95);
        batch.fillRect(sx + e.w - 1, sy - 3, 4, 1, '#5ce1ff', 0.95);
        batch.fillRect(sx + e.w + 2, sy - 3, 1, 4, '#5ce1ff', 0.95);
      }
    }

    // Miniboss overhead HP strip
    if (e.isMiniboss && e.maxHp > 0) {
      const bw = Math.max(24, e.w);
      const bx = sx + Math.floor((e.w - bw) / 2);
      const by = sy - 8;
      batch.fillRect(bx - 1, by - 1, bw + 2, 5, '#090c14', 0.9);
      const fillW = Math.round((Math.max(0, e.hp) / e.maxHp) * bw);
      batch.fillRect(bx, by, fillW, 3, '#ff4d6d', 1);
    }
  }
}

function drawBoss(
  batch: SceneBatcher,
  prev: RenderSnapshot,
  state: SimState,
  alpha: number,
  camX: number,
  camY: number,
): void {
  const boss: BossEntity | null = state.boss;
  if (!boss || !boss.active || boss.defeated) return;

  const bx = prev.bossPos ? lerpClamped(prev.bossPos.x, boss.x, alpha) : boss.x;
  const by = prev.bossPos ? lerpClamped(prev.bossPos.y, boss.y, alpha) : boss.y;
  const sx = Math.round(bx - camX);
  const sy = Math.round(by - camY);
  const tick = state.tick;
  const flash = boss.hurtFlash > 0 ? 1 : 0;
  const flipX = boss.facing < 0;

  // Desperation crimson-gold aura behind boss
  if (boss.desperationTriggered) {
    const pulse = (tick & 4) !== 0 ? 3 : 1;
    batch.fillRect(sx - pulse, sy - pulse, boss.w + pulse * 2, boss.h + pulse * 2, '#ff3b5c', 0.28);
    batch.fillRect(sx - 1, sy - 1, boss.w + 2, 2, '#ffd166', 0.75);
  }

  // Telegraph danger indicator & warning vector
  if (boss.aiState === 'telegraph') {
    const blink = (tick & 4) !== 0;
    const cx = sx + Math.floor(boss.w / 2);
    // Crisp pulsing [!] alert above boss
    batch.fillRect(cx - 5, sy - 16, 10, 11, '#260712', 0.92);
    batch.fillRect(cx - 1, sy - 14, 2, 5, blink ? '#fff4b8' : '#ff4d6d', 1);
    batch.fillRect(cx - 1, sy - 8, 2, 2, blink ? '#fff4b8' : '#ff4d6d', 1);
    // Charging energy ring around boss core
    const rad = 10 + (tick % 8) * 2;
    batch.fillRect(cx - rad, sy + Math.floor(boss.h / 2) - 1, rad * 2, 2, '#ff4d6d', 0.45);
    // Directional strike line
    const lineStart = boss.facing > 0 ? sx + boss.w : sx - 64;
    batch.fillRect(lineStart, sy + Math.floor(boss.h * 0.45), 64, 2, '#ff5c7c', blink ? 0.7 : 0.25);
  }

  // Try custom override or atlas region first
  const bossKey = `boss_${boss.bossId}`;
  if (batch.hasCustomOverride(bossKey)) {
    batch.drawCustom(bossKey, sx, sy, boss.w, boss.h, flipX, 1, flash);
    return;
  }
  const reg = batch.resolveRegion(bossKey) ?? batch.resolveRegion(boss.bossId);
  if (reg) {
    const dx = sx + Math.round((boss.w - reg.w) * 0.5);
    const dy = sy + boss.h - reg.h;
    batch.drawAtlas(reg, dx, dy, reg.w, reg.h, flipX, 1, flash, false, true);
    return;
  }

  // Handcrafted crisp procedural pixel-art Boss rigs
  if (boss.bossId === 'siege_tread') {
    // Heavy armored tread mech (Opening boss)
    drawOutlinedRect(batch, sx + 2, sy + 6, boss.w - 4, boss.h - 14, '#4c5b78', '#0d101b', 1, flash);
    batch.fillRect(sx + 6, sy + 2, boss.w - 12, 8, '#7387ab', 1, flash); // turret dome
    const visorX = boss.facing > 0 ? sx + boss.w - 14 : sx + 6;
    batch.fillRect(visorX, sy + 10, 8, 4, '#ff4d6d', 1, flash);
    // Heavy armored tank treads
    drawOutlinedRect(batch, sx, sy + boss.h - 10, boss.w, 10, '#232a3b', '#0d101b', 1, flash);
    const treadShift = (tick >> 1) & 3;
    for (let tx = sx + 2 + treadShift; tx < sx + boss.w - 3; tx += 6) {
      batch.fillRect(tx, sy + boss.h - 8, 3, 6, '#ffd166', 0.85, flash);
    }
  } else if (boss.bossId === 'prism') {
    // Solar Prism Master with radiant cape & crystal visor (Optic boss)
    // Flowing solar cape
    const capeX = boss.facing > 0 ? sx - 6 : sx + boss.w - 2;
    const capeWave = (tick & 8) !== 0 ? 2 : 0;
    batch.fillRect(capeX, sy + 8, 8, boss.h - 12 + capeWave, '#ff9f1c', 0.9, flash);
    batch.fillRect(capeX + 2, sy + 10, 4, boss.h - 16, '#fff29c', 0.85, flash);
    // Sleek crystal-plated armor
    drawOutlinedRect(batch, sx + 3, sy + 4, boss.w - 6, boss.h - 6, '#e67e22', '#0d101b', 1, flash);
    batch.fillRect(sx + 5, sy + 5, boss.w - 10, 6, '#ffd166', 1, flash);
    // Prism crest
    batch.fillRect(sx + Math.floor(boss.w / 2) - 2, sy - 3, 4, 6, '#9cf0ff', 1, flash);
    const visorX = boss.facing > 0 ? sx + boss.w - 12 : sx + 5;
    batch.fillRect(visorX, sy + 9, 7, 3, '#5ce1ff', 1, flash);
    batch.fillRect(sx + Math.floor(boss.w / 2) - 3, sy + 17, 6, 6, '#fff6cc', 1, flash);
  } else {
    // Sleek Circuit Master / Final Overlord armored chassis
    const primary = boss.bossId === 'overlord_apex' ? '#7b2cbf' : '#c9385f';
    const accent = boss.bossId === 'overlord_apex' ? '#5ce1ff' : '#ffd166';
    drawOutlinedRect(batch, sx + 2, sy + 3, boss.w - 4, boss.h - 5, primary, '#0d101b', 1, flash);
    batch.fillRect(sx + 5, sy + 5, boss.w - 10, 5, '#eef5ff', 0.45, flash);
    const visorX = boss.facing > 0 ? sx + boss.w - 13 : sx + 5;
    batch.fillRect(visorX, sy + 10, 8, 4, accent, 1, flash);
    batch.fillRect(sx + 4, sy + Math.floor(boss.h * 0.55), boss.w - 8, 3, accent, 0.85, flash);
  }
}

function drawScarf(
  batch: SceneBatcher,
  player: PlayerState,
  activePalette: Palette6,
  camX: number,
  camY: number,
): void {
  const nodes = player.scarf;
  if (!nodes || nodes.length < 2) return;

  const outlineCol = activePalette[0];
  const scarfCol = activePalette[4];
  const tipCol = activePalette[5];

  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    const ax = a.x - camX;
    const ay = a.y - camY;
    const bx = b.x - camX;
    const by = b.y - camY;
    const thickness = i < 2 ? 4 : i < 5 ? 3 : 2;
    // 1px dark contrast outline pass
    drawPixelLine(batch, ax, ay, bx, by, thickness + 2, outlineCol, 0.95);
  }
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    const ax = a.x - camX;
    const ay = a.y - camY;
    const bx = b.x - camX;
    const by = b.y - camY;
    const thickness = i < 2 ? 4 : i < 5 ? 3 : 2;
    const col = i === nodes.length - 2 ? tipCol : scarfCol;
    drawPixelLine(batch, ax, ay, bx, by, thickness, col, 1);
  }
}

function drawHookshotAndReticle(
  batch: SceneBatcher,
  prev: RenderSnapshot,
  state: SimState,
  alpha: number,
  settings: RenderSettings,
  activePalette: Palette6,
  px: number,
  py: number,
  camX: number,
  camY: number,
): void {
  const { player } = state;
  const hook = player.hook;
  const originX = px + player.w * 0.5 - camX;
  const originY = py + player.h * 0.42 - camY;

  // 8-directional aiming reticle when enabled
  if (settings.aimReticle) {
    const aimDx = hook.phase !== 'idle' ? hook.dirX : player.facing;
    const aimDy = hook.phase !== 'idle' ? hook.dirY : 0;
    const norm = Math.hypot(aimDx, aimDy) || 1;
    const rx = Math.round(originX + (aimDx / norm) * 28);
    const ry = Math.round(originY + (aimDy / norm) * 28);

    const retReg = batch.resolveRegion('aim_reticle');
    if (retReg) {
      batch.drawAtlas(
        retReg,
        rx - Math.floor(retReg.w / 2),
        ry - Math.floor(retReg.h / 2),
        retReg.w,
        retReg.h,
        false,
        hook.phase !== 'idle' ? 0.95 : 0.48,
        0,
        false,
        false,
      );
    } else {
      const a = hook.phase !== 'idle' ? 0.92 : 0.42;
      const col = activePalette[5];
      batch.fillRect(rx - 4, ry, 3, 1, col, a);
      batch.fillRect(rx + 2, ry, 3, 1, col, a);
      batch.fillRect(rx, ry - 4, 1, 3, col, a);
      batch.fillRect(rx, ry + 2, 1, 3, col, a);
      batch.fillRect(rx, ry, 1, 1, '#ffffff', a);
    }
  }

  if (hook.phase === 'idle') return;

  // Holding an object overhead!
  if (hook.phase === 'holding' && hook.heldKind !== 'none') {
    const hx = Math.round(px + player.w * 0.5 - camX);
    const hy = Math.round(py - 10 - camY);
    const col =
      hook.heldKind === 'barrel'
        ? '#ff4d6d'
        : hook.heldKind === 'shield'
          ? '#4ee7ff'
          : hook.heldKind === 'crate'
            ? '#cc915e'
            : '#ff8fa3';
    // Glowing grapple tether ring around held object
    batch.fillRect(hx - 8, hy - 8, 16, 16, '#5ce1ff', 0.24);
    drawOutlinedRect(batch, hx - 6, hy - 6, 12, 12, col, '#0d101b', 1, 0);
    batch.fillRect(hx - 3, hy - 3, 6, 2, '#ffffff', 0.75);
    return;
  }

  const tipWorldX = lerpClamped(prev.hookTipX, hook.tipX, alpha);
  const tipWorldY = lerpClamped(prev.hookTipY, hook.tipY, alpha);
  const tipX = tipWorldX - camX;
  const tipY = tipWorldY - camY;

  // Glowing segmented hookshot chain links
  const dx = tipX - originX;
  const dy = tipY - originY;
  const dist = Math.hypot(dx, dy);
  const links = Math.max(2, Math.floor(dist / 5));
  const chainReg = batch.resolveRegion('hook_chain');

  for (let i = 1; i < links; i++) {
    const t = i / links;
    const lx = Math.round(originX + dx * t);
    const ly = Math.round(originY + dy * t);
    if (chainReg) {
      batch.drawAtlas(
        chainReg,
        lx - Math.floor(chainReg.w / 2),
        ly - Math.floor(chainReg.h / 2),
        chainReg.w,
        chainReg.h,
        false,
        1,
        0,
        false,
        false,
      );
    } else {
      const linkCol = i % 2 === 0 ? '#5ce1ff' : activePalette[5];
      batch.fillRect(lx - 2, ly - 2, 4, 4, '#0d101b', 1);
      batch.fillRect(lx - 1, ly - 1, 2, 2, linkCol, 1);
    }
  }

  // Grapple claw tip
  const tipReg = batch.resolveRegion('hook_tip');
  if (tipReg) {
    batch.drawAtlas(
      tipReg,
      Math.round(tipX - tipReg.w * 0.5),
      Math.round(tipY - tipReg.h * 0.5),
      tipReg.w,
      tipReg.h,
      hook.dirX < 0,
      1,
      0,
      false,
      true,
    );
  } else {
    const tx = Math.round(tipX);
    const ty = Math.round(tipY);
    drawOutlinedRect(batch, tx - 3, ty - 3, 6, 6, '#5ce1ff', '#0d101b');
    batch.fillRect(tx - 1, ty - 1, 2, 2, '#ffffff', 1);
  }
}

function resolveHeroAnimKey(player: PlayerState, tick: number): string {
  switch (player.action) {
    case 'walk':
      return `walk_${(tick >> 3) & 3}`;
    case 'sprint':
      return `sprint_${(tick >> 2) & 3}`;
    case 'jump':
      return 'jump';
    case 'fall':
      return 'fall';
    case 'wall_slide':
      return 'wall_slide';
    case 'ledge_hang':
      return 'ledge_hang';
    case 'slide':
      return 'slide';
    case 'dive_kick':
      return 'dive_kick';
    case 'burst':
      return 'burst';
    case 'hurt':
      return 'hurt';
    case 'attack': {
      if (player.attackId === 'airUpKick' || player.attackId === 'hopKick') return 'attack_up';
      if (player.attackId === 'sprintKick' || player.attackId === 'airKick') return 'attack_kick';
      return 'attack_jab';
    }
    default:
      return `idle_${(tick >> 4) & 1}`;
  }
}

function drawPlayer(
  batch: SceneBatcher,
  state: SimState,
  activePalette: Palette6,
  px: number,
  py: number,
  camX: number,
  camY: number,
): void {
  const { player, tick } = state;
  const sx = Math.round(px - camX);
  const sy = Math.round(py - camY);

  // Freeze Field expanding crystalline ring
  if (player.freezeFieldTimer > 0) {
    const rad = 28 + Math.round(Math.sin(tick * 0.2) * 3);
    const cx = sx + Math.floor(player.w / 2);
    const cy = sy + Math.floor(player.h / 2);
    batch.fillRect(cx - rad, cy - rad, rad * 2, 1, '#9cf0ff', 0.65);
    batch.fillRect(cx - rad, cy + rad, rad * 2, 1, '#9cf0ff', 0.65);
    batch.fillRect(cx - rad, cy - rad, 1, rad * 2, '#9cf0ff', 0.65);
    batch.fillRect(cx + rad, cy - rad, 1, rad * 2, '#9cf0ff', 0.65);
  }

  // Overload golden energy aura
  if (player.overloadTimer > 0) {
    const auraPad = (tick & 4) !== 0 ? 3 : 2;
    batch.fillRect(
      sx - auraPad,
      sy - auraPad,
      player.w + auraPad * 2,
      player.h + auraPad * 2,
      '#ffd166',
      0.28,
    );
  }

  // Invuln blink alpha
  const blinkAlpha = player.invulnTimer > 0 && (tick & 2) !== 0 ? 0.42 : 1;
  const flash = player.hurtTimer > 0 && (tick & 2) === 0 ? 1 : 0;
  const flipX = player.facing < 0;

  // Custom sprite override or palette-swapped atlas sprite
  const animKey = resolveHeroAnimKey(player, tick);
  if (batch.hasCustomOverride('player_hero')) {
    batch.drawCustom('player_hero', sx - 9, sy - 4, 32, 32, flipX, blinkAlpha, flash);
  } else {
    const reg =
      batch.resolveRegion(`player_hero:${animKey}`) ??
      batch.resolveRegion(`hero_${animKey}`) ??
      batch.resolveRegion(animKey);
    if (reg) {
      const dx = sx + Math.round((player.w - reg.w) * 0.5);
      const dy = sy + player.h - reg.h;
      batch.drawAtlas(reg, dx, dy, reg.w, reg.h, flipX, blinkAlpha, flash, true, false);
    } else {
      // Crisp handcrafted 16-bit procedural Volt rig colored by activePalette
      const [cOut, cDark, cMid, cHi, cScarf, cVisor] = activePalette;
      const isSlide = player.sliding || player.crouching;

      if (isSlide) {
        drawOutlinedRect(batch, sx - 2, sy + 2, player.w + 4, player.h - 2, cMid, cOut, blinkAlpha, flash);
        batch.fillRect(sx, sy + 3, player.w, 3, cHi, blinkAlpha, flash);
        const vx = player.facing > 0 ? sx + player.w - 5 : sx + 1;
        batch.fillRect(vx, sy + 5, 4, 3, cVisor, blinkAlpha, flash);
      } else {
        // Helmet / Head (10x9)
        const headX = sx + 2;
        const headY = sy + 1;
        drawOutlinedRect(batch, headX, headY, 10, 9, cMid, cOut, blinkAlpha, flash);
        batch.fillRect(headX + 1, headY, 8, 2, cHi, blinkAlpha, flash);
        // Crest fin
        batch.fillRect(headX + 4, headY - 2, 2, 3, cScarf, blinkAlpha, flash);
        // Glowing visor
        const vx = player.facing > 0 ? headX + 5 : headX + 1;
        batch.fillRect(vx, headY + 4, 4, 3, cVisor, blinkAlpha, flash);

        // Scarf collar
        batch.fillRect(sx + 1, sy + 10, player.w - 2, 3, cScarf, blinkAlpha, flash);

        // Armored Torso
        drawOutlinedRect(batch, sx + 2, sy + 13, player.w - 4, 8, cDark, cOut, blinkAlpha, flash);
        batch.fillRect(sx + 4, sy + 14, player.w - 8, 4, cMid, blinkAlpha, flash);
        batch.fillRect(sx + 5, sy + 15, 4, 2, cVisor, blinkAlpha, flash); // chest core

        // Animated legs / boots
        const moving = Math.abs(player.vx) > 0.25 && player.grounded;
        const stride = moving ? Math.round(Math.sin(tick * 0.45) * 3) : 0;
        drawOutlinedRect(batch, sx + 2 + stride, sy + 21, 4, 7, cMid, cOut, blinkAlpha, flash);
        drawOutlinedRect(batch, sx + player.w - 6 - stride, sy + 21, 4, 7, cDark, cOut, blinkAlpha, flash);
      }
    }
  }

  // Barrier protective ring
  if (player.barrierHits > 0) {
    const cx = sx + Math.floor(player.w / 2);
    const cy = sy + Math.floor(player.h / 2);
    const rx = 11;
    const ry = 16;
    batch.fillRect(cx - rx, cy - ry, rx * 2, 1, '#5ce1ff', 0.8);
    batch.fillRect(cx - rx, cy + ry, rx * 2, 1, '#5ce1ff', 0.8);
    batch.fillRect(cx - rx, cy - ry, 1, ry * 2, '#5ce1ff', 0.8);
    batch.fillRect(cx + rx, cy - ry, 1, ry * 2, '#5ce1ff', 0.8);
  }

  // Punchy melee slash crescent matching ATTACK_DATA hitbox
  if (player.attackId && player.attackTimer > 0) {
    const spec = ATTACK_DATA[player.attackId];
    const progress = player.attackTimer / Math.max(1, spec.activeTicks);
    const slashX =
      player.facing > 0
        ? sx + player.w + spec.offsetX - 6
        : sx - spec.width - spec.offsetX + 6;
    const slashY = sy + spec.offsetY + 2;
    const sw = Math.min(spec.width, 32);
    const sh = Math.min(spec.height - 4, 26);
    const slashCol = spec.armorBreak ? '#ffd166' : activePalette[5];
    batch.fillRect(slashX, slashY, sw, sh, slashCol, 0.35 * progress);
    const edgeX = player.facing > 0 ? slashX + sw - 4 : slashX;
    batch.fillRect(edgeX, slashY + 2, 4, sh - 4, '#ffffff', 0.9 * progress);
  }
}

function drawProjectiles(
  batch: SceneBatcher,
  prev: RenderSnapshot,
  state: SimState,
  alpha: number,
  camX: number,
  camY: number,
): void {
  const tick = state.tick;
  for (let i = 0; i < state.projectiles.length; i++) {
    const p: ProjectileEntity = state.projectiles[i];
    const prevPos = prev.projPos[p.id];
    const px = prevPos ? lerpClamped(prevPos.x, p.x, alpha) : p.x;
    const py = prevPos ? lerpClamped(prevPos.y, p.y, alpha) : p.y;
    const sx = Math.round(px - camX);
    const sy = Math.round(py - camY);
    if (sx + p.w < -24 || sx > W + 24 || sy + p.h < -24 || sy > H + 24) continue;

    const col = p.color || '#5ce1ff';

    if (p.kind === 'laser_beam' || p.kind === 'burst_beam' || p.kind === 'dive_beam') {
      batch.fillRect(sx - 1, sy - 1, p.w + 2, p.h + 2, col, 0.45);
      batch.fillRect(sx, sy, p.w, p.h, col, 0.95);
      const innerH = Math.max(2, Math.floor(p.h * 0.4));
      batch.fillRect(sx, sy + Math.floor((p.h - innerH) / 2), p.w, innerH, '#ffffff', 0.92);
    } else if (p.kind === 'support_platform') {
      drawOutlinedRect(batch, sx, sy, p.w, p.h, '#4ee7ff', '#0d101b', 0.92);
      batch.fillRect(sx + 2, sy + 1, p.w - 4, 2, '#ffffff', 0.9);
    } else if (
      p.kind === 'thrown_enemy' ||
      p.kind === 'thrown_shield' ||
      p.kind === 'thrown_crate' ||
      p.kind === 'thrown_barrel'
    ) {
      // Motion trail + high-contrast spinning projectile
      batch.fillRect(
        Math.round(sx - p.vx * 1.4),
        Math.round(sy - p.vy * 1.4),
        p.w,
        p.h,
        col,
        0.35,
      );
      drawOutlinedRect(batch, sx, sy, p.w, p.h, col, '#ffffff', 1, (tick & 2) !== 0 ? 0.5 : 0);
    } else if (p.kind === 'electric_arc') {
      const jitter = ((tick + p.id) & 2) !== 0 ? 1 : -1;
      batch.fillRect(sx, sy + jitter, p.w, p.h, '#5ce1ff', 0.95);
      batch.fillRect(sx + 1, sy - jitter, Math.max(1, p.w - 2), Math.max(1, p.h - 2), '#ffffff', 0.9);
    } else {
      drawOutlinedRect(batch, sx, sy, p.w, p.h, col, '#0d101b', 1);
      if (p.w >= 4 && p.h >= 4) {
        batch.fillRect(sx + 1, sy + 1, p.w - 2, p.h - 2, '#ffffff', 0.7);
      }
    }
  }
}

function drawParticles(
  batch: SceneBatcher,
  particles: ParticlePool,
  camX: number,
  camY: number,
): void {
  const slots = particles.slots;
  for (let i = 0; i < slots.length; i++) {
    const p = slots[i];
    if (!p.active) continue;
    const sx = Math.round(p.x - camX);
    const sy = Math.round(p.y - camY);
    if (sx < -32 || sx > W + 32 || sy < -32 || sy > H + 32) continue;

    const lifeRatio = Math.max(0, Math.min(1, p.life / p.maxLife));
    const alpha = p.a * Math.min(1, lifeRatio * 1.6);

    if (p.kind === 'shockring') {
      const rad = Math.round(p.size + (p.maxSize - p.size) * (1 - lifeRatio));
      batch.fillRect(sx - rad, sy - rad, rad * 2, 1, p.colorHex, alpha);
      batch.fillRect(sx - rad, sy + rad, rad * 2, 1, p.colorHex, alpha);
      batch.fillRect(sx - rad, sy - rad, 1, rad * 2, p.colorHex, alpha);
      batch.fillRect(sx + rad, sy - rad, 1, rad * 2, p.colorHex, alpha);
    } else if (p.kind === 'heal') {
      batch.fillRect(sx - 1, sy - 3, 2, 6, p.colorHex, alpha);
      batch.fillRect(sx - 3, sy - 1, 6, 2, p.colorHex, alpha);
    } else {
      const sz = Math.max(1, Math.round(p.size * (0.45 + 0.55 * lifeRatio)));
      batch.fillRect(sx - Math.floor(sz / 2), sy - Math.floor(sz / 2), sz, sz, p.colorHex, alpha);
    }
  }
}

/**
 * Shared pixel-aligned world rendering pipeline used identically by both
 * `WebGL2Renderer` and `Canvas2DFallback`.
 */
export function drawWorldScene(
  batch: SceneBatcher,
  prev: RenderSnapshot,
  state: SimState,
  interpAlpha: number,
  settings: RenderSettings,
  activePalette: Palette6,
  stagePalette: StageDefinition['palette'],
  particles: ParticlePool,
  parallax: ParallaxRenderer,
  stageMeta?: StageRenderMeta,
): { camX: number; camY: number } {
  const alpha = settings.classicSnap60 ? 1 : Math.max(0, Math.min(1, interpAlpha));

  let camX = lerpClamped(prev.cameraX, state.camera.x, alpha);
  let camY = lerpClamped(prev.cameraY, state.camera.y, alpha);

  // Deterministic pixel-snapped screen shake
  if (settings.screenShake && state.camera.shakeTimer > 0) {
    const mag = state.camera.shakeIntensity;
    const sx = Math.sin(state.tick * 2.7 + 0.5) * mag;
    const sy = Math.cos(state.tick * 3.3 + 1.2) * mag;
    camX += sx;
    camY += sy;
  }

  camX = Math.round(camX);
  camY = Math.round(camY);

  // 1. Multi-layer pixel parallax background
  parallax.render(batch, {
    camX,
    camY,
    tick: state.tick,
    palette: stagePalette,
    biomeGimmick: stageMeta?.biomeGimmick ?? state.biomeGimmick,
    hasStars: stageMeta?.hasStars,
    heatHaze: stageMeta?.heatHaze,
  });

  // 2. Visible camera-culled tilemap
  const col0 = Math.max(0, Math.floor(camX / TS) - 1);
  const col1 = Math.min(state.tilesW - 1, Math.ceil((camX + W) / TS) + 1);
  const row0 = Math.max(0, Math.floor(camY / TS) - 1);
  const row1 = Math.min(state.tilesH - 1, Math.ceil((camY + H) / TS) + 1);

  for (let r = row0; r <= row1; r++) {
    const rowOff = r * state.tilesW;
    const sy = r * TS - camY;
    for (let c = col0; c <= col1; c++) {
      const tile = state.tiles[rowOff + c];
      if (tile === TileType.EMPTY || tile === TileType.CAMERA_BLOCKER) continue;
      const sx = c * TS - camX;
      // Animated / stateful tiles always render animated overlay or procedural detail
      const animatedTile =
        tile === TileType.CONVEYOR_L ||
        tile === TileType.CONVEYOR_R ||
        tile === TileType.ELECTRIC_RAIL ||
        tile === TileType.TOGGLE_A ||
        tile === TileType.TOGGLE_B ||
        tile === TileType.PROXIMITY_SOLID;
      const atlasTile = animatedTile ? null : batch.resolveTileRegion(state.stageId, tile);
      if (atlasTile) {
        batch.drawAtlas(atlasTile, sx, sy, TS, TS, false, 1, 0, false, false);
      } else {
        drawProceduralTile(batch, tile, sx, sy, c, r, state, stagePalette);
      }
    }
  }

  // 3. Props & interactive world objects
  drawProps(batch, state, camX, camY);

  // 4. Pickups
  drawPickups(batch, state, camX, camY);

  // 5. Enemies
  drawEnemies(batch, prev, state, alpha, camX, camY);

  // 6. Boss & Telegraph indicators
  drawBoss(batch, prev, state, alpha, camX, camY);

  // 7. Player interpolated coordinates + Hookshot + Scarf + Volt sprite
  const px = lerpClamped(prev.playerX, state.player.x, alpha);
  const py = lerpClamped(prev.playerY, state.player.y, alpha);

  drawHookshotAndReticle(batch, prev, state, alpha, settings, activePalette, px, py, camX, camY);
  drawScarf(batch, state.player, activePalette, camX, camY);
  drawPlayer(batch, state, activePalette, px, py, camX, camY);

  // 8. Projectiles
  drawProjectiles(batch, prev, state, alpha, camX, camY);

  // 9. Preallocated Particle Pool
  drawParticles(batch, particles, camX, camY);

  return { camX, camY };
}

// ============================================================================
// Canvas2DFallback — Crisp Pixel-Perfect Software 2D Implementation
// ============================================================================

export class Canvas2DFallback implements GameRenderer {
  public readonly backend = 'canvas2d' as const;

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private atlasCanvas: HTMLCanvasElement | null = null;
  private sourcePalette: Palette6 = DEFAULT_PALETTE_KEY_COLORS;
  private readonly lookup = new RegionLookup();
  private readonly customOverrides = new Map<string, HTMLImageElement>();
  private readonly paletteAtlasCache = new Map<string, HTMLCanvasElement>();
  private readonly particles = new ParticlePool();
  private readonly parallax = new ParallaxRenderer();
  private readonly hud = new HudRenderer();
  private lastScaleMode: ScaleMode | null = null;
  private lastTickSeen = -1;

  // Reusable batcher state bound once to avoid per-frame closures
  private currentPalette: Palette6 = DEFAULT_PALETTE_KEY_COLORS;
  private readonly batcher: SceneBatcher;

  constructor() {
    this.batcher = {
      fillRect: (x, y, w, h, hexColor, alpha = 1, flash = 0) => {
        const ctx = this.ctx;
        if (!ctx || alpha <= 0) return;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = flash >= 0.8 ? '#ffffff' : hexColor;
        ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
        ctx.globalAlpha = 1;
      },
      drawAtlas: (region, dx, dy, dw, dh, flipX, alpha, flash, paletteSwap) => {
        const ctx = this.ctx;
        if (!ctx || !this.atlasCanvas || alpha <= 0) return;
        const srcCanvas = paletteSwap
          ? this.getRecoloredAtlas(this.currentPalette)
          : this.atlasCanvas;
        const rx = Math.round(dx);
        const ry = Math.round(dy);
        const rw = Math.round(dw);
        const rh = Math.round(dh);

        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.globalAlpha = alpha;
        if (flipX) {
          ctx.translate(rx + rw, ry);
          ctx.scale(-1, 1);
          ctx.drawImage(srcCanvas, region.x, region.y, region.w, region.h, 0, 0, rw, rh);
        } else {
          ctx.drawImage(srcCanvas, region.x, region.y, region.w, region.h, rx, ry, rw, rh);
        }
        if (flash > 0.35) {
          ctx.globalCompositeOperation = 'source-atop';
          ctx.fillStyle = `rgba(255,255,255,${Math.min(1, flash)})`;
          ctx.fillRect(flipX ? 0 : rx, flipX ? 0 : ry, rw, rh);
        }
        ctx.restore();
      },
      drawCustom: (key, dx, dy, dw, dh, flipX, alpha, flash) => {
        const ctx = this.ctx;
        const img = this.customOverrides.get(key);
        if (!ctx || !img || !img.complete || alpha <= 0) return;
        const rx = Math.round(dx);
        const ry = Math.round(dy);
        const rw = Math.round(dw);
        const rh = Math.round(dh);
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.globalAlpha = alpha;
        if (flipX) {
          ctx.translate(rx + rw, ry);
          ctx.scale(-1, 1);
          ctx.drawImage(img, 0, 0, rw, rh);
        } else {
          ctx.drawImage(img, rx, ry, rw, rh);
        }
        if (flash > 0.35) {
          ctx.fillStyle = 'rgba(255,255,255,0.65)';
          ctx.fillRect(flipX ? 0 : rx, flipX ? 0 : ry, rw, rh);
        }
        ctx.restore();
      },
      resolveRegion: (key) => this.lookup.get(key),
      resolveTileRegion: (stageId, tileType) => this.lookup.getTile(stageId, tileType),
      hasCustomOverride: (key) => {
        const img = this.customOverrides.get(key);
        return Boolean(img && img.complete && img.naturalWidth > 0);
      },
    };
  }

  public init(
    canvas: HTMLCanvasElement,
    atlasCanvas: HTMLCanvasElement | null,
    atlasRegions: Record<string, AtlasRect>,
    sourcePalette?: Palette6,
  ): void {
    this.canvas = canvas;
    canvas.width = W;
    canvas.height = H;
    this.ctx = canvas.getContext('2d', { alpha: false });
    if (this.ctx) {
      this.ctx.imageSmoothingEnabled = false;
    }
    this.atlasCanvas = atlasCanvas;
    this.lookup.setRegions(atlasRegions);
    if (sourcePalette) {
      this.sourcePalette = sourcePalette;
    }
    this.paletteAtlasCache.clear();
  }

  public setAtlas(
    atlasCanvas: HTMLCanvasElement | null,
    atlasRegions: Record<string, AtlasRect>,
  ): void {
    this.atlasCanvas = atlasCanvas;
    this.lookup.setRegions(atlasRegions);
    this.paletteAtlasCache.clear();
  }

  public setSourcePalette(palette: Palette6): void {
    this.sourcePalette = palette;
    this.paletteAtlasCache.clear();
  }

  public setCustomSpriteOverride(key: string, img: HTMLImageElement | null): void {
    if (!img) {
      this.customOverrides.delete(key);
    } else {
      this.customOverrides.set(key, img);
    }
  }

  public triggerBossIntro(name: string, title: string): void {
    this.hud.triggerBossIntro(name, title);
  }

  public spawnEventParticles(event: SimEvent): void {
    if (event.type === 'bossIntro') {
      this.hud.triggerBossIntro(event.name, event.title);
      return;
    }
    this.particles.spawnFromEvent(event);
  }

  private getRecoloredAtlas(targetPalette: Palette6): HTMLCanvasElement {
    const base = this.atlasCanvas!;
    const key = targetPalette.join(',');
    const cached = this.paletteAtlasCache.get(key);
    if (cached) return cached;

    if (typeof document === 'undefined') return base;
    const copy = document.createElement('canvas');
    copy.width = base.width;
    copy.height = base.height;
    const cctx = copy.getContext('2d');
    if (!cctx) return base;

    cctx.drawImage(base, 0, 0);
    try {
      const imgData = cctx.getImageData(0, 0, copy.width, copy.height);
      const data = imgData.data;
      const srcRgb = this.sourcePalette.map((h) => {
        const f = parseHexColor(h);
        return [Math.round(f.r * 255), Math.round(f.g * 255), Math.round(f.b * 255)] as const;
      });
      const dstRgb = targetPalette.map((h) => {
        const f = parseHexColor(h);
        return [Math.round(f.r * 255), Math.round(f.g * 255), Math.round(f.b * 255)] as const;
      });

      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 10) continue;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        for (let p = 0; p < 6; p++) {
          if (
            Math.abs(r - srcRgb[p][0]) <= 8 &&
            Math.abs(g - srcRgb[p][1]) <= 8 &&
            Math.abs(b - srcRgb[p][2]) <= 8
          ) {
            data[i] = dstRgb[p][0];
            data[i + 1] = dstRgb[p][1];
            data[i + 2] = dstRgb[p][2];
            break;
          }
        }
      }
      cctx.putImageData(imgData, 0, 0);
    } catch {
      return base;
    }

    this.paletteAtlasCache.set(key, copy);
    return copy;
  }

  public render(
    prev: RenderSnapshot,
    state: SimState,
    interpAlpha: number,
    settings: RenderSettings,
    activePalette: Palette6,
    stagePalette: StageDefinition['palette'],
    stageMeta?: StageRenderMeta,
    activeModality: InputModality = 'keyboard',
    fps?: number,
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;

    if (this.canvas && this.lastScaleMode !== settings.scaleMode) {
      applyCanvasScale(this.canvas, settings.scaleMode);
      this.lastScaleMode = settings.scaleMode;
    }

    // Step particles in lockstep with sim tick delta (smooth across 30/60/120 FPS)
    const tickDelta =
      this.lastTickSeen >= 0 ? Math.max(0, Math.min(4, state.tick - this.lastTickSeen)) : 1;
    this.lastTickSeen = state.tick;
    if (tickDelta > 0) {
      this.particles.update(tickDelta);
    }

    this.currentPalette = activePalette;
    ctx.imageSmoothingEnabled = false;

    drawWorldScene(
      this.batcher,
      prev,
      state,
      interpAlpha,
      settings,
      activePalette,
      stagePalette,
      this.particles,
      this.parallax,
      stageMeta,
    );

    // Lightweight Canvas2D heat-haze shimmer bands for Optic Solar Relay
    if (stageMeta?.heatHaze) {
      ctx.fillStyle = '#ffe599';
      for (let y = 72; y < H; y += 14) {
        const wave = Math.round(Math.sin(y * 0.25 + state.tick * 0.18) * 6);
        ctx.globalAlpha = 0.05;
        ctx.fillRect(wave, y, W, 2);
      }
      ctx.globalAlpha = 1;
    }

    // Subtle Boss Desperation edge flash
    if (state.boss && state.boss.desperationBannerTicks > 0) {
      const pulse = (state.tick & 4) !== 0 ? 0.16 : 0.06;
      ctx.fillStyle = '#ff2a4b';
      ctx.globalAlpha = pulse;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }

    // Crisp 400x240 In-Canvas Pixel HUD
    this.hud.render(this.batcher, {
      state,
      settings,
      activePalette,
      activeModality,
      fps,
      bossIntroTitle: stageMeta?.bossTitle,
    });
  }

  public dispose(): void {
    this.particles.clear();
    this.paletteAtlasCache.clear();
    this.customOverrides.clear();
    this.ctx = null;
    this.canvas = null;
    this.atlasCanvas = null;
  }
}
