import {
  BOSS_CONSTANTS,
  DAMAGE_TABLES,
  ENGINE_CONSTANTS,
  type BossEntity,
  type BossId,
  type Difficulty,
  type DifficultyDamageTable,
  type ProjectileEntity,
  type SimState,
} from '../contracts/index';
import { getBossDefinition, getStageDefinition } from '../data/index';
import { spawnEnemyFromArchetype } from './enemies';
import { nextRng } from './prng';

export interface BossSimCallbacks {
  damagePlayer: (state: SimState, damage: number, sourceX: number) => void;
  spawnProjectile: (
    state: SimState,
    spec: Omit<ProjectileEntity, 'id' | 'hitIds'>,
  ) => void;
  onBossDefeated: (state: SimState, boss: BossEntity) => void;
}

const CELL_PX_W = ENGINE_CONSTANTS.GAME_WIDTH;
const CELL_PX_H = ENGINE_CONSTANTS.GAME_HEIGHT;
const TILE = ENGINE_CONSTANTS.TILE_SIZE;
const GRAVITY = 0.25;

function aabbOverlap(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function clampBossToArena(boss: BossEntity): {
  hitLeft: boolean;
  hitRight: boolean;
  grounded: boolean;
} {
  let hitLeft = false;
  let hitRight = false;
  let grounded = false;

  if (!Number.isFinite(boss.x)) boss.x = (boss.arenaLeft + boss.arenaRight) * 0.5;
  if (!Number.isFinite(boss.y)) boss.y = boss.arenaBottom - boss.h;
  if (!Number.isFinite(boss.vx)) boss.vx = 0;
  if (!Number.isFinite(boss.vy)) boss.vy = 0;

  if (boss.x < boss.arenaLeft) {
    boss.x = boss.arenaLeft;
    hitLeft = true;
  } else if (boss.x + boss.w > boss.arenaRight) {
    boss.x = boss.arenaRight - boss.w;
    hitRight = true;
  }

  if (boss.y < boss.arenaTop) {
    boss.y = boss.arenaTop;
    if (boss.vy < 0) boss.vy = 0;
  } else if (boss.y + boss.h >= boss.arenaBottom) {
    boss.y = boss.arenaBottom - boss.h;
    if (boss.vy > 0) boss.vy = 0;
    grounded = true;
  }

  return { hitLeft, hitRight, grounded };
}

export function createBossEntity(
  bossId: BossId,
  x: number,
  y: number,
  arenaLeft: number,
  arenaRight: number,
  arenaTop: number,
  arenaBottom: number,
  entityId: number,
  difficulty: Difficulty,
  rudeEnemies: boolean,
): BossEntity {
  const def = getBossDefinition(bossId);
  const hardBoost = difficulty === 'hard' && rudeEnemies && !def.isFinal;
  const maxHp = hardBoost ? BOSS_CONSTANTS.FINAL_HP : def.baseHp;
  const desperationHp = hardBoost ? BOSS_CONSTANTS.FINAL_DESPERATION_HP : def.desperationHp;

  return {
    id: entityId,
    bossId: def.id,
    name: def.name,
    x,
    y,
    vx: 0,
    vy: 0,
    w: def.width,
    h: def.height,
    facing: -1,
    hp: maxHp,
    maxHp,
    desperationHp,
    phase: 1,
    desperationTriggered: false,
    desperationBannerTicks: 0,
    aiState: 'idle',
    aiTimer: 0,
    patternIndex: 0,
    mimicIndex: 0,
    hurtFlash: 0,
    techRecoverTimer: 0,
    launchHits: 0,
    invulnTimer: 0,
    active: false,
    defeated: false,
    arenaLeft,
    arenaRight,
    arenaTop,
    arenaBottom,
    partsHp: def.id === 'overlord_apex' ? [16, 16, maxHp] : [0, 0, maxHp],
  };
}

function ensureBossArenaBounds(state: SimState, boss: BossEntity): { cellX: number; cellY: number } {
  const stage = getStageDefinition(state.stageId, state.remix);
  const cellX = stage.bossCellX;
  const cellY = stage.bossCellY;
  if (boss.arenaRight <= boss.arenaLeft || boss.arenaBottom <= boss.arenaTop) {
    boss.arenaLeft = cellX * CELL_PX_W + TILE;
    boss.arenaRight = (cellX + 1) * CELL_PX_W - TILE;
    boss.arenaTop = cellY * CELL_PX_H + TILE * 2;
    boss.arenaBottom = (cellY + 1) * CELL_PX_H - TILE * 2;
  }
  return { cellX, cellY };
}

function emitTelegraphSpark(state: SimState, x: number, y: number, color: string): void {
  state.events.push({
    type: 'particle',
    kind: 'spark',
    x,
    y,
    color,
    count: 6,
  });
}

// ============================================================================
// 1. SIEGE TREAD (Opening) — Tread Ram, Mortar Lob, Twin Turret, Desp Triple Barrage
// ============================================================================
function updateSiegeTread(
  state: SimState,
  boss: BossEntity,
  cb: BossSimCallbacks,
  t: DifficultyDamageTable,
): void {
  const pCx = state.player.x + state.player.w * 0.5;
  const bCx = boss.x + boss.w * 0.5;
  const bCy = boss.y + boss.h * 0.5;
  const p2 = boss.phase >= 2;

  boss.vy += GRAVITY;
  boss.x += boss.vx;
  boss.y += boss.vy;
  const bounds = clampBossToArena(boss);

  if (boss.aiState === 'desperation') {
    boss.vx = 0;
    boss.facing = pCx >= bCx ? 1 : -1;
    boss.aiTimer -= 1;
    // Desperation Triple Barrage (fires cleanly under both 45t and 75t desperation timers)
    if (boss.aiTimer === 38 || boss.aiTimer === 24 || boss.aiTimer === 10) {
      const waveIdx = boss.aiTimer === 38 ? 0 : boss.aiTimer === 24 ? 1 : 2;
      const spreadVx = (2.2 + waveIdx * 1.1) * boss.facing;
      cb.spawnProjectile(state, {
        owner: 'boss',
        kind: 'shockwave',
        x: bCx - 6,
        y: boss.y + 4,
        vx: spreadVx,
        vy: -4.8,
        w: 10,
        h: 10,
        damage: t.explosion,
        ttl: 110,
        pierce: false,
        bouncesLeft: 1,
        color: '#ff6b4a',
      });
      cb.spawnProjectile(state, {
        owner: 'boss',
        kind: 'laser_beam',
        x: bCx + boss.facing * 20 - 6,
        y: bCy - 4,
        vx: boss.facing * (4.0 + waveIdx * 0.5),
        vy: (waveIdx - 1) * 0.7,
        w: 12,
        h: 6,
        damage: t.mediumProjectile,
        ttl: 95,
        pierce: false,
        bouncesLeft: 0,
        color: '#fbbf24',
      });
      if (waveIdx === 2) {
        for (const dir of [-1, 1] as const) {
          cb.spawnProjectile(state, {
            owner: 'boss',
            kind: 'shockwave',
            x: bCx - 7,
            y: boss.arenaBottom - 14,
            vx: dir * 4.2,
            vy: 0,
            w: 14,
            h: 14,
            damage: t.mediumProjectile,
            ttl: 90,
            pierce: true,
            bouncesLeft: 0,
            color: '#ff4d6d',
          });
        }
      }
      state.events.push({ type: 'sfx', key: 'burst', gain: 0.85 });
    }
    if (boss.aiTimer <= 0) {
      boss.aiState = 'telegraph';
      boss.patternIndex = 0;
      boss.aiTimer = 20;
    }
    return;
  }

  if (boss.aiState === 'idle') {
    boss.vx *= 0.8;
    boss.facing = pCx >= bCx ? 1 : -1;
    boss.aiTimer -= 1;
    if (boss.aiTimer <= 0) {
      boss.aiState = 'telegraph';
      boss.aiTimer = p2 ? 20 : 26;
      emitTelegraphSpark(state, bCx, bCy, '#fbbf24');
    }
    return;
  }

  if (boss.aiState === 'telegraph') {
    boss.vx = 0;
    boss.facing = pCx >= bCx ? 1 : -1;
    boss.aiTimer -= 1;
    if (boss.aiTimer % 6 === 0) {
      state.events.push({
        type: 'particle',
        kind: 'dust',
        x: bCx - boss.facing * 18,
        y: boss.y + boss.h - 2,
        color: '#f07167',
        count: 2,
      });
    }
    if (boss.aiTimer <= 0) {
      boss.aiState = 'attack';
      const pat = boss.patternIndex % (p2 ? 4 : 3);
      if (pat === 0) {
        boss.vx = boss.facing * (p2 ? 6.2 : 4.9);
        boss.aiTimer = 78;
        state.events.push({ type: 'sfx', key: 'sprint_kick', gain: 0.9 });
      } else if (pat === 1) {
        boss.vx = 0;
        boss.aiTimer = p2 ? 52 : 44;
      } else if (pat === 2) {
        boss.vx = 0;
        boss.aiTimer = p2 ? 46 : 36;
      } else {
        // P2 Pattern 3: Triple Siege Barrage
        boss.vx = 0;
        boss.aiTimer = 50;
      }
    }
    return;
  }

  if (boss.aiState === 'attack') {
    const pat = boss.patternIndex % (p2 ? 4 : 3);
    boss.aiTimer -= 1;

    if (pat === 0) {
      if ((boss.facing > 0 && bounds.hitRight) || (boss.facing < 0 && bounds.hitLeft)) {
        boss.vx = 0;
        state.events.push(
          { type: 'sfx', key: 'heavy_hit' },
          { type: 'shake', ticks: 10, intensity: 3 },
        );
        const waveDir = bounds.hitRight ? -1 : 1;
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'shockwave',
          x: bCx - 8,
          y: boss.arenaBottom - 14,
          vx: waveDir * (p2 ? 4.5 : 3.4),
          vy: 0,
          w: 14,
          h: 14,
          damage: t.mediumProjectile,
          ttl: 95,
          pierce: true,
          bouncesLeft: 0,
          color: '#ff7b3a',
        });
        boss.aiState = 'recover';
        boss.aiTimer = p2 ? 22 : 30;
        boss.patternIndex += 1;
        return;
      }
      if (boss.aiTimer <= 0) {
        boss.vx = 0;
        boss.aiState = 'recover';
        boss.aiTimer = 24;
        boss.patternIndex += 1;
      }
    } else if (pat === 1) {
      const fireEvery = p2 ? 11 : 14;
      if (boss.aiTimer % fireEvery === 0) {
        const idx = Math.floor(boss.aiTimer / fireEvery);
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'enemy_shot',
          x: bCx - 5,
          y: boss.y + 4,
          vx: (2.0 + idx * 0.75) * boss.facing,
          vy: -4.2,
          w: 10,
          h: 10,
          damage: t.explosion,
          ttl: 95,
          pierce: false,
          bouncesLeft: 1,
          color: '#fbbf24',
        });
        state.events.push({ type: 'sfx', key: 'throw', gain: 0.75 });
      }
      if (boss.aiTimer <= 0) {
        boss.aiState = 'recover';
        boss.aiTimer = p2 ? 22 : 28;
        boss.patternIndex += 1;
      }
    } else if (pat === 2) {
      if (boss.aiTimer === 28 || (p2 && boss.aiTimer === 12)) {
        const speed = p2 ? 4.2 : 3.4;
        for (const a of [-0.28, 0, 0.28]) {
          cb.spawnProjectile(state, {
            owner: 'boss',
            kind: 'enemy_shot',
            x: bCx + boss.facing * 20 - 4,
            y: bCy - 4,
            vx: boss.facing * Math.cos(a) * speed,
            vy: Math.sin(a) * speed,
            w: 8,
            h: 8,
            damage: t.lightProjectile,
            ttl: 110,
            pierce: false,
            bouncesLeft: 0,
            color: '#ff4d6d',
          });
        }
        state.events.push({ type: 'sfx', key: 'jab', gain: 0.8 });
      }
      if (boss.aiTimer <= 0) {
        boss.aiState = 'recover';
        boss.aiTimer = p2 ? 22 : 28;
        boss.patternIndex += 1;
      }
    } else {
      // P2 Triple Barrage: mortar + turret fan + shockwave
      if (boss.aiTimer === 40 || boss.aiTimer === 24 || boss.aiTimer === 8) {
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'enemy_shot',
          x: bCx - 5,
          y: boss.y + 4,
          vx: boss.facing * (2.5 + (40 - boss.aiTimer) * 0.05),
          vy: -4.4,
          w: 10,
          h: 10,
          damage: t.explosion,
          ttl: 95,
          pierce: false,
          bouncesLeft: 1,
          color: '#fbbf24',
        });
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'shockwave',
          x: bCx + boss.facing * 18 - 6,
          y: boss.arenaBottom - 14,
          vx: boss.facing * 4.4,
          vy: 0,
          w: 12,
          h: 14,
          damage: t.mediumProjectile,
          ttl: 85,
          pierce: true,
          bouncesLeft: 0,
          color: '#ff4d6d',
        });
        state.events.push({ type: 'sfx', key: 'burst', gain: 0.8 });
      }
      if (boss.aiTimer <= 0) {
        boss.aiState = 'recover';
        boss.aiTimer = 24;
        boss.patternIndex += 1;
      }
    }
    return;
  }

  if (boss.aiState === 'recover') {
    boss.vx *= 0.82;
    boss.aiTimer -= 1;
    if (boss.aiTimer <= 0) {
      boss.aiState = 'idle';
      boss.aiTimer = p2 ? 10 : 16;
    }
  }
}

// ============================================================================
// 2. PRISM (Optic) — Solar Dash Slash, Bounce Darts, Vertical Lasers, Desp Solar Cage
// ============================================================================
function updatePrismBoss(
  state: SimState,
  boss: BossEntity,
  cb: BossSimCallbacks,
  t: DifficultyDamageTable,
): void {
  const pCx = state.player.x + state.player.w * 0.5;
  const bCx = boss.x + boss.w * 0.5;
  const bCy = boss.y + boss.h * 0.5;
  const centerX = (boss.arenaLeft + boss.arenaRight) * 0.5 - boss.w * 0.5;
  const hoverTopY = boss.arenaTop + 22;
  const p2 = boss.phase >= 2;

  if (boss.aiState === 'desperation') {
    // Desperation Solar Cage: hover center, drop vertical cage beams + crisscross fan!
    boss.x += (centerX - boss.x) * 0.16;
    boss.y += (hoverTopY - boss.y) * 0.16;
    boss.vx = 0;
    boss.vy = 0;
    clampBossToArena(boss);
    boss.aiTimer -= 1;

    if (boss.aiTimer === 40) {
      state.events.push({
        type: 'particle',
        kind: 'shockring',
        x: bCx,
        y: bCy,
        color: '#fef08a',
        count: 14,
      });
    }
    if (boss.aiTimer === 34 || boss.aiTimer === 20 || boss.aiTimer === 8) {
      const fanAngles =
        boss.aiTimer === 34
          ? [-0.6, -0.2, 0.2, 0.6]
          : boss.aiTimer === 20
            ? [-0.8, -0.4, 0, 0.4, 0.8]
            : [-0.5, 0, 0.5];
      for (const a of fanAngles) {
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'laser_beam',
          x: bCx - 5,
          y: bCy - 5,
          vx: Math.sin(a) * 4.4,
          vy: Math.cos(a) * 4.4,
          w: 10,
          h: 10,
          damage: t.mediumProjectile,
          ttl: 100,
          pierce: true,
          bouncesLeft: 1,
          color: '#ffdf5e',
        });
      }
      // Flanking vertical cage pillars
      const span = boss.arenaRight - boss.arenaLeft;
      for (const frac of [0.18, 0.82]) {
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'laser_beam',
          x: boss.arenaLeft + span * frac - 6,
          y: boss.arenaTop,
          vx: 0,
          vy: 5.2,
          w: 12,
          h: 26,
          damage: t.heavyProjectile,
          ttl: 60,
          pierce: true,
          bouncesLeft: 0,
          color: '#fff59d',
        });
      }
      state.events.push(
        { type: 'sfx', key: 'burst', gain: 0.9 },
        { type: 'shake', ticks: 8, intensity: 3 },
      );
    }
    if (boss.aiTimer <= 0) {
      boss.aiState = 'recover';
      boss.aiTimer = 22;
      boss.patternIndex = 0;
    }
    return;
  }

  const patCount = p2 ? 4 : 3;
  const currentPat = boss.patternIndex % patCount;
  const isHoverAttack = boss.aiState === 'attack' && (currentPat === 2 || currentPat === 3);

  if (!isHoverAttack) {
    boss.vy += GRAVITY;
    boss.x += boss.vx;
    boss.y += boss.vy;
    clampBossToArena(boss);
  }

  if (boss.aiState === 'idle') {
    boss.vx *= 0.8;
    boss.facing = pCx >= bCx ? 1 : -1;
    boss.aiTimer -= 1;
    if (boss.aiTimer <= 0) {
      boss.aiState = 'telegraph';
      boss.aiTimer = p2 ? 18 : 24;
      emitTelegraphSpark(state, bCx, bCy - 6, '#fef08a');
    }
    return;
  }

  if (boss.aiState === 'telegraph') {
    boss.vx = 0;
    boss.facing = pCx >= bCx ? 1 : -1;
    boss.aiTimer -= 1;
    if (boss.aiTimer <= 0) {
      boss.aiState = 'attack';
      if (currentPat === 0) {
        // Solar Dash Slash
        boss.vx = boss.facing * (p2 ? 6.4 : 5.4);
        boss.aiTimer = 34;
        state.events.push({ type: 'sfx', key: 'sprint_kick' });
      } else if (currentPat === 1) {
        // Prism Bounce Darts
        boss.vy = -5.6;
        boss.vx = (centerX - boss.x) * 0.04;
        boss.aiTimer = 46;
      } else if (currentPat === 2) {
        // Vertical Laser Beams
        boss.vx = 0;
        boss.vy = 0;
        boss.aiTimer = p2 ? 54 : 44;
      } else {
        // P2 Solar Refraction Sweep
        boss.vx = 0;
        boss.vy = 0;
        boss.aiTimer = 56;
      }
    }
    return;
  }

  if (boss.aiState === 'attack') {
    boss.aiTimer -= 1;

    if (currentPat === 0) {
      if (boss.aiTimer % 9 === 0) {
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'shockwave',
          x: bCx - 5,
          y: boss.y + boss.h - 12,
          vx: 0,
          vy: -0.6,
          w: 10,
          h: 12,
          damage: t.lightProjectile,
          ttl: 24,
          pierce: true,
          bouncesLeft: 0,
          color: '#fde047',
        });
      }
      if (boss.aiTimer <= 0) {
        boss.vx = -boss.facing * 2.2;
        boss.vy = -3.8;
        boss.aiState = 'recover';
        boss.aiTimer = p2 ? 20 : 28;
        boss.patternIndex += 1;
      }
    } else if (currentPat === 1) {
      if (boss.aiTimer === 32 || boss.aiTimer === 20 || (p2 && boss.aiTimer === 10)) {
        const spread = boss.aiTimer === 32 ? -0.35 : boss.aiTimer === 20 ? 0.15 : 0.45;
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'phase_ball',
          x: bCx - 4,
          y: bCy - 4,
          vx: boss.facing * 3.5,
          vy: 1.8 + spread * 3.2,
          w: 8,
          h: 8,
          damage: t.lightProjectile,
          ttl: 130,
          pierce: false,
          bouncesLeft: 2,
          color: '#ff6b4a',
        });
        state.events.push({ type: 'sfx', key: 'bounce', gain: 0.7 });
      }
      if (boss.aiTimer <= 0) {
        boss.aiState = 'recover';
        boss.aiTimer = p2 ? 20 : 26;
        boss.patternIndex += 1;
      }
    } else if (currentPat === 2) {
      // Vertical Laser Beams dropping across arena
      boss.x += (centerX - boss.x) * 0.12;
      boss.y += (hoverTopY - boss.y) * 0.12;
      clampBossToArena(boss);
      if (boss.aiTimer === 34 || boss.aiTimer === 18 || (p2 && boss.aiTimer === 6)) {
        const offsets = boss.aiTimer === 18 ? [-96, 0, 96] : [-56, 56];
        for (const off of offsets) {
          const lx = Math.max(boss.arenaLeft + 8, Math.min(boss.arenaRight - 20, pCx + off - 6));
          cb.spawnProjectile(state, {
            owner: 'boss',
            kind: 'laser_beam',
            x: lx,
            y: boss.arenaTop,
            vx: 0,
            vy: p2 ? 5.6 : 4.6,
            w: 12,
            h: 28,
            damage: t.heavyProjectile,
            ttl: 65,
            pierce: true,
            bouncesLeft: 0,
            color: '#ffdf5e',
          });
        }
        state.events.push(
          { type: 'sfx', key: 'burst', gain: 0.85 },
          { type: 'shake', ticks: 6, intensity: 2 },
        );
      }
      if (boss.aiTimer <= 0) {
        boss.aiState = 'recover';
        boss.aiTimer = p2 ? 20 : 28;
        boss.patternIndex += 1;
      }
    } else {
      // P2 Aerial Prism Fan + Horizontal Sweep
      boss.x += (centerX - boss.x) * 0.12;
      boss.y += (hoverTopY - boss.y) * 0.12;
      clampBossToArena(boss);
      if (boss.aiTimer === 40 || boss.aiTimer === 20) {
        const flip = boss.aiTimer === 20 ? 0.2 : 0;
        for (let k = -2; k <= 2; k++) {
          const ang = k * 0.36 + flip;
          cb.spawnProjectile(state, {
            owner: 'boss',
            kind: 'enemy_shot',
            x: bCx - 4,
            y: bCy - 4,
            vx: Math.sin(ang) * 4.0,
            vy: Math.cos(ang) * 4.0,
            w: 8,
            h: 8,
            damage: t.mediumProjectile,
            ttl: 100,
            pierce: false,
            bouncesLeft: 0,
            color: '#fef08a',
          });
        }
        state.events.push({ type: 'sfx', key: 'burst', gain: 0.75 });
      }
      if (boss.aiTimer <= 0) {
        boss.aiState = 'recover';
        boss.aiTimer = 24;
        boss.patternIndex += 1;
      }
    }
    return;
  }

  if (boss.aiState === 'recover') {
    boss.vx *= 0.82;
    boss.aiTimer -= 1;
    if (boss.aiTimer <= 0) {
      boss.aiState = 'idle';
      boss.aiTimer = p2 ? 10 : 16;
    }
  }
}

// ============================================================================
// 3. STITCH (Patch) — Magnet Pull Beam, Scrap Blocks, Shock Slam, Desp Junk Cyclone
// ============================================================================
function updateStitchBoss(
  state: SimState,
  boss: BossEntity,
  cb: BossSimCallbacks,
  t: DifficultyDamageTable,
): void {
  const player = state.player;
  const pCx = player.x + player.w * 0.5;
  const bCx = boss.x + boss.w * 0.5;
  const bCy = boss.y + boss.h * 0.5;
  const centerX = (boss.arenaLeft + boss.arenaRight) * 0.5 - boss.w * 0.5;
  const p2 = boss.phase >= 2;

  boss.vy += GRAVITY;
  boss.x += boss.vx;
  boss.y += boss.vy;
  const bounds = clampBossToArena(boss);

  if (boss.aiState === 'desperation') {
    // Desperation Junk Cyclone: spin in center & sling swirling scrap blocks 360 deg!
    boss.x += (centerX - boss.x) * 0.14;
    boss.vx = 0;
    clampBossToArena(boss);
    boss.aiTimer -= 1;

    if (boss.aiTimer === 38 || boss.aiTimer === 24 || boss.aiTimer === 10) {
      const baseSpin = boss.aiTimer * 0.15;
      for (let k = 0; k < 6; k++) {
        const ang = baseSpin + (k * Math.PI) / 3;
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'enemy_shot',
          x: bCx - 5,
          y: bCy - 5,
          vx: Math.cos(ang) * 3.5,
          vy: Math.sin(ang) * 3.1 - 0.6,
          w: 11,
          h: 11,
          damage: t.mediumProjectile,
          ttl: 110,
          pierce: false,
          bouncesLeft: 2,
          color: k % 2 === 0 ? '#f97316' : '#c9e27c',
        });
      }
      state.events.push(
        { type: 'sfx', key: 'throw', gain: 0.9 },
        { type: 'shake', ticks: 6, intensity: 2.5 },
      );
    }
    if (boss.aiTimer <= 0) {
      boss.aiState = 'recover';
      boss.aiTimer = 22;
      boss.patternIndex = 0;
    }
    return;
  }

  if (boss.aiState === 'idle') {
    boss.vx *= 0.8;
    boss.facing = pCx >= bCx ? 1 : -1;
    boss.aiTimer -= 1;
    if (boss.aiTimer <= 0) {
      boss.aiState = 'telegraph';
      boss.aiTimer = p2 ? 18 : 24;
      emitTelegraphSpark(state, bCx, bCy, '#c9e27c');
    }
    return;
  }

  if (boss.aiState === 'telegraph') {
    boss.vx = 0;
    boss.facing = pCx >= bCx ? 1 : -1;
    boss.aiTimer -= 1;
    if (boss.aiTimer <= 0) {
      boss.aiState = 'attack';
      const pat = boss.patternIndex % 3;
      if (pat === 0) {
        // Magnetic Pull Beam
        boss.aiTimer = p2 ? 48 : 42;
        state.events.push({ type: 'sfx', key: 'hook_fire', gain: 0.85 });
      } else if (pat === 1) {
        // Hurled Scrap Blocks
        boss.aiTimer = p2 ? 48 : 40;
      } else {
        // Shock Slam leap toward player
        const dx = Math.max(-160, Math.min(160, pCx - bCx));
        boss.vx = dx / 28;
        boss.vy = -6.2;
        boss.aiTimer = 50;
        state.events.push({ type: 'sfx', key: 'jump', gain: 0.85 });
      }
    }
    return;
  }

  if (boss.aiState === 'attack') {
    const pat = boss.patternIndex % 3;
    boss.aiTimer -= 1;

    if (pat === 0) {
      // Magnetic Pull Beam gently pulls Volt inward + finishes with scrap shock burst
      const pullDir = bCx >= pCx ? 1 : -1;
      if (boss.aiTimer > 12) {
        player.vx = Math.max(-4.5, Math.min(4.5, player.vx + pullDir * (p2 ? 0.3 : 0.22)));
        if (boss.aiTimer % 10 === 0) {
          cb.spawnProjectile(state, {
            owner: 'boss',
            kind: 'laser_beam',
            x: bCx + boss.facing * 18 - 6,
            y: bCy - 4,
            vx: boss.facing * 4.4,
            vy: 0,
            w: 14,
            h: 8,
            damage: t.lightProjectile,
            ttl: 45,
            pierce: true,
            bouncesLeft: 0,
            color: '#c9e27c',
          });
        }
      } else if (boss.aiTimer === 10) {
        // Point-blank magnetic discharge
        for (const dir of [-1, 1] as const) {
          cb.spawnProjectile(state, {
            owner: 'boss',
            kind: 'shockwave',
            x: bCx - 7,
            y: boss.arenaBottom - 14,
            vx: dir * (p2 ? 4.2 : 3.2),
            vy: 0,
            w: 14,
            h: 14,
            damage: t.mediumProjectile,
            ttl: 70,
            pierce: true,
            bouncesLeft: 0,
            color: '#f97316',
          });
        }
        state.events.push({ type: 'sfx', key: 'burst', gain: 0.8 });
      }
      if (boss.aiTimer <= 0) {
        boss.aiState = 'recover';
        boss.aiTimer = p2 ? 20 : 28;
        boss.patternIndex += 1;
      }
    } else if (pat === 1) {
      // Hurled Scrap Blocks
      const every = p2 ? 10 : 12;
      if (boss.aiTimer % every === 0) {
        const idx = Math.floor(boss.aiTimer / every);
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'enemy_shot',
          x: bCx + boss.facing * 12 - 6,
          y: bCy - 8,
          vx: boss.facing * (2.6 + idx * 0.75),
          vy: -2.4 - idx * 0.4,
          w: 12,
          h: 12,
          damage: t.mediumProjectile,
          ttl: 115,
          pierce: false,
          bouncesLeft: 2,
          color: '#f97316',
        });
        state.events.push({ type: 'sfx', key: 'throw', gain: 0.8 });
      }
      if (boss.aiTimer <= 0) {
        boss.aiState = 'recover';
        boss.aiTimer = p2 ? 20 : 26;
        boss.patternIndex += 1;
      }
    } else {
      // Shock Slam upon landing
      if ((bounds.grounded && boss.aiTimer < 42) || boss.aiTimer <= 0) {
        boss.vx = 0;
        for (const dir of [-1, 1] as const) {
          cb.spawnProjectile(state, {
            owner: 'boss',
            kind: 'shockwave',
            x: bCx - 8 + dir * 10,
            y: boss.arenaBottom - 14,
            vx: dir * (p2 ? 4.6 : 3.5),
            vy: 0,
            w: 16,
            h: 14,
            damage: t.heavyProjectile,
            ttl: 90,
            pierce: true,
            bouncesLeft: 0,
            color: '#fde047',
          });
        }
        state.events.push(
          { type: 'sfx', key: 'heavy_hit', gain: 0.9 },
          { type: 'shake', ticks: 10, intensity: 3 },
        );
        boss.aiState = 'recover';
        boss.aiTimer = p2 ? 20 : 28;
        boss.patternIndex += 1;
      }
    }
    return;
  }

  if (boss.aiState === 'recover') {
    boss.vx *= 0.82;
    boss.aiTimer -= 1;
    if (boss.aiTimer <= 0) {
      boss.aiState = 'idle';
      boss.aiTimer = p2 ? 10 : 16;
    }
  }
}

// ============================================================================
// 4. FROSTFANG (Cooler) — Ice-Slide Dash, Ceiling Icicles, Shard Fan, Desp Blizzard Lunge
// ============================================================================
function updateFrostfangBoss(
  state: SimState,
  boss: BossEntity,
  cb: BossSimCallbacks,
  t: DifficultyDamageTable,
): void {
  const player = state.player;
  const pCx = player.x + player.w * 0.5;
  const bCx = boss.x + boss.w * 0.5;
  const bCy = boss.y + boss.h * 0.5;
  const p2 = boss.phase >= 2;

  boss.vy += GRAVITY;
  boss.x += boss.vx;
  boss.y += boss.vy;
  const bounds = clampBossToArena(boss);

  if (boss.aiState === 'desperation') {
    // Desperation Blizzard Lunge: cryo gale + zigzag lunges + icicle storm
    boss.aiTimer -= 1;
    player.vx = Math.max(-4.5, Math.min(4.5, player.vx - 0.14));
    if (boss.aiTimer === 38 || boss.aiTimer === 22) {
      boss.facing = pCx >= bCx ? 1 : -1;
      boss.vx = boss.facing * 6.8;
      boss.vy = -2.2;
      state.events.push({ type: 'sfx', key: 'burst_freeze', gain: 0.9 });
      const span = boss.arenaRight - boss.arenaLeft;
      for (let k = 0; k < 5; k++) {
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'dive_beam',
          x: boss.arenaLeft + 24 + (span - 48) * (k / 4) - 4,
          y: boss.arenaTop + 2,
          vx: 0,
          vy: 4.4,
          w: 8,
          h: 18,
          damage: t.mediumProjectile,
          ttl: 85,
          pierce: false,
          bouncesLeft: 0,
          color: '#67e8f9',
        });
      }
    }
    if (boss.aiTimer === 10) {
      boss.vx = 0;
      for (let k = -2; k <= 2; k++) {
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'phase_ball',
          x: bCx - 4,
          y: bCy - 4,
          vx: boss.facing * 3.8,
          vy: k * 1.1,
          w: 8,
          h: 8,
          damage: t.lightProjectile,
          ttl: 105,
          pierce: false,
          bouncesLeft: 0,
          color: '#e0f2fe',
        });
      }
    }
    if (boss.aiTimer <= 0) {
      boss.vx = 0;
      boss.aiState = 'recover';
      boss.aiTimer = 20;
      boss.patternIndex = 0;
    }
    return;
  }

  if (boss.aiState === 'idle') {
    boss.vx *= 0.85;
    boss.facing = pCx >= bCx ? 1 : -1;
    boss.aiTimer -= 1;
    if (boss.aiTimer <= 0) {
      boss.aiState = 'telegraph';
      boss.aiTimer = p2 ? 18 : 24;
      emitTelegraphSpark(state, bCx, bCy, '#67e8f9');
    }
    return;
  }

  if (boss.aiState === 'telegraph') {
    boss.vx *= 0.8;
    boss.facing = pCx >= bCx ? 1 : -1;
    boss.aiTimer -= 1;
    if (boss.aiTimer <= 0) {
      boss.aiState = 'attack';
      const pat = boss.patternIndex % 3;
      if (pat === 0) {
        // Cryo Ice-Slide Dash
        boss.vx = boss.facing * (p2 ? 6.6 : 5.4);
        boss.aiTimer = 38;
        state.events.push({ type: 'sfx', key: 'slide', gain: 0.9 });
      } else if (pat === 1) {
        // Ceiling Icicle Volley
        boss.vx = 0;
        boss.aiTimer = p2 ? 48 : 40;
        state.events.push(
          { type: 'sfx', key: 'burst_freeze', gain: 0.85 },
          { type: 'shake', ticks: 8, intensity: 2 },
        );
      } else {
        // Frost Shard Fan leap
        boss.vx = -boss.facing * 2.4;
        boss.vy = -5.4;
        boss.aiTimer = 42;
      }
    }
    return;
  }

  if (boss.aiState === 'attack') {
    const pat = boss.patternIndex % 3;
    boss.aiTimer -= 1;

    if (pat === 0) {
      if (boss.aiTimer % 10 === 0) {
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'shockwave',
          x: bCx - 5,
          y: boss.arenaBottom - 12,
          vx: 0,
          vy: -0.4,
          w: 10,
          h: 12,
          damage: t.lightProjectile,
          ttl: 44,
          pierce: false,
          bouncesLeft: 0,
          color: '#38bdf8',
        });
      }
      if (bounds.hitLeft || bounds.hitRight || boss.aiTimer <= 0) {
        boss.vx = 0;
        boss.aiState = 'recover';
        boss.aiTimer = p2 ? 18 : 26;
        boss.patternIndex += 1;
      }
    } else if (pat === 1) {
      // Drop staggered icicle spears across ceiling
      const step = p2 ? 8 : 10;
      if (boss.aiTimer % step === 0) {
        const dropX = Math.max(
          boss.arenaLeft + 12,
          Math.min(boss.arenaRight - 20, pCx + (nextRng(state) - 0.5) * 140),
        );
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'dive_beam',
          x: dropX,
          y: boss.arenaTop + 2,
          vx: 0,
          vy: p2 ? 4.8 : 3.9,
          w: 8,
          h: 18,
          damage: t.mediumProjectile,
          ttl: 85,
          pierce: false,
          bouncesLeft: 0,
          color: '#67e8f9',
        });
      }
      if (boss.aiTimer <= 0) {
        boss.aiState = 'recover';
        boss.aiTimer = p2 ? 20 : 26;
        boss.patternIndex += 1;
      }
    } else {
      if (boss.aiTimer === 26 || (p2 && boss.aiTimer === 12)) {
        const count = p2 ? 5 : 4;
        for (let k = 0; k < count; k++) {
          const ang = -0.5 + (k / (count - 1)) * 1.0;
          cb.spawnProjectile(state, {
            owner: 'boss',
            kind: 'enemy_shot',
            x: bCx + boss.facing * 12 - 4,
            y: bCy - 4,
            vx: boss.facing * Math.cos(ang) * 4.2,
            vy: Math.sin(ang) * 4.2 + 0.5,
            w: 8,
            h: 8,
            damage: t.lightProjectile,
            ttl: 105,
            pierce: false,
            bouncesLeft: 0,
            color: '#e0f2fe',
          });
        }
        state.events.push({ type: 'sfx', key: 'burst', gain: 0.75 });
      }
      if (boss.aiTimer <= 0) {
        boss.aiState = 'recover';
        boss.aiTimer = p2 ? 18 : 26;
        boss.patternIndex += 1;
      }
    }
    return;
  }

  if (boss.aiState === 'recover') {
    boss.vx *= 0.85;
    boss.aiTimer -= 1;
    if (boss.aiTimer <= 0) {
      boss.aiState = 'idle';
      boss.aiTimer = p2 ? 10 : 16;
    }
  }
}

// ============================================================================
// 5. ARCBOLT (Elec) — Blink-Zip, Floor Surge, Overhead Thunderbolts, Desp Plasma Arc Storm
// ============================================================================
function updateArcboltBoss(
  state: SimState,
  boss: BossEntity,
  cb: BossSimCallbacks,
  t: DifficultyDamageTable,
): void {
  const pCx = state.player.x + state.player.w * 0.5;
  const pCy = state.player.y + state.player.h * 0.5;
  const bCx = boss.x + boss.w * 0.5;
  const bCy = boss.y + boss.h * 0.5;
  const centerX = (boss.arenaLeft + boss.arenaRight) * 0.5 - boss.w * 0.5;
  const topY = boss.arenaTop + 20;
  const p2 = boss.phase >= 2;

  if (boss.aiState === 'desperation') {
    // Desperation Plasma Arc Storm: levitate high & fire cross-arcs + thunderbolt columns
    boss.x += (centerX - boss.x) * 0.16;
    boss.y += (topY - boss.y) * 0.16;
    boss.vx = 0;
    boss.vy = 0;
    clampBossToArena(boss);
    boss.aiTimer -= 1;

    if (boss.aiTimer === 40 || boss.aiTimer === 28 || boss.aiTimer === 16 || boss.aiTimer === 6) {
      const span = boss.arenaRight - boss.arenaLeft;
      const colFrac = boss.aiTimer % 24 === 16 ? [0.22, 0.5, 0.78] : [0.35, 0.65];
      for (const f of colFrac) {
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'electric_arc',
          x: boss.arenaLeft + span * f - 6,
          y: boss.arenaTop,
          vx: 0,
          vy: 5.5,
          w: 12,
          h: 26,
          damage: t.heavyProjectile,
          ttl: 60,
          pierce: true,
          bouncesLeft: 0,
          color: '#facc15',
        });
      }
      for (const vx of [-4.2, 4.2]) {
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'electric_arc',
          x: bCx - 5,
          y: bCy - 5,
          vx,
          vy: 2.2,
          w: 10,
          h: 10,
          damage: t.mediumProjectile,
          ttl: 95,
          pierce: false,
          bouncesLeft: 1,
          color: '#38f8ff',
        });
      }
      state.events.push({ type: 'sfx', key: 'burst', gain: 0.85 });
    }
    if (boss.aiTimer <= 0) {
      boss.aiState = 'recover';
      boss.aiTimer = 20;
      boss.patternIndex = 0;
    }
    return;
  }

  const pat = boss.patternIndex % 3;
  const hoverNow = boss.aiState === 'attack' && pat === 2;
  if (!hoverNow) {
    boss.vy += GRAVITY;
    boss.x += boss.vx;
    boss.y += boss.vy;
    clampBossToArena(boss);
  }

  if (boss.aiState === 'idle') {
    boss.vx *= 0.78;
    boss.facing = pCx >= bCx ? 1 : -1;
    boss.aiTimer -= 1;
    if (boss.aiTimer <= 0) {
      boss.aiState = 'telegraph';
      boss.aiTimer = p2 ? 16 : 22;
      emitTelegraphSpark(state, bCx, bCy, '#facc15');
    }
    return;
  }

  if (boss.aiState === 'telegraph') {
    boss.vx = 0;
    boss.facing = pCx >= bCx ? 1 : -1;
    boss.aiTimer -= 1;
    if (boss.aiTimer <= 0) {
      boss.aiState = 'attack';
      if (pat === 0) {
        // High-Speed Lightning Blink-Zip
        boss.aiTimer = p2 ? 44 : 34;
      } else if (pat === 1) {
        // Floor Surge Wave
        boss.aiTimer = 36;
      } else {
        // Overhead Thunderbolts
        boss.vx = 0;
        boss.vy = 0;
        boss.aiTimer = p2 ? 48 : 38;
      }
    }
    return;
  }

  if (boss.aiState === 'attack') {
    boss.aiTimer -= 1;

    if (pat === 0) {
      // Blink-zip across arena firing electric arcs at each stop
      if (boss.aiTimer === 32 || boss.aiTimer === 16 || (p2 && boss.aiTimer === 4)) {
        const destX =
          boss.x > centerX ? boss.arenaLeft + 24 : boss.arenaRight - boss.w - 24;
        state.events.push({
          type: 'particle',
          kind: 'spark',
          x: bCx,
          y: bCy,
          color: '#38f8ff',
          count: 8,
        });
        boss.x = destX;
        boss.y = boss.arenaBottom - boss.h;
        boss.facing = pCx >= boss.x + boss.w * 0.5 ? 1 : -1;
        const dx = pCx - (boss.x + boss.w * 0.5);
        const dy = pCy - (boss.y + boss.h * 0.5);
        const dist = Math.max(1, Math.hypot(dx, dy));
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'electric_arc',
          x: boss.x + boss.w * 0.5 - 5,
          y: boss.y + boss.h * 0.5 - 5,
          vx: (dx / dist) * (p2 ? 5.2 : 4.3),
          vy: (dy / dist) * (p2 ? 5.2 : 4.3),
          w: 10,
          h: 10,
          damage: t.mediumProjectile,
          ttl: 95,
          pierce: false,
          bouncesLeft: 0,
          color: '#facc15',
        });
        state.events.push({ type: 'sfx', key: 'sprint_kick', gain: 0.85 });
      }
      if (boss.aiTimer <= 0) {
        boss.aiState = 'recover';
        boss.aiTimer = p2 ? 18 : 24;
        boss.patternIndex += 1;
      }
    } else if (pat === 1) {
      // Floor Surge Wave
      if (boss.aiTimer === 26 || (p2 && boss.aiTimer === 10)) {
        for (const dir of [-1, 1] as const) {
          cb.spawnProjectile(state, {
            owner: 'boss',
            kind: 'electric_arc',
            x: bCx - 6,
            y: boss.arenaBottom - 16,
            vx: dir * (p2 ? 5.2 : 4.2),
            vy: 0,
            w: 14,
            h: 16,
            damage: t.mediumProjectile,
            ttl: 95,
            pierce: true,
            bouncesLeft: 0,
            color: '#38f8ff',
          });
        }
        state.events.push(
          { type: 'sfx', key: 'burst', gain: 0.85 },
          { type: 'shake', ticks: 6, intensity: 2 },
        );
      }
      if (boss.aiTimer <= 0) {
        boss.aiState = 'recover';
        boss.aiTimer = p2 ? 18 : 24;
        boss.patternIndex += 1;
      }
    } else {
      // Overhead Thunderbolts
      boss.x += (centerX - boss.x) * 0.14;
      boss.y += (topY - boss.y) * 0.14;
      clampBossToArena(boss);
      const boltStep = p2 ? 9 : 12;
      if (boss.aiTimer % boltStep === 0 && boss.aiTimer > 0) {
        const bx = Math.max(
          boss.arenaLeft + 10,
          Math.min(boss.arenaRight - 22, pCx + (nextRng(state) - 0.5) * 90),
        );
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'electric_arc',
          x: bx,
          y: boss.arenaTop,
          vx: 0,
          vy: 5.6,
          w: 12,
          h: 26,
          damage: t.heavyProjectile,
          ttl: 60,
          pierce: true,
          bouncesLeft: 0,
          color: '#facc15',
        });
        state.events.push({ type: 'sfx', key: 'heavy_hit', gain: 0.7 });
      }
      if (boss.aiTimer <= 0) {
        boss.aiState = 'recover';
        boss.aiTimer = p2 ? 18 : 24;
        boss.patternIndex += 1;
      }
    }
    return;
  }

  if (boss.aiState === 'recover') {
    boss.vx *= 0.8;
    boss.aiTimer -= 1;
    if (boss.aiTimer <= 0) {
      boss.aiState = 'idle';
      boss.aiTimer = p2 ? 10 : 15;
    }
  }
}

// ============================================================================
// 6. STRIDER (Shift) — Wind-Scythe Dive, Gale Gusts, Wall-Kick Ambush, Desp Supersonic Blitz
// ============================================================================
function updateStriderBoss(
  state: SimState,
  boss: BossEntity,
  cb: BossSimCallbacks,
  t: DifficultyDamageTable,
): void {
  const player = state.player;
  const pCx = player.x + player.w * 0.5;
  const bCx = boss.x + boss.w * 0.5;
  const bCy = boss.y + boss.h * 0.5;
  const p2 = boss.phase >= 2;

  if (boss.aiState === 'desperation') {
    // Desperation Supersonic Blitz: 3 blistering diagonal passes with vacuum shockwaves!
    boss.aiTimer -= 1;
    if (boss.aiTimer === 38 || boss.aiTimer === 25 || boss.aiTimer === 12) {
      const fromLeft = boss.aiTimer !== 25;
      boss.x = fromLeft ? boss.arenaLeft + 8 : boss.arenaRight - boss.w - 8;
      boss.y = boss.arenaTop + 20;
      boss.facing = fromLeft ? 1 : -1;
      boss.vx = boss.facing * 8.2;
      boss.vy = 3.2;
      for (let k = -1; k <= 1; k++) {
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'burst_beam',
          x: boss.x + boss.w * 0.5 - 8,
          y: boss.y + boss.h * 0.5 - 6,
          vx: boss.facing * 5.2,
          vy: 1.8 + k * 1.1,
          w: 16,
          h: 12,
          damage: t.mediumProjectile,
          ttl: 85,
          pierce: true,
          bouncesLeft: 0,
          color: '#f43f5e',
        });
      }
      state.events.push({ type: 'sfx', key: 'sprint_kick', gain: 0.9 });
    }
    boss.x += boss.vx;
    boss.y += boss.vy;
    clampBossToArena(boss);
    if (boss.aiTimer <= 0) {
      boss.vx = 0;
      boss.vy = 0;
      boss.aiState = 'recover';
      boss.aiTimer = 20;
      boss.patternIndex = 0;
    }
    return;
  }

  const pat = boss.patternIndex % 3;
  const gravityOff = boss.aiState === 'attack' && pat === 1;
  if (!gravityOff) {
    boss.vy += GRAVITY;
  }
  boss.x += boss.vx;
  boss.y += boss.vy;
  const bounds = clampBossToArena(boss);

  if (boss.aiState === 'idle') {
    boss.vx *= 0.8;
    boss.facing = pCx >= bCx ? 1 : -1;
    boss.aiTimer -= 1;
    if (boss.aiTimer <= 0) {
      boss.aiState = 'telegraph';
      boss.aiTimer = p2 ? 16 : 22;
      emitTelegraphSpark(state, bCx, bCy, '#34d399');
    }
    return;
  }

  if (boss.aiState === 'telegraph') {
    boss.vx = 0;
    boss.facing = pCx >= bCx ? 1 : -1;
    boss.aiTimer -= 1;
    if (boss.aiTimer <= 0) {
      boss.aiState = 'attack';
      if (pat === 0) {
        // Aerial Wind-Scythe Dive
        boss.vy = -6.8;
        boss.vx = boss.facing * 2.2;
        boss.aiTimer = 46;
        state.events.push({ type: 'sfx', key: 'jump', gain: 0.85 });
      } else if (pat === 1) {
        // Gale Pushback Gusts
        boss.vx = 0;
        boss.vy = 0;
        boss.aiTimer = p2 ? 48 : 40;
        state.events.push({ type: 'sfx', key: 'burst', gain: 0.8 });
      } else {
        // Wall-Kick Ambush
        const nearRight = bCx > (boss.arenaLeft + boss.arenaRight) * 0.5;
        boss.vx = nearRight ? 7.2 : -7.2;
        boss.vy = -5.6;
        boss.aiTimer = 46;
        state.events.push({ type: 'sfx', key: 'wall_jump', gain: 0.9 });
      }
    }
    return;
  }

  if (boss.aiState === 'attack') {
    boss.aiTimer -= 1;

    if (pat === 0) {
      // Dive diagonally at apex & unleash dual crescent wind-scythes
      if (boss.aiTimer === 28) {
        boss.facing = pCx >= bCx ? 1 : -1;
        boss.vx = boss.facing * (p2 ? 6.4 : 5.2);
        boss.vy = 4.6;
        for (const spread of [-0.25, 0.25]) {
          cb.spawnProjectile(state, {
            owner: 'boss',
            kind: 'burst_beam',
            x: bCx - 8,
            y: bCy - 6,
            vx: boss.facing * 4.6,
            vy: 2.0 + spread * 4,
            w: 16,
            h: 12,
            damage: t.mediumProjectile,
            ttl: 90,
            pierce: true,
            bouncesLeft: 0,
            color: '#f43f5e',
          });
        }
        state.events.push({ type: 'sfx', key: 'dive_kick', gain: 0.9 });
      }
      if ((bounds.grounded && boss.aiTimer < 26) || boss.aiTimer <= 0) {
        boss.vx = 0;
        boss.aiState = 'recover';
        boss.aiTimer = p2 ? 18 : 24;
        boss.patternIndex += 1;
      }
    } else if (pat === 1) {
      // Gale Pushback Gusts pushing player + slicing aero-waves
      boss.y += (boss.arenaTop + 56 - boss.y) * 0.14;
      clampBossToArena(boss);
      const pushDir = boss.facing;
      player.vx = Math.max(-4.5, Math.min(4.5, player.vx + pushDir * (p2 ? 0.28 : 0.2)));
      if (boss.aiTimer % (p2 ? 12 : 16) === 0) {
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'shockwave',
          x: bCx + pushDir * 14 - 6,
          y: boss.arenaBottom - 26 - (boss.aiTimer % 32 === 0 ? 28 : 0),
          vx: pushDir * (p2 ? 5.2 : 4.2),
          vy: 0,
          w: 12,
          h: 22,
          damage: t.lightProjectile,
          ttl: 90,
          pierce: true,
          bouncesLeft: 0,
          color: '#34d399',
        });
      }
      if (boss.aiTimer <= 0) {
        boss.aiState = 'recover';
        boss.aiTimer = p2 ? 18 : 24;
        boss.patternIndex += 1;
      }
    } else {
      // Wall-Kick Ambush: bounce off arena wall with 3-way aero-feather volley
      if ((bounds.hitLeft || bounds.hitRight) && boss.aiTimer > 12) {
        const kickDir: -1 | 1 = bounds.hitLeft ? 1 : -1;
        boss.facing = kickDir;
        boss.vx = kickDir * (p2 ? 6.2 : 5.0);
        boss.vy = -3.8;
        for (const vy of [0.8, 2.0, 3.2]) {
          cb.spawnProjectile(state, {
            owner: 'boss',
            kind: 'enemy_shot',
            x: bCx - 4,
            y: bCy - 4,
            vx: kickDir * 4.2,
            vy,
            w: 8,
            h: 8,
            damage: t.lightProjectile,
            ttl: 95,
            pierce: false,
            bouncesLeft: 0,
            color: '#38bdf8',
          });
        }
        state.events.push({ type: 'sfx', key: 'wall_jump', gain: 0.9 });
      }
      if (boss.aiTimer <= 0) {
        boss.vx = 0;
        boss.aiState = 'recover';
        boss.aiTimer = p2 ? 18 : 24;
        boss.patternIndex += 1;
      }
    }
    return;
  }

  if (boss.aiState === 'recover') {
    boss.vx *= 0.8;
    boss.aiTimer -= 1;
    if (boss.aiTimer <= 0) {
      boss.aiState = 'idle';
      boss.aiTimer = p2 ? 10 : 15;
    }
  }
}

// ============================================================================
// 7. TEMPO (Wave) — Sonic Rings, Bass-Drop Slam, Dual Speakers, Desp Encore Barrage
// ============================================================================
function updateTempoBoss(
  state: SimState,
  boss: BossEntity,
  cb: BossSimCallbacks,
  t: DifficultyDamageTable,
): void {
  const pCx = state.player.x + state.player.w * 0.5;
  const bCx = boss.x + boss.w * 0.5;
  const bCy = boss.y + boss.h * 0.5;
  const centerX = (boss.arenaLeft + boss.arenaRight) * 0.5 - boss.w * 0.5;
  const p2 = boss.phase >= 2;

  boss.vy += GRAVITY;
  boss.x += boss.vx;
  boss.y += boss.vy;
  const bounds = clampBossToArena(boss);

  if (boss.aiState === 'desperation') {
    // Desperation Encore Barrage: 3-beat harmonic crescendo!
    boss.x += (centerX - boss.x) * 0.14;
    boss.vx = 0;
    clampBossToArena(boss);
    boss.aiTimer -= 1;

    if (boss.aiTimer === 40) {
      // Beat 1: 8-way sonic ring
      for (let k = 0; k < 8; k++) {
        const ang = (k * Math.PI) / 4;
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'phase_ball',
          x: bCx - 4,
          y: bCy - 4,
          vx: Math.cos(ang) * 3.6,
          vy: Math.sin(ang) * 3.6,
          w: 8,
          h: 8,
          damage: t.mediumProjectile,
          ttl: 105,
          pierce: false,
          bouncesLeft: 1,
          color: '#d946ef',
        });
      }
      state.events.push({ type: 'sfx', key: 'burst', gain: 0.9 });
    } else if (boss.aiTimer === 26) {
      // Beat 2: alternating speaker beams
      for (const dir of [-1, 1] as const) {
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'laser_beam',
          x: bCx - 8,
          y: boss.arenaBottom - 36,
          vx: dir * 4.8,
          vy: 0,
          w: 18,
          h: 10,
          damage: t.mediumProjectile,
          ttl: 85,
          pierce: true,
          bouncesLeft: 0,
          color: '#14b8a6',
        });
      }
      state.events.push({ type: 'sfx', key: 'burst', gain: 0.85 });
    } else if (boss.aiTimer === 12) {
      // Beat 3: massive bass-drop twin shockwaves
      for (const dir of [-1, 1] as const) {
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'shockwave',
          x: bCx - 8,
          y: boss.arenaBottom - 16,
          vx: dir * 5.0,
          vy: 0,
          w: 16,
          h: 16,
          damage: t.heavyProjectile,
          ttl: 95,
          pierce: true,
          bouncesLeft: 0,
          color: '#ff80df',
        });
      }
      state.events.push(
        { type: 'sfx', key: 'heavy_hit', gain: 0.95 },
        { type: 'shake', ticks: 10, intensity: 3 },
      );
    }
    if (boss.aiTimer <= 0) {
      boss.aiState = 'recover';
      boss.aiTimer = 20;
      boss.patternIndex = 0;
    }
    return;
  }

  if (boss.aiState === 'idle') {
    boss.vx *= 0.8;
    boss.facing = pCx >= bCx ? 1 : -1;
    boss.aiTimer -= 1;
    if (boss.aiTimer <= 0) {
      boss.aiState = 'telegraph';
      boss.aiTimer = p2 ? 16 : 22;
      emitTelegraphSpark(state, bCx, bCy, '#d946ef');
    }
    return;
  }

  if (boss.aiState === 'telegraph') {
    boss.vx = 0;
    boss.facing = pCx >= bCx ? 1 : -1;
    boss.aiTimer -= 1;
    if (boss.aiTimer <= 0) {
      boss.aiState = 'attack';
      const pat = boss.patternIndex % 3;
      if (pat === 0) {
        // Beat-Synced Sonic Rings
        boss.aiTimer = p2 ? 46 : 38;
      } else if (pat === 1) {
        // Bouncing Bass-Drop Slam
        boss.vy = -6.0;
        boss.vx = boss.facing * 2.8;
        boss.aiTimer = p2 ? 64 : 48;
        state.events.push({ type: 'sfx', key: 'bounce', gain: 0.9 });
      } else {
        // Dual Speaker Waves
        boss.aiTimer = p2 ? 48 : 38;
      }
    }
    return;
  }

  if (boss.aiState === 'attack') {
    const pat = boss.patternIndex % 3;
    boss.aiTimer -= 1;

    if (pat === 0) {
      // Fire radial beat-synced sonic rings on rhythmic cadence
      if (boss.aiTimer === 32 || boss.aiTimer === 16 || (p2 && boss.aiTimer === 4)) {
        const count = p2 ? 6 : 5;
        const twist = (state.rhythmBeat % 2) * 0.3;
        for (let k = 0; k < count; k++) {
          const ang = twist + (k * Math.PI * 2) / count;
          cb.spawnProjectile(state, {
            owner: 'boss',
            kind: 'phase_ball',
            x: bCx - 4,
            y: bCy - 4,
            vx: Math.cos(ang) * 3.4,
            vy: Math.sin(ang) * 3.4,
            w: 8,
            h: 8,
            damage: t.lightProjectile,
            ttl: 105,
            pierce: false,
            bouncesLeft: 1,
            color: k % 2 === 0 ? '#d946ef' : '#14b8a6',
          });
        }
        state.events.push({ type: 'sfx', key: 'burst', gain: 0.75 });
      }
      if (boss.aiTimer <= 0) {
        boss.aiState = 'recover';
        boss.aiTimer = p2 ? 18 : 24;
        boss.patternIndex += 1;
      }
    } else if (pat === 1) {
      // Bouncing Bass-Drop Slam: bounces repeatedly and drops bass shockwaves on each impact
      if (bounds.grounded && boss.aiTimer > 6) {
        boss.vy = -5.6;
        boss.facing = pCx >= bCx ? 1 : -1;
        boss.vx = boss.facing * (p2 ? 3.2 : 2.5);
        for (const dir of [-1, 1] as const) {
          cb.spawnProjectile(state, {
            owner: 'boss',
            kind: 'shockwave',
            x: bCx - 7,
            y: boss.arenaBottom - 14,
            vx: dir * (p2 ? 4.4 : 3.4),
            vy: 0,
            w: 14,
            h: 14,
            damage: t.mediumProjectile,
            ttl: 85,
            pierce: true,
            bouncesLeft: 0,
            color: '#ff80df',
          });
        }
        state.events.push(
          { type: 'sfx', key: 'bounce', gain: 0.9 },
          { type: 'shake', ticks: 6, intensity: 2.5 },
        );
      }
      if (boss.aiTimer <= 0) {
        boss.vx = 0;
        boss.aiState = 'recover';
        boss.aiTimer = p2 ? 18 : 24;
        boss.patternIndex += 1;
      }
    } else {
      // Dual Speaker Waves: alternating low/high horizontal synth beams
      if (boss.aiTimer === 32 || boss.aiTimer === 18 || (p2 && boss.aiTimer === 6)) {
        const high = boss.aiTimer === 18;
        const beamY = high ? boss.arenaBottom - 44 : boss.arenaBottom - 16;
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'laser_beam',
          x: bCx + boss.facing * 14 - 8,
          y: beamY,
          vx: boss.facing * (p2 ? 5.2 : 4.2),
          vy: 0,
          w: 18,
          h: 10,
          damage: t.mediumProjectile,
          ttl: 90,
          pierce: true,
          bouncesLeft: 0,
          color: high ? '#14b8a6' : '#d946ef',
        });
        state.events.push({ type: 'sfx', key: 'jab', gain: 0.8 });
      }
      if (boss.aiTimer <= 0) {
        boss.aiState = 'recover';
        boss.aiTimer = p2 ? 18 : 24;
        boss.patternIndex += 1;
      }
    }
    return;
  }

  if (boss.aiState === 'recover') {
    boss.vx *= 0.82;
    boss.aiTimer -= 1;
    if (boss.aiTimer <= 0) {
      boss.aiState = 'idle';
      boss.aiTimer = p2 ? 10 : 15;
    }
  }
}

// ============================================================================
// 8. CRAG (Break) — Boulder Heave, Seismic Pillars, Bull-Charge, Desp Tectonic Quake
// ============================================================================
function updateCragBoss(
  state: SimState,
  boss: BossEntity,
  cb: BossSimCallbacks,
  t: DifficultyDamageTable,
): void {
  const pCx = state.player.x + state.player.w * 0.5;
  const bCx = boss.x + boss.w * 0.5;
  const bCy = boss.y + boss.h * 0.5;
  const p2 = boss.phase >= 2;

  boss.vy += GRAVITY;
  boss.x += boss.vx;
  boss.y += boss.vy;
  const bounds = clampBossToArena(boss);

  if (boss.aiState === 'desperation') {
    // Desperation Tectonic Quake: seismic floor pillars + falling quarry boulders!
    boss.vx = 0;
    boss.aiTimer -= 1;
    if (boss.aiTimer === 38 || boss.aiTimer === 24 || boss.aiTimer === 10) {
      const span = boss.arenaRight - boss.arenaLeft;
      for (let k = 0; k < 4; k++) {
        const px = boss.arenaLeft + 24 + (span - 48) * ((k + (boss.aiTimer === 24 ? 0.5 : 0)) / 4);
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'shockwave',
          x: px - 8,
          y: boss.arenaBottom - 18,
          vx: 0,
          vy: -3.6,
          w: 16,
          h: 20,
          damage: t.heavyProjectile,
          ttl: 44,
          pierce: true,
          bouncesLeft: 0,
          color: '#f97316',
        });
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'enemy_shot',
          x: px - 6,
          y: boss.arenaTop + 2,
          vx: (nextRng(state) - 0.5) * 1.2,
          vy: 3.6,
          w: 12,
          h: 12,
          damage: t.explosion,
          ttl: 95,
          pierce: false,
          bouncesLeft: 1,
          color: '#ffd166',
        });
      }
      state.events.push(
        { type: 'sfx', key: 'heavy_hit', gain: 0.95 },
        { type: 'shake', ticks: 12, intensity: 4 },
      );
    }
    if (boss.aiTimer <= 0) {
      boss.aiState = 'recover';
      boss.aiTimer = 24;
      boss.patternIndex = 0;
    }
    return;
  }

  if (boss.aiState === 'idle') {
    boss.vx *= 0.78;
    boss.facing = pCx >= bCx ? 1 : -1;
    boss.aiTimer -= 1;
    if (boss.aiTimer <= 0) {
      boss.aiState = 'telegraph';
      boss.aiTimer = p2 ? 20 : 26;
      emitTelegraphSpark(state, bCx, bCy, '#f97316');
    }
    return;
  }

  if (boss.aiState === 'telegraph') {
    boss.vx = 0;
    boss.facing = pCx >= bCx ? 1 : -1;
    boss.aiTimer -= 1;
    if (boss.aiTimer <= 0) {
      boss.aiState = 'attack';
      const pat = boss.patternIndex % 3;
      if (pat === 0) {
        // Boulder Heave
        boss.aiTimer = p2 ? 46 : 38;
      } else if (pat === 1) {
        // Seismic Ground Pillars
        boss.aiTimer = p2 ? 48 : 38;
        state.events.push(
          { type: 'sfx', key: 'heavy_hit', gain: 0.9 },
          { type: 'shake', ticks: 10, intensity: 3 },
        );
      } else {
        // Armored Bull-Charge
        boss.vx = boss.facing * (p2 ? 6.0 : 4.8);
        boss.aiTimer = 64;
        state.events.push({ type: 'sfx', key: 'sprint_kick', gain: 0.95 });
      }
    }
    return;
  }

  if (boss.aiState === 'attack') {
    const pat = boss.patternIndex % 3;
    boss.aiTimer -= 1;

    if (pat === 0) {
      const every = p2 ? 11 : 14;
      if (boss.aiTimer % every === 0) {
        const idx = Math.floor(boss.aiTimer / every);
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'enemy_shot',
          x: bCx + boss.facing * 16 - 7,
          y: boss.y + 4,
          vx: boss.facing * (2.4 + idx * 0.8),
          vy: -3.2 - idx * 0.3,
          w: 14,
          h: 14,
          damage: t.heavyProjectile,
          ttl: 115,
          pierce: false,
          bouncesLeft: 2,
          color: '#ffd166',
        });
        state.events.push({ type: 'sfx', key: 'throw', gain: 0.85 });
      }
      if (boss.aiTimer <= 0) {
        boss.aiState = 'recover';
        boss.aiTimer = p2 ? 20 : 28;
        boss.patternIndex += 1;
      }
    } else if (pat === 1) {
      // Rising Seismic Ground Pillars marching across arena
      const step = p2 ? 9 : 11;
      if (boss.aiTimer % step === 0) {
        const idx = Math.floor((48 - boss.aiTimer) / step);
        const px = Math.max(
          boss.arenaLeft + 16,
          Math.min(boss.arenaRight - 32, bCx + boss.facing * (48 + idx * 54)),
        );
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'shockwave',
          x: px - 8,
          y: boss.arenaBottom - 16,
          vx: 0,
          vy: -3.4,
          w: 16,
          h: 22,
          damage: t.heavyProjectile,
          ttl: 44,
          pierce: true,
          bouncesLeft: 0,
          color: '#f97316',
        });
        state.events.push({ type: 'sfx', key: 'breakable', gain: 0.8 });
      }
      if (boss.aiTimer <= 0) {
        boss.aiState = 'recover';
        boss.aiTimer = p2 ? 20 : 28;
        boss.patternIndex += 1;
      }
    } else {
      // Bull-Charge wall smash shakes loose falling quarry boulders
      if ((boss.facing > 0 && bounds.hitRight) || (boss.facing < 0 && bounds.hitLeft)) {
        boss.vx = 0;
        const dropCount = p2 ? 4 : 3;
        for (let k = 0; k < dropCount; k++) {
          cb.spawnProjectile(state, {
            owner: 'boss',
            kind: 'enemy_shot',
            x:
              boss.arenaLeft +
              24 +
              nextRng(state) * Math.max(16, boss.arenaRight - boss.arenaLeft - 48),
            y: boss.arenaTop + 2,
            vx: 0,
            vy: 3.4 + nextRng(state) * 0.8,
            w: 12,
            h: 12,
            damage: t.explosion,
            ttl: 95,
            pierce: false,
            bouncesLeft: 1,
            color: '#c7b8bf',
          });
        }
        state.events.push(
          { type: 'sfx', key: 'heavy_hit', gain: 0.95 },
          { type: 'shake', ticks: 12, intensity: 3.5 },
        );
        boss.aiState = 'recover';
        boss.aiTimer = p2 ? 22 : 30;
        boss.patternIndex += 1;
        return;
      }
      if (boss.aiTimer <= 0) {
        boss.vx = 0;
        boss.aiState = 'recover';
        boss.aiTimer = 24;
        boss.patternIndex += 1;
      }
    }
    return;
  }

  if (boss.aiState === 'recover') {
    boss.vx *= 0.8;
    boss.aiTimer -= 1;
    if (boss.aiTimer <= 0) {
      boss.aiState = 'idle';
      boss.aiTimer = p2 ? 12 : 18;
    }
  }
}

// ============================================================================
// 9. PHANTOM (Cipher) — Teleport Blinks, Decoy Mirage, Shuriken Fan, Desp Cross-Grid
// ============================================================================
function updatePhantomBoss(
  state: SimState,
  boss: BossEntity,
  cb: BossSimCallbacks,
  t: DifficultyDamageTable,
): void {
  const pCx = state.player.x + state.player.w * 0.5;
  const bCx = boss.x + boss.w * 0.5;
  const bCy = boss.y + boss.h * 0.5;
  const centerX = (boss.arenaLeft + boss.arenaRight) * 0.5 - boss.w * 0.5;
  const p2 = boss.phase >= 2;

  boss.vy += GRAVITY;
  boss.x += boss.vx;
  boss.y += boss.vy;
  clampBossToArena(boss);

  if (boss.aiState === 'desperation') {
    // Desperation Matrix Cross-Grid: intersecting horizontal & vertical neon beams + shurikens!
    boss.x += (centerX - boss.x) * 0.16;
    boss.vx = 0;
    boss.vy = 0;
    clampBossToArena(boss);
    boss.aiTimer -= 1;

    if (boss.aiTimer === 40 || boss.aiTimer === 26) {
      const span = boss.arenaRight - boss.arenaLeft;
      for (const f of boss.aiTimer === 40 ? [0.2, 0.5, 0.8] : [0.35, 0.65]) {
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'laser_beam',
          x: boss.arenaLeft + span * f - 5,
          y: boss.arenaTop,
          vx: 0,
          vy: 5.0,
          w: 10,
          h: 26,
          damage: t.mediumProjectile,
          ttl: 65,
          pierce: true,
          bouncesLeft: 0,
          color: '#10b981',
        });
      }
      cb.spawnProjectile(state, {
        owner: 'boss',
        kind: 'laser_beam',
        x: boss.arenaLeft,
        y: boss.arenaBottom - (boss.aiTimer === 40 ? 22 : 52),
        vx: 5.2,
        vy: 0,
        w: 26,
        h: 8,
        damage: t.mediumProjectile,
        ttl: 85,
        pierce: true,
        bouncesLeft: 0,
        color: '#a855f7',
      });
      state.events.push({ type: 'sfx', key: 'burst', gain: 0.85 });
    } else if (boss.aiTimer === 12) {
      for (let k = 0; k < 6; k++) {
        const ang = (k * Math.PI) / 3;
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'phase_ball',
          x: bCx - 4,
          y: bCy - 4,
          vx: Math.cos(ang) * 4.2,
          vy: Math.sin(ang) * 4.2,
          w: 8,
          h: 8,
          damage: t.lightProjectile,
          ttl: 100,
          pierce: false,
          bouncesLeft: 1,
          color: '#d9f99d',
        });
      }
      state.events.push({ type: 'sfx', key: 'throw', gain: 0.85 });
    }
    if (boss.aiTimer <= 0) {
      boss.aiState = 'recover';
      boss.aiTimer = 20;
      boss.patternIndex = 0;
    }
    return;
  }

  if (boss.aiState === 'idle') {
    boss.vx *= 0.8;
    boss.facing = pCx >= bCx ? 1 : -1;
    boss.aiTimer -= 1;
    if (boss.aiTimer <= 0) {
      boss.aiState = 'telegraph';
      boss.aiTimer = p2 ? 16 : 22;
      emitTelegraphSpark(state, bCx, bCy, '#10b981');
    }
    return;
  }

  if (boss.aiState === 'telegraph') {
    boss.vx = 0;
    boss.facing = pCx >= bCx ? 1 : -1;
    boss.aiTimer -= 1;
    if (boss.aiTimer <= 0) {
      boss.aiState = 'attack';
      const pat = boss.patternIndex % 3;
      if (pat === 0) {
        // Cyber Teleport Blinks
        boss.aiTimer = p2 ? 42 : 32;
      } else if (pat === 1) {
        // Decoy Mirage Strikes
        boss.aiTimer = 38;
      } else {
        // Neon Shuriken Fan leap
        boss.vy = -5.6;
        boss.vx = -boss.facing * 1.8;
        boss.aiTimer = 40;
      }
    }
    return;
  }

  if (boss.aiState === 'attack') {
    const pat = boss.patternIndex % 3;
    boss.aiTimer -= 1;

    if (pat === 0) {
      // Blink behind Volt and slash forward
      if (boss.aiTimer === 28 || (p2 && boss.aiTimer === 12)) {
        state.events.push({
          type: 'particle',
          kind: 'spark',
          x: bCx,
          y: bCy,
          color: '#10b981',
          count: 8,
        });
        const behindOffset = state.player.facing > 0 ? -56 : 56;
        boss.x = Math.max(
          boss.arenaLeft + 8,
          Math.min(boss.arenaRight - boss.w - 8, pCx + behindOffset - boss.w * 0.5),
        );
        boss.y = boss.arenaBottom - boss.h;
        boss.facing = pCx >= boss.x + boss.w * 0.5 ? 1 : -1;
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'burst_beam',
          x: boss.x + boss.w * 0.5 + boss.facing * 14 - 10,
          y: boss.y + 8,
          vx: boss.facing * 5.2,
          vy: 0,
          w: 20,
          h: 16,
          damage: t.mediumProjectile,
          ttl: 60,
          pierce: true,
          bouncesLeft: 0,
          color: '#10b981',
        });
        state.events.push({ type: 'sfx', key: 'sprint_kick', gain: 0.85 });
      }
      if (boss.aiTimer <= 0) {
        boss.aiState = 'recover';
        boss.aiTimer = p2 ? 18 : 24;
        boss.patternIndex += 1;
      }
    } else if (pat === 1) {
      // Decoy Mirage Crossfire from opposite side of arena
      if (boss.aiTimer === 28 || (p2 && boss.aiTimer === 14)) {
        const realLeft = boss.aiTimer === 28;
        boss.x = realLeft ? boss.arenaLeft + 18 : boss.arenaRight - boss.w - 18;
        boss.facing = realLeft ? 1 : -1;
        const mirageX = realLeft ? boss.arenaRight - 28 : boss.arenaLeft + 18;
        const mirageDir = realLeft ? -1 : 1;
        // Real strike + mirrored mirage strike
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'burst_beam',
          x: boss.x + boss.w * 0.5 - 8,
          y: boss.arenaBottom - 26,
          vx: boss.facing * 4.4,
          vy: 0,
          w: 16,
          h: 12,
          damage: t.mediumProjectile,
          ttl: 90,
          pierce: false,
          bouncesLeft: 0,
          color: '#10b981',
        });
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'burst_beam',
          x: mirageX,
          y: boss.arenaBottom - 44,
          vx: mirageDir * 4.4,
          vy: 0,
          w: 16,
          h: 12,
          damage: t.lightProjectile,
          ttl: 90,
          pierce: false,
          bouncesLeft: 0,
          color: '#a855f7',
        });
        state.events.push({ type: 'sfx', key: 'burst', gain: 0.8 });
      }
      if (boss.aiTimer <= 0) {
        boss.aiState = 'recover';
        boss.aiTimer = p2 ? 18 : 24;
        boss.patternIndex += 1;
      }
    } else {
      // Neon Shuriken Fan
      if (boss.aiTimer === 24) {
        const count = p2 ? 7 : 5;
        for (let k = 0; k < count; k++) {
          const ang = -0.55 + (k / (count - 1)) * 1.1;
          cb.spawnProjectile(state, {
            owner: 'boss',
            kind: 'phase_ball',
            x: bCx - 4,
            y: bCy - 4,
            vx: boss.facing * Math.cos(ang) * 4.2,
            vy: Math.sin(ang) * 4.2 + 0.4,
            w: 8,
            h: 8,
            damage: t.lightProjectile,
            ttl: 105,
            pierce: false,
            bouncesLeft: 1,
            color: k % 2 === 0 ? '#a855f7' : '#d9f99d',
          });
        }
        state.events.push({ type: 'sfx', key: 'throw', gain: 0.85 });
      }
      if (boss.aiTimer <= 0) {
        boss.aiState = 'recover';
        boss.aiTimer = p2 ? 18 : 24;
        boss.patternIndex += 1;
      }
    }
    return;
  }

  if (boss.aiState === 'recover') {
    boss.vx *= 0.8;
    boss.aiTimer -= 1;
    if (boss.aiTimer <= 0) {
      boss.aiState = 'idle';
      boss.aiTimer = p2 ? 10 : 15;
    }
  }
}

// ============================================================================
// 10. UNIT K-00 MIRROR (Final 1) — Authentic Player Moveset Duel & Function Overload!
// ============================================================================
function updateMirrorRivalBoss(
  state: SimState,
  boss: BossEntity,
  cb: BossSimCallbacks,
  t: DifficultyDamageTable,
): void {
  const pCx = state.player.x + state.player.w * 0.5;
  const bCx = boss.x + boss.w * 0.5;
  const bCy = boss.y + boss.h * 0.5;
  const p2 = boss.phase >= 2;

  boss.vy += GRAVITY;
  boss.x += boss.vx;
  boss.y += boss.vy;
  const bounds = clampBossToArena(boss);

  if (boss.aiState === 'desperation') {
    // Desperation: FUNCTION OVERLOAD Burst Combo (Flying Strike -> Rising Upper -> Piledrive!)
    boss.aiTimer -= 1;
    if (boss.aiTimer === 40) {
      // Flying Strike horizontal torpedo
      boss.facing = pCx >= bCx ? 1 : -1;
      boss.vx = boss.facing * 7.5;
      boss.vy = 0;
      cb.spawnProjectile(state, {
        owner: 'boss',
        kind: 'burst_beam',
        x: bCx + boss.facing * 10 - 12,
        y: boss.y + 4,
        vx: boss.facing * 6.4,
        vy: 0,
        w: 24,
        h: 18,
        damage: t.heavyProjectile,
        ttl: 55,
        pierce: true,
        bouncesLeft: 0,
        color: '#e11d48',
      });
      state.events.push({ type: 'sfx', key: 'burst', gain: 0.9 });
    } else if (boss.aiTimer === 26) {
      // Rising Upper launch
      boss.vx = boss.facing * 2.0;
      boss.vy = -7.2;
      for (const vxOff of [-2.0, 0, 2.0]) {
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'burst_beam',
          x: bCx - 6,
          y: boss.y - 8,
          vx: vxOff,
          vy: -4.2,
          w: 12,
          h: 16,
          damage: t.mediumProjectile,
          ttl: 50,
          pierce: true,
          bouncesLeft: 0,
          color: '#facc15',
        });
      }
      state.events.push({ type: 'sfx', key: 'sprint_kick', gain: 0.9 });
    } else if (boss.aiTimer === 12) {
      // Heavenly Piledrive slam + twin ground shockwaves
      boss.vx = 0;
      boss.vy = 8.0;
      for (const dir of [-1, 1] as const) {
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'shockwave',
          x: bCx - 8,
          y: boss.arenaBottom - 16,
          vx: dir * 5.2,
          vy: 0,
          w: 16,
          h: 16,
          damage: t.heavyProjectile,
          ttl: 85,
          pierce: true,
          bouncesLeft: 0,
          color: '#e11d48',
        });
      }
      state.events.push(
        { type: 'sfx', key: 'heavy_hit', gain: 0.95 },
        { type: 'shake', ticks: 10, intensity: 3 },
      );
    }
    if (boss.aiTimer <= 0) {
      boss.vx = 0;
      boss.aiState = 'recover';
      boss.aiTimer = 18;
      boss.patternIndex = 0;
    }
    return;
  }

  if (boss.aiState === 'idle') {
    boss.vx *= 0.8;
    boss.facing = pCx >= bCx ? 1 : -1;
    boss.aiTimer -= 1;
    if (boss.aiTimer <= 0) {
      boss.aiState = 'telegraph';
      boss.aiTimer = p2 ? 14 : 20;
      emitTelegraphSpark(state, bCx, bCy, '#e11d48');
    }
    return;
  }

  if (boss.aiState === 'telegraph') {
    boss.vx = 0;
    boss.facing = pCx >= bCx ? 1 : -1;
    boss.aiTimer -= 1;
    if (boss.aiTimer <= 0) {
      boss.aiState = 'attack';
      const pat = boss.patternIndex % 3;
      if (pat === 0) {
        // Sprint + Vault + Dive-Kick + Hookshot Zip Dash
        boss.vx = boss.facing * (p2 ? 5.2 : 4.2);
        boss.vy = -5.6;
        boss.aiTimer = 46;
        state.events.push({ type: 'sfx', key: 'jump', gain: 0.85 });
      } else if (pat === 1) {
        // Burst Flying Strike -> Rising Upper
        boss.vx = boss.facing * (p2 ? 7.2 : 6.0);
        boss.vy = 0;
        boss.aiTimer = 44;
        state.events.push({ type: 'sfx', key: 'burst', gain: 0.9 });
      } else {
        // Gravity Freeze Counter-Pulse + Hookshot Dash
        boss.vx = 0;
        boss.aiTimer = 42;
        state.events.push({ type: 'sfx', key: 'burst_freeze', gain: 0.9 });
      }
    }
    return;
  }

  if (boss.aiState === 'attack') {
    const pat = boss.patternIndex % 3;
    boss.aiTimer -= 1;

    if (pat === 0) {
      // Dive-Kick mid-arc -> Hookshot Zip Dash after landing
      if (boss.aiTimer === 30) {
        boss.facing = pCx >= bCx ? 1 : -1;
        boss.vx = boss.facing * (p2 ? 5.4 : 4.4);
        boss.vy = 5.4;
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'dive_beam',
          x: bCx - 8,
          y: bCy,
          vx: boss.facing * 4.4,
          vy: 4.4,
          w: 16,
          h: 16,
          damage: t.mediumProjectile,
          ttl: 45,
          pierce: true,
          bouncesLeft: 0,
          color: '#fda4af',
        });
        state.events.push({ type: 'sfx', key: 'dive_kick', gain: 0.9 });
      } else if (boss.aiTimer === 14) {
        // Hookshot-style horizontal zip dash
        boss.facing = pCx >= bCx ? 1 : -1;
        boss.vx = boss.facing * (p2 ? 7.4 : 6.2);
        state.events.push({ type: 'sfx', key: 'hook_latch', gain: 0.85 });
      }
      if (boss.aiTimer <= 0) {
        boss.vx = 0;
        boss.aiState = 'recover';
        boss.aiTimer = p2 ? 16 : 22;
        boss.patternIndex += 1;
      }
    } else if (pat === 1) {
      // Flying Strike beam at start -> Rising Upper at mid-timer
      if (boss.aiTimer === 40) {
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'burst_beam',
          x: bCx + boss.facing * 10 - 12,
          y: boss.y + 4,
          vx: boss.facing * (p2 ? 6.8 : 5.6),
          vy: 0,
          w: 24,
          h: 18,
          damage: t.heavyProjectile,
          ttl: 55,
          pierce: true,
          bouncesLeft: 0,
          color: '#e11d48',
        });
      } else if (boss.aiTimer === 18) {
        boss.facing = pCx >= bCx ? 1 : -1;
        boss.vx = boss.facing * 2.4;
        boss.vy = -6.6;
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'burst_beam',
          x: bCx - 8,
          y: boss.y - 10,
          vx: boss.facing * 2.2,
          vy: -4.2,
          w: 16,
          h: 22,
          damage: t.mediumProjectile,
          ttl: 45,
          pierce: true,
          bouncesLeft: 0,
          color: '#facc15',
        });
        state.events.push({ type: 'sfx', key: 'sprint_kick', gain: 0.85 });
      }
      if ((bounds.grounded && boss.aiTimer < 10) || boss.aiTimer <= 0) {
        boss.vx = 0;
        boss.aiState = 'recover';
        boss.aiTimer = p2 ? 16 : 22;
        boss.patternIndex += 1;
      }
    } else {
      // Gravity Freeze radial orbs + Overload follow-up beam
      if (boss.aiTimer === 34) {
        for (let k = 0; k < (p2 ? 8 : 6); k++) {
          const ang = (k * Math.PI * 2) / (p2 ? 8 : 6);
          cb.spawnProjectile(state, {
            owner: 'boss',
            kind: 'phase_ball',
            x: bCx - 4,
            y: bCy - 4,
            vx: Math.cos(ang) * 2.4,
            vy: Math.sin(ang) * 2.4,
            w: 8,
            h: 8,
            damage: t.mediumProjectile,
            ttl: 95,
            pierce: false,
            bouncesLeft: 1,
            color: '#a855f7',
          });
        }
      } else if (boss.aiTimer === 14 && p2) {
        boss.facing = pCx >= bCx ? 1 : -1;
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'burst_beam',
          x: bCx + boss.facing * 12 - 14,
          y: bCy - 8,
          vx: boss.facing * 6.5,
          vy: 0,
          w: 28,
          h: 16,
          damage: t.heavyProjectile,
          ttl: 60,
          pierce: true,
          bouncesLeft: 0,
          color: '#f43f5e',
        });
      }
      if (boss.aiTimer <= 0) {
        boss.aiState = 'recover';
        boss.aiTimer = p2 ? 16 : 22;
        boss.patternIndex += 1;
      }
    }
    return;
  }

  if (boss.aiState === 'recover') {
    boss.vx *= 0.8;
    boss.aiTimer -= 1;
    if (boss.aiTimer <= 0) {
      boss.aiState = 'idle';
      boss.aiTimer = p2 ? 8 : 14;
    }
  }
}

// ============================================================================
// 11. PRISM CORE (Final 2, 48 HP / 32 Desp) — Cycles ALL 8 Rogue Masters via mimicIndex 0..7!
// ============================================================================
const ROGUE_MASTER_COLORS = [
  '#fef08a', // 0: Prism
  '#c9e27c', // 1: Stitch
  '#38bdf8', // 2: Frostfang
  '#facc15', // 3: Arcbolt
  '#f43f5e', // 4: Strider
  '#d946ef', // 5: Tempo
  '#f97316', // 6: Crag
  '#10b981', // 7: Phantom
] as const;

function updatePrismCoreBoss(
  state: SimState,
  boss: BossEntity,
  cb: BossSimCallbacks,
  t: DifficultyDamageTable,
): void {
  const pCx = state.player.x + state.player.w * 0.5;
  const bCx = boss.x + boss.w * 0.5;
  const bCy = boss.y + boss.h * 0.5;
  const centerX = (boss.arenaLeft + boss.arenaRight) * 0.5 - boss.w * 0.5;
  const hoverY = boss.arenaTop + 44 + Math.sin(state.tick * 0.06) * 14;
  const p2 = boss.phase >= 2;
  const mimicIdx = ((boss.mimicIndex % 8) + 8) % 8;
  const mimicColor = ROGUE_MASTER_COLORS[mimicIdx];

  if (boss.aiState === 'desperation') {
    // Core Relay Overdrive: multi-element medley from all Rogue Masters!
    boss.x += (centerX - boss.x) * 0.14;
    boss.y += (boss.arenaTop + 28 - boss.y) * 0.14;
    boss.vx = 0;
    boss.vy = 0;
    clampBossToArena(boss);
    boss.aiTimer -= 1;

    if (boss.aiTimer === 40 || boss.aiTimer === 28 || boss.aiTimer === 16 || boss.aiTimer === 6) {
      const idx = boss.aiTimer === 40 ? 0 : boss.aiTimer === 28 ? 3 : boss.aiTimer === 16 ? 5 : 7;
      const col = ROGUE_MASTER_COLORS[idx];
      for (let k = -2; k <= 2; k++) {
        const ang = k * 0.42;
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: idx === 3 ? 'electric_arc' : idx === 0 ? 'laser_beam' : 'phase_ball',
          x: bCx - 5,
          y: bCy - 5,
          vx: Math.sin(ang) * 4.2,
          vy: Math.cos(ang) * 4.2,
          w: 10,
          h: 10,
          damage: t.mediumProjectile,
          ttl: 100,
          pierce: idx === 0,
          bouncesLeft: idx === 7 ? 1 : 0,
          color: col,
        });
      }
      state.events.push({ type: 'sfx', key: 'burst', gain: 0.85 });
    }
    if (boss.aiTimer <= 0) {
      boss.aiState = 'recover';
      boss.aiTimer = 18;
    }
    return;
  }

  // Smooth orbital hover motion
  const orbitX = centerX + Math.cos(state.tick * 0.03) * 86;
  boss.x += (orbitX - boss.x) * 0.06;
  boss.y += (hoverY - boss.y) * 0.08;
  boss.facing = pCx >= bCx ? 1 : -1;
  clampBossToArena(boss);

  if (boss.aiState === 'idle') {
    boss.aiTimer -= 1;
    if (boss.aiTimer <= 0) {
      boss.aiState = 'telegraph';
      boss.aiTimer = p2 ? 16 : 22;
      state.events.push({
        type: 'particle',
        kind: 'shockring',
        x: bCx,
        y: bCy,
        color: mimicColor,
        count: 10,
      });
    }
    return;
  }

  if (boss.aiState === 'telegraph') {
    boss.aiTimer -= 1;
    if (boss.aiTimer <= 0) {
      boss.aiState = 'attack';
      boss.aiTimer = p2 ? 38 : 34;
    }
    return;
  }

  if (boss.aiState === 'attack') {
    boss.aiTimer -= 1;
    const fireMain = boss.aiTimer === 26;
    const fireP2 = p2 && boss.aiTimer === 10;

    if (fireMain || fireP2) {
      switch (mimicIdx) {
        case 0: {
          // Mimic 0: Prism — Solar laser sweep & bouncing darts
          for (const a of [-0.45, 0, 0.45]) {
            cb.spawnProjectile(state, {
              owner: 'boss',
              kind: 'laser_beam',
              x: bCx - 5,
              y: bCy - 5,
              vx: Math.sin(a) * 4.5,
              vy: Math.cos(a) * 4.5,
              w: 10,
              h: 12,
              damage: t.heavyProjectile,
              ttl: 95,
              pierce: true,
              bouncesLeft: 1,
              color: mimicColor,
            });
          }
          break;
        }
        case 1: {
          // Mimic 1: Stitch — Magnetic pull + bouncing scrap blocks
          state.player.vx += (bCx >= pCx ? 1 : -1) * 1.4;
          for (const vx of [-2.8, 0, 2.8]) {
            cb.spawnProjectile(state, {
              owner: 'boss',
              kind: 'enemy_shot',
              x: bCx - 6,
              y: bCy - 6,
              vx,
              vy: -2.4,
              w: 12,
              h: 12,
              damage: t.mediumProjectile,
              ttl: 110,
              pierce: false,
              bouncesLeft: 2,
              color: mimicColor,
            });
          }
          break;
        }
        case 2: {
          // Mimic 2: Frostfang — Ceiling icicle volley
          const span = boss.arenaRight - boss.arenaLeft;
          for (let k = 0; k < 4; k++) {
            cb.spawnProjectile(state, {
              owner: 'boss',
              kind: 'dive_beam',
              x: boss.arenaLeft + 28 + (span - 56) * (k / 3) - 4,
              y: boss.arenaTop + 2,
              vx: 0,
              vy: 4.5,
              w: 8,
              h: 18,
              damage: t.mediumProjectile,
              ttl: 85,
              pierce: false,
              bouncesLeft: 0,
              color: mimicColor,
            });
          }
          break;
        }
        case 3: {
          // Mimic 3: Arcbolt — Overhead thunderbolts + floor surge
          for (const off of [-60, 0, 60]) {
            const lx = Math.max(boss.arenaLeft + 10, Math.min(boss.arenaRight - 22, pCx + off));
            cb.spawnProjectile(state, {
              owner: 'boss',
              kind: 'electric_arc',
              x: lx,
              y: boss.arenaTop,
              vx: 0,
              vy: 5.4,
              w: 12,
              h: 24,
              damage: t.heavyProjectile,
              ttl: 60,
              pierce: true,
              bouncesLeft: 0,
              color: mimicColor,
            });
          }
          break;
        }
        case 4: {
          // Mimic 4: Strider — Aimed wind-scythe dive blades
          const dx = pCx - bCx;
          const dy = state.player.y + state.player.h * 0.5 - bCy;
          const dist = Math.max(1, Math.hypot(dx, dy));
          for (const spread of [-0.22, 0, 0.22]) {
            const ang = Math.atan2(dy / dist, dx / dist) + spread;
            cb.spawnProjectile(state, {
              owner: 'boss',
              kind: 'burst_beam',
              x: bCx - 8,
              y: bCy - 6,
              vx: Math.cos(ang) * 4.8,
              vy: Math.sin(ang) * 4.8,
              w: 16,
              h: 12,
              damage: t.mediumProjectile,
              ttl: 90,
              pierce: true,
              bouncesLeft: 0,
              color: mimicColor,
            });
          }
          break;
        }
        case 5: {
          // Mimic 5: Tempo — Radial 6-way sonic ring
          for (let k = 0; k < 6; k++) {
            const ang = (k * Math.PI) / 3 + (fireP2 ? 0.26 : 0);
            cb.spawnProjectile(state, {
              owner: 'boss',
              kind: 'phase_ball',
              x: bCx - 4,
              y: bCy - 4,
              vx: Math.cos(ang) * 3.8,
              vy: Math.sin(ang) * 3.8,
              w: 8,
              h: 8,
              damage: t.lightProjectile,
              ttl: 100,
              pierce: false,
              bouncesLeft: 1,
              color: mimicColor,
            });
          }
          break;
        }
        case 6: {
          // Mimic 6: Crag — Rising seismic ground pillars
          for (const off of [-84, 0, 84]) {
            const px = Math.max(boss.arenaLeft + 16, Math.min(boss.arenaRight - 32, pCx + off));
            cb.spawnProjectile(state, {
              owner: 'boss',
              kind: 'shockwave',
              x: px - 8,
              y: boss.arenaBottom - 16,
              vx: 0,
              vy: -3.5,
              w: 16,
              h: 22,
              damage: t.heavyProjectile,
              ttl: 44,
              pierce: true,
              bouncesLeft: 0,
              color: mimicColor,
            });
          }
          break;
        }
        case 7: {
          // Mimic 7: Phantom — Cross-arena neon shuriken volley
          for (let k = -2; k <= 2; k++) {
            cb.spawnProjectile(state, {
              owner: 'boss',
              kind: 'phase_ball',
              x: bCx - 4,
              y: bCy - 4,
              vx: boss.facing * 4.2,
              vy: k * 1.15,
              w: 8,
              h: 8,
              damage: t.mediumProjectile,
              ttl: 105,
              pierce: false,
              bouncesLeft: 1,
              color: mimicColor,
            });
          }
          break;
        }
      }
      state.events.push({ type: 'sfx', key: 'burst', gain: 0.8 });
    }

    if (boss.aiTimer <= 0) {
      // Advance cyclically through ALL 8 Rogue Masters (0..7)
      boss.mimicIndex = (mimicIdx + 1) % 8;
      boss.patternIndex += 1;
      boss.aiState = 'recover';
      boss.aiTimer = p2 ? 16 : 22;
    }
    return;
  }

  if (boss.aiState === 'recover') {
    boss.aiTimer -= 1;
    if (boss.aiTimer <= 0) {
      boss.aiState = 'idle';
      boss.aiTimer = p2 ? 10 : 14;
    }
  }
}

// ============================================================================
// 12. OVERLORD APEX (Final 3, 48 HP / 32 Desp) — Multi-part partsHp + 3 Phases!
// ============================================================================
function syncOverlordParts(state: SimState, boss: BossEntity): void {
  const prevLeft = boss.partsHp[0];
  const prevRight = boss.partsHp[1];

  const targetLeft =
    boss.hp > 32 ? Math.max(0, Math.min(16, Math.ceil((boss.hp - 40) * 2))) : 0;
  const targetRight =
    boss.hp > 32 ? Math.max(0, Math.min(16, Math.ceil((boss.hp - 32) * 2))) : 0;
  const targetEye = Math.max(0, boss.hp);

  if (prevLeft > 0 && targetLeft === 0) {
    state.events.push(
      { type: 'sfx', key: 'explosion', gain: 0.9 },
      { type: 'shake', ticks: 12, intensity: 3 },
      {
        type: 'particle',
        kind: 'explosion',
        x: boss.x - 16,
        y: boss.y + boss.h * 0.5,
        color: '#f59e0b',
        count: 14,
      },
      { type: 'toast', text: 'OVERLORD LEFT HAND SHATTERED!', tone: 'info' },
    );
  }
  if (prevRight > 0 && targetRight === 0) {
    state.events.push(
      { type: 'sfx', key: 'explosion', gain: 0.9 },
      { type: 'shake', ticks: 12, intensity: 3 },
      {
        type: 'particle',
        kind: 'explosion',
        x: boss.x + boss.w + 16,
        y: boss.y + boss.h * 0.5,
        color: '#f59e0b',
        count: 14,
      },
      { type: 'toast', text: 'OVERLORD RIGHT HAND SHATTERED!', tone: 'info' },
    );
  }

  boss.partsHp = [targetLeft, targetRight, targetEye];
}

function updateOverlordApexBoss(
  state: SimState,
  boss: BossEntity,
  cb: BossSimCallbacks,
  t: DifficultyDamageTable,
): void {
  syncOverlordParts(state, boss);

  const pCx = state.player.x + state.player.w * 0.5;
  const bCx = boss.x + boss.w * 0.5;
  const bCy = boss.y + boss.h * 0.5;
  const centerX = (boss.arenaLeft + boss.arenaRight) * 0.5 - boss.w * 0.5;
  const p2 = boss.phase >= 2;
  const p3 = boss.phase >= 3;

  // Phase 3 final shift below 16 HP!
  if (boss.phase === 2 && boss.hp > 0 && boss.hp <= 16) {
    boss.phase = 3;
    boss.desperationBannerTicks = 75;
    boss.aiState = 'desperation';
    boss.aiTimer = 75;
    boss.invulnTimer = 45;
    boss.vx = 0;
    boss.vy = 0;
    state.events.push(
      { type: 'sfx', key: 'boss_desperation' },
      { type: 'shake', ticks: 20, intensity: 4 },
      { type: 'rumble', weak: 0.6, strong: 1.0, durationMs: 360 },
      {
        type: 'particle',
        kind: 'shockring',
        x: bCx,
        y: bCy,
        color: '#ff3b5c',
        count: 18,
      },
      { type: 'toast', text: 'OVERLORD APEX — FINAL CIRCUIT!', tone: 'warn' },
    );
  }

  if (boss.aiState === 'desperation') {
    // Phase 2 / Phase 3 Desperation Overdrive: Forehead Laser Sweep + Radial Plasma Storm!
    boss.x += (centerX - boss.x) * 0.14;
    boss.y += (boss.arenaTop + 26 - boss.y) * 0.14;
    boss.vx = 0;
    boss.vy = 0;
    clampBossToArena(boss);
    boss.aiTimer -= 1;

    if (boss.aiTimer === 40 || boss.aiTimer === 26 || boss.aiTimer === 12) {
      const fanCount = p3 ? 7 : 5;
      for (let k = 0; k < fanCount; k++) {
        const ang = -0.85 + (k / (fanCount - 1)) * 1.7;
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'laser_beam',
          x: bCx - 6,
          y: boss.y + 10,
          vx: Math.sin(ang) * (p3 ? 5.0 : 4.2),
          vy: Math.cos(ang) * (p3 ? 5.0 : 4.2),
          w: 12,
          h: 12,
          damage: t.heavyProjectile,
          ttl: 95,
          pierce: true,
          bouncesLeft: 0,
          color: p3 ? '#ff3b5c' : '#f59e0b',
        });
      }
      if (boss.aiTimer === 12) {
        for (const dir of [-1, 1] as const) {
          cb.spawnProjectile(state, {
            owner: 'boss',
            kind: 'shockwave',
            x: bCx - 8,
            y: boss.arenaBottom - 16,
            vx: dir * (p3 ? 5.4 : 4.4),
            vy: 0,
            w: 16,
            h: 16,
            damage: t.heavyProjectile,
            ttl: 90,
            pierce: true,
            bouncesLeft: 0,
            color: '#9333ea',
          });
        }
      }
      state.events.push(
        { type: 'sfx', key: 'burst', gain: 0.95 },
        { type: 'shake', ticks: 8, intensity: 3 },
      );
    }
    if (boss.aiTimer <= 0) {
      boss.aiState = 'recover';
      boss.aiTimer = p3 ? 14 : 20;
      boss.patternIndex = 0;
    }
    return;
  }

  // Phase 1 hovers like a sovereign colossus; Phase 2/3 descends as agile Apex Commander
  const targetHoverY = p2 ? boss.arenaBottom - boss.h - 14 : boss.arenaTop + 26;
  const targetHoverX = p2
    ? centerX + Math.sin(state.tick * 0.05) * 95
    : centerX + Math.sin(state.tick * 0.025) * 44;

  if (boss.aiState !== 'attack' || boss.patternIndex % 3 !== 2 || !p2) {
    boss.x += (targetHoverX - boss.x) * (p2 ? 0.08 : 0.06);
    boss.y += (targetHoverY - boss.y) * 0.08;
  } else {
    boss.x += boss.vx;
    boss.y += boss.vy;
  }
  boss.facing = pCx >= bCx ? 1 : -1;
  clampBossToArena(boss);

  if (boss.aiState === 'idle') {
    boss.vx *= 0.8;
    boss.aiTimer -= 1;
    if (boss.aiTimer <= 0) {
      boss.aiState = 'telegraph';
      boss.aiTimer = p3 ? 14 : p2 ? 18 : 24;
      emitTelegraphSpark(state, bCx, boss.y + 12, p3 ? '#ff3b5c' : '#f59e0b');
    }
    return;
  }

  if (boss.aiState === 'telegraph') {
    boss.vx = 0;
    boss.vy = 0;
    boss.aiTimer -= 1;
    if (boss.aiTimer <= 0) {
      boss.aiState = 'attack';
      const pat = boss.patternIndex % 3;
      if (pat === 0) {
        // Phase 1: Hand Slams | Phase 2/3: Apex Shockwave Barrage
        boss.aiTimer = p3 ? 42 : 46;
      } else if (pat === 1) {
        // Forehead Laser Sweep
        boss.aiTimer = p3 ? 46 : 42;
      } else {
        // Phase 1: Drone Summons + Orbital Orbs | Phase 2/3: Apex Commander Blitz + Drones
        if (p2) {
          boss.vx = boss.facing * (p3 ? 6.8 : 5.4);
          boss.vy = 0;
        }
        boss.aiTimer = 44;
      }
    }
    return;
  }

  if (boss.aiState === 'attack') {
    const pat = boss.patternIndex % 3;
    boss.aiTimer -= 1;

    if (pat === 0) {
      // Hand Slams (reflecting live left/right hand partsHp in Phase 1!)
      const leftAlive = boss.partsHp[0] > 0;
      const rightAlive = boss.partsHp[1] > 0;
      if (boss.aiTimer === 34 || boss.aiTimer === 16) {
        const isLeftWave = boss.aiTimer === 34;
        const slamX = isLeftWave
          ? boss.arenaLeft + (boss.arenaRight - boss.arenaLeft) * 0.28
          : boss.arenaLeft + (boss.arenaRight - boss.arenaLeft) * 0.72;
        if (!p2 && ((isLeftWave && leftAlive) || (!isLeftWave && rightAlive) || (!leftAlive && !rightAlive))) {
          // Slam shockwaves radiating from impact zone
          for (const dir of [-1, 1] as const) {
            cb.spawnProjectile(state, {
              owner: 'boss',
              kind: 'shockwave',
              x: slamX - 8,
              y: boss.arenaBottom - 16,
              vx: dir * 3.8,
              vy: 0,
              w: 16,
              h: 16,
              damage: t.heavyProjectile,
              ttl: 85,
              pierce: true,
              bouncesLeft: 0,
              color: '#f59e0b',
            });
          }
          state.events.push(
            { type: 'sfx', key: 'heavy_hit', gain: 0.9 },
            { type: 'shake', ticks: 9, intensity: 3 },
          );
        } else {
          // Phase 2/3 Apex Commander twin-tier shockwaves + orbital bolts
          for (const dir of [-1, 1] as const) {
            cb.spawnProjectile(state, {
              owner: 'boss',
              kind: 'shockwave',
              x: bCx - 8,
              y: boss.arenaBottom - 16,
              vx: dir * (p3 ? 5.2 : 4.4),
              vy: 0,
              w: 16,
              h: 16,
              damage: t.heavyProjectile,
              ttl: 90,
              pierce: true,
              bouncesLeft: 0,
              color: p3 ? '#ff3b5c' : '#9333ea',
            });
          }
          state.events.push({ type: 'sfx', key: 'heavy_hit', gain: 0.9 });
        }
      }
      if (boss.aiTimer <= 0) {
        boss.aiState = 'recover';
        boss.aiTimer = p3 ? 14 : 22;
        boss.patternIndex += 1;
      }
    } else if (pat === 1) {
      // Forehead Eye Core Laser Sweep
      const step = p3 ? 8 : 10;
      if (boss.aiTimer % step === 0 && boss.aiTimer > 0) {
        const sweepIdx = Math.floor((42 - boss.aiTimer) / step);
        const sweepAng = -0.65 + sweepIdx * 0.32;
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'laser_beam',
          x: bCx - 6,
          y: boss.y + 10,
          vx: Math.sin(sweepAng) * (p3 ? 5.2 : 4.3),
          vy: Math.cos(sweepAng) * (p3 ? 5.2 : 4.3),
          w: 12,
          h: 14,
          damage: t.heavyProjectile,
          ttl: 90,
          pierce: true,
          bouncesLeft: 0,
          color: p3 ? '#ff3b5c' : '#f59e0b',
        });
        state.events.push({ type: 'sfx', key: 'burst', gain: 0.75 });
      }
      if (boss.aiTimer <= 0) {
        boss.aiState = 'recover';
        boss.aiTimer = p3 ? 14 : 22;
        boss.patternIndex += 1;
      }
    } else {
      // Drone Summons + Orbital Orbs (and Apex Commander Dash Slash in P2/P3)
      if (boss.aiTimer === 34) {
        let aliveDrones = 0;
        for (let i = 0; i < state.enemies.length; i++) {
          if (!state.enemies[i].dead) aliveDrones++;
        }
        if (aliveDrones < 2) {
          spawnEnemyFromArchetype(
            state,
            'citadel_interceptor',
            Math.max(boss.arenaLeft + 16, Math.min(boss.arenaRight - 36, bCx - 48)),
            boss.arenaTop + 28,
            `apex_drone_${state.tick}`,
          );
        }
        for (let k = 0; k < (p3 ? 6 : 4); k++) {
          const ang = (k * Math.PI * 2) / (p3 ? 6 : 4);
          cb.spawnProjectile(state, {
            owner: 'boss',
            kind: 'phase_ball',
            x: bCx - 5,
            y: bCy - 5,
            vx: Math.cos(ang) * 3.4,
            vy: Math.sin(ang) * 3.4,
            w: 10,
            h: 10,
            damage: t.mediumProjectile,
            ttl: 100,
            pierce: false,
            bouncesLeft: 1,
            color: '#e9d5ff',
          });
        }
        state.events.push({ type: 'sfx', key: 'switch', gain: 0.85 });
      }
      if (p2 && boss.aiTimer === 16) {
        boss.facing = pCx >= bCx ? 1 : -1;
        boss.vx = boss.facing * (p3 ? 7.0 : 5.6);
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'burst_beam',
          x: bCx + boss.facing * 16 - 12,
          y: bCy - 8,
          vx: boss.facing * 5.8,
          vy: 0,
          w: 24,
          h: 16,
          damage: t.heavyProjectile,
          ttl: 65,
          pierce: true,
          bouncesLeft: 0,
          color: '#ff3b5c',
        });
        state.events.push({ type: 'sfx', key: 'sprint_kick', gain: 0.9 });
      }
      if (boss.aiTimer <= 0) {
        boss.vx = 0;
        boss.aiState = 'recover';
        boss.aiTimer = p3 ? 14 : 20;
        boss.patternIndex += 1;
      }
    }
    return;
  }

  if (boss.aiState === 'recover') {
    boss.vx *= 0.8;
    boss.aiTimer -= 1;
    if (boss.aiTimer <= 0) {
      boss.aiState = 'idle';
      boss.aiTimer = p3 ? 8 : p2 ? 12 : 16;
    }
  }
}

// ============================================================================
// Master Boss Dispatch & Lifecycle (Zero Generic Fallback!)
// ============================================================================

export function updateBoss(state: SimState, cb: BossSimCallbacks): void {
  const boss = state.boss;
  if (!boss) return;

  const def = getBossDefinition(boss.bossId);
  const { cellX, cellY } = ensureBossArenaBounds(state, boss);
  const player = state.player;
  const pCx = player.x + player.w * 0.5;
  const pCy = player.y + player.h * 0.5;

  if (boss.hurtFlash > 0) boss.hurtFlash -= 1;
  if (boss.invulnTimer > 0) boss.invulnTimer -= 1;
  if (boss.desperationBannerTicks > 0) boss.desperationBannerTicks -= 1;

  // Rude Mode launch reduction: bosses tech-recover after just 2 armor-break launches (vs 3 normal)
  if (state.progression.modifiers.rudeEnemies && boss.launchHits >= 2 && boss.techRecoverTimer <= 0) {
    boss.techRecoverTimer = BOSS_CONSTANTS.TECH_RECOVER_TICKS;
    boss.launchHits = 0;
  }

  // 90-tick Tech Recover flip impulse when juggle threshold triggers
  if (boss.techRecoverTimer > 0) {
    const justTriggered = boss.techRecoverTimer === BOSS_CONSTANTS.TECH_RECOVER_TICKS;
    boss.techRecoverTimer -= 1;
    if (justTriggered && boss.active && !boss.defeated && boss.aiState !== 'intro') {
      const bCx = boss.x + boss.w * 0.5;
      const fleeDir: -1 | 1 = pCx >= bCx ? -1 : 1;
      boss.vx = fleeDir * 3.8;
      boss.vy = -4.2;
      boss.invulnTimer = Math.max(boss.invulnTimer, 22);
      boss.aiState = 'idle';
      boss.aiTimer = 10;
      state.events.push(
        { type: 'sfx', key: 'jump', gain: 0.85 },
        {
          type: 'particle',
          kind: 'shockring',
          x: bCx,
          y: boss.y + boss.h * 0.5,
          color: '#38f8ff',
          count: 10,
        },
      );
    }
  }

  // Defeat handling
  if (boss.hp <= 0 && !boss.defeated) {
    boss.hp = 0;
    boss.partsHp = [0, 0, 0];
    boss.defeated = true;
    boss.active = false;
    boss.aiState = 'defeated';
    boss.aiTimer = 90;
    boss.vx = 0;
    boss.vy = 0;
    state.camera.lockedBossArena = false;
    state.events.push(
      { type: 'sfx', key: 'explosion' },
      { type: 'shake', ticks: 24, intensity: 4 },
      { type: 'rumble', weak: 0.6, strong: 1.0, durationMs: 450 },
      {
        type: 'particle',
        kind: 'explosion',
        x: boss.x + boss.w * 0.5,
        y: boss.y + boss.h * 0.5,
        color: def.palette[4],
        count: 18,
      },
      { type: 'toast', text: `${boss.name.toUpperCase()} DEFEATED!`, tone: 'unlock' },
    );
    cb.onBossDefeated(state, boss);
    return;
  }

  if (boss.defeated) {
    if (boss.aiTimer > 0) boss.aiTimer -= 1;
    return;
  }

  // Activate boss arena when player enters boss cell
  if (!boss.active) {
    const cellLeft = cellX * CELL_PX_W;
    const cellTop = cellY * CELL_PX_H;
    const inBossCell =
      pCx >= cellLeft + 12 &&
      pCx <= cellLeft + CELL_PX_W &&
      pCy >= cellTop &&
      pCy <= cellTop + CELL_PX_H;

    if (inBossCell) {
      boss.active = true;
      boss.aiState = 'intro';
      boss.aiTimer = 90;
      boss.invulnTimer = 90;
      boss.facing = pCx >= boss.x ? 1 : -1;
      state.camera.lockedBossArena = true;
      state.camera.targetX = cellLeft;
      state.camera.targetY = cellTop;
      state.camera.cellX = cellX;
      state.camera.cellY = cellY;
      state.events.push(
        { type: 'bossIntro', bossId: boss.bossId, name: boss.name, title: def.title },
        { type: 'bgm', key: def.bgmKey, fadeMs: 200 },
        { type: 'sfx', key: 'boss_intro' },
        { type: 'shake', ticks: 12, intensity: 2 },
      );
    }
    return;
  }

  // 90-tick intro pose countdown
  if (boss.aiState === 'intro') {
    if (boss.bossId !== 'prism_core' && boss.bossId !== 'overlord_apex') {
      boss.vy += GRAVITY;
      boss.y += boss.vy;
    }
    clampBossToArena(boss);
    boss.aiTimer -= 1;
    if (boss.aiTimer <= 0) {
      boss.aiState = 'idle';
      boss.aiTimer = 14;
    }
    return;
  }

  // Desperation trigger at threshold HP (75-tick banner!)
  if (!boss.desperationTriggered && boss.hp <= boss.desperationHp) {
    boss.desperationTriggered = true;
    boss.phase = 2;
    boss.desperationBannerTicks = 75;
    boss.aiState = 'desperation';
    boss.aiTimer = 75;
    boss.invulnTimer = 60;
    boss.vx = 0;
    boss.vy = 0;
    if (boss.bossId === 'overlord_apex') {
      state.events.push({ type: 'bgm', key: 'bgm_boss_final_3_p2', fadeMs: 200 });
    }
    state.events.push(
      { type: 'sfx', key: 'boss_desperation' },
      { type: 'shake', ticks: 18, intensity: 4 },
      { type: 'rumble', weak: 0.5, strong: 0.9, durationMs: 320 },
      {
        type: 'particle',
        kind: 'shockring',
        x: boss.x + boss.w * 0.5,
        y: boss.y + boss.h * 0.5,
        color: def.palette[4],
        count: 14,
      },
      {
        type: 'toast',
        text:
          boss.bossId === 'mirror_rival'
            ? 'UNIT K-00 MIRROR — FUNCTION OVERLOAD!'
            : `${boss.name.toUpperCase()} — OVERDRIVE!`,
        tone: 'warn',
      },
    );
  }

  const table = DAMAGE_TABLES[state.progression.difficulty];

  // Exhaustive bespoke dispatch across ALL 12 Bosses (zero generic fallback!)
  switch (boss.bossId) {
    case 'siege_tread':
      updateSiegeTread(state, boss, cb, table);
      break;
    case 'prism':
      updatePrismBoss(state, boss, cb, table);
      break;
    case 'stitch':
      updateStitchBoss(state, boss, cb, table);
      break;
    case 'frostfang':
      updateFrostfangBoss(state, boss, cb, table);
      break;
    case 'arcbolt':
      updateArcboltBoss(state, boss, cb, table);
      break;
    case 'strider':
      updateStriderBoss(state, boss, cb, table);
      break;
    case 'tempo':
      updateTempoBoss(state, boss, cb, table);
      break;
    case 'crag':
      updateCragBoss(state, boss, cb, table);
      break;
    case 'phantom':
      updatePhantomBoss(state, boss, cb, table);
      break;
    case 'mirror_rival':
      updateMirrorRivalBoss(state, boss, cb, table);
      break;
    case 'prism_core':
      updatePrismCoreBoss(state, boss, cb, table);
      break;
    case 'overlord_apex':
      updateOverlordApexBoss(state, boss, cb, table);
      break;
    default: {
      const _exhaustive: never = boss.bossId;
      void _exhaustive;
    }
  }

  // Boss-to-player contact damage
  if (
    boss.aiState !== 'desperation' &&
    player.invulnTimer <= 0 &&
    player.action !== 'dead' &&
    player.action !== 'warp' &&
    aabbOverlap(player.x, player.y, player.w, player.h, boss.x, boss.y, boss.w, boss.h)
  ) {
    const heavyBoss =
      boss.bossId === 'siege_tread' ||
      boss.bossId === 'crag' ||
      boss.bossId === 'overlord_apex';
    const contactDmg = heavyBoss ? table.heavyContact : table.mediumContact;
    cb.damagePlayer(state, contactDmg, boss.x + boss.w * 0.5);
  }
}
