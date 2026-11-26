import type { ChipDefinition, ChipId } from '../contracts/index';

export const CHIP_DEFINITIONS: readonly ChipDefinition[] = [
  {
    id: 1,
    key: 'energy_absorber',
    name: 'Energy Absorber',
    description:
      'Harvests stray kinetic charge from defeated enemies, granting bonus Burst Energy on every takedown.',
    part: 'circuit',
    priceBits: 0,
    rescueTokens: 0,
    iconKey: 'chip_energy_absorber',
    starter: true,
  },
  {
    id: 2,
    key: 'air_jumper',
    name: 'Air Jumper',
    description:
      'Installs micro-thruster boots enabling a crisp mid-air double jump for extended aerial control.',
    part: 'legs',
    priceBits: 0,
    rescueTokens: 0,
    iconKey: 'chip_air_jumper',
    starter: true,
  },
  {
    id: 3,
    key: 'power_extender',
    name: 'Power Extender',
    description:
      'Projects an amplified plasma edge on melee strikes, extending horizontal attack reach by +16 px.',
    part: 'arms',
    priceBits: 0,
    rescueTokens: 0,
    iconKey: 'chip_power_extender',
    starter: true,
  },
  {
    id: 4,
    key: 'grip_enhancer',
    name: 'Grip Enhancer',
    description:
      'Magnetizes gauntlets to vertical surfaces, halting wall-slide descent completely unless Down is held.',
    part: 'arms',
    priceBits: 0,
    rescueTokens: 0,
    iconKey: 'chip_grip_enhancer',
    starter: true,
  },
  {
    id: 5,
    key: 'surge_protector',
    name: 'Surge Protector',
    description:
      'Insulates Unit K-01 against environmental spikes and electric rails, reducing hazard damage taken.',
    part: 'body',
    priceBits: 90,
    rescueTokens: 2,
    iconKey: 'chip_surge_protector',
  },
  {
    id: 6,
    key: 'catch_block',
    name: 'Catch Block',
    description:
      'Carrying a grappled enemy, shield, or crate overhead establishes a frontal energy guard against shots.',
    part: 'arms',
    priceBits: 100,
    rescueTokens: 2,
    iconKey: 'chip_catch_block',
  },
  {
    id: 7,
    key: 'magnet_chassis',
    name: 'Magnet Chassis',
    description:
      'Generates an attractive field around Volt that pulls nearby Bits, health cells, and burst orbs straight in.',
    part: 'body',
    priceBits: 110,
    rescueTokens: 3,
    iconKey: 'chip_magnet_chassis',
  },
  {
    id: 8,
    key: 'emergency_accumulator',
    name: 'Emergency Accumulator',
    description:
      'Automatically charges Burst Energy over time whenever Volt drops to critical health.',
    part: 'circuit',
    priceBits: 130,
    rescueTokens: 3,
    iconKey: 'chip_emergency_accumulator',
  },
  {
    id: 9,
    key: 'underflow_guard',
    name: 'Underflow Guard',
    description:
      'Stabilizes core capacitors so Burst Energy is preserved on damage and lethal hits leave 1 HP once per room.',
    part: 'circuit',
    priceBits: 160,
    rescueTokens: 4,
    iconKey: 'chip_underflow_guard',
  },
  {
    id: 10,
    key: 'energy_multiplier',
    name: 'Energy Multiplier',
    description:
      'Amplifies Burst Energy gained from melee strikes, throws, and burst orbs by +35%.',
    part: 'circuit',
    priceBits: 180,
    rescueTokens: 5,
    iconKey: 'chip_energy_multiplier',
  },
  {
    id: 11,
    key: 'light_alloy',
    name: 'Light Alloy',
    description:
      'Reduces chassis mass near jump apex, letting Volt float smoothly while holding the Jump button.',
    part: 'legs',
    priceBits: 120,
    rescueTokens: 3,
    iconKey: 'chip_light_alloy',
  },
  {
    id: 12,
    key: 'frame_amplifier',
    name: 'Frame Amplifier',
    description:
      'Extends melee combo windows and increases enemy stun duration for easier hookshot setups.',
    part: 'head',
    priceBits: 140,
    rescueTokens: 4,
    iconKey: 'chip_frame_amplifier',
  },
  {
    id: 13,
    key: 'dodge_slider',
    name: 'Dodge Slider',
    description:
      'Coats low-profile slides in brief phase armor, letting Volt slip safely under projectiles and light strikes.',
    part: 'legs',
    priceBits: 150,
    rescueTokens: 4,
    iconKey: 'chip_dodge_slider',
  },
  {
    id: 14,
    key: 'speed_basher',
    name: 'Speed Basher',
    description:
      'Turns full-speed sprints into a kinetic ram dealing 1.55 impact damage and knocking back light foes.',
    part: 'legs',
    priceBits: 150,
    rescueTokens: 4,
    iconKey: 'chip_speed_basher',
  },
  {
    id: 15,
    key: 'chain_booster',
    name: 'Chain Booster',
    description:
      'Extends hookshot cable reach (+3 ticks) and adds +1 impact damage to every hookshot strike.',
    part: 'arms',
    priceBits: 160,
    rescueTokens: 5,
    iconKey: 'chip_chain_booster',
  },
  {
    id: 16,
    key: 'chain_dasher',
    name: 'Chain Dasher',
    description:
      'Reconfigures the hookshot to zip Volt directly into enemies and cancel seamlessly into aerial melee.',
    part: 'arms',
    priceBits: 170,
    rescueTokens: 5,
    iconKey: 'chip_chain_dasher',
  },
  {
    id: 17,
    key: 'repair_enhancer',
    name: 'Repair Enhancer',
    description:
      'Boosts restorative efficiency of small and large health pickups by +2 additional HP.',
    part: 'body',
    priceBits: 140,
    rescueTokens: 4,
    iconKey: 'chip_repair_enhancer',
  },
  {
    id: 18,
    key: 'nullifying_layer',
    name: 'Nullifying Layer',
    description:
      'Maintains a rechargeable single-hit deflection barrier that negates one incoming attack on cooldown.',
    part: 'body',
    priceBits: 220,
    rescueTokens: 6,
    iconKey: 'chip_nullifying_layer',
  },
  {
    id: 19,
    key: 'protection_timer',
    name: 'Protection Timer',
    description:
      'Extends post-damage invulnerability recovery frames by 1.5x for safer repositioning in boss arenas.',
    part: 'head',
    priceBits: 150,
    rescueTokens: 4,
    iconKey: 'chip_protection_timer',
  },
  {
    id: 20,
    key: 'overflow_converter',
    name: 'Overflow Converter',
    description:
      'Converts any excess healing collected at full HP directly into pure Burst Energy.',
    part: 'circuit',
    priceBits: 190,
    rescueTokens: 5,
    iconKey: 'chip_overflow_converter',
  },
] as const;

export const CHIP_MAP: Readonly<Record<ChipId, ChipDefinition>> = CHIP_DEFINITIONS.reduce(
  (acc, item) => {
    acc[item.id] = item;
    return acc;
  },
  {} as Record<ChipId, ChipDefinition>,
);

export function getChipDefinition(id: ChipId): ChipDefinition {
  return CHIP_MAP[id];
}
