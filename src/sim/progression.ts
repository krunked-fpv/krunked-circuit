import {
  MAIN_EIGHT_STAGES,
  PLAYER_PHYSICS,
  TileType,
  type ArmorPaintId,
  type BurstId,
  type BurstSlots,
  type ChipId,
  type DataChipDefinition,
  type Loadout,
  type ProgressionState,
  type SimState,
  type StageId,
  type StageStats,
} from '../contracts/index';
import {
  ARMOR_PAINT_DEFINITIONS,
  BURST_DEFINITIONS,
  CHALLENGE_DEFINITIONS,
  CHIP_DEFINITIONS,
  DATACHIP_DEFINITIONS,
  getBurstDefinition,
  getChallengeDefinition,
  getChipDefinition,
  getDataChipDefinition,
} from '../data/index';

export interface PurchaseResult {
  readonly ok: boolean;
  readonly reason?: string;
}

const STAGE_TO_BOSS_KEY: Partial<Record<StageId, string>> = {
  opening: 'siege_tread',
  optic: 'prism',
  patch: 'stitch',
  cooler: 'frostfang',
  elec: 'arcbolt',
  shift: 'strider',
  wave: 'tempo',
  break: 'crag',
  cipher: 'phantom',
  final_1: 'mirror_rival',
  final_2: 'prism_core',
  final_3: 'overlord_apex',
};

export function createInitialProgression(): ProgressionState {
  const defaultLoadouts: [Loadout, Loadout, Loadout] = [
    {
      name: 'ASSAULT',
      bursts: { neutral: 1, side: 4, up: 2, down: 3 },
      chips: [2, 3, 1],
      armorPaint: 0,
    },
    {
      name: 'MOBILITY',
      bursts: { neutral: 1, side: 4, up: 2, down: 3 },
      chips: [2, 4, 1],
      armorPaint: 0,
    },
    {
      name: 'CUSTOM',
      bursts: { neutral: 1, side: 0, up: 2, down: 3 },
      chips: [2, 3, 4],
      armorPaint: 0,
    },
  ];

  return {
    bits: 0,
    rescueTokens: 0,
    totalRescues: 0,
    rescuedIds: [],
    clearedStages: [],
    clearedRemixes: [],
    collectedHealthBoosters: [],
    collectedBurstBoosters: [],
    unlockedBursts: [1, 2, 3, 4],
    unlockedChips: [1, 2, 3, 4],
    unlockedArmors: [0],
    unlockedChallenges: [],
    unlockedDataChips: ['dc_hero_volt', 'dc_tech_hookshot', 'dc_tech_burst', 'dc_world_hq'],
    loadouts: defaultLoadouts,
    activeLoadoutIndex: 0,
    difficulty: 'normal',
    mode: 'standard',
    modifiers: {
      masterLevels: false,
      rudeEnemies: false,
      doubleHazards: false,
      singleCredit: false,
      ironCircuit: false,
      mirrorWorld: false,
    },
    bestTimesTicks: {},
    farmCounts: {},
  };
}

export function getMaxPlayerHp(progression: ProgressionState): number {
  const perBooster =
    progression.mode === 'circuit'
      ? PLAYER_PHYSICS.CIRCUIT_MODE_HP_PER_BOOSTER
      : PLAYER_PHYSICS.HP_PER_BOOSTER;
  const boosted =
    PLAYER_PHYSICS.STARTING_MAX_HP + progression.collectedHealthBoosters.length * perBooster;
  return Math.min(PLAYER_PHYSICS.MAX_BOOSTED_HP, boosted);
}

export function getMaxBurstCharges(progression: ProgressionState): number {
  if (progression.mode === 'circuit') {
    return PLAYER_PHYSICS.CIRCUIT_MODE_MAX_BURST;
  }
  const boosted =
    PLAYER_PHYSICS.STARTING_MAX_BURST + progression.collectedBurstBoosters.length;
  return Math.min(PLAYER_PHYSICS.MAX_BOOSTED_BURST, boosted);
}

export function hasEquippedChip(progression: ProgressionState, chipId: ChipId): boolean {
  const loadout = progression.loadouts[progression.activeLoadoutIndex];
  return (
    loadout.chips[0] === chipId ||
    loadout.chips[1] === chipId ||
    loadout.chips[2] === chipId
  );
}

export function purchaseBurst(
  progression: ProgressionState,
  burstId: BurstId,
): PurchaseResult {
  const def = getBurstDefinition(burstId);
  if (!def) {
    return { ok: false, reason: 'Unknown Burst Technique.' };
  }
  if (progression.unlockedBursts.includes(burstId)) {
    return { ok: false, reason: 'Already unlocked.' };
  }
  if (progression.bits < def.priceBits) {
    return { ok: false, reason: `Requires ${def.priceBits} Bits.` };
  }
  progression.bits -= def.priceBits;
  progression.unlockedBursts.push(burstId);
  progression.unlockedBursts.sort((a, b) => a - b);
  return { ok: true };
}

export function purchaseChip(
  progression: ProgressionState,
  chipId: ChipId,
): PurchaseResult {
  const def = getChipDefinition(chipId);
  if (!def) {
    return { ok: false, reason: 'Unknown Booster Chip.' };
  }
  if (progression.unlockedChips.includes(chipId)) {
    return { ok: false, reason: 'Already unlocked.' };
  }
  if (progression.bits < def.priceBits) {
    return { ok: false, reason: `Requires ${def.priceBits} Bits.` };
  }
  if (progression.rescueTokens < def.rescueTokens) {
    return { ok: false, reason: `Requires ${def.rescueTokens} Rescue Tokens.` };
  }
  progression.bits -= def.priceBits;
  progression.rescueTokens -= def.rescueTokens;
  progression.unlockedChips.push(chipId);
  progression.unlockedChips.sort((a, b) => a - b);
  return { ok: true };
}

export function equipBurst(
  progression: ProgressionState,
  slot: keyof BurstSlots,
  burstId: BurstId | 0,
  loadoutIndex: 0 | 1 | 2 = progression.activeLoadoutIndex,
): boolean {
  if (burstId !== 0 && !progression.unlockedBursts.includes(burstId)) {
    return false;
  }
  const loadout = progression.loadouts[loadoutIndex];
  if (burstId !== 0) {
    // Avoid duplicating the same Burst across two directional slots in the same loadout
    const keys: (keyof BurstSlots)[] = ['neutral', 'side', 'up', 'down'];
    for (const k of keys) {
      if (k !== slot && loadout.bursts[k] === burstId) {
        loadout.bursts[k] = 0;
      }
    }
  }
  loadout.bursts[slot] = burstId;
  return true;
}

export function equipChip(
  progression: ProgressionState,
  slotIndex: 0 | 1 | 2,
  chipId: ChipId | 0,
  loadoutIndex: 0 | 1 | 2 = progression.activeLoadoutIndex,
): boolean {
  if (chipId !== 0 && !progression.unlockedChips.includes(chipId)) {
    return false;
  }
  const loadout = progression.loadouts[loadoutIndex];
  if (chipId !== 0) {
    for (let i = 0; i < 3; i++) {
      if (i !== slotIndex && loadout.chips[i] === chipId) {
        loadout.chips[i] = 0;
      }
    }
  }
  loadout.chips[slotIndex] = chipId;
  return true;
}

export function equipArmor(
  progression: ProgressionState,
  armorId: ArmorPaintId,
  loadoutIndex: 0 | 1 | 2 = progression.activeLoadoutIndex,
): boolean {
  if (!progression.unlockedArmors.includes(armorId)) {
    return false;
  }
  progression.loadouts[loadoutIndex].armorPaint = armorId;
  return true;
}

export function switchLoadout(
  progression: ProgressionState,
  index?: 0 | 1 | 2,
): 0 | 1 | 2 {
  const nextIndex: 0 | 1 | 2 =
    index !== undefined
      ? index
      : (((progression.activeLoadoutIndex + 1) % 3) as 0 | 1 | 2);
  progression.activeLoadoutIndex = nextIndex;
  return nextIndex;
}

export function computeStageRank(stats: StageStats): 'S' | 'A' | 'B' | 'C' {
  // 60 Hz ticks: 180s = 10800 ticks, 300s = 18000 ticks, 480s = 28800 ticks
  let score = 100;
  score -= stats.deaths * 25;
  score -= stats.damageTaken * 2;
  if (stats.elapsedTicks > 10800) {
    score -= Math.min(30, Math.floor((stats.elapsedTicks - 10800) / 600) * 3);
  }
  score += Math.min(16, stats.rescuesCollected * 2);

  let rank: 'S' | 'A' | 'B' | 'C';
  if (stats.deaths === 0 && score >= 90) {
    rank = 'S';
  } else if (score >= 70) {
    rank = 'A';
  } else if (score >= 45) {
    rank = 'B';
  } else {
    rank = 'C';
  }
  stats.rank = rank;
  return rank;
}

function findDataChipByKey(key: string): DataChipDefinition | undefined {
  if (!key) {
    return undefined;
  }
  const direct = getDataChipDefinition(key);
  if (direct) {
    return direct;
  }
  for (let i = 0; i < DATACHIP_DEFINITIONS.length; i++) {
    const def = DATACHIP_DEFINITIONS[i];
    if (def.relatedKey === key) {
      return def;
    }
  }
  const candidates = [
    `dc_${key}`,
    `dc_enemy_${key}`,
    `dc_boss_${key}`,
    `dc_world_${key}`,
    `dc_tech_${key}`,
    `dc_hero_${key}`,
  ];
  for (let i = 0; i < candidates.length; i++) {
    const hit = getDataChipDefinition(candidates[i]);
    if (hit) {
      return hit;
    }
  }
  return undefined;
}

function tryUnlockChallenge(state: SimState, id: string): void {
  const def = getChallengeDefinition(id);
  if (!def) {
    return;
  }
  if (state.progression.unlockedChallenges.includes(def.id)) {
    return;
  }
  state.progression.unlockedChallenges.push(def.id);
  state.progression.bits += def.rewardBits;
  state.events.push({
    type: 'challengeUnlock',
    id: def.id,
    name: def.name,
  });
}

/**
 * Pure deterministic Data Chip unlock by DataChip ID or relatedKey (enemy/boss/stage/tech).
 * Emits a `datachipUnlock` SimEvent when newly unlocked.
 */
export function unlockDataChip(state: SimState, key: string): void {
  const def = findDataChipByKey(key);
  if (!def) {
    return;
  }
  if (state.progression.unlockedDataChips.includes(def.id)) {
    return;
  }
  state.progression.unlockedDataChips.push(def.id);
  state.events.push({
    type: 'datachipUnlock',
    id: def.id,
    title: def.title,
  });
}

function isPlayerSlidingUnderCeiling(state: SimState): boolean {
  const p = state.player;
  if (!p.sliding || p.h !== PLAYER_PHYSICS.SLIDE_H || Math.abs(p.vx) < 3.0) {
    return false;
  }
  const ts = 16;
  const aboveTy = Math.floor((p.y - 3) / ts);
  if (aboveTy < 0 || aboveTy >= state.tilesH) {
    return false;
  }
  const leftTx = Math.floor((p.x + 1) / ts);
  const rightTx = Math.floor((p.x + p.w - 1) / ts);
  for (let tx = leftTx; tx <= rightTx; tx++) {
    if (tx < 0 || tx >= state.tilesW) continue;
    const tile = state.tiles[aboveTy * state.tilesW + tx];
    if (
      tile === TileType.SOLID ||
      tile === TileType.BREAKABLE ||
      tile === TileType.ICE ||
      tile === TileType.CONVEYOR_L ||
      tile === TileType.CONVEYOR_R ||
      tile === TileType.CRUSHER
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Pure deterministic evaluator that checks all matching Challenge conditions against SimState,
 * unlocking newly satisfied challenges, awarding their reward Bits, and emitting `challengeUnlock`.
 */
export function evaluateChallenges(state: SimState): void {
  const prog = state.progression;
  const p = state.player;
  const stats = state.stageStats;
  const boss = state.boss;

  // Stage clears
  if (prog.clearedStages.includes('opening')) {
    tryUnlockChallenge(state, 'chal_first_clear');
  }
  if (prog.clearedStages.includes('optic')) {
    tryUnlockChallenge(state, 'chal_solar_clear');
  }
  for (let i = 0; i < prog.clearedStages.length; i++) {
    const sid = prog.clearedStages[i];
    tryUnlockChallenge(state, `chal_${sid}_clear`);
    tryUnlockChallenge(state, `chal_clear_${sid}`);
  }

  // S-Rank & Remix & Modes
  if (
    (state.screen === 'stage_clear' || p.action === 'victory') &&
    stats.rank === 'S'
  ) {
    tryUnlockChallenge(state, 'chal_s_rank_any');
  }
  if (prog.clearedRemixes.length > 0) {
    tryUnlockChallenge(state, 'chal_remix_clear');
  }
  if (prog.clearedStages.includes('boss_rush')) {
    tryUnlockChallenge(state, 'chal_boss_rush_clear');
  }
  if (prog.mode === 'circuit' && prog.clearedStages.length > 0) {
    tryUnlockChallenge(state, 'chal_circuit_mode');
  }
  if (MAIN_EIGHT_STAGES.every((sid) => prog.clearedStages.includes(sid))) {
    tryUnlockChallenge(state, 'chal_eight_masters');
    tryUnlockChallenge(state, 'chal_all_main_stages');
  }
  if (prog.clearedStages.includes('final_3')) {
    tryUnlockChallenge(state, 'chal_campaign_clear');
    tryUnlockChallenge(state, 'chal_final_clear');
  }

  // Combat & movement mastery
  if (p.comboCount >= 10) {
    tryUnlockChallenge(state, 'chal_combo_master');
  }
  if (p.comboCount >= 20) {
    tryUnlockChallenge(state, 'chal_combo_legend');
  }
  if (isPlayerSlidingUnderCeiling(state)) {
    tryUnlockChallenge(state, 'chal_slide_specialist');
  }
  if (p.hook.phase === 'swinging' && p.hook.timer >= 5) {
    tryUnlockChallenge(state, 'chal_hook_swing');
  }

  // Guard break & thrown bowling checks
  for (let i = 0; i < state.projectiles.length; i++) {
    const pr = state.projectiles[i];
    if (pr.kind === 'thrown_shield') {
      tryUnlockChallenge(state, 'chal_guard_breaker');
    }
    if (pr.owner === 'thrown' && pr.hitIds.length >= 2) {
      tryUnlockChallenge(state, 'chal_throw_chain');
    }
  }

  // Boss mastery checks
  if (boss && boss.defeated) {
    tryUnlockChallenge(state, `chal_boss_${boss.bossId}`);
    if (stats.damageTaken === 0) {
      tryUnlockChallenge(state, 'chal_no_damage_boss');
    }
    if (p.action === 'burst' || (p.attackId === null && p.attackTimer > 0)) {
      tryUnlockChallenge(state, 'chal_burst_finisher');
    }
    if (
      boss.bossId === 'prism' &&
      boss.desperationTriggered &&
      stats.damageTaken === 0
    ) {
      tryUnlockChallenge(state, 'chal_prism_desperation');
    }
  }

  // Collectibles & Arsenal mastery
  const opticRescues = prog.rescuedIds.filter((id) => id.startsWith('optic:')).length;
  if (
    opticRescues >= 8 ||
    (state.stageId === 'optic' && stats.rescuesCollected >= 8)
  ) {
    tryUnlockChallenge(state, 'chal_optic_all_rescues');
  }
  if (stats.rescuesCollected >= 8) {
    tryUnlockChallenge(state, `chal_${state.stageId}_all_rescues`);
  }
  if (prog.totalRescues >= 64) {
    tryUnlockChallenge(state, 'chal_all_rescues');
  }
  if (prog.unlockedArmors.length >= 2) {
    tryUnlockChallenge(state, 'chal_palette_hunter');
  }
  if (prog.unlockedArmors.length >= ARMOR_PAINT_DEFINITIONS.length) {
    tryUnlockChallenge(state, 'chal_all_armors');
  }
  if (
    prog.collectedHealthBoosters.some((sid) =>
      prog.collectedBurstBoosters.includes(sid),
    )
  ) {
    tryUnlockChallenge(state, 'chal_booster_pair');
  }
  if (prog.unlockedBursts.length >= BURST_DEFINITIONS.length) {
    tryUnlockChallenge(state, 'chal_all_bursts');
  }
  if (prog.unlockedChips.length >= CHIP_DEFINITIONS.length) {
    tryUnlockChallenge(state, 'chal_all_chips');
  }
  if (prog.unlockedDataChips.length >= DATACHIP_DEFINITIONS.length) {
    tryUnlockChallenge(state, 'chal_all_datachips');
  }

  // Modifier clears when stage is cleared
  if (state.screen === 'stage_clear' || p.action === 'victory') {
    if (prog.modifiers.rudeEnemies) tryUnlockChallenge(state, 'chal_mod_rude');
    if (prog.modifiers.doubleHazards) tryUnlockChallenge(state, 'chal_mod_hazards');
    if (prog.modifiers.singleCredit) tryUnlockChallenge(state, 'chal_mod_single_credit');
    if (prog.modifiers.ironCircuit) tryUnlockChallenge(state, 'chal_mod_iron_circuit');
    if (prog.modifiers.mirrorWorld) tryUnlockChallenge(state, 'chal_mod_mirror');
  }
}

export function completeStage(
  progression: ProgressionState,
  stats: StageStats,
): StageStats {
  const rank = computeStageRank(stats);

  if (!progression.clearedStages.includes(stats.stageId)) {
    progression.clearedStages.push(stats.stageId);
  }
  if (stats.remix && !progression.clearedRemixes.includes(stats.stageId)) {
    progression.clearedRemixes.push(stats.stageId);
  }

  const prevBest = progression.bestTimesTicks[stats.stageId];
  if (prevBest === undefined || stats.elapsedTicks < prevBest) {
    progression.bestTimesTicks[stats.stageId] = stats.elapsedTicks;
  }

  const rankBonusBits: Record<'S' | 'A' | 'B' | 'C', number> = {
    S: 150,
    A: 100,
    B: 60,
    C: 30,
  };
  progression.bits += rankBonusBits[rank];

  const unlockChallengeId = (id: string): void => {
    const def = getChallengeDefinition(id);
    if (def && !progression.unlockedChallenges.includes(def.id)) {
      progression.unlockedChallenges.push(def.id);
      progression.bits += def.rewardBits;
    }
  };
  const unlockDataChipKey = (key: string): void => {
    const def = findDataChipByKey(key);
    if (def && !progression.unlockedDataChips.includes(def.id)) {
      progression.unlockedDataChips.push(def.id);
    }
  };

  // Unlock world & boss datachips for any cleared stage
  unlockDataChipKey(stats.stageId);
  const bossKey = STAGE_TO_BOSS_KEY[stats.stageId];
  if (bossKey) {
    unlockDataChipKey(bossKey);
  }

  if (stats.stageId === 'opening') {
    unlockChallengeId('chal_first_clear');
  }
  if (stats.stageId === 'optic') {
    unlockChallengeId('chal_solar_clear');
    if (stats.rescuesCollected >= 8) {
      unlockChallengeId('chal_optic_all_rescues');
    }
  }
  unlockChallengeId(`chal_${stats.stageId}_clear`);
  if (stats.rescuesCollected >= 8) {
    unlockChallengeId(`chal_${stats.stageId}_all_rescues`);
  }
  if (rank === 'S') {
    unlockChallengeId('chal_s_rank_any');
  }
  if (stats.remix) {
    unlockChallengeId('chal_remix_clear');
  }

  return stats;
}

export function unlockAllContent(progression: ProgressionState): void {
  progression.bits = Math.max(progression.bits, 9999);
  progression.rescueTokens = Math.max(progression.rescueTokens, 64);
  progression.totalRescues = Math.max(progression.totalRescues, 64);

  progression.unlockedBursts = BURST_DEFINITIONS.map((b) => b.id);
  progression.unlockedChips = CHIP_DEFINITIONS.map((c) => c.id);
  progression.unlockedArmors = ARMOR_PAINT_DEFINITIONS.map((a) => a.id);
  progression.unlockedChallenges = CHALLENGE_DEFINITIONS.map((c) => c.id);
  progression.unlockedDataChips = DATACHIP_DEFINITIONS.map((d) => d.id);

  // Fill boosters up to cap (4 health boosters -> 32 HP, 4 burst boosters -> 6 charges)
  const boosterStages = MAIN_EIGHT_STAGES.slice(0, 4);
  for (const sid of boosterStages) {
    if (!progression.collectedHealthBoosters.includes(sid)) {
      progression.collectedHealthBoosters.push(sid);
    }
    if (!progression.collectedBurstBoosters.includes(sid)) {
      progression.collectedBurstBoosters.push(sid);
    }
  }
}
