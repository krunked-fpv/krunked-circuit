import type { ArmorPaintDefinition, ArmorPaintId } from '../contracts/index';

// Each Palette6 is [outline, dark, primary, highlight, accent, visorGlow]
export const ARMOR_PAINT_DEFINITIONS: readonly ArmorPaintDefinition[] = [
  {
    id: 0,
    key: 'classic_k01',
    name: 'Unit K-01 Classic',
    traitName: 'Balanced Circuit',
    description:
      'Standard Circuit Guard cobalt-and-titanium finish calibrated for balanced speed, defense, and recovery.',
    palette: ['#0d101b', '#1b3d7a', '#2e7cf6', '#8cd4ff', '#ff4757', '#66fff2'],
  },
  {
    id: 1,
    key: 'solar_beam',
    name: 'Solar Beam',
    traitName: 'Helios Dive Flare',
    description:
      'Sun-forged golden alloy from the Solar Relay. Dive-kicks release an explosive solar shockwave on impact.',
    unlockStage: 'optic',
    palette: ['#1a0d08', '#8a3b08', '#f59e0b', '#fde047', '#ef4444', '#fff7ae'],
  },
  {
    id: 2,
    key: 'scrap_weld',
    name: 'Salvage Weld',
    traitName: 'Scrap Harvester',
    description:
      'Heavy-duty foundry plating tuned for resource extraction. Enemies yield bonus Bits and crates detonate wider.',
    unlockStage: 'patch',
    palette: ['#121410', '#3d4a2a', '#6b823f', '#b8cf6b', '#e67e22', '#ffe66d'],
  },
  {
    id: 3,
    key: 'cryo_edge',
    name: 'Cryo Edge',
    traitName: 'Thermal Traction',
    description:
      'Sub-zero ceramic coating that eliminates ice traction loss and chills struck targets.',
    unlockStage: 'cooler',
    palette: ['#0b1320', '#1e4b7a', '#38bdf8', '#d8f3ff', '#6366f1', '#a5f3fc'],
  },
  {
    id: 4,
    key: 'voltaic_surge',
    name: 'Voltaic Surge',
    traitName: 'Kinetic Capacitor',
    description:
      'High-conductivity coil weave that passively harvests Burst Energy while sprinting and hookshot zipping.',
    unlockStage: 'elec',
    palette: ['#0f0c24', '#2e2478', '#5b4df5', '#a5a1ff', '#facc15', '#38f8ff'],
  },
  {
    id: 5,
    key: 'aero_strider',
    name: 'Aero Strider',
    traitName: 'Velocity Overdrive',
    description:
      'Streamlined skyway shell that boosts Unit K-01 walk and sprint speeds by +0.50 px/tick.',
    unlockStage: 'shift',
    palette: ['#1a0b12', '#7f1d35', '#f43f5e', '#fda4af', '#f8fafc', '#34d399'],
  },
  {
    id: 6,
    key: 'harmonic_pulse',
    name: 'Harmonic Pulse',
    traitName: 'Resonance Cadence',
    description:
      'Synth-tuned acoustic plating that sustains melee combos longer and amplifies Burst Technique power.',
    unlockStage: 'wave',
    palette: ['#17091f', '#5c1778', '#c026d3', '#f5a6ff', '#2dd4bf', '#ff77e9'],
  },
  {
    id: 7,
    key: 'basalt_titan',
    name: 'Basalt Titan',
    traitName: 'Heavy Impact',
    description:
      'Dense quarry tungsten plating increasing max fall speed by +3.0 px/tick for crushing heavy dive-kicks.',
    unlockStage: 'break',
    palette: ['#141214', '#3b353c', '#69626d', '#b4adb8', '#f97316', '#ffbf47'],
  },
  {
    id: 8,
    key: 'cipher_ghost',
    name: 'Cipher Ghost',
    traitName: 'Phase Step',
    description:
      'Stealth matrix coating that extends slide agility and improves evasion through dense projectile lanes.',
    unlockStage: 'cipher',
    palette: ['#0a1216', '#163d42', '#10b981', '#86efac', '#8b5cf6', '#bef264'],
  },
  {
    id: 9,
    key: 'overclock_crimson',
    name: 'Overclock Crimson',
    traitName: 'Glass Overdrive',
    description:
      'Unshackled prototype lacquer boosting melee & throw output by +35%, at the cost of 0.8x invulnerability frames.',
    unlockStage: 'final_1',
    palette: ['#18060a', '#6e0d1c', '#dc2626', '#ff8787', '#fbbf24', '#fff5cc'],
  },
  {
    id: 10,
    key: 'aegis_platinum',
    name: 'Aegis Platinum',
    traitName: 'Reinforced Plating',
    description:
      'Citadel-grade reflective titanium that shaves 1 point off incoming contact and projectile hits (min 1).',
    unlockStage: 'final_2',
    palette: ['#0f141e', '#475569', '#94a3b8', '#f1f5f9', '#3b82f6', '#38f2ff'],
  },
  {
    id: 11,
    key: 'apex_circuit',
    name: 'Apex Circuit',
    traitName: 'Master Resonance',
    description:
      'Ceremonial Circuit Guard championship finish combining brisk mobility, strong charge flow, and explosive throws.',
    unlockStage: 'final_3',
    palette: ['#0d0b14', '#423215', '#d4a017', '#fef08a', '#06b6d4', '#ffffff'],
  },
] as const;

export const ARMOR_PAINT_MAP: Readonly<Record<ArmorPaintId, ArmorPaintDefinition>> =
  ARMOR_PAINT_DEFINITIONS.reduce(
    (acc, item) => {
      acc[item.id] = item;
      return acc;
    },
    {} as Record<ArmorPaintId, ArmorPaintDefinition>,
  );

export function getArmorPaintDefinition(id: ArmorPaintId): ArmorPaintDefinition {
  return ARMOR_PAINT_MAP[id];
}
