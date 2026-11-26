import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type { AssetPackManifest } from '../src/contracts/index';

// ============================================================================
// Krunked Circuit — Strictly Read-Only Steam Retail Asset Extractor
// Extracts PNG sprites/tilesets/backgrounds/palettes and OGG/WAV audio from
// the fused LÖVE2D ZIP inside GravityCircuit.exe into gitignored
// .krunked-circuit-assets/ and emits .krunked-circuit-assets/manifest.json.
// ============================================================================

const DEFAULT_STEAM_EXE =
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Gravity Circuit\\win64_steam\\GravityCircuit.exe';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const OUTPUT_DIR = path.join(REPO_ROOT, '.krunked-circuit-assets');
const MANIFEST_FILE = path.join(OUTPUT_DIR, 'manifest.json');

interface ZipEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

class ReadOnlyFusedZip {
  private readonly fd: number;
  private readonly zipBaseOffset: number;
  private readonly entries = new Map<string, ZipEntry>();

  constructor(exePath: string) {
    this.fd = fs.openSync(exePath, 'r');
    const stat = fs.fstatSync(this.fd);
    const fileSize = stat.size;
    const tailLen = Math.min(fileSize, 65557);
    const tailBuf = Buffer.allocUnsafe(tailLen);
    fs.readSync(this.fd, tailBuf, 0, tailLen, fileSize - tailLen);

    let eocdRel = -1;
    for (let i = tailLen - 22; i >= 0; i--) {
      if (tailBuf.readUInt32LE(i) === 0x06054b50) {
        const commentLen = tailBuf.readUInt16LE(i + 20);
        if (i + 22 + commentLen === tailLen) {
          eocdRel = i;
          break;
        }
      }
    }
    if (eocdRel < 0) {
      this.close();
      throw new Error(`Could not locate ZIP End-Of-Central-Directory in ${exePath}`);
    }

    const totalEntries = tailBuf.readUInt16LE(eocdRel + 10);
    const cdSize = tailBuf.readUInt32LE(eocdRel + 12);
    const cdOffset = tailBuf.readUInt32LE(eocdRel + 16);
    const eocdAbs = fileSize - tailLen + eocdRel;
    const cdStartAbs = eocdAbs - cdSize;
    this.zipBaseOffset = cdStartAbs - cdOffset;

    const cdBuf = Buffer.allocUnsafe(cdSize);
    fs.readSync(this.fd, cdBuf, 0, cdSize, cdStartAbs);

    let pos = 0;
    for (let idx = 0; idx < totalEntries && pos + 46 <= cdSize; idx++) {
      const sig = cdBuf.readUInt32LE(pos);
      if (sig !== 0x02014b50) {
        this.close();
        throw new Error(`Invalid ZIP Central Directory signature at offset ${pos}`);
      }
      const compressionMethod = cdBuf.readUInt16LE(pos + 10);
      const compressedSize = cdBuf.readUInt32LE(pos + 20);
      const uncompressedSize = cdBuf.readUInt32LE(pos + 24);
      const nameLen = cdBuf.readUInt16LE(pos + 28);
      const extraLen = cdBuf.readUInt16LE(pos + 30);
      const commentLen = cdBuf.readUInt16LE(pos + 32);
      const localHeaderOffset = cdBuf.readUInt32LE(pos + 42);
      const name = cdBuf.toString('utf8', pos + 46, pos + 46 + nameLen);

      this.entries.set(name, {
        name,
        compressionMethod,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
      });

      pos += 46 + nameLen + extraLen + commentLen;
    }
  }

  getEntries(): ZipEntry[] {
    return Array.from(this.entries.values());
  }

  has(entryPath: string): boolean {
    return this.entries.has(entryPath);
  }

  readBuffer(entryPath: string): Buffer {
    const entry = this.entries.get(entryPath);
    if (!entry) {
      throw new Error(`ZIP entry not found: ${entryPath}`);
    }
    const headerAbs = this.zipBaseOffset + entry.localHeaderOffset;
    const headerBuf = Buffer.allocUnsafe(30);
    fs.readSync(this.fd, headerBuf, 0, 30, headerAbs);
    if (headerBuf.readUInt32LE(0) !== 0x04034b50) {
      throw new Error(`Invalid ZIP local file header for ${entryPath}`);
    }
    const nameLen = headerBuf.readUInt16LE(26);
    const extraLen = headerBuf.readUInt16LE(28);
    const dataOffset = headerAbs + 30 + nameLen + extraLen;
    const raw = Buffer.allocUnsafe(entry.compressedSize);
    if (entry.compressedSize > 0) {
      fs.readSync(this.fd, raw, 0, entry.compressedSize, dataOffset);
    }
    if (entry.compressionMethod === 0) {
      return raw;
    }
    if (entry.compressionMethod === 8) {
      return zlib.inflateRawSync(raw);
    }
    throw new Error(`Unsupported ZIP compression method ${entry.compressionMethod} for ${entryPath}`);
  }

  readText(entryPath: string): string {
    return this.readBuffer(entryPath).toString('utf8');
  }

  close(): void {
    fs.closeSync(this.fd);
  }
}

function toPosix(relPath: string): string {
  return relPath.replace(/\\/g, '/');
}

function slugify(fileName: string): string {
  return path
    .basename(fileName, path.extname(fileName))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseRetailMusicMap(musicLua: string, extractedSet: Set<string>): Record<string, string> {
  const out: Record<string, string> = {};
  const blockRx = /\{\s*files\s*=\s*\{([\s\S]*?)\}\s*,[\s\S]*?id\s*=\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = blockRx.exec(musicLua)) !== null) {
    const filesBlock = m[1];
    const trackId = m[2];
    const paths = Array.from(filesBlock.matchAll(/path\s*=\s*"([^"]+)"/g), (pm) => `content/audio/music/${pm[1]}`);
    const valid = paths.filter((p) => extractedSet.has(p));
    if (valid.length === 0) continue;
    // Prefer loop file as primary track; also expose intro if 2-part track
    const loopFile = valid.find((p) => /loop/i.test(p)) ?? valid[0];
    out[trackId] = loopFile;
    if (valid.length >= 2 && valid[0] !== loopFile) {
      out[`${trackId}_intro`] = valid[0];
    }
  }
  return out;
}

function parseRetailSfxMap(sfxLua: string, extractedSet: Set<string>): Record<string, string> {
  const out: Record<string, string> = {};
  const sections: Array<{ name: string; folder: string }> = [
    { name: 'gameplay', folder: 'content/audio/sfx/gameplay/' },
    { name: 'hud', folder: 'content/audio/sfx/hud/' },
    { name: 'menu', folder: 'content/audio/sfx/menu/' },
    { name: 'level_select', folder: 'content/audio/sfx/level_select/' },
    { name: 'mission_complete', folder: 'content/audio/sfx/mission_complete/' },
    { name: 'teleport', folder: 'content/audio/sfx/teleport/' },
    { name: 'text', folder: 'content/audio/sfx/text/' },
    { name: 'misc', folder: 'content/audio/sfx/misc/' },
  ];

  // Strip block comments --[[ ... ]]
  const cleaned = sfxLua.replace(/--\[\[[\s\S]*?\]\]/g, '');
  const entryRx = /([a-zA-Z0-9_]+)\s*=\s*\{\s*file\s*=\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = entryRx.exec(cleaned)) !== null) {
    const key = m[1];
    const rel = m[2];
    for (const sec of sections) {
      const candidate = `${sec.folder}${rel}`;
      if (extractedSet.has(candidate)) {
        out[`${sec.name}_${key}`] = candidate;
        break;
      }
    }
  }
  return out;
}

function main(): void {
  const exePath = process.env.GRAVITY_CIRCUIT_EXE || DEFAULT_STEAM_EXE;
  if (!fs.existsSync(exePath)) {
    console.log(
      `[extract-assets] Owned Steam GravityCircuit.exe not found at "${exePath}". Skipping retail asset extraction cleanly.`,
    );
    return;
  }

  const zip = new ReadOnlyFusedZip(exePath);
  try {
    const entries = zip.getEntries();
    const extractedSet = new Set<string>();

    let imagesCount = 0;
    let palettesCount = 0;
    let audioMusicCount = 0;
    let audioSfxCount = 0;
    let mapsCount = 0;
    let writtenCount = 0;
    let skippedCount = 0;

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    for (const entry of entries) {
      if (entry.name.endsWith('/')) continue;
      const posixName = toPosix(entry.name);
      const ext = path.extname(posixName).toLowerCase();

      if (posixName.startsWith('content/maps/') && ext === '.gcl') {
        mapsCount++;
        continue;
      }

      if (ext !== '.png' && ext !== '.ogg' && ext !== '.wav') {
        continue;
      }

      // Guard against path traversal
      const normalized = path.normalize(posixName).replace(/^(\.\.(\/|\\|$))+/, '');
      const destPath = path.resolve(OUTPUT_DIR, normalized);
      if (!destPath.startsWith(OUTPUT_DIR)) {
        continue;
      }

      const alreadyPresent =
        fs.existsSync(destPath) && fs.statSync(destPath).size === entry.uncompressedSize;
      if (!alreadyPresent) {
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        const buf = zip.readBuffer(entry.name);
        fs.writeFileSync(destPath, buf);
        writtenCount++;
      } else {
        skippedCount++;
      }

      extractedSet.add(posixName);

      if (ext === '.png') {
        imagesCount++;
        if (posixName.startsWith('content/gfx/palettes/')) {
          palettesCount++;
        }
      } else if (posixName.startsWith('content/audio/music/')) {
        audioMusicCount++;
      } else if (posixName.startsWith('content/audio/sfx/')) {
        audioSfxCount++;
      }
    }

    const pick = (rel: string): string => {
      if (!extractedSet.has(rel)) {
        throw new Error(`Expected extracted asset missing from archive: ${rel}`);
      }
      return rel;
    };

    // ---------------- SPRITES ----------------
    const sprites: Record<string, string> = {
      player_hero: pick('content/gfx/characters/kai.png'),
      hookshot: pick('content/gfx/characters/kai.png'),
      palette_hero: pick('content/gfx/palettes/kai.png'),
      palette_master: pick('content/gfx/palettes/palette.png'),
      palette_grayscale: pick('content/gfx/palettes/palette_grayscale.png'),
      projectiles: pick('content/gfx/projectiles/projectiles.png'),
      particles: pick('content/gfx/particles/particles.png'),
      obstacles: pick('content/gfx/overworld/obstacles/obstacles.png'),
      walker: pick('content/gfx/overworld/walkers/walker-sprites.png'),
      pickups: pick('content/gfx/collectables/collectable-particles.png'),
      rescues: pick('content/gfx/collectables/rescuable-bots.png'),
      hud: pick('content/gfx/ui/hud/player_hud.png'),
      equippable_icons: pick('content/gfx/config/equippableIcons.png'),
      title_logo: pick('content/gfx/title/logo.png'),
      boss_intros: pick('content/gfx/intros/bossIntros.png'),
      bestiary: pick('content/gfx/characters/bestiary/bestiary.png'),
      // Boss logical keys (Krunked BossIds + retail aliases)
      boss_siege_tread: pick('content/gfx/characters/enemies/wrecker-tank.png'),
      boss_prism: pick('content/gfx/characters/npcs/ray.png'),
      boss_stitch: pick('content/gfx/characters/npcs/fix.png'),
      boss_frostfang: pick('content/gfx/characters/npcs/blade.png'),
      boss_arcbolt: pick('content/gfx/characters/npcs/cable.png'),
      boss_strider: pick('content/gfx/characters/npcs/bit.png'),
      boss_tempo: pick('content/gfx/characters/npcs/medley.png'),
      boss_crag: pick('content/gfx/characters/npcs/crash.png'),
      boss_phantom: pick('content/gfx/characters/npcs/hash.png'),
      boss_mirror_rival: pick('content/gfx/characters/npcs/nega-boss.png'),
      boss_prism_core: pick('content/gfx/characters/npcs/circuit-crystal.png'),
      boss_overlord_apex: pick('content/gfx/characters/npcs/commander.png'),
      boss_kernel: pick('content/gfx/characters/npcs/kernel_boss.png'),
      // Minibosses
      miniboss_junk_colossus: pick('content/gfx/characters/enemies/scrap-golem.png'),
      miniboss_sky_gunship: pick('content/gfx/characters/enemies/virus-heli.png'),
      miniboss_wrecker_tank: pick('content/gfx/characters/enemies/wrecker-tank.png'),
    };

    for (const rel of extractedSet) {
      if (rel.startsWith('content/gfx/characters/enemies/') && rel.endsWith('.png')) {
        sprites[`enemy_${slugify(rel)}`] = rel;
      } else if (rel.startsWith('content/gfx/portraits/') && rel.endsWith('.png')) {
        sprites[`portrait_${slugify(rel)}`] = rel;
      } else if (rel.startsWith('content/gfx/characters/npcs/') && rel.endsWith('.png')) {
        sprites[`npc_${slugify(rel)}`] = rel;
      }
    }

    // ---------------- TILESETS ----------------
    const tilesets: Record<string, string> = {
      optic: pick('content/gfx/tilesets/laser-circuit-tileset.png'),
      patch: pick('content/gfx/tilesets/patch-circuit-tileset.png'),
      cooler: pick('content/gfx/tilesets/cooler-circuit-tileset-v2.png'),
      elec: pick('content/gfx/tilesets/power-circuit-tileset.png'),
      shift: pick('content/gfx/tilesets/shift-circuit-tileset.png'),
      wave: pick('content/gfx/tilesets/wave-circuit-tileset.png'),
      break: pick('content/gfx/tilesets/crash-circuit-tileset.png'),
      cipher: pick('content/gfx/tilesets/cipher-circuit-tileset.png'),
      cipher_2: pick('content/gfx/tilesets/cipher-circuit-tileset-pt2.png'),
      opening: pick('content/gfx/tilesets/opening-stage-tileset.png'),
      tutorial: pick('content/gfx/tilesets/control-tileset.png'),
      hub: pick('content/gfx/tilesets/hub-tileset.png'),
      final_1: pick('content/gfx/tilesets/final-stage-1-tileset.png'),
      final_2: pick('content/gfx/tilesets/final-stage-2-tileset-1.png'),
      final_2_2: pick('content/gfx/tilesets/final-stage-2-tileset-2.png'),
      final_2_3: pick('content/gfx/tilesets/final-stage-2-tileset-3.png'),
      final_2_4: pick('content/gfx/tilesets/final-stage-2-tileset-4.png'),
      final_3: pick('content/gfx/tilesets/final-stage-3-tileset.png'),
      boss_rush: pick('content/gfx/tilesets/bossrush-tileset.png'),
      boss_rush_2: pick('content/gfx/tilesets/bossrush-tileset-2.png'),
    };

    // ---------------- BACKGROUNDS ----------------
    const backgrounds: Record<string, string> = {
      optic: pick('content/gfx/backgrounds/optic-stage-backgrounds.png'),
      patch: pick('content/gfx/backgrounds/patch-stage-backgrounds.png'),
      cooler: pick('content/gfx/backgrounds/cooler-stage-backgrounds.png'),
      elec: pick('content/gfx/backgrounds/power-stage-backgrounds.png'),
      shift: pick('content/gfx/backgrounds/shift-stage-backgrounds.png'),
      wave: pick('content/gfx/backgrounds/wave-stage-backgrounds.png'),
      break: pick('content/gfx/backgrounds/break-stage-backgrounds.png'),
      cipher: pick('content/gfx/backgrounds/cipher-stage-backgrounds.png'),
      opening: pick('content/gfx/backgrounds/opening-stage-backgrounds.png'),
      tutorial: pick('content/gfx/backgrounds/cipher-stage-backgrounds.png'),
      hub: pick('content/gfx/backgrounds/hub-area-backgrounds.png'),
      final_1: pick('content/gfx/backgrounds/final-stage-1-backgrounds.png'),
      final_2: pick('content/gfx/backgrounds/final-stage-2-backgrounds.png'),
      final_3: pick('content/gfx/backgrounds/final-stage-3-backgrounds.png'),
      boss_rush: pick('content/gfx/backgrounds/bossrush-backgrounds.png'),
    };

    // ---------------- AUDIO: MUSIC ----------------
    const retailMusic = zip.has('content/audio/music/music.lua')
      ? parseRetailMusicMap(zip.readText('content/audio/music/music.lua'), extractedSet)
      : {};

    const audioMusic: Record<string, string> = {
      ...retailMusic,
      // Logical stage BGM keys
      hub: pick('content/audio/music/hub/hub_command.ogg'),
      hub_command: pick('content/audio/music/hub/hub_command.ogg'),
      hub_medbay: pick('content/audio/music/hub/hub_stageselect.ogg'),
      hub_dojo: pick('content/audio/music/hub/hub_teleport.ogg'),
      tutorial: pick('content/audio/music/tutorial/tutorial_loop.ogg'),
      opening: pick('content/audio/music/intro/Opening_Stage_Loop.ogg'),
      optic: pick('content/audio/music/optic/Optic_Circuit_Stage_Loop.ogg'),
      patch: pick('content/audio/music/patch/Patch_Stage_Loop.ogg'),
      cooler: pick('content/audio/music/cooler/Cooler_Circuit_Stage_Loop.ogg'),
      elec: pick('content/audio/music/power/Power_Stage_Loop.ogg'),
      shift: pick('content/audio/music/shift/Shift_Circuit_Stage_Loop.ogg'),
      wave: pick('content/audio/music/wave/Wave_Circuit_Stage_Loop.ogg'),
      break: pick('content/audio/music/break/Break_Circuit_Stage_Loop.ogg'),
      cipher: pick('content/audio/music/cipher/Cipher_Circuit_Stage_Loop.ogg'),
      final_1: pick('content/audio/music/final/Final_Stage_1_Loop.ogg'),
      final_2: pick('content/audio/music/final/Final_Stage_2_Loop.ogg'),
      final_3: pick('content/audio/music/final/Final_Stage_3_Loop.ogg'),
      boss_rush: pick('content/audio/music/boss/final_stage_3/Final_Battle_Phase_2_Loop.ogg'),
      // Boss & UI BGM logical keys
      boss_standard: pick('content/audio/music/boss/boss_loop_ray.ogg'),
      boss_siege_tread: pick('content/audio/music/boss/intro_stage/Opening_Stage_Boss_Loop.ogg'),
      boss_prism: pick('content/audio/music/boss/boss_loop_ray.ogg'),
      boss_stitch: pick('content/audio/music/boss/boss_loop_trace.ogg'),
      boss_frostfang: pick('content/audio/music/boss/boss_loop_blade.ogg'),
      boss_arcbolt: pick('content/audio/music/boss/boss_loop_cable.ogg'),
      boss_strider: pick('content/audio/music/boss/boss_loop_bit.ogg'),
      boss_tempo: pick('content/audio/music/boss/boss_loop_medley.ogg'),
      boss_crag: pick('content/audio/music/boss/boss_loop_crash.ogg'),
      boss_phantom: pick('content/audio/music/boss/boss_loop_hash.ogg'),
      boss_mirror_rival: pick('content/audio/music/boss/final_stage_1/Final_Stage_1_Boss_Loop.ogg'),
      boss_prism_core: pick('content/audio/music/boss/final_stage_2/Circuit_Crystal_Battle_Loop.ogg'),
      boss_overlord_apex: pick('content/audio/music/boss/final_stage_3/Final_Battle_Phase_2_Loop.ogg'),
      title: pick('content/audio/music/jingles/title_drop.ogg'),
      title_ambient: pick('content/audio/music/jingles/title_drop_ambiance.ogg'),
      file_select: pick('content/audio/music/jingles/file_select_loop.ogg'),
      stage_start: pick('content/audio/music/jingles/mission_start.ogg'),
      stage_clear: pick('content/audio/music/jingles/mission_complete.ogg'),
      stage_results: pick('content/audio/music/jingles/mission_result_loop.ogg'),
      tension: pick('content/audio/music/jingles/tension_loop.ogg'),
      credits: pick('content/audio/music/cinematics/credits_loop.ogg'),
    };

    // ---------------- AUDIO: SFX ----------------
    const retailSfx = zip.has('content/audio/sfx/sfx.lua')
      ? parseRetailSfxMap(zip.readText('content/audio/sfx/sfx.lua'), extractedSet)
      : {};

    const audioSfx: Record<string, string> = {
      ...retailSfx,
      // Canonical logical SFX keys
      jump: pick('content/audio/sfx/gameplay/ft/ft-jump.wav'),
      jump_land: pick('content/audio/sfx/gameplay/ft/ft-jump-land.wav'),
      jump_from_hookshot: pick('content/audio/sfx/gameplay/ft/ft-jump-from-hookshot.wav'),
      slide: pick('content/audio/sfx/gameplay/ft/ft-slide.wav'),
      sprint: pick('content/audio/sfx/gameplay/ft/ft-sprint-start.wav'),
      footstep: pick('content/audio/sfx/gameplay/ft/ft-footstep-sprint.wav'),
      ledge_grab: pick('content/audio/sfx/gameplay/ledge_grab_ver2.wav'),
      punch: pick('content/audio/sfx/gameplay/ft/ft-punch-v2.wav'),
      punch_alt: pick('content/audio/sfx/gameplay/ft/ft-punch.wav'),
      punch_hit: pick('content/audio/sfx/gameplay/ft/ft-punch-hit-regular-v2.wav'),
      punch_hard_hit: pick('content/audio/sfx/gameplay/ft/ft-hit-hard-v2.wav'),
      punch_stunned: pick('content/audio/sfx/gameplay/ft/ft-punch-stunned.wav'),
      punch_reflect: pick('content/audio/sfx/gameplay/ft/ft-hit-reflect.wav'),
      guard_break: pick('content/audio/sfx/gameplay/guard_break.wav'),
      punch_shield: pick('content/audio/sfx/gameplay/punch_shield.wav'),
      no_damage: pick('content/audio/sfx/gameplay/no_damage.wav'),
      stun: pick('content/audio/sfx/gameplay/ft/ft-stun.wav'),
      enemy_hit: pick('content/audio/sfx/gameplay/ft/ft-hit-hard.wav'),
      enemy_explode: pick('content/audio/sfx/gameplay/ft/ft-destruct.wav'),
      enemy_bounce: pick('content/audio/sfx/gameplay/ft/ft-enemy-bounce-enemy.wav'),
      hookshot_shoot: pick('content/audio/sfx/gameplay/ft/ft-hookshot-shoot.wav'),
      hookshot_latch: pick('content/audio/sfx/gameplay/ft/ft-hookshot-latch-solid-tile.wav'),
      hookshot_latch_passable: pick('content/audio/sfx/gameplay/ft/ft-hookshot-latch-passable-tile.wav'),
      hookshot_latch_enemy: pick('content/audio/sfx/gameplay/ft/ft-hookshot-latch-enemy.wav'),
      grab: pick('content/audio/sfx/gameplay/ft/ft-grab.wav'),
      throw: pick('content/audio/sfx/gameplay/ft/ft-throw.wav'),
      burst_flash: pick('content/audio/sfx/gameplay/ft/ft-burst-super-flash-v4.wav'),
      player_hit: pick('content/audio/sfx/gameplay/ft/ft-player-hit-v2.wav'),
      hazard_hit: pick('content/audio/sfx/gameplay/lethal_hit.wav'),
      hazard_respawn: pick('content/audio/sfx/gameplay/respawn.wav'),
      player_death: pick('content/audio/sfx/gameplay/death/player_death_explosion.wav'),
      checkpoint: pick('content/audio/sfx/gameplay/checkpoint/checkpoint_activate.wav'),
      rescue: pick('content/audio/sfx/gameplay/pickups/rescue_ver3.wav'),
      pickup_bit: pick('content/audio/sfx/gameplay/pickups/money_1.wav'),
      pickup_health: pick('content/audio/sfx/gameplay/pickups/health_pick_up.wav'),
      pickup_health_large: pick('content/audio/sfx/gameplay/pickups/health_pick_up_large.wav'),
      pickup_burst: pick('content/audio/sfx/gameplay/pickups/burst_energy_v2.wav'),
      pickup_booster: pick('content/audio/sfx/gameplay/pickups/health_burst_upgrade_pick_up_ver2.wav'),
      pickup_palette: pick('content/audio/sfx/gameplay/pickups/palette_chip_pick_up.wav'),
      pickup_datachip: pick('content/audio/sfx/gameplay/pickups/data_chip_pick_up.wav'),
      burst_charge_get: pick('content/audio/sfx/hud/burst_charge_get-v2.wav'),
      burst_charge_max: pick('content/audio/sfx/hud/burst_charge_get_max.wav'),
      boss_phase2: pick('content/audio/sfx/gameplay/bosses/boss_phase_2.wav'),
      boss_explode: pick('content/audio/sfx/gameplay/bosses/boss_big_explosion_ver2.wav'),
      challenge_unlock: pick('content/audio/sfx/gameplay/challenge_completed.wav'),
      menu_move: pick('content/audio/sfx/menu/menu1-v2.wav'),
      menu_confirm: pick('content/audio/sfx/menu/menu2-v2.wav'),
      menu_cancel: pick('content/audio/sfx/menu/menu3-v2.wav'),
      menu_equip: pick('content/audio/sfx/menu/equip_ver3.wav'),
      menu_unequip: pick('content/audio/sfx/menu/unequip_ver2.wav'),
      menu_error: pick('content/audio/sfx/menu/error.wav'),
      door: pick('content/audio/sfx/gameplay/doors/door_1.wav'),
      crate_break: pick('content/audio/sfx/gameplay/crates/break_crate.wav'),
      barrel_break: pick('content/audio/sfx/gameplay/crates/break_barrel.wav'),
    };

    const manifest: AssetPackManifest = {
      version: 1,
      source: exePath,
      extractedAt: new Date().toISOString(),
      counts: {
        images: imagesCount,
        audioMusic: audioMusicCount,
        audioSfx: audioSfxCount,
        maps: mapsCount,
        palettes: palettesCount,
      },
      sprites,
      tilesets,
      backgrounds,
      audioMusic,
      audioSfx,
    };

    fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

    console.log(`[extract-assets] Wrote ${MANIFEST_FILE}`);
    console.log(
      `[extract-assets] Extracted ${writtenCount} files (${skippedCount} already up-to-date): images=${imagesCount} (palettes=${palettesCount}), audioMusic=${audioMusicCount}, audioSfx=${audioSfxCount}, maps=${mapsCount}`,
    );
    console.log(
      `[extract-assets] Manifest keys: sprites=${Object.keys(sprites).length}, tilesets=${Object.keys(tilesets).length}, backgrounds=${Object.keys(backgrounds).length}, audioMusic=${Object.keys(audioMusic).length}, audioSfx=${Object.keys(audioSfx).length}`,
    );
  } finally {
    zip.close();
  }
}

main();
