import type { SimState } from '../contracts/index';

// ============================================================================
// Deterministic FNV-1a 32-bit Simulation State Hasher
// Produces an 8-character lowercase unsigned hex digest of canonical SimState.
// ============================================================================

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function mixByte(hash: number, byte: number): number {
  return Math.imul((hash ^ (byte & 0xff)) >>> 0, FNV_PRIME) >>> 0;
}

function mixInt32(hash: number, val: number): number {
  const n = val | 0;
  let h = mixByte(hash, n & 0xff);
  h = mixByte(h, (n >>> 8) & 0xff);
  h = mixByte(h, (n >>> 16) & 0xff);
  h = mixByte(h, (n >>> 24) & 0xff);
  return h;
}

function mixFloat(hash: number, val: number): number {
  if (!Number.isFinite(val)) {
    return mixInt32(hash, 0x7fffffff);
  }
  const q = Math.round(val * 1000);
  return mixInt32(hash, q === 0 ? 0 : q);
}

function mixBool(hash: number, val: boolean): number {
  return mixByte(hash, val ? 1 : 0);
}

function mixString(hash: number, str: string): number {
  let h = mixInt32(hash, str.length);
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    h = mixByte(h, code & 0xff);
    if (code > 0xff) {
      h = mixByte(h, (code >>> 8) & 0xff);
    }
  }
  return h;
}

/**
 * Computes a deterministic FNV-1a 32-bit unsigned hex hash over all gameplay-relevant
 * fields of SimState (tick, rngState, stage, tiles, player, hook, camera, enemies,
 * boss, projectiles, pickups, props, progression, and stage stats).
 */
export function hashSimState(state: SimState): string {
  let h = FNV_OFFSET_BASIS;

  // Core simulation metadata
  h = mixInt32(h, state.tick);
  h = mixInt32(h, state.rngState);
  h = mixString(h, state.stageId);
  h = mixBool(h, state.remix);
  h = mixString(h, state.screen);
  h = mixBool(h, state.togglePhase);
  h = mixInt32(h, state.rhythmBeat);
  h = mixInt32(h, state.hitstopTicks);
  h = mixInt32(h, state.nextEntityId);

  // Tilemap (captures shattered breakables / dynamic tile edits)
  h = mixInt32(h, state.tilesW);
  h = mixInt32(h, state.tilesH);
  const tiles = state.tiles;
  h = mixInt32(h, tiles.length);
  for (let i = 0; i < tiles.length; i++) {
    h = mixByte(h, tiles[i]);
  }

  // Player state
  const p = state.player;
  h = mixFloat(h, p.x);
  h = mixFloat(h, p.y);
  h = mixFloat(h, p.vx);
  h = mixFloat(h, p.vy);
  h = mixFloat(h, p.w);
  h = mixFloat(h, p.h);
  h = mixInt32(h, p.facing);
  h = mixBool(h, p.grounded);
  h = mixBool(h, p.onIce);
  h = mixInt32(h, p.onWall);
  h = mixInt32(h, p.onLedge);
  h = mixBool(h, p.crouching);
  h = mixBool(h, p.sliding);
  h = mixInt32(h, p.slideTimer);
  h = mixInt32(h, p.airJumpsUsed);
  h = mixInt32(h, p.diveKickTicks);
  h = mixString(h, p.action);
  h = mixString(h, p.attackId ?? '');
  h = mixInt32(h, p.attackTimer);
  h = mixFloat(h, p.hp);
  h = mixInt32(h, p.maxHp);
  h = mixFloat(h, p.burstEnergy);
  h = mixInt32(h, p.maxBurstCharges);
  h = mixInt32(h, p.invulnTimer);
  h = mixInt32(h, p.hurtTimer);
  h = mixInt32(h, p.overloadTimer);
  h = mixInt32(h, p.freezeFieldTimer);
  h = mixInt32(h, p.barrierHits);
  h = mixInt32(h, p.barrierTimer);
  h = mixInt32(h, p.cloneTimer);
  h = mixBool(h, p.nullifyReady);
  h = mixInt32(h, p.comboCount);
  h = mixBool(h, p.inWalker);
  h = mixFloat(h, p.lastSafeX);
  h = mixFloat(h, p.lastSafeY);

  // Hookshot state
  const hk = p.hook;
  h = mixString(h, hk.phase);
  h = mixFloat(h, hk.tipX);
  h = mixFloat(h, hk.tipY);
  h = mixFloat(h, hk.vx);
  h = mixFloat(h, hk.vy);
  h = mixInt32(h, hk.timer);
  h = mixFloat(h, hk.ropeLen);
  h = mixFloat(h, hk.swingAngle);
  h = mixFloat(h, hk.swingAngVel);
  h = mixString(h, hk.heldKind);
  h = mixInt32(h, hk.heldEntityId);
  h = mixInt32(h, hk.remoteBombTargetId);

  // Camera state
  const cam = state.camera;
  h = mixFloat(h, cam.x);
  h = mixFloat(h, cam.y);
  h = mixFloat(h, cam.targetX);
  h = mixFloat(h, cam.targetY);
  h = mixInt32(h, cam.cellX);
  h = mixInt32(h, cam.cellY);
  h = mixInt32(h, cam.transitionTimer);
  h = mixBool(h, cam.lockedBossArena);
  h = mixInt32(h, cam.shakeTimer);

  // Enemies
  h = mixInt32(h, state.enemies.length);
  for (let i = 0; i < state.enemies.length; i++) {
    const e = state.enemies[i];
    h = mixInt32(h, e.id);
    h = mixString(h, e.archetypeId);
    h = mixFloat(h, e.x);
    h = mixFloat(h, e.y);
    h = mixFloat(h, e.vx);
    h = mixFloat(h, e.vy);
    h = mixInt32(h, e.facing);
    h = mixFloat(h, e.hp);
    h = mixBool(h, e.shielded);
    h = mixInt32(h, e.stunTimer);
    h = mixInt32(h, e.aiTimer);
    h = mixInt32(h, e.aiPhase);
    h = mixBool(h, e.grounded);
    h = mixBool(h, e.grabbed);
    h = mixBool(h, e.dead);
  }

  // Boss
  const b = state.boss;
  if (b === null) {
    h = mixByte(h, 0);
  } else {
    h = mixByte(h, 1);
    h = mixInt32(h, b.id);
    h = mixString(h, b.bossId);
    h = mixFloat(h, b.x);
    h = mixFloat(h, b.y);
    h = mixFloat(h, b.vx);
    h = mixFloat(h, b.vy);
    h = mixInt32(h, b.facing);
    h = mixFloat(h, b.hp);
    h = mixInt32(h, b.phase);
    h = mixBool(h, b.desperationTriggered);
    h = mixString(h, b.aiState);
    h = mixInt32(h, b.aiTimer);
    h = mixInt32(h, b.patternIndex);
    h = mixBool(h, b.active);
    h = mixBool(h, b.defeated);
    h = mixFloat(h, b.partsHp[0]);
    h = mixFloat(h, b.partsHp[1]);
    h = mixFloat(h, b.partsHp[2]);
  }

  // Projectiles
  h = mixInt32(h, state.projectiles.length);
  for (let i = 0; i < state.projectiles.length; i++) {
    const pr = state.projectiles[i];
    h = mixInt32(h, pr.id);
    h = mixString(h, pr.owner);
    h = mixString(h, pr.kind);
    h = mixFloat(h, pr.x);
    h = mixFloat(h, pr.y);
    h = mixFloat(h, pr.vx);
    h = mixFloat(h, pr.vy);
    h = mixFloat(h, pr.damage);
    h = mixInt32(h, pr.ttl);
    h = mixInt32(h, pr.bouncesLeft);
  }

  // Pickups
  h = mixInt32(h, state.pickups.length);
  for (let i = 0; i < state.pickups.length; i++) {
    const pk = state.pickups[i];
    h = mixInt32(h, pk.id);
    h = mixString(h, pk.kind);
    h = mixFloat(h, pk.x);
    h = mixFloat(h, pk.y);
    h = mixInt32(h, pk.value);
    h = mixBool(h, pk.collected);
  }

  // Props
  h = mixInt32(h, state.props.length);
  for (let i = 0; i < state.props.length; i++) {
    const prop = state.props[i];
    h = mixInt32(h, prop.id);
    h = mixString(h, prop.kind);
    h = mixFloat(h, prop.x);
    h = mixFloat(h, prop.y);
    h = mixFloat(h, prop.hp);
    h = mixBool(h, prop.activated);
    h = mixBool(h, prop.grabbed);
  }

  // Progression (bits, rescues, unlocks, active loadout)
  const prog = state.progression;
  h = mixInt32(h, prog.bits);
  h = mixInt32(h, prog.rescueTokens);
  h = mixInt32(h, prog.totalRescues);
  h = mixInt32(h, prog.activeLoadoutIndex);
  h = mixString(h, prog.difficulty);
  h = mixString(h, prog.mode);
  h = mixInt32(h, prog.rescuedIds.length);
  for (let i = 0; i < prog.rescuedIds.length; i++) {
    h = mixString(h, prog.rescuedIds[i]);
  }
  h = mixInt32(h, prog.clearedStages.length);
  for (let i = 0; i < prog.clearedStages.length; i++) {
    h = mixString(h, prog.clearedStages[i]);
  }
  h = mixInt32(h, prog.unlockedBursts.length);
  for (let i = 0; i < prog.unlockedBursts.length; i++) {
    h = mixInt32(h, prog.unlockedBursts[i]);
  }
  h = mixInt32(h, prog.unlockedChips.length);
  for (let i = 0; i < prog.unlockedChips.length; i++) {
    h = mixInt32(h, prog.unlockedChips[i]);
  }
  h = mixInt32(h, prog.unlockedArmors.length);
  for (let i = 0; i < prog.unlockedArmors.length; i++) {
    h = mixInt32(h, prog.unlockedArmors[i]);
  }

  // Stage stats
  const st = state.stageStats;
  h = mixInt32(h, st.elapsedTicks);
  h = mixFloat(h, st.damageTaken);
  h = mixInt32(h, st.enemiesDefeated);
  h = mixInt32(h, st.rescuesCollected);
  h = mixInt32(h, st.bitsCollected);
  h = mixInt32(h, st.deaths);

  return (h >>> 0).toString(16).padStart(8, '0');
}
