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
  setTileAt,
  type Aabb,
} from './collision';
import {
  addBurstEnergy,
  damageBoss,
  damageEnemy,
  explodeAt,
  getActiveArmorPaint,
  getActiveLoadout,
  hasChip,
  spawnProjectile,
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
  9: 1, // Clone Array
  10: 1, // Burst Spark
  11: 1, // Hardware Barrier
  12: 1, // Gravity Dash
  13: 1, // Function Overload
  14: 1, // Piercing Drill
  15: 1, // Support Platform
  16: 1, // Hologram Trap
  17: 1, // Current Arc
  18: 1, // Emergency Heal
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
  let dmg = base;
  const armor = getActiveArmorPaint(state);
  if (armor === 4) {
    dmg *= 1.15; // Elec Volt Armor
  } else if (armor === 9) {
    dmg += 1; // Weak/Glass Armor
  }
  if (hasChip(state, 12)) {
    dmg *= 1.25; // Frame Amplifier
  }
  if (state.player.overloadTimer > 0) {
    dmg *= PLAYER_PHYSICS.OVERLOAD_DAMAGE_MULT;
  }
  return Math.round(dmg * 100) / 100;
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
): number {
  const p = state.player;
  let hits = 0;
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
          onEnemyDefeated: hooks?.onEnemyDefeated,
        })
      ) {
        hits += 1;
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
      hits += 1;
    }
  }

  return hits;
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

  p.burstEnergy = Math.max(0, p.burstEnergy - cost);
  p.action = 'burst';
  p.attackTimer = 14;
  p.attackId = null;
  p.onLedge = 0;

  const cx = p.x + p.w * 0.5;
  const cy = p.y + p.h * 0.5;
  const facing = p.facing;

  state.events.push({ type: 'sfx', key: burstId === 4 ? 'burst_freeze' : 'burst' });
  state.events.push({ type: 'rumble', weak: 0.4, strong: 0.65, durationMs: 130 });

  switch (burstId) {
    case 1: {
      // 1. Flying Strike — high-speed horizontal torpedo lunge + armor-breaking shock beam
      const dmg = scaleBurstDamage(state, 5);
      p.vx = facing * 9.0;
      p.vy = 0;
      p.invulnTimer = Math.max(p.invulnTimer, 18);
      const strikeBox: Aabb = {
        x: facing === 1 ? cx - 6 : cx - 66,
        y: p.y - 4,
        w: 72,
        h: p.h + 8,
      };
      hitTargetsInBox(state, strikeBox, dmg, 5.5, -2.5, 4, hooks);
      spawnProjectile(state, {
        owner: 'player',
        kind: 'burst_beam',
        x: facing === 1 ? p.x + p.w : p.x - 28,
        y: p.y + 4,
        vx: facing * 8.5,
        vy: 0,
        w: 28,
        h: 18,
        damage: dmg,
        ttl: 18,
        pierce: true,
        bouncesLeft: 0,
        color: '#38bdf8',
      });
      state.camera.shakeTimer = Math.max(state.camera.shakeTimer, 8);
      state.camera.shakeIntensity = Math.max(state.camera.shakeIntensity, 2.5);
      state.events.push({
        type: 'particle',
        kind: 'burst',
        x: cx,
        y: cy,
        color: '#38bdf8',
        count: 14,
      });
      break;
    }

    case 2: {
      // 2. Rising Upper — blazing anti-air uppercut launching foes skyward
      const dmg = scaleBurstDamage(state, 5);
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
      hitTargetsInBox(state, upperBox, dmg, 1.8, -7.0, 5, hooks);
      state.camera.shakeTimer = Math.max(state.camera.shakeTimer, 8);
      state.camera.shakeIntensity = Math.max(state.camera.shakeIntensity, 2.5);
      state.events.push({
        type: 'particle',
        kind: 'burst',
        x: cx,
        y: p.y,
        color: '#f97316',
        count: 14,
      });
      break;
    }

    case 3: {
      // 3. Heavenly Piledrive — meteor seismic slam + twin ground shockwaves
      const dmg = scaleBurstDamage(state, 6);
      p.vx = 0;
      p.vy = p.grounded ? 0 : 9.5;
      p.invulnTimer = Math.max(p.invulnTimer, 16);
      const slamBox: Aabb = {
        x: cx - 36,
        y: p.y - 4,
        w: 72,
        h: p.h + 16,
      };
      hitTargetsInBox(state, slamBox, dmg, 4.5, -4.5, 5, hooks);
      for (const dir of [-1, 1] as const) {
        spawnProjectile(state, {
          owner: 'player',
          kind: 'shockwave',
          x: cx - 10 + dir * 12,
          y: p.y + p.h - 14,
          vx: dir * 5.8,
          vy: 0,
          w: 20,
          h: 14,
          damage: scaleBurstDamage(state, 4),
          ttl: 36,
          pierce: true,
          bouncesLeft: 0,
          color: '#facc15',
        });
      }
      state.camera.shakeTimer = Math.max(state.camera.shakeTimer, 12);
      state.camera.shakeIntensity = Math.max(state.camera.shakeIntensity, 3.5);
      state.events.push({
        type: 'particle',
        kind: 'shockring',
        x: cx,
        y: p.y + p.h,
        color: '#facc15',
        count: 16,
      });
      break;
    }

    case 4: {
      // 4. Gravity Freeze — time-slow cryo field freezing enemies & slowing enemy fire
      const dmg = scaleBurstDamage(state, 2);
      p.freezeFieldTimer = 240;
      const cam = state.camera;
      for (let i = 0; i < state.enemies.length; i++) {
        const e = state.enemies[i];
        if (e.dead || e.grabbed) {
          continue;
        }
        if (
          e.x + e.w >= cam.x - 32 &&
          e.x <= cam.x + ENGINE_CONSTANTS.GAME_WIDTH + 32 &&
          e.y + e.h >= cam.y - 32 &&
          e.y <= cam.y + ENGINE_CONSTANTS.GAME_HEIGHT + 32
        ) {
          e.stunTimer = Math.max(e.stunTimer, 180);
          e.vx *= 0.1;
          e.vy *= 0.1;
          damageEnemy(state, e, dmg, {
            armorBreak: true,
            sourceX: cx,
            freezeTicks: 3,
            onEnemyDefeated: hooks?.onEnemyDefeated,
          });
        }
      }
      state.events.push({
        type: 'particle',
        kind: 'shockring',
        x: cx,
        y: cy,
        color: '#22d3ee',
        count: 18,
      });
      break;
    }

    case 5: {
      // 5. Surface Render — twin high-speed floor shockwaves
      const dmg = scaleBurstDamage(state, 4);
      for (const dir of [-1, 1] as const) {
        spawnProjectile(state, {
          owner: 'player',
          kind: 'shockwave',
          x: cx - 8 + dir * 10,
          y: p.y + p.h - 16,
          vx: dir * 6.5,
          vy: 0,
          w: 18,
          h: 16,
          damage: dmg,
          ttl: 44,
          pierce: true,
          bouncesLeft: 0,
          color: '#a78bfa',
        });
      }
      break;
    }

    case 6: {
      // 6. Catch Interrupt — counter dome reflecting nearby enemy projectiles
      const dmg = scaleBurstDamage(state, 4);
      p.invulnTimer = Math.max(p.invulnTimer, 20);
      const dome: Aabb = { x: cx - 32, y: cy - 32, w: 64, h: 64 };
      hitTargetsInBox(state, dome, dmg, 4.0, -3.0, 3, hooks);
      for (let i = 0; i < state.projectiles.length; i++) {
        const pr = state.projectiles[i];
        if ((pr.owner === 'enemy' || pr.owner === 'boss') && aabbOverlap(dome, pr)) {
          pr.owner = 'player';
          pr.vx = -pr.vx * 1.4;
          pr.vy = -pr.vy * 1.4;
          pr.damage = dmg;
          pr.color = '#38bdf8';
          pr.ttl = Math.max(pr.ttl, 60);
        }
      }
      state.events.push({
        type: 'particle',
        kind: 'shockring',
        x: cx,
        y: cy,
        color: '#60a5fa',
        count: 14,
      });
      break;
    }

    case 7: {
      // 7. Screen Interrupt — full-screen EMP blast damaging all on-screen foes (2 charges)
      const dmg = scaleBurstDamage(state, 6);
      const screenBox: Aabb = {
        x: state.camera.x - 16,
        y: state.camera.y - 16,
        w: ENGINE_CONSTANTS.GAME_WIDTH + 32,
        h: ENGINE_CONSTANTS.GAME_HEIGHT + 32,
      };
      hitTargetsInBox(state, screenBox, dmg, 2.0, -3.0, 6, hooks);
      // Clear enemy projectiles on screen
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
        color: '#e879f9',
        count: 24,
      });
      break;
    }

    case 8: {
      // 8. Cycle Kick — spinning forward kick releasing 3 rapid energy arcs
      const dmg = scaleBurstDamage(state, 2);
      p.vx = facing * 6.0;
      p.invulnTimer = Math.max(p.invulnTimer, 14);
      for (let k = 0; k < 3; k++) {
        spawnProjectile(state, {
          owner: 'player',
          kind: 'burst_beam',
          x: cx + facing * (8 + k * 14) - 8,
          y: cy - 10 + (k - 1) * 4,
          vx: facing * (5.5 + k * 0.8),
          vy: 0,
          w: 18,
          h: 16,
          damage: dmg,
          ttl: 24,
          pierce: true,
          bouncesLeft: 0,
          color: '#fb7185',
        });
      }
      break;
    }

    case 9: {
      // 9. Clone Array — summons holo-clone echoing player attacks for 6 seconds
      p.cloneTimer = 360;
      state.events.push({
        type: 'particle',
        kind: 'shockring',
        x: cx,
        y: cy,
        color: '#22d3ee',
        count: 12,
      });
      break;
    }

    case 10: {
      // 10. Burst Spark — 8-way radial electric spark volley
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
          color: '#fde047',
        });
      }
      break;
    }

    case 11: {
      // 11. Hardware Barrier — 3-hit orbital energy shield (10s) + pushback pulse
      p.barrierHits = 3;
      p.barrierTimer = 600;
      const pulseBox: Aabb = { x: cx - 28, y: cy - 28, w: 56, h: 56 };
      hitTargetsInBox(state, pulseBox, scaleBurstDamage(state, 2), 4.0, -2.0, 2, hooks);
      state.events.push({
        type: 'particle',
        kind: 'shockring',
        x: cx,
        y: cy,
        color: '#38bdf8',
        count: 14,
      });
      break;
    }

    case 12: {
      // 12. Gravity Dash — omnidirectional invulnerable warp dash leaving damage trail
      const dmg = scaleBurstDamage(state, 4);
      const dx = input.moveX !== 0 ? input.moveX : facing;
      const dy = input.moveY;
      const len = Math.max(1, Math.hypot(dx, dy));
      p.vx = (dx / len) * 9.5;
      p.vy = (dy / len) * 7.5;
      p.grounded = false;
      p.invulnTimer = Math.max(p.invulnTimer, 18);
      spawnProjectile(state, {
        owner: 'player',
        kind: 'burst_beam',
        x: cx - 16,
        y: cy - 16,
        vx: (dx / len) * 2.5,
        vy: (dy / len) * 2.5,
        w: 32,
        h: 32,
        damage: dmg,
        ttl: 16,
        pierce: true,
        bouncesLeft: 0,
        color: '#818cf8',
      });
      break;
    }

    case 13: {
      // 13. Function Overload — 400 ticks of Walk 3.0 / Sprint 5.0 & 1.4x damage!
      p.overloadTimer = PLAYER_PHYSICS.OVERLOAD_DURATION_TICKS;
      state.events.push({ type: 'toast', text: 'FUNCTION OVERLOAD!', tone: 'unlock' });
      state.events.push({
        type: 'particle',
        kind: 'shockring',
        x: cx,
        y: cy,
        color: '#f43f5e',
        count: 16,
      });
      break;
    }

    case 14: {
      // 14. Piercing Drill — armor-shattering drill thrust breaking walls & shields
      const dmg = scaleBurstDamage(state, 5);
      p.vx = facing * 7.2;
      p.vy = 0;
      p.invulnTimer = Math.max(p.invulnTimer, 14);
      const drillBox: Aabb = {
        x: facing === 1 ? p.x + p.w - 4 : p.x - 44,
        y: p.y + 2,
        w: 48,
        h: p.h - 4,
      };
      hitTargetsInBox(state, drillBox, dmg, 4.5, -2.0, 4, hooks);
      spawnProjectile(state, {
        owner: 'player',
        kind: 'dive_beam',
        x: facing === 1 ? p.x + p.w : p.x - 24,
        y: p.y + 6,
        vx: facing * 6.8,
        vy: 0,
        w: 24,
        h: 14,
        damage: dmg,
        ttl: 22,
        pierce: true,
        bouncesLeft: 0,
        color: '#fb923c',
      });
      break;
    }

    case 15: {
      // 15. Support Platform — deploys a solid temporary foothold beneath player
      spawnProjectile(state, {
        owner: 'player',
        kind: 'support_platform',
        x: cx - 20,
        y: p.y + p.h + 1,
        vx: 0,
        vy: 0,
        w: 40,
        h: 8,
        damage: 0,
        ttl: 420,
        pierce: true,
        bouncesLeft: 0,
        color: '#34d399',
        solid: true,
      });
      if (!p.grounded && p.vy > 0) {
        p.vy = 0;
      }
      state.events.push({
        type: 'particle',
        kind: 'spark',
        x: cx,
        y: p.y + p.h + 4,
        color: '#34d399',
        count: 8,
      });
      break;
    }

    case 16: {
      // 16. Hologram Trap — deploys proximity blast mine
      spawnProjectile(state, {
        owner: 'player',
        kind: 'hologram_mine',
        x: cx - 8,
        y: cy - 8,
        vx: 0,
        vy: 0,
        w: 16,
        h: 16,
        damage: scaleBurstDamage(state, 5),
        ttl: 480,
        pierce: false,
        bouncesLeft: 0,
        color: '#c084fc',
      });
      break;
    }

    case 17: {
      // 17. Current Arc — twin homing electric arcs seeking enemies
      const dmg = scaleBurstDamage(state, 3);
      for (const vyOff of [-1.2, 1.2]) {
        spawnProjectile(state, {
          owner: 'player',
          kind: 'electric_arc',
          x: cx + facing * 8 - 6,
          y: cy - 6,
          vx: facing * 5.0,
          vy: vyOff,
          w: 12,
          h: 12,
          damage: dmg,
          ttl: 70,
          pierce: false,
          bouncesLeft: 0,
          color: '#38bdf8',
        });
      }
      break;
    }

    case 18: {
      // 18. Emergency Heal — restores 6 HP (+2 with Repair Enhancer; Overflow Converter excess -> burst)
      const repairBonus = hasChip(state, 17) ? 2 : 0;
      const rawHeal = state.progression.modifiers.ironCircuit ? 3 : 6 + repairBonus;
      const missing = p.maxHp - p.hp;
      const healed = Math.min(missing, rawHeal);
      p.hp += healed;
      const overflow = rawHeal - healed;
      if (overflow > 0 && hasChip(state, 20)) {
        addBurstEnergy(state, overflow * 12);
      }
      state.events.push({ type: 'sfx', key: 'pickup_hp' });
      state.events.push({
        type: 'particle',
        kind: 'heal',
        x: cx,
        y: cy,
        color: '#4ade80',
        count: 12,
      });
      break;
    }

    case 19: {
      // 19. Distant Detonation — detonates hook-tagged target or nearest foe
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
        } else if (state.boss && state.boss.id === markedId && state.boss.active && !state.boss.defeated) {
          targetX = state.boss.x + state.boss.w * 0.5;
          targetY = state.boss.y + state.boss.h * 0.5;
          matched = true;
        }
      }

      if (!matched) {
        let bestDistSq = 240 * 240;
        for (let i = 0; i < state.enemies.length; i++) {
          const e = state.enemies[i];
          if (e.dead) continue;
          const dSq = (e.x - cx) ** 2 + (e.y - cy) ** 2;
          if (dSq < bestDistSq) {
            bestDistSq = dSq;
            targetX = e.x + e.w * 0.5;
            targetY = e.y + e.h * 0.5;
          }
        }
      }

      p.hook.remoteBombTargetId = 0;
      explodeAt(state, targetX, targetY, 52, dmg, hooks);
      break;
    }

    case 20: {
      // 20. Erupting Beam — colossal piercing horizontal rail-beam (2 charges)
      const dmg = scaleBurstDamage(state, 9);
      p.vx = -facing * 2.5;
      p.invulnTimer = Math.max(p.invulnTimer, 20);
      spawnProjectile(state, {
        owner: 'player',
        kind: 'burst_beam',
        x: facing === 1 ? p.x + p.w : p.x - 160,
        y: cy - 14,
        vx: facing * 10.0,
        vy: 0,
        w: 160,
        h: 28,
        damage: dmg,
        ttl: 28,
        pierce: true,
        bouncesLeft: 0,
        color: '#f43f5e',
      });
      state.hitstopTicks = Math.max(state.hitstopTicks, 5);
      state.camera.shakeTimer = 16;
      state.camera.shakeIntensity = 4;
      state.events.push({
        type: 'particle',
        kind: 'burst',
        x: cx + facing * 16,
        y: cy,
        color: '#f43f5e',
        count: 20,
      });
      break;
    }
  }

  return true;
}

/**
 * Updates ongoing Burst timers (Overload, Gravity Freeze, Hardware Barrier, Clone Array)
 * and passive chip effects (Emergency Accumulator, Nullifying Layer).
 */
export function updateActiveBurstEffects(state: SimState): void {
  const p = state.player;

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
    }
  }

  if (p.cloneTimer > 0) {
    p.cloneTimer -= 1;
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
