import {
  ENGINE_CONSTANTS,
  PLAYER_PHYSICS,
  TileType,
  type BurstId,
  type InputFrame,
  type SimState,
} from '../contracts/index';
import {
  aabbOverlap,
  getTileAt,
  isOneWayTile,
  isSolidTile,
  setTileAt,
  type Aabb,
} from './collision';
import {
  addBurstEnergy,
  damageBoss,
  damageEnemy,
  explodeAt,
  getActiveLoadout,
  getBurstDamageMultiplier,
  hasChip,
  setCatchInterruptTicks,
  spawnProjectile,
  tickCatchInterrupt,
  type CombatHooks,
} from './combat';

// ============================================================================
// All 20 Burst Techniques (IDs 1..20) & Passive Burst/Chip Sustain Loop
// ============================================================================

const TS = ENGINE_CONSTANTS.TILE_SIZE;

export const BURST_COSTS: Record<BurstId, number> = {
  1: 1, // Flying Strike
  2: 1, // Rising Upper
  3: 1, // Heavenly Piledrive
  4: 1, // Gravity Freeze
  5: 1, // Surface Render
  6: 1, // Catch Interrupt
  7: 2, // Screen Interrupt
  8: 1, // Cycle Kick
  9: 2, // Clone Array
  10: 1, // Burst Spark
  11: 2, // Hardware Barrier
  12: 1, // Gravity Dash
  13: 2, // Function Overload
  14: 1, // Piercing Drill
  15: 1, // Support Platform
  16: 1, // Hologram Trap
  17: 1, // Current Arc
  18: 2, // Emergency Heal
  19: 1, // Distant Detonation
  20: 2, // Erupting Beam
};

export function getBurstCost(burstId: BurstId): number {
  return BURST_COSTS[burstId] * PLAYER_PHYSICS.BURST_ENERGY_PER_CHARGE;
}

export function selectBurstSlot(state: SimState, input: InputFrame): BurstId | 0 {
  const slots = getActiveLoadout(state).bursts;
  let picked: BurstId | 0 = 0;

  if (input.moveY === -1) {
    picked = slots.up;
  } else if (input.moveY === 1) {
    picked = slots.down;
  } else if (input.moveX !== 0) {
    picked = slots.side;
  } else {
    picked = slots.neutral;
  }

  return picked !== 0 ? picked : slots.neutral;
}

function scaleBurstDamage(state: SimState, base: number): number {
  return Math.round(base * getBurstDamageMultiplier(state) * 100) / 100;
}

function shatterBreakables(state: SimState, box: Aabb): void {
  const left = Math.floor(box.x / TS);
  const right = Math.floor((box.x + box.w) / TS);
  const top = Math.floor(box.y / TS);
  const bottom = Math.floor((box.y + box.h) / TS);

  for (let ty = top; ty <= bottom; ty++) {
    for (let tx = left; tx <= right; tx++) {
      if (getTileAt(state, tx, ty) === TileType.BREAKABLE) {
        setTileAt(state, tx, ty, TileType.EMPTY);
        state.events.push({ type: 'sfx', key: 'breakable' });
      }
    }
  }
}

function hitTargetsInBox(
  state: SimState,
  box: Aabb,
  damage: number,
  kbX: number,
  kbY: number,
  freezeTicks: number,
  hooks?: CombatHooks,
  extraStunTicks = 0,
): number[] {
  const p = state.player;
  const hitIds: number[] = [];
  shatterBreakables(state, box);

  for (let i = 0; i < state.enemies.length; i++) {
    const e = state.enemies[i];
    if (e.dead || e.grabbed) {
      continue;
    }
    if (aabbOverlap(box, e)) {
      if (
        damageEnemy(state, e, damage, {
          armorBreak: true,
          knockbackX: kbX,
          knockbackY: kbY,
          sourceX: p.x + p.w * 0.5,
          freezeTicks,
          isBurst: true,
          onEnemyDefeated: hooks?.onEnemyDefeated,
        })
      ) {
        if (extraStunTicks > 0 && !e.dead && !e.isMiniboss) {
          e.stunTimer = Math.max(e.stunTimer, extraStunTicks);
        }
        hitIds.push(e.id);
      }
    }
  }

  const boss = state.boss;
  if (boss && boss.active && !boss.defeated && aabbOverlap(box, boss)) {
    if (
      damageBoss(state, boss, damage, {
        armorBreak: true,
        freezeTicks,
        isBurst: true,
        onBossDefeated: hooks?.onBossDefeated,
      })
    ) {
      hitIds.push(boss.id);
    }
  }

  return hitIds;
}

function findSurfaceFloorY(state: SimState, worldX: number, referenceBottomY: number): number {
  const tx = Math.floor(worldX / TS);
  const startTy = Math.floor(referenceBottomY / TS);
  for (let offset = -2; offset <= 3; offset++) {
    const ty = startTy + offset;
    const tile = getTileAt(state, tx, ty);
    const above = getTileAt(state, tx, ty - 1);
    if (
      (isSolidTile(state, tile, tx, ty) || isOneWayTile(tile)) &&
      !isSolidTile(state, above, tx, ty - 1)
    ) {
      return ty * TS;
    }
  }
  return referenceBottomY;
}

/**
 * Attempts to activate the directional Burst Technique from the active loadout.
 * Returns true if the Burst fired cleanly.
 */
export function tryActivateBurst(
  state: SimState,
  input: InputFrame,
  hooks?: CombatHooks,
): boolean {
  const p = state.player;
  if (p.action === 'dead' || p.action === 'hurt' || p.action === 'warp') {
    return false;
  }

  const burstId = selectBurstSlot(state, input);
  if (burstId === 0) {
    return false;
  }

  const cost = getBurstCost(burstId);
  if (p.burstEnergy < cost) {
    return false;
  }

  p.burstEnergy = Math.max(0, Math.round((p.burstEnergy - cost) * 100) / 100);
  p.action = 'burst';
  p.attackTimer = 14;
  p.attackId = null;
  p.onLedge = 0;

  const cx = p.x + p.w * 0.5;
  const cy = p.y + p.h * 0.5;
  const facing = p.facing;
  const effMoveX = (state.progression.modifiers.mirrorWorld ? -input.moveX : input.moveX) as
    | -1
    | 0
    | 1;
  const effAimX = (state.progression.modifiers.mirrorWorld ? -input.aimX : input.aimX) as
    | -1
    | 0
    | 1;

  state.events.push({ type: 'sfx', key: burstId === 4 ? 'burst_freeze' : 'burst' });
  state.events.push({ type: 'rumble', weak: 0.4, strong: 0.65, durationMs: 130 });

  switch (burstId) {
    case 1: {
      // 1. Flying Strike — 3 dmg high-speed horizontal dash strike + piercing shock beam
      const dmg = scaleBurstDamage(state, 3);
      p.vx = facing * 9.0;
      p.vy = 0;
      p.invulnTimer = Math.max(p.invulnTimer, 18);
      const strikeBox: Aabb = {
        x: facing === 1 ? cx - 6 : cx - 66,
        y: p.y - 4,
        w: 72,
        h: p.h + 8,
      };
      const hitIds = hitTargetsInBox(state, strikeBox, dmg, 5.5, -2.5, 4, hooks);
      const wave = spawnProjectile(state, {
        owner: 'player',
        kind: 'burst_beam',
        x: facing === 1 ? p.x + p.w : p.x - 28,
        y: p.y + 4,
        vx: facing * 8.5,
        vy: 0,
        w: 28,
        h: 18,
        damage: dmg,
        ttl: 16,
        pierce: true,
        bouncesLeft: 0,
        color: '#38d9ff',
      });
      wave.hitIds.push(...hitIds);
      state.camera.shakeTimer = Math.max(state.camera.shakeTimer, 8);
      state.camera.shakeIntensity = Math.max(state.camera.shakeIntensity, 2.5);
      state.events.push({
        type: 'particle',
        kind: 'burst',
        x: cx,
        y: cy,
        color: '#38d9ff',
        count: 14,
      });
      break;
    }

    case 2: {
      // 2. Rising Upper — multi-hit anti-air launcher + armorBreak
      const hitDmg = scaleBurstDamage(state, 2.5);
      p.vx = facing * 2.2;
      p.vy = -7.8;
      p.grounded = false;
      p.airJumpsUsed = 0;
      p.invulnTimer = Math.max(p.invulnTimer, 18);
      const upperBox: Aabb = {
        x: facing === 1 ? cx - 8 : cx - 34,
        y: p.y - 34,
        w: 42,
        h: 62,
      };
      hitTargetsInBox(state, upperBox, hitDmg, 1.8, -6.8, 4, hooks, 45);
      // Rising follow-up flare for multi-hit launcher impact
      spawnProjectile(state, {
        owner: 'player',
        kind: 'burst_beam',
        x: facing === 1 ? cx - 6 : cx - 26,
        y: p.y - 22,
        vx: facing * 1.6,
        vy: -6.4,
        w: 32,
        h: 36,
        damage: hitDmg,
        ttl: 14,
        pierce: true,
        bouncesLeft: 0,
        color: '#ff6b4a',
      });
      state.camera.shakeTimer = Math.max(state.camera.shakeTimer, 8);
      state.camera.shakeIntensity = Math.max(state.camera.shakeIntensity, 2.5);
      state.events.push({
        type: 'particle',
        kind: 'burst',
        x: cx,
        y: p.y,
        color: '#ff6b4a',
        count: 14,
      });
      break;
    }

    case 3: {
      // 3. Heavenly Piledrive — 4.5 dmg grab/slam + twin ground shockwaves
      const slamDmg = scaleBurstDamage(state, 4.5);
      const waveDmg = scaleBurstDamage(state, 3);
      // Grab nearest close non-miniboss enemy into the piledrive slam
      for (let i = 0; i < state.enemies.length; i++) {
        const e = state.enemies[i];
        if (e.dead || e.grabbed || e.isMiniboss) continue;
        const distSq = (e.x + e.w * 0.5 - cx) ** 2 + (e.y + e.h * 0.5 - cy) ** 2;
        if (distSq <= 44 * 44) {
          e.x = cx - e.w * 0.5;
          e.y = p.y + p.h - e.h;
          break;
        }
      }
      p.vx = 0;
      p.vy = p.grounded ? 0 : 9.5;
      p.invulnTimer = Math.max(p.invulnTimer, 16);
      const slamBox: Aabb = {
        x: cx - 38,
        y: p.y - 4,
        w: 76,
        h: p.h + 18,
      };
      const slammedIds = hitTargetsInBox(state, slamBox, slamDmg, 4.5, -4.5, 5, hooks);
      for (const dir of [-1, 1] as const) {
        const sw = spawnProjectile(state, {
          owner: 'player',
          kind: 'shockwave',
          x: cx - 10 + dir * 12,
          y: p.y + p.h - 14,
          vx: dir * 5.8,
          vy: 0,
          w: 20,
          h: 14,
          damage: waveDmg,
          ttl: 34,
          pierce: true,
          bouncesLeft: 0,
          color: '#ffc83d',
        });
        sw.hitIds.push(...slammedIds);
      }
      state.camera.shakeTimer = Math.max(state.camera.shakeTimer, 12);
      state.camera.shakeIntensity = Math.max(state.camera.shakeIntensity, 3.5);
      state.events.push(
        { type: 'sfx', key: 'heavy_hit' },
        {
          type: 'particle',
          kind: 'shockring',
          x: cx,
          y: p.y + p.h,
          color: '#ffc83d',
          count: 16,
        },
      );
      break;
    }

    case 4: {
      // 4. Gravity Freeze — time-slow cryo field + 2 dmg (4 dmg vs stunned/boss)
      const lightDmg = scaleBurstDamage(state, 2);
      const heavyDmg = scaleBurstDamage(state, 4);
      p.freezeFieldTimer = 240;
      const cam = state.camera;
      const screenBox: Aabb = {
        x: cam.x - 32,
        y: cam.y - 32,
        w: ENGINE_CONSTANTS.GAME_WIDTH + 64,
        h: ENGINE_CONSTANTS.GAME_HEIGHT + 64,
      };
      for (let i = 0; i < state.enemies.length; i++) {
        const e = state.enemies[i];
        if (e.dead || e.grabbed) {
          continue;
        }
        if (aabbOverlap(screenBox, e)) {
          const wasStunned = e.stunTimer > 0;
          e.stunTimer = Math.max(e.stunTimer, 180);
          e.vx *= 0.1;
          e.vy *= 0.1;
          damageEnemy(state, e, wasStunned ? heavyDmg : lightDmg, {
            armorBreak: true,
            sourceX: cx,
            freezeTicks: 3,
            isBurst: true,
            onEnemyDefeated: hooks?.onEnemyDefeated,
          });
        }
      }
      const boss = state.boss;
      if (boss && boss.active && !boss.defeated && aabbOverlap(screenBox, boss)) {
        boss.aiTimer += 24;
        damageBoss(state, boss, heavyDmg, {
          armorBreak: true,
          freezeTicks: 3,
          isBurst: true,
          onBossDefeated: hooks?.onBossDefeated,
        });
      }
      // Immediately decelerate enemy/boss projectiles in field
      for (let i = 0; i < state.projectiles.length; i++) {
        const pr = state.projectiles[i];
        if (pr.owner === 'enemy' || pr.owner === 'boss') {
          pr.vx *= 0.25;
          pr.vy *= 0.25;
        }
      }
      state.events.push({
        type: 'particle',
        kind: 'shockring',
        x: cx,
        y: cy,
        color: '#8f7cff',
        count: 18,
      });
      break;
    }

    case 5: {
      // 5. Surface Render — 3 ground shockwave pillars surging forward along terrain
      const dmg = scaleBurstDamage(state, 3.5);
      const offsets = [22, 54, 86];
      for (let k = 0; k < offsets.length; k++) {
        const px = cx + facing * offsets[k];
        const floorY = findSurfaceFloorY(state, px, p.y + p.h);
        spawnProjectile(state, {
          owner: 'player',
          kind: 'shockwave',
          x: px - 9,
          y: floorY - 36,
          vx: facing * 1.4,
          vy: 0,
          w: 18,
          h: 36,
          damage: dmg,
          ttl: 18 + k * 8,
          pierce: true,
          bouncesLeft: 0,
          color: '#ff8a3d',
        });
        state.events.push({
          type: 'particle',
          kind: 'burst',
          x: px,
          y: floorY - 4,
          color: '#ff8a3d',
          count: 6,
        });
      }
      state.camera.shakeTimer = Math.max(state.camera.shakeTimer, 8);
      state.camera.shakeIntensity = Math.max(state.camera.shakeIntensity, 2.5);
      break;
    }

    case 6: {
      // 6. Catch Interrupt — opens 30-tick counter-parry window + immediate dome reflection / shock counter
      const dmg = scaleBurstDamage(state, 4);
      setCatchInterruptTicks(p, 30);
      p.vx *= 0.25;
      const dome: Aabb = { x: cx - 34, y: cy - 34, w: 68, h: 68 };
      let countered = false;

      // Reflect enemy/boss projectiles already entering the counter dome
      for (let i = 0; i < state.projectiles.length; i++) {
        const pr = state.projectiles[i];
        if ((pr.owner === 'enemy' || pr.owner === 'boss') && aabbOverlap(dome, pr)) {
          pr.owner = 'player';
          pr.vx = -pr.vx * 1.45;
          pr.vy = -pr.vy * 1.45;
          pr.damage = scaleBurstDamage(state, 6);
          pr.color = '#4de8a4';
          pr.ttl = Math.max(pr.ttl, 60);
          countered = true;
        }
      }

      // Point-blank shock counter pulse if foes are already overlapping
      const hits = hitTargetsInBox(state, dome, dmg, 4.5, -3.0, 3, hooks, 75);
      if (hits.length > 0 || countered) {
        p.invulnTimer = Math.max(p.invulnTimer, 20);
        state.events.push({ type: 'sfx', key: 'armor_break' });
      }
      state.events.push({
        type: 'particle',
        kind: 'shockring',
        x: cx,
        y: cy,
        color: '#4de8a4',
        count: 14,
      });
      break;
    }

    case 7: {
      // 7. Screen Interrupt — screen-wide EMP blast (2 dmg single / 1 dmg multi) + projectile wipe (2 charges)
      const screenBox: Aabb = {
        x: state.camera.x - 16,
        y: state.camera.y - 16,
        w: ENGINE_CONSTANTS.GAME_WIDTH + 32,
        h: ENGINE_CONSTANTS.GAME_HEIGHT + 32,
      };
      let targetCount = 0;
      for (let i = 0; i < state.enemies.length; i++) {
        const e = state.enemies[i];
        if (!e.dead && !e.grabbed && aabbOverlap(screenBox, e)) {
          targetCount += 1;
        }
      }
      if (
        state.boss &&
        state.boss.active &&
        !state.boss.defeated &&
        aabbOverlap(screenBox, state.boss)
      ) {
        targetCount += 1;
      }

      const baseDmg = targetCount <= 1 ? 2 : 1;
      const dmg = scaleBurstDamage(state, baseDmg);
      hitTargetsInBox(state, screenBox, dmg, 2.0, -3.0, 6, hooks, 60);

      // Clear all on-screen enemy/boss projectiles
      for (let i = state.projectiles.length - 1; i >= 0; i--) {
        const pr = state.projectiles[i];
        if ((pr.owner === 'enemy' || pr.owner === 'boss') && aabbOverlap(screenBox, pr)) {
          state.projectiles.splice(i, 1);
        }
      }
      state.camera.shakeTimer = 16;
      state.camera.shakeIntensity = 4;
      state.events.push({
        type: 'particle',
        kind: 'burst',
        x: cx,
        y: cy,
        color: '#ffee55',
        count: 24,
      });
      break;
    }

    case 8: {
      // 8. Cycle Kick — spinning multi-hit whirlwind kick releasing 3 rapid energy arcs
      const hitDmg = scaleBurstDamage(state, 1.5);
      p.vx = facing * 6.0;
      if (!p.grounded) {
        p.vy = Math.min(p.vy, -1.8);
      }
      p.invulnTimer = Math.max(p.invulnTimer, 14);
      const spinBox: Aabb = { x: cx - 26, y: cy - 18, w: 52, h: 36 };
      hitTargetsInBox(state, spinBox, hitDmg, 3.0, -2.0, 2, hooks);
      for (let k = 0; k < 3; k++) {
        spawnProjectile(state, {
          owner: 'player',
          kind: 'burst_beam',
          x: cx + facing * (6 + k * 14) - 9,
          y: cy - 10 + (k - 1) * 5,
          vx: facing * (5.2 + k * 0.9),
          vy: (k - 1) * 0.35,
          w: 18,
          h: 16,
          damage: hitDmg,
          ttl: 14 + k * 6,
          pierce: true,
          bouncesLeft: 0,
          color: '#ff5c8a',
        });
      }
      state.events.push({
        type: 'particle',
        kind: 'burst',
        x: cx,
        y: cy,
        color: '#ff5c8a',
        count: 12,
      });
      break;
    }

    case 9: {
      // 9. Clone Array — summons orbiting echo clone echoing melee & autonomous orbital attacks (2 charges)
      p.cloneTimer = 360;
      const echoDmg = scaleBurstDamage(state, 1.5);
      spawnProjectile(state, {
        owner: 'player',
        kind: 'burst_beam',
        x: cx + facing * 12 - 8,
        y: cy - 8,
        vx: facing * 6.2,
        vy: 0,
        w: 16,
        h: 16,
        damage: echoDmg,
        ttl: 24,
        pierce: true,
        bouncesLeft: 0,
        color: '#7cffcb',
      });
      state.events.push({
        type: 'particle',
        kind: 'shockring',
        x: cx,
        y: cy,
        color: '#7cffcb',
        count: 14,
      });
      break;
    }

    case 10: {
      // 10. Burst Spark — radial 8-way electric discharge + close stun pulse
      const dmg = scaleBurstDamage(state, 3);
      for (let k = 0; k < 8; k++) {
        const ang = (k * Math.PI) / 4;
        spawnProjectile(state, {
          owner: 'player',
          kind: 'electric_arc',
          x: cx - 5,
          y: cy - 5,
          vx: Math.cos(ang) * 5.2,
          vy: Math.sin(ang) * 5.2,
          w: 10,
          h: 10,
          damage: dmg,
          ttl: 38,
          pierce: false,
          bouncesLeft: 0,
          color: '#52e5ff',
        });
      }
      // Radial static shock stuns adjacent foes for instant hookshot grab setups
      const aura: Aabb = { x: cx - 28, y: cy - 28, w: 56, h: 56 };
      for (let i = 0; i < state.enemies.length; i++) {
        const e = state.enemies[i];
        if (!e.dead && !e.grabbed && !e.isMiniboss && aabbOverlap(aura, e)) {
          e.stunTimer = Math.max(e.stunTimer, 90);
        }
      }
      state.events.push({
        type: 'particle',
        kind: 'shockring',
        x: cx,
        y: cy,
        color: '#52e5ff',
        count: 16,
      });
      break;
    }

    case 11: {
      // 11. Hardware Barrier — 3-hit orbiting hex-shield (10s) + pushback pulse (2 charges)
      p.barrierHits = 3;
      p.barrierTimer = 600;
      const pulseBox: Aabb = { x: cx - 28, y: cy - 28, w: 56, h: 56 };
      hitTargetsInBox(state, pulseBox, scaleBurstDamage(state, 2), 4.0, -2.0, 2, hooks);
      state.events.push({
        type: 'particle',
        kind: 'shockring',
        x: cx,
        y: cy,
        color: '#44b8ff',
        count: 14,
      });
      break;
    }

    case 12: {
      // 12. Gravity Dash — 8-dir high-speed 3 dmg invulnerable dash strike
      const dmg = scaleBurstDamage(state, 3);
      const rawX = effAimX !== 0 ? effAimX : effMoveX;
      const rawY = input.aimY !== 0 ? input.aimY : input.moveY;
      const dx = rawX === 0 && rawY === 0 ? facing : rawX;
      const dy = rawY;
      const len = Math.max(1, Math.hypot(dx, dy));
      const nx = dx / len;
      const ny = dy / len;
      if (dx !== 0) {
        p.facing = dx > 0 ? 1 : -1;
      }
      p.vx = nx * 9.5;
      p.vy = ny * 7.5;
      p.grounded = false;
      p.invulnTimer = Math.max(p.invulnTimer, 20);
      const dashBox: Aabb = {
        x: cx - 18 + nx * 16,
        y: cy - 18 + ny * 16,
        w: 36,
        h: 36,
      };
      const hitIds = hitTargetsInBox(state, dashBox, dmg, 4.0, -2.5, 3, hooks);
      const trail = spawnProjectile(state, {
        owner: 'player',
        kind: 'burst_beam',
        x: cx - 16,
        y: cy - 16,
        vx: nx * 3.5,
        vy: ny * 3.5,
        w: 32,
        h: 32,
        damage: dmg,
        ttl: 16,
        pierce: true,
        bouncesLeft: 0,
        color: '#c06bff',
      });
      trail.hitIds.push(...hitIds);
      state.events.push({
        type: 'particle',
        kind: 'burst',
        x: cx,
        y: cy,
        color: '#c06bff',
        count: 14,
      });
      break;
    }

    case 13: {
      // 13. Function Overload — 400 ticks of +1 speed (3.0/5.0) & 1.40x dmg (2 charges)
      p.overloadTimer = PLAYER_PHYSICS.OVERLOAD_DURATION_TICKS;
      state.events.push({ type: 'toast', text: 'FUNCTION OVERLOAD!', tone: 'unlock' });
      state.events.push({
        type: 'particle',
        kind: 'shockring',
        x: cx,
        y: cy,
        color: '#ff3b6b',
        count: 16,
      });
      break;
    }

    case 14: {
      // 14. Piercing Drill — chain-launcher piercing rush breaking shields & breakable walls
      const dmg = scaleBurstDamage(state, 5);
      p.vx = facing * 7.5;
      p.vy = 0;
      p.invulnTimer = Math.max(p.invulnTimer, 16);
      const drillBox: Aabb = {
        x: facing === 1 ? p.x + p.w - 4 : p.x - 44,
        y: p.y + 2,
        w: 48,
        h: p.h - 4,
      };
      const hitIds = hitTargetsInBox(state, drillBox, dmg, 4.5, -3.5, 4, hooks, 75);
      const auger = spawnProjectile(state, {
        owner: 'player',
        kind: 'dive_beam',
        x: facing === 1 ? p.x + p.w : p.x - 28,
        y: p.y + 5,
        vx: facing * 7.2,
        vy: 0,
        w: 28,
        h: 16,
        damage: dmg,
        ttl: 22,
        pierce: true,
        bouncesLeft: 0,
        color: '#ff9e3b',
      });
      auger.hitIds.push(...hitIds);
      state.camera.shakeTimer = Math.max(state.camera.shakeTimer, 8);
      state.camera.shakeIntensity = Math.max(state.camera.shakeIntensity, 2.5);
      state.events.push({
        type: 'particle',
        kind: 'burst',
        x: cx + facing * 14,
        y: cy,
        color: '#ff9e3b',
        count: 12,
      });
      break;
    }

    case 15: {
      // 15. Support Platform — summons solid walkable & hookshot-throwable support_platform hover pad
      let platformCount = 0;
      let oldestIdx = -1;
      for (let i = 0; i < state.projectiles.length; i++) {
        if (state.projectiles[i].kind === 'support_platform') {
          platformCount += 1;
          if (oldestIdx === -1) oldestIdx = i;
        }
      }
      if (platformCount >= 2 && oldestIdx >= 0) {
        state.projectiles.splice(oldestIdx, 1);
      }

      const platX = p.grounded ? cx + facing * 22 - 20 : cx - 20;
      const platY = p.grounded ? p.y + p.h - 16 : p.y + p.h;
      spawnProjectile(state, {
        owner: 'player',
        kind: 'support_platform',
        x: platX,
        y: platY,
        vx: 0,
        vy: 0,
        w: 40,
        h: 8,
        damage: scaleBurstDamage(state, 3),
        ttl: 420,
        pierce: true,
        bouncesLeft: 0,
        color: '#63e2ff',
        solid: true,
      });
      if (!p.grounded && p.vy > 0) {
        p.vy = 0;
      }
      state.events.push({
        type: 'particle',
        kind: 'spark',
        x: platX + 20,
        y: platY + 4,
        color: '#63e2ff',
        count: 10,
      });
      break;
    }

    case 16: {
      // 16. Hologram Trap — deploys decoy hologram_mine dealing 3+ explosive AoE dmg
      spawnProjectile(state, {
        owner: 'player',
        kind: 'hologram_mine',
        x: cx - 8,
        y: cy - 8,
        vx: 0,
        vy: 0,
        w: 16,
        h: 16,
        damage: scaleBurstDamage(state, 3),
        ttl: 480,
        pierce: false,
        bouncesLeft: 0,
        color: '#95ff5c',
      });
      state.events.push({
        type: 'particle',
        kind: 'spark',
        x: cx,
        y: cy,
        color: '#95ff5c',
        count: 10,
      });
      break;
    }

    case 17: {
      // 17. Current Arc — fires 3 homing electric_arc bolts seeking enemies & bosses
      const dmg = scaleBurstDamage(state, 2.5);
      for (const vyOff of [-1.8, 0, 1.8]) {
        spawnProjectile(state, {
          owner: 'player',
          kind: 'electric_arc',
          x: cx + facing * 8 - 6,
          y: cy - 6,
          vx: facing * 5.2,
          vy: vyOff,
          w: 12,
          h: 12,
          damage: dmg,
          ttl: 75,
          pierce: false,
          bouncesLeft: 0,
          color: '#ffe84d',
        });
      }
      state.events.push({
        type: 'particle',
        kind: 'spark',
        x: cx + facing * 10,
        y: cy,
        color: '#ffe84d',
        count: 10,
      });
      break;
    }

    case 18: {
      // 18. Emergency Heal — restores +6 HP (+2 Repair Enhancer; halves on Iron Circuit; Overflow Converter -> burst)
      const repairBonus = hasChip(state, 17) ? 2 : 0;
      const baseHeal = 6 + repairBonus;
      const rawHeal = state.progression.modifiers.ironCircuit
        ? Math.floor(baseHeal * 0.5)
        : baseHeal;
      const missing = Math.max(0, p.maxHp - p.hp);
      const healed = Math.min(missing, rawHeal);
      p.hp += healed;
      const overflow = rawHeal - healed;
      if (overflow > 0 && hasChip(state, 20)) {
        addBurstEnergy(state, overflow * 15);
      }
      state.events.push({ type: 'sfx', key: 'pickup_hp' });
      state.events.push({
        type: 'particle',
        kind: 'heal',
        x: cx,
        y: cy,
        color: '#4eff91',
        count: 14,
      });
      break;
    }

    case 19: {
      // 19. Distant Detonation — detonates remoteBombTargetId or nearest hooked/nearby target for 2+ explosive AoE dmg
      const dmg = scaleBurstDamage(state, 7);
      let targetX = cx + facing * 96;
      let targetY = cy;
      const markedId = p.hook.remoteBombTargetId;
      let matched = false;

      if (markedId > 0) {
        const enemy = state.enemies.find((e) => e.id === markedId && !e.dead);
        if (enemy) {
          targetX = enemy.x + enemy.w * 0.5;
          targetY = enemy.y + enemy.h * 0.5;
          matched = true;
        } else if (
          state.boss &&
          state.boss.id === markedId &&
          state.boss.active &&
          !state.boss.defeated
        ) {
          targetX = state.boss.x + state.boss.w * 0.5;
          targetY = state.boss.y + state.boss.h * 0.5;
          matched = true;
        }
      }

      if (!matched) {
        let bestDistSq = 260 * 260;
        for (let i = 0; i < state.enemies.length; i++) {
          const e = state.enemies[i];
          if (e.dead) continue;
          const dSq = (e.x + e.w * 0.5 - cx) ** 2 + (e.y + e.h * 0.5 - cy) ** 2;
          if (dSq < bestDistSq) {
            bestDistSq = dSq;
            targetX = e.x + e.w * 0.5;
            targetY = e.y + e.h * 0.5;
          }
        }
        if (state.boss && state.boss.active && !state.boss.defeated) {
          const b = state.boss;
          const dSq = (b.x + b.w * 0.5 - cx) ** 2 + (b.y + b.h * 0.5 - cy) ** 2;
          if (dSq < bestDistSq) {
            targetX = b.x + b.w * 0.5;
            targetY = b.y + b.h * 0.5;
          }
        }
      }

      p.hook.remoteBombTargetId = 0;
      explodeAt(state, targetX, targetY, 56, dmg, hooks, true);
      state.events.push({
        type: 'particle',
        kind: 'shockring',
        x: targetX,
        y: targetY,
        color: '#ff533b',
        count: 14,
      });
      break;
    }

    case 20: {
      // 20. Erupting Beam — heavy horizontal piercing burst_beam (2 charges)
      const dmg = scaleBurstDamage(state, 9);
      p.vx = -facing * 2.5;
      p.invulnTimer = Math.max(p.invulnTimer, 22);
      spawnProjectile(state, {
        owner: 'player',
        kind: 'burst_beam',
        x: facing === 1 ? p.x + p.w : p.x - 168,
        y: cy - 14,
        vx: facing * 10.5,
        vy: 0,
        w: 168,
        h: 28,
        damage: dmg,
        ttl: 30,
        pierce: true,
        bouncesLeft: 0,
        color: '#ffdf5e',
      });
      state.hitstopTicks = Math.max(state.hitstopTicks, 5);
      state.camera.shakeTimer = 16;
      state.camera.shakeIntensity = 4;
      state.events.push(
        { type: 'sfx', key: 'heavy_hit' },
        {
          type: 'particle',
          kind: 'burst',
          x: cx + facing * 16,
          y: cy,
          color: '#ffdf5e',
          count: 22,
        },
      );
      break;
    }
  }

  return true;
}

/**
 * Updates ongoing Burst timers (Overload, Gravity Freeze, Hardware Barrier, Clone Array,
 * Catch Interrupt counter window) and passive chip effects (Emergency Accumulator, Nullifying Layer).
 */
export function updateActiveBurstEffects(state: SimState): void {
  const p = state.player;
  const cx = p.x + p.w * 0.5;
  const cy = p.y + p.h * 0.5;

  // Tick down Catch Interrupt counter-parry window
  tickCatchInterrupt(p);

  if (p.overloadTimer > 0) {
    p.overloadTimer -= 1;
  }

  if (p.freezeFieldTimer > 0) {
    p.freezeFieldTimer -= 1;
    // Keep nearby enemies slowed while Gravity Freeze field is active
    for (let i = 0; i < state.enemies.length; i++) {
      const e = state.enemies[i];
      if (!e.dead && !e.grabbed) {
        e.vx *= 0.85;
      }
    }
  }

  if (p.barrierTimer > 0) {
    p.barrierTimer -= 1;
    if (p.barrierTimer === 0) {
      p.barrierHits = 0;
    } else if (p.barrierHits > 0 && state.tick % 18 === 0) {
      // Orbiting Hardware Barrier deals contact damage to overlapping enemies
      const ringBox: Aabb = { x: cx - 24, y: cy - 24, w: 48, h: 48 };
      const orbDmg = scaleBurstDamage(state, 1.5);
      for (let i = 0; i < state.enemies.length; i++) {
        const e = state.enemies[i];
        if (!e.dead && !e.grabbed && aabbOverlap(ringBox, e)) {
          damageEnemy(state, e, orbDmg, {
            armorBreak: false,
            knockbackX: 2.5,
            knockbackY: -1.5,
            sourceX: cx,
            freezeTicks: 1,
          });
        }
      }
    }
  }

  if (p.cloneTimer > 0) {
    p.cloneTimer -= 1;
    // Orbiting echo clone performs periodic synchronized orbital strikes
    if (state.tick % 30 === 0 && p.action !== 'dead') {
      const ang = state.tick * 0.14;
      const cloneX = cx + Math.cos(ang) * 24;
      const cloneY = cy + Math.sin(ang) * 16;
      const cloneBox: Aabb = { x: cloneX - 14, y: cloneY - 14, w: 28, h: 28 };
      const cloneDmg = scaleBurstDamage(state, 1.5);
      hitTargetsInBox(state, cloneBox, cloneDmg, 1.8, -1.2, 1);
      state.events.push({
        type: 'particle',
        kind: 'spark',
        x: cloneX,
        y: cloneY,
        color: '#7cffcb',
        count: 4,
      });
    }
  }

  // Emergency Accumulator chip (ID 8): passive burst recharge at <= 25% HP
  if (hasChip(state, 8) && p.hp > 0 && p.hp <= Math.ceil(p.maxHp * 0.25)) {
    if (state.tick % 6 === 0) {
      addBurstEnergy(state, 1.5);
    }
  }

  // Nullifying Layer chip (ID 18): recharges periodic 1-hit barrier
  if (hasChip(state, 18)) {
    if (!p.nullifyReady) {
      if (p.nullifyCooldown > 0) {
        p.nullifyCooldown -= 1;
      } else {
        p.nullifyReady = true;
      }
    }
  } else {
    p.nullifyReady = false;
    p.nullifyCooldown = 0;
  }
}
