import type { ChallengeDefinition } from '../contracts/index';

export const CHALLENGE_DEFINITIONS: readonly ChallengeDefinition[] = [
  {
    id: 'chal_first_clear',
    index: 1,
    name: 'Expressway Departure',
    description: 'Clear the Metro Expressway opening mission and bring down Siege Tread.',
    category: 'mode',
    rewardBits: 100,
  },
  {
    id: 'chal_solar_clear',
    index: 2,
    name: 'Helios Unplugged',
    description: 'Defeat Prism and liberate the Solar Relay.',
    category: 'boss',
    rewardBits: 150,
  },
  {
    id: 'chal_s_rank_any',
    index: 3,
    name: 'Peak Voltage',
    description: 'Achieve an S Rank on any mission stage.',
    category: 'mode',
    rewardBits: 200,
  },
  {
    id: 'chal_no_damage_boss',
    index: 4,
    name: 'Untouched Circuit',
    description: 'Defeat any stage boss without taking a single point of damage.',
    category: 'boss',
    rewardBits: 250,
  },
  {
    id: 'chal_throw_chain',
    index: 5,
    name: 'Kinetic Bowling',
    description: 'Defeat two or more enemies with a single hookshot-thrown object or stunned foe.',
    category: 'combat',
    rewardBits: 120,
  },
  {
    id: 'chal_guard_breaker',
    index: 6,
    name: 'Shatter Protocol',
    description: 'Break an enemy energy shield with an armor-breaking kick or Burst Technique.',
    category: 'combat',
    rewardBits: 100,
  },
  {
    id: 'chal_dive_bounce',
    index: 7,
    name: 'Skyward Rebound',
    description: 'Land three consecutive dive-kick bounces without touching solid ground.',
    category: 'movement',
    rewardBits: 120,
  },
  {
    id: 'chal_slide_specialist',
    index: 8,
    name: 'Zero-Clearance Wedge',
    description: 'Zip cleanly through a 1-tile ventilation tunnel without stopping.',
    category: 'movement',
    rewardBits: 80,
  },
  {
    id: 'chal_hook_swing',
    index: 9,
    name: 'Pendulum Ace',
    description: 'Cross the Solar Relay grapple gallery using hookshot swings.',
    category: 'movement',
    rewardBits: 120,
  },
  {
    id: 'chal_optic_all_rescues',
    index: 10,
    name: 'No Unit Left Behind',
    description: 'Rescue all 8 stranded Circuit Guard units inside the Solar Relay.',
    category: 'collectible',
    rewardBits: 200,
  },
  {
    id: 'chal_palette_hunter',
    index: 11,
    name: 'Chromatic Armor',
    description: 'Recover a functional Armor Paint chip hidden in a mission stage.',
    category: 'collectible',
    rewardBits: 150,
  },
  {
    id: 'chal_booster_pair',
    index: 12,
    name: 'Overclocked Core',
    description: 'Collect both a Health Booster and a Burst Booster in a single stage.',
    category: 'collectible',
    rewardBits: 160,
  },
  {
    id: 'chal_burst_finisher',
    index: 13,
    name: 'Circuit Breaker',
    description: 'Deliver the final blow to a boss using a Burst Technique.',
    category: 'boss',
    rewardBits: 180,
  },
  {
    id: 'chal_prism_desperation',
    index: 14,
    name: 'Refraction Survivor',
    description: 'Survive Prism overdrive laser barrage without taking damage.',
    category: 'boss',
    rewardBits: 220,
  },
  {
    id: 'chal_remix_clear',
    index: 15,
    name: 'Master Circuit',
    description: 'Complete any stage with the Master Levels remix modifier enabled.',
    category: 'mode',
    rewardBits: 250,
  },
  {
    id: 'chal_combo_master',
    index: 16,
    name: 'Chain Reaction',
    description: 'Build a 10-hit melee and Burst combo inside combat or the Dojo.',
    category: 'combat',
    rewardBits: 120,
  },
] as const;

export const CHALLENGE_MAP: Readonly<Record<string, ChallengeDefinition>> =
  CHALLENGE_DEFINITIONS.reduce(
    (acc, item) => {
      acc[item.id] = item;
      return acc;
    },
    {} as Record<string, ChallengeDefinition>,
  );

export function getChallengeDefinition(id: string): ChallengeDefinition | undefined {
  return CHALLENGE_MAP[id];
}
