// ============================================================================
// Krunked Circuit — Preallocated Particle Pool (512 Fixed Slots, Zero GC)
// Handles sparks, dust, hit flashes, armor shards, heals, explosions,
// burst diamonds, and expanding shockrings at 30/60/120 FPS.
// ============================================================================

import type { SimEvent } from '../contracts/index';
import { parseHexColor } from './shaders';

export const PARTICLE_POOL_CAPACITY = 512;

export type ParticleKind =
  | 'spark'
  | 'dust'
  | 'burst'
  | 'hit'
  | 'shard'
  | 'heal'
  | 'explosion'
  | 'shockring';

export interface ParticleSlot {
  active: boolean;
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  drag: number;
  size: number;
  maxSize: number;
  life: number;
  maxLife: number;
  r: number;
  g: number;
  b: number;
  a: number;
  colorHex: string;
}

export interface ParticleSpawnOptions {
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity?: number;
  drag?: number;
  size?: number;
  maxSize?: number;
  life: number;
  colorHex: string;
  alpha?: number;
}

export class ParticlePool {
  public readonly slots: readonly ParticleSlot[];
  private readonly mutableSlots: ParticleSlot[];
  private cursor = 0;
  private rng = 0x9e3779b9;
  private _activeCount = 0;

  constructor(capacity: number = PARTICLE_POOL_CAPACITY) {
    const arr: ParticleSlot[] = new Array(capacity);
    for (let i = 0; i < capacity; i++) {
      arr[i] = {
        active: false,
        kind: 'spark',
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        gravity: 0,
        drag: 1,
        size: 2,
        maxSize: 2,
        life: 0,
        maxLife: 1,
        r: 1,
        g: 1,
        b: 1,
        a: 1,
        colorHex: '#ffffff',
      };
    }
    this.mutableSlots = arr;
    this.slots = arr;
  }

  public get activeCount(): number {
    return this._activeCount;
  }

  public clear(): void {
    for (let i = 0; i < this.mutableSlots.length; i++) {
      this.mutableSlots[i].active = false;
    }
    this._activeCount = 0;
    this.cursor = 0;
  }

  private rand(): number {
    // Fast xorshift32 strictly for purely visual particle scatter
    let x = this.rng | 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rng = x;
    return ((x >>> 0) % 10000) / 10000;
  }

  private acquireSlot(): ParticleSlot {
    const len = this.mutableSlots.length;
    for (let i = 0; i < len; i++) {
      const idx = (this.cursor + i) % len;
      const slot = this.mutableSlots[idx];
      if (!slot.active) {
        this.cursor = (idx + 1) % len;
        return slot;
      }
    }
    // Pool full: recycle oldest at cursor
    const slot = this.mutableSlots[this.cursor];
    this.cursor = (this.cursor + 1) % len;
    return slot;
  }

  public spawn(opts: ParticleSpawnOptions): void {
    const slot = this.acquireSlot();
    const wasActive = slot.active;
    const c = parseHexColor(opts.colorHex);
    slot.active = true;
    slot.kind = opts.kind;
    slot.x = opts.x;
    slot.y = opts.y;
    slot.vx = opts.vx;
    slot.vy = opts.vy;
    slot.gravity = opts.gravity ?? 0;
    slot.drag = opts.drag ?? 0.96;
    slot.size = opts.size ?? 2;
    slot.maxSize = opts.maxSize ?? slot.size;
    slot.life = opts.life;
    slot.maxLife = opts.life > 0 ? opts.life : 1;
    slot.r = c.r;
    slot.g = c.g;
    slot.b = c.b;
    slot.a = opts.alpha ?? c.a;
    slot.colorHex = opts.colorHex;
    if (!wasActive) {
      this._activeCount++;
    }
  }

  public spawnTrail(
    x: number,
    y: number,
    vx: number,
    vy: number,
    colorHex: string,
    size = 2,
    life = 10,
  ): void {
    this.spawn({
      kind: 'dust',
      x,
      y,
      vx,
      vy,
      gravity: 0,
      drag: 0.9,
      size,
      life,
      colorHex,
      alpha: 0.78,
    });
  }

  public spawnFromEvent(event: SimEvent): void {
    if (event.type === 'particle') {
      const count = Math.min(Math.max(event.count, 1), 36);
      const baseVx = event.vx ?? 0;
      const baseVy = event.vy ?? 0;
      const color = event.color || '#ffffff';

      switch (event.kind) {
        case 'spark': {
          for (let i = 0; i < count; i++) {
            const ang = this.rand() * Math.PI * 2;
            const spd = 1.0 + this.rand() * 2.8;
            this.spawn({
              kind: 'spark',
              x: event.x + (this.rand() - 0.5) * 3,
              y: event.y + (this.rand() - 0.5) * 3,
              vx: baseVx + Math.cos(ang) * spd,
              vy: baseVy + Math.sin(ang) * spd - 0.6,
              gravity: 0.12,
              drag: 0.94,
              size: this.rand() > 0.45 ? 2 : 1,
              life: 12 + Math.floor(this.rand() * 14),
              colorHex: i % 3 === 0 ? '#ffffff' : color,
            });
          }
          break;
        }
        case 'dust': {
          for (let i = 0; i < count; i++) {
            this.spawn({
              kind: 'dust',
              x: event.x + (this.rand() - 0.5) * 8,
              y: event.y + (this.rand() - 0.5) * 3,
              vx: baseVx + (this.rand() - 0.5) * 1.4,
              vy: baseVy - 0.25 - this.rand() * 0.9,
              gravity: -0.015,
              drag: 0.92,
              size: 2 + Math.floor(this.rand() * 2),
              life: 14 + Math.floor(this.rand() * 12),
              colorHex: color,
              alpha: 0.72,
            });
          }
          break;
        }
        case 'hit': {
          // Crisp central impact flash + radial white/colored sparks
          this.spawn({
            kind: 'shockring',
            x: event.x,
            y: event.y,
            vx: 0,
            vy: 0,
            gravity: 0,
            drag: 1,
            size: 3,
            maxSize: 13,
            life: 8,
            colorHex: '#ffffff',
          });
          for (let i = 0; i < count; i++) {
            const ang = (i / count) * Math.PI * 2 + (this.rand() - 0.5) * 0.45;
            const spd = 1.6 + this.rand() * 3.0;
            this.spawn({
              kind: 'hit',
              x: event.x,
              y: event.y,
              vx: baseVx + Math.cos(ang) * spd,
              vy: baseVy + Math.sin(ang) * spd,
              gravity: 0.05,
              drag: 0.89,
              size: i % 2 === 0 ? 3 : 2,
              life: 8 + Math.floor(this.rand() * 10),
              colorHex: i % 3 === 0 ? '#ffffff' : color,
            });
          }
          break;
        }
        case 'shard': {
          for (let i = 0; i < count; i++) {
            const ang = -Math.PI * 0.15 - this.rand() * Math.PI * 0.7;
            const spd = 1.2 + this.rand() * 3.2;
            this.spawn({
              kind: 'shard',
              x: event.x + (this.rand() - 0.5) * 6,
              y: event.y + (this.rand() - 0.5) * 6,
              vx: baseVx + Math.cos(ang) * spd,
              vy: baseVy + Math.sin(ang) * spd - 0.8,
              gravity: 0.2,
              drag: 0.98,
              size: 3,
              life: 20 + Math.floor(this.rand() * 18),
              colorHex: i % 4 === 0 ? '#e6f6ff' : color,
            });
          }
          break;
        }
        case 'burst': {
          this.spawn({
            kind: 'shockring',
            x: event.x,
            y: event.y,
            vx: 0,
            vy: 0,
            size: 4,
            maxSize: 28,
            life: 16,
            colorHex: color,
          });
          for (let i = 0; i < count; i++) {
            const ang = (i / count) * Math.PI * 2 + this.rand() * 0.3;
            const spd = 1.4 + this.rand() * 3.4;
            this.spawn({
              kind: 'burst',
              x: event.x,
              y: event.y,
              vx: baseVx + Math.cos(ang) * spd,
              vy: baseVy + Math.sin(ang) * spd,
              gravity: -0.02,
              drag: 0.93,
              size: 3,
              life: 16 + Math.floor(this.rand() * 14),
              colorHex: i % 2 === 0 ? color : '#ffffff',
            });
          }
          break;
        }
        case 'heal': {
          for (let i = 0; i < count; i++) {
            this.spawn({
              kind: 'heal',
              x: event.x + (this.rand() - 0.5) * 14,
              y: event.y + (this.rand() - 0.5) * 10,
              vx: (this.rand() - 0.5) * 0.4,
              vy: -0.7 - this.rand() * 0.9,
              gravity: -0.01,
              drag: 0.98,
              size: 3,
              life: 22 + Math.floor(this.rand() * 14),
              colorHex: color || '#4dff9b',
            });
          }
          break;
        }
        case 'explosion': {
          this.spawn({
            kind: 'shockring',
            x: event.x,
            y: event.y,
            vx: 0,
            vy: 0,
            size: 5,
            maxSize: 26,
            life: 14,
            colorHex: '#fff3a1',
          });
          for (let i = 0; i < count; i++) {
            const ang = this.rand() * Math.PI * 2;
            const spd = 0.8 + this.rand() * 3.4;
            const palettePick =
              i % 4 === 0 ? '#ffffff' : i % 4 === 1 ? '#ffe15a' : i % 4 === 2 ? color : '#ff5238';
            this.spawn({
              kind: 'explosion',
              x: event.x + (this.rand() - 0.5) * 6,
              y: event.y + (this.rand() - 0.5) * 6,
              vx: baseVx + Math.cos(ang) * spd,
              vy: baseVy + Math.sin(ang) * spd - 0.4,
              gravity: 0.06,
              drag: 0.91,
              size: 3 + Math.floor(this.rand() * 3),
              life: 14 + Math.floor(this.rand() * 16),
              colorHex: palettePick,
            });
          }
          break;
        }
        case 'shockring': {
          this.spawn({
            kind: 'shockring',
            x: event.x,
            y: event.y,
            vx: baseVx,
            vy: baseVy,
            gravity: 0,
            drag: 0.98,
            size: 4,
            maxSize: 24 + Math.min(count * 2, 24),
            life: 14,
            colorHex: color,
          });
          break;
        }
      }
      return;
    }

    if (event.type === 'checkpoint') {
      this.spawn({
        kind: 'shockring',
        x: event.x,
        y: event.y - 8,
        vx: 0,
        vy: 0,
        size: 4,
        maxSize: 26,
        life: 18,
        colorHex: '#4dffb5',
      });
      for (let i = 0; i < 12; i++) {
        this.spawn({
          kind: 'burst',
          x: event.x + (this.rand() - 0.5) * 10,
          y: event.y - this.rand() * 14,
          vx: (this.rand() - 0.5) * 1.1,
          vy: -1.1 - this.rand() * 1.4,
          gravity: -0.02,
          drag: 0.96,
          size: 2,
          life: 20 + Math.floor(this.rand() * 12),
          colorHex: i % 2 === 0 ? '#4dffb5' : '#ffffff',
        });
      }
    }
  }

  /**
   * Advances active particles by `dtSteps` (1.0 = one 60 Hz frame, 0.5 = 120 FPS frame, 2.0 = 30 FPS frame).
   */
  public update(dtSteps = 1.0): void {
    const step = dtSteps > 0 ? Math.min(dtSteps, 3.0) : 0;
    if (step === 0 || this._activeCount === 0) return;

    let alive = 0;
    const slots = this.mutableSlots;
    for (let i = 0; i < slots.length; i++) {
      const p = slots[i];
      if (!p.active) continue;

      p.life -= step;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }

      const dragFactor = p.drag === 1 ? 1 : Math.pow(p.drag, step);
      p.vx *= dragFactor;
      p.vy = p.vy * dragFactor + p.gravity * step;
      p.x += p.vx * step;
      p.y += p.vy * step;
      alive++;
    }
    this._activeCount = alive;
  }
}
