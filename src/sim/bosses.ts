import {
  BOSS_CONSTANTS,
  DAMAGE_TABLES,
  ENGINE_CONSTANTS,
  type BossEntity,
  type BossId,
  type Difficulty,
  type ProjectileEntity,
  type SimState,
} from '../contracts/index';
import { getBossDefinition, getStageDefinition } from '../data/index';

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

function clampBossToArena(boss: BossEntity): { hitLeft: boolean; hitRight: boolean; grounded: boolean } {
  let hitLeft = false;
  let hitRight = false;
  let grounded = false;

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
    partsHp: def.isFinal ? [16, 16, maxHp] : [0, 0, maxHp],
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

function updateSiegeTread(
  state: SimState,
  boss: BossEntity,
  cb: BossSimCallbacks,
  projLight: number,
  projMed: number,
  explosionDmg: number,
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
    boss.vx = 0;
    boss.aiTimer -= 1;
    // Overdrive mortar shower during desperation activation finish
    if (boss.aiTimer === 40 || boss.aiTimer === 24 || boss.aiTimer === 10) {
      const spreadVx = (boss.aiTimer === 40 ? -3.4 : boss.aiTimer === 24 ? -2.0 : -4.4) * (bCx > pCx ? 1 : -1);
      cb.spawnProjectile(state, {
        owner: 'boss',
        kind: 'shockwave',
        x: bCx - 6,
        y: boss.y + 4,
        vx: spreadVx,
        vy: -5.2,
        w: 10,
        h: 10,
        damage: explosionDmg,
        ttl: 110,
        pierce: false,
        bouncesLeft: 1,
        color: '#ff6b4a',
      });
    }
    if (boss.aiTimer <= 0) {
      boss.aiState = 'telegraph';
      boss.patternIndex = 0;
      boss.aiTimer = 24;
      boss.facing = pCx >= bCx ? 1 : -1;
    }
    return;
  }

  if (boss.aiState === 'idle') {
    boss.vx *= 0.8;
    boss.facing = pCx >= bCx ? 1 : -1;
    boss.aiTimer -= 1;
    if (boss.aiTimer <= 0) {
      boss.aiState = 'telegraph';
      boss.aiTimer = p2 ? 22 : 30;
      state.events.push({
        type: 'particle',
        kind: 'spark',
        x: bCx,
        y: bCy,
        color: '#fbbf24',
        count: 6,
      });
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
      const pat = boss.patternIndex % 3;
      if (pat === 0) {
        // Pattern 0: Armored Ram Charge
        boss.vx = boss.facing * (p2 ? 6.2 : 4.9);
        boss.aiTimer = 85;
        state.events.push({ type: 'sfx', key: 'sprint_kick', gain: 0.9 });
      } else if (pat === 1) {
        // Pattern 1: Mortar Bomb Barrage
        boss.vx = 0;
        boss.aiTimer = p2 ? 60 : 48;
      } else {
        // Pattern 2: Twin Turret Spread
        boss.vx = 0;
        boss.aiTimer = p2 ? 52 : 36;
      }
    }
    return;
  }

  if (boss.aiState === 'attack') {
    const pat = boss.patternIndex % 3;
    boss.aiTimer -= 1;

    if (pat === 0) {
      // Ram across arena until hitting wall
      if ((boss.facing > 0 && bounds.hitRight) || (boss.facing < 0 && bounds.hitLeft)) {
        boss.vx = 0;
        state.events.push(
          { type: 'sfx', key: 'heavy_hit' },
          { type: 'shake', ticks: 10, intensity: 3 },
        );
        // Ground shockwave traveling inward across arena floor
        const waveDir = bounds.hitRight ? -1 : 1;
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'shockwave',
          x: bCx - 8,
          y: boss.arenaBottom - 14,
          vx: waveDir * (p2 ? 4.4 : 3.4),
          vy: 0,
          w: 14,
          h: 14,
          damage: projMed,
          ttl: 95,
          pierce: true,
          bouncesLeft: 0,
          color: '#ff7b3a',
        });
        boss.aiState = 'recover';
        boss.aiTimer = p2 ? 26 : 38;
        boss.patternIndex += 1;
        return;
      }
      if (boss.aiTimer <= 0) {
        boss.vx = 0;
        boss.aiState = 'recover';
        boss.aiTimer = 30;
        boss.patternIndex += 1;
      }
    } else if (pat === 1) {
      // Launch staggered parabolic mortar bombs
      const fireEvery = p2 ? 11 : 14;
      if (boss.aiTimer % fireEvery === 0) {
        const idx = Math.floor(boss.aiTimer / fireEvery);
        const speedX = (2.1 + idx * 0.75) * boss.facing;
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'enemy_shot',
          x: bCx - 5,
          y: boss.y + 4,
          vx: speedX,
          vy: -4.2,
          w: 10,
          h: 10,
          damage: explosionDmg,
          ttl: 95,
          pierce: false,
          bouncesLeft: 1,
          color: '#fbbf24',
        });
        state.events.push({ type: 'sfx', key: 'throw', gain: 0.75 });
      }
      if (boss.aiTimer <= 0) {
        boss.aiState = 'recover';
        boss.aiTimer = p2 ? 24 : 34;
        boss.patternIndex += 1;
      }
    } else {
      // Twin Turret 3-way Spread
      const shouldFire = boss.aiTimer === 30 || (p2 && boss.aiTimer === 12);
      if (shouldFire) {
        const angles = [-0.28, 0, 0.28];
        const speed = p2 ? 4.1 : 3.4;
        for (const a of angles) {
          cb.spawnProjectile(state, {
            owner: 'boss',
            kind: 'enemy_shot',
            x: bCx + boss.facing * 20 - 4,
            y: bCy - 4,
            vx: boss.facing * Math.cos(a) * speed,
            vy: Math.sin(a) * speed,
            w: 8,
            h: 8,
            damage: projLight,
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
        boss.aiTimer = p2 ? 24 : 34;
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
      boss.aiTimer = p2 ? 12 : 20;
    }
  }
}

function updatePrismBoss(
  state: SimState,
  boss: BossEntity,
  cb: BossSimCallbacks,
  projLight: number,
  projMed: number,
  projHeavy: number,
): void {
  const player = state.player;
  const pCx = player.x + player.w * 0.5;
  const bCx = boss.x + boss.w * 0.5;
  const bCy = boss.y + boss.h * 0.5;
  const centerX = (boss.arenaLeft + boss.arenaRight) * 0.5 - boss.w * 0.5;
  const hoverTopY = boss.arenaTop + 26;
  const p2 = boss.phase >= 2;

  if (boss.aiState === 'desperation') {
    // Dramatic Overdrive: rise to arena center and fire multi-laser prism fan!
    boss.x += (centerX - boss.x) * 0.14;
    boss.y += (hoverTopY - boss.y) * 0.14;
    boss.vx = 0;
    boss.vy = 0;
    boss.aiTimer -= 1;

    if (boss.aiTimer === 48) {
      state.events.push({
        type: 'particle',
        kind: 'shockring',
        x: bCx,
        y: bCy,
        color: '#fef08a',
        count: 14,
      });
    }
    if (boss.aiTimer === 32 || boss.aiTimer === 14) {
      const fanAngles =
        boss.aiTimer === 32
          ? [-0.55, -0.18, 0.18, 0.55]
          : [-0.75, -0.35, 0, 0.35, 0.75];
      for (const a of fanAngles) {
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'laser_beam',
          x: bCx - 5,
          y: bCy - 5,
          vx: Math.sin(a) * 4.2,
          vy: Math.cos(a) * 4.2,
          w: 10,
          h: 10,
          damage: projMed,
          ttl: 100,
          pierce: true,
          bouncesLeft: 1,
          color: '#ffdf5e',
        });
      }
      state.events.push(
        { type: 'sfx', key: 'burst', gain: 0.9 },
        { type: 'shake', ticks: 8, intensity: 3 },
      );
    }
    if (boss.aiTimer <= 0) {
      boss.aiState = 'recover';
      boss.aiTimer = 28;
      boss.patternIndex = 0;
    }
    return;
  }

  // Pattern 3 (P2 Aerial Prism Barrage) hovers; other patterns use gravity
  const patCount = p2 ? 4 : 3;
  const currentPat = boss.patternIndex % patCount;
  const isAerialBarrage = boss.aiState === 'attack' && currentPat === 3;

  if (!isAerialBarrage) {
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
      boss.aiTimer = p2 ? 20 : 28;
      state.events.push({
        type: 'particle',
        kind: 'spark',
        x: bCx,
        y: bCy - 6,
        color: '#fef08a',
        count: 6,
      });
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
        // Pattern 0: Solar Beam Sweep
        boss.aiTimer = p2 ? 56 : 44;
      } else if (currentPat === 1) {
        // Pattern 1: Mirror Bounce Darts (leap & fire bouncing prisms)
        boss.vy = -5.6;
        boss.vx = (centerX - boss.x) * 0.04;
        boss.aiTimer = 52;
      } else if (currentPat === 2) {
        // Pattern 2: Solar Dash Slash
        boss.vx = boss.facing * (p2 ? 6.4 : 5.4);
        boss.aiTimer = 34;
        state.events.push({ type: 'sfx', key: 'sprint_kick' });
      } else {
        // Pattern 3 (P2): Aerial Prism Barrage
        boss.vx = 0;
        boss.vy = 0;
        boss.aiTimer = 72;
      }
    }
    return;
  }

  if (boss.aiState === 'attack') {
    boss.aiTimer -= 1;

    if (currentPat === 0) {
      // Solar Beam Sweep: fire bright horizontal sweeping beam segments
      if (boss.aiTimer === 36 || (p2 && boss.aiTimer === 18)) {
        const yOff = boss.aiTimer === 36 ? boss.h - 14 : 6;
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'laser_beam',
          x: bCx + boss.facing * 18 - 12,
          y: boss.y + yOff,
          vx: boss.facing * (p2 ? 5.6 : 4.6),
          vy: 0,
          w: 24,
          h: 10,
          damage: projHeavy,
          ttl: 85,
          pierce: true,
          bouncesLeft: 0,
          color: '#ffdf5e',
        });
        state.events.push(
          { type: 'sfx', key: 'burst', gain: 0.85 },
          { type: 'shake', ticks: 6, intensity: 2 },
        );
      }
      if (boss.aiTimer <= 0) {
        boss.aiState = 'recover';
        boss.aiTimer = p2 ? 22 : 32;
        boss.patternIndex += 1;
      }
    } else if (currentPat === 1) {
      // Mirror Bounce Darts fired near apex
      if (boss.aiTimer === 34 || boss.aiTimer === 22 || (p2 && boss.aiTimer === 10)) {
        const spread = boss.aiTimer === 34 ? -0.35 : boss.aiTimer === 22 ? 0.15 : 0.45;
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'phase_ball',
          x: bCx - 4,
          y: bCy - 4,
          vx: boss.facing * 3.4,
          vy: 1.8 + spread * 3.2,
          w: 8,
          h: 8,
          damage: projLight,
          ttl: 135,
          pierce: false,
          bouncesLeft: 2,
          color: '#ff6b4a',
        });
        state.events.push({ type: 'sfx', key: 'bounce', gain: 0.7 });
      }
      if (boss.aiTimer <= 0) {
        boss.aiState = 'recover';
        boss.aiTimer = p2 ? 22 : 30;
        boss.patternIndex += 1;
      }
    } else if (currentPat === 2) {
      // Solar Dash Slash leaving trailing golden spark shockwaves
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
          damage: projLight,
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
        boss.aiTimer = p2 ? 24 : 34;
        boss.patternIndex += 1;
      }
    } else {
      // P2 Aerial Prism Barrage: hover above center and fire alternating angled solar darts
      boss.x += (centerX - boss.x) * 0.12;
      boss.y += (hoverTopY - boss.y) * 0.12;
      if (boss.aiTimer % 18 === 0 && boss.aiTimer > 0) {
        const phaseFlip = (boss.aiTimer / 18) % 2 === 0 ? 0.22 : 0;
        for (let k = -2; k <= 2; k++) {
          const ang = k * 0.38 + phaseFlip;
          cb.spawnProjectile(state, {
            owner: 'boss',
            kind: 'enemy_shot',
            x: bCx - 4,
            y: bCy - 4,
            vx: Math.sin(ang) * 3.8,
            vy: Math.cos(ang) * 3.8,
            w: 8,
            h: 8,
            damage: projMed,
            ttl: 105,
            pierce: false,
            bouncesLeft: 0,
            color: '#fef08a',
          });
        }
        state.events.push({ type: 'sfx', key: 'burst', gain: 0.7 });
      }
      if (boss.aiTimer <= 0) {
        boss.aiState = 'recover';
        boss.aiTimer = 28;
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
      boss.aiTimer = p2 ? 12 : 20;
    }
  }
}

function updateGenericBoss(
  state: SimState,
  boss: BossEntity,
  cb: BossSimCallbacks,
  projMed: number,
  color: string,
): void {
  const player = state.player;
  const pCx = player.x + player.w * 0.5;
  const bCx = boss.x + boss.w * 0.5;
  const bCy = boss.y + boss.h * 0.5;
  const p2 = boss.phase >= 2;

  boss.vy += GRAVITY;
  boss.x += boss.vx;
  boss.y += boss.vy;
  clampBossToArena(boss);

  if (boss.aiState === 'desperation') {
    boss.vx = 0;
    boss.aiTimer -= 1;
    if (boss.aiTimer === 30) {
      for (let i = -2; i <= 2; i++) {
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'enemy_shot',
          x: bCx - 4,
          y: bCy - 4,
          vx: i * 1.9,
          vy: -2.4,
          w: 8,
          h: 8,
          damage: projMed,
          ttl: 110,
          pierce: false,
          bouncesLeft: 1,
          color,
        });
      }
    }
    if (boss.aiTimer <= 0) {
      boss.aiState = 'idle';
      boss.aiTimer = 18;
    }
    return;
  }

  if (boss.aiState === 'idle') {
    boss.vx *= 0.8;
    boss.facing = pCx >= bCx ? 1 : -1;
    boss.aiTimer -= 1;
    if (boss.aiTimer <= 0) {
      boss.aiState = 'telegraph';
      boss.aiTimer = p2 ? 20 : 28;
    }
    return;
  }

  if (boss.aiState === 'telegraph') {
    boss.vx = 0;
    boss.facing = pCx >= bCx ? 1 : -1;
    boss.aiTimer -= 1;
    if (boss.aiTimer <= 0) {
      boss.aiState = 'attack';
      if (boss.patternIndex % 2 === 0) {
        boss.vx = boss.facing * (p2 ? 5.2 : 4.2);
        boss.vy = -4.2;
        boss.aiTimer = 42;
      } else {
        boss.vx = 0;
        boss.aiTimer = 36;
      }
    }
    return;
  }

  if (boss.aiState === 'attack') {
    boss.aiTimer -= 1;
    if (boss.patternIndex % 2 === 1 && (boss.aiTimer === 24 || (p2 && boss.aiTimer === 10))) {
      for (const vy of [-1.2, 0, 1.2]) {
        cb.spawnProjectile(state, {
          owner: 'boss',
          kind: 'enemy_shot',
          x: bCx + boss.facing * 14 - 4,
          y: bCy - 4,
          vx: boss.facing * (p2 ? 4.2 : 3.5),
          vy,
          w: 8,
          h: 8,
          damage: projMed,
          ttl: 110,
          pierce: false,
          bouncesLeft: 0,
          color,
        });
      }
      state.events.push({ type: 'sfx', key: 'burst', gain: 0.75 });
    }
    if (boss.aiTimer <= 0) {
      boss.aiState = 'recover';
      boss.aiTimer = p2 ? 22 : 32;
      boss.patternIndex += 1;
    }
    return;
  }

  if (boss.aiState === 'recover') {
    boss.vx *= 0.82;
    boss.aiTimer -= 1;
    if (boss.aiTimer <= 0) {
      boss.aiState = 'idle';
      boss.aiTimer = p2 ? 14 : 22;
    }
  }
}

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
  if (boss.techRecoverTimer > 0) boss.techRecoverTimer -= 1;
  if (boss.desperationBannerTicks > 0) boss.desperationBannerTicks -= 1;

  // Defeat handling
  if (boss.hp <= 0 && !boss.defeated) {
    boss.hp = 0;
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
      boss.aiTimer = 75;
      boss.invulnTimer = 75;
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

  // Intro pose countdown
  if (boss.aiState === 'intro') {
    boss.vy += GRAVITY;
    boss.y += boss.vy;
    clampBossToArena(boss);
    boss.aiTimer -= 1;
    if (boss.aiTimer <= 0) {
      boss.aiState = 'idle';
      boss.aiTimer = 18;
    }
    return;
  }

  // Desperation trigger at threshold HP
  if (!boss.desperationTriggered && boss.hp <= boss.desperationHp) {
    boss.desperationTriggered = true;
    boss.phase = 2;
    boss.desperationBannerTicks = 75;
    boss.aiState = 'desperation';
    boss.aiTimer = 75;
    boss.invulnTimer = 60;
    boss.vx = 0;
    boss.vy = 0;
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
      { type: 'toast', text: `${boss.name.toUpperCase()} — OVERDRIVE!`, tone: 'warn' },
    );
  }

  const table = DAMAGE_TABLES[state.progression.difficulty];

  if (boss.bossId === 'siege_tread') {
    updateSiegeTread(state, boss, cb, table.lightProjectile, table.mediumProjectile, table.explosion);
  } else if (boss.bossId === 'prism') {
    updatePrismBoss(state, boss, cb, table.lightProjectile, table.mediumProjectile, table.heavyProjectile);
  } else {
    updateGenericBoss(state, boss, cb, table.mediumProjectile, def.palette[4]);
  }

  // Boss-to-player contact damage
  if (
    boss.aiState !== 'desperation' &&
    player.invulnTimer <= 0 &&
    player.action !== 'dead' &&
    player.action !== 'warp' &&
    aabbOverlap(player.x, player.y, player.w, player.h, boss.x, boss.y, boss.w, boss.h)
  ) {
    const contactDmg = boss.bossId === 'siege_tread' ? table.heavyContact : table.mediumContact;
    cb.damagePlayer(state, contactDmg, boss.x + boss.w * 0.5);
  }
}
