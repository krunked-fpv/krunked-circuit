import {
  MAIN_EIGHT_STAGES,
  PLAYER_PHYSICS,
  type ArmorPaintId,
  type BurstId,
  type BurstSlots,
  type ChipId,
  type Loadout,
  type ProgressionState,
  type StageStats,
} from '../contracts/index';
import {
  ARMOR_PAINT_DEFINITIONS,
  BURST_DEFINITIONS,
  CHALLENGE_DEFINITIONS,
  CHIP_DEFINITIONS,
  DATACHIP_DEFINITIONS,
  getBurstDefinition,
  getChipDefinition,
} from '../data/index';

export interface PurchaseResult {
  readonly ok: boolean;
  readonly reason?: string;
}

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

  const unlockChallenge = (id: string): void => {
    if (!progression.unlockedChallenges.includes(id)) {
      progression.unlockedChallenges.push(id);
    }
  };
  const unlockDataChip = (id: string): void => {
    if (!progression.unlockedDataChips.includes(id)) {
      progression.unlockedDataChips.push(id);
    }
  };

  if (stats.stageId === 'opening') {
    unlockChallenge('chal_first_clear');
    unlockDataChip('dc_world_opening');
    unlockDataChip('dc_boss_siege_tread');
  }
  if (stats.stageId === 'optic') {
    unlockChallenge('chal_solar_clear');
    unlockDataChip('dc_world_optic');
    unlockDataChip('dc_boss_prism');
    if (stats.rescuesCollected >= 8) {
      unlockChallenge('chal_optic_all_rescues');
    }
  }
  if (rank === 'S') {
    unlockChallenge('chal_s_rank_any');
  }
  if (stats.remix) {
    unlockChallenge('chal_remix_clear');
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
