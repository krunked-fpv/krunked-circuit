// ============================================================================
// Krunked Circuit — Master Game Application Controller
// Runs fixed 60 Hz deterministic simulation + decoupled 30/60/120 FPS WebGL2
// render loop with interpAlpha interpolation, AudioEngine, AssetRegistry,
// InputManager (Keyboard + Xbox/Tesla Gamepad + TouchOverlay), MenuSystem,
// F9 DebugDrawer, SaveManager, and window.__KRUNKED_DEBUG__.
// ============================================================================

import { AssetRegistry } from '../assets/AssetRegistry';
import { PALETTE_KEY_COLORS } from '../assets/ProceduralPixelAtlas';
import { AudioEngine } from '../audio/AudioEngine';
import {
  ENGINE_CONSTANTS,
  OFFICIAL_STAGE_IDS,
  PLAYER_PHYSICS,
  createNeutralInput,
  type AssetMode,
  type AudioSettings,
  type ControlBindings,
  type HubTerminalKind,
  type InputFrame,
  type KrunkedDebugBridge,
  type RenderSettings,
  type RenderSnapshot,
  type SimEvent,
  type SimState,
  type SimulatedGamepadState,
  type StageId,
} from '../contracts/index';
import {
  ARMOR_PAINT_DEFINITIONS,
  BOSS_DEFINITIONS,
  BURST_DEFINITIONS,
  CHALLENGE_DEFINITIONS,
  CHIP_DEFINITIONS,
  DATACHIP_DEFINITIONS,
  getArmorPaintDefinition,
  getBossDefinition,
  getEnemyArchetype,
  getStageDefinition,
} from '../data/index';
import { InputManager } from '../input/InputManager';
import { createGameRenderer, type GameRenderer } from '../render/WebGL2Renderer';
import { hashSimState } from '../sim/hash';
import {
  equipArmor,
  equipBurst,
  equipChip,
  purchaseBurst,
  purchaseChip,
  switchLoadout,
  unlockAllContent,
} from '../sim/progression';
import {
  captureRenderSnapshot,
  createFullSimState,
  loadFullStage,
  stepFullSim,
} from '../sim/runtime';
import { DebugDrawer } from '../ui/DebugDrawer';
import { MenuSystem, type MenuCatalogData } from '../ui/MenuSystem';
import { installDebugBridge, uninstallDebugBridge } from './DebugBridge';
import { SaveManager } from './SaveManager';

const FIXED_DT = ENGINE_CONSTANTS.FIXED_DT;
const MAX_FRAME_DT = 0.1; // Clamp tab-resume spikes cleanly
const MAX_SUBSTEPS = 5;

export class GameApp {
  private readonly canvas: HTMLCanvasElement;
  private readonly uiRoot: HTMLElement | null;
  private readonly touchRoot: HTMLElement | null;
  private readonly toastRoot: HTMLElement | null;
  private readonly debugRoot: HTMLElement | null;

  private readonly saveManager = new SaveManager();
  private readonly assets = new AssetRegistry();
  private readonly audio: AudioEngine;
  private readonly renderer: GameRenderer;
  private readonly input: InputManager;
  private readonly menus: MenuSystem;
  private readonly debugDrawer: DebugDrawer;

  private state: SimState;
  private prevSnapshot: RenderSnapshot;
  private renderSettings: RenderSettings;
  private audioSettings: AudioSettings;
  private controls: ControlBindings;
  private hasExistingSave: boolean;

  private rafId: number | null = null;
  private lastRafTime = 0;
  private lastRenderTime = 0;
  private accumulator = 0;
  private fpsSamples = 0;
  private fpsWindowStart = 0;
  private measuredFps = 60;
  private disposed = false;
  private qaGamepadSimActive = false;

  private readonly handleUnlockGesture = (): void => {
    this.audio.unlock();
  };

  constructor(elements: {
    canvas: HTMLCanvasElement;
    uiRoot: HTMLElement | null;
    touchRoot: HTMLElement | null;
    toastRoot: HTMLElement | null;
    debugRoot: HTMLElement | null;
  }) {
    this.canvas = elements.canvas;
    this.uiRoot = elements.uiRoot;
    this.touchRoot = elements.touchRoot;
    this.toastRoot = elements.toastRoot;
    this.debugRoot = elements.debugRoot;

    const loaded = this.saveManager.load();
    this.hasExistingSave = loaded.existed && !loaded.recovered;
    this.renderSettings = { ...loaded.data.renderSettings };
    this.audioSettings = { ...loaded.data.audioSettings };
    this.controls = {
      ...loaded.data.controls,
      keyboard: { ...loaded.data.controls.keyboard },
    };

    // Start cleanly on the Title Screen with Opening scene live in backdrop
    this.state = createFullSimState('opening', false, loaded.data.progression);
    this.state.screen = 'title';
    this.prevSnapshot = captureRenderSnapshot(this.state);

    this.audio = new AudioEngine(this.audioSettings);
    this.renderer = createGameRenderer();

    this.input = new InputManager({
      touchContainer: this.touchRoot,
      bindings: this.controls,
      onModalityChange: (modality) => {
        if (modality === 'gamepad') {
          const gpName = this.input.getGamepadAdapter().getConnectedGamepadName();
          if (gpName) {
            this.menus.showToast(`GAMEPAD ACTIVE: ${gpName.slice(0, 28)}`, 'info');
          }
        }
      },
      onToast: (text, tone) => {
        this.menus.showToast(text, tone);
      },
    });

    const catalog = this.buildMenuCatalog();
    this.menus = new MenuSystem(
      this.uiRoot,
      {
        onPlayCampaign: (difficulty, mode, modifiers) => {
          this.audio.unlock();
          this.state.progression.difficulty = difficulty;
          this.state.progression.mode = mode;
          this.state.progression.modifiers = { ...modifiers };
          if (mode === 'speedrun') {
            this.renderSettings.showSpeedrunTimer = true;
          }
          const startStage: StageId = mode === 'boss_rush' ? 'boss_rush' : 'opening';
          this.startStage(startStage, modifiers.masterLevels && startStage !== 'boss_rush');
          this.persistSave();
        },
        onContinue: () => {
          this.audio.unlock();
          const hasClearedOpening = this.state.progression.clearedStages.includes('opening');
          this.startStage(hasClearedOpening ? 'hub' : 'opening', false);
        },
        onStartBossRush: () => {
          this.audio.unlock();
          this.state.progression.mode = 'boss_rush';
          this.renderSettings.showSpeedrunTimer = true;
          this.startStage('boss_rush', false);
        },
        onEnterHub: () => {
          this.audio.unlock();
          this.startStage('hub', false);
        },
        onSelectStage: (stageId, remix) => {
          this.audio.unlock();
          this.state.activeHubTerminal = null;
          this.startStage(stageId, remix);
        },
        onStartRefight: (bossId, stageId) => {
          this.audio.unlock();
          this.state.activeHubTerminal = null;
          this.startStage(stageId, false);
          this.warpPlayerToBoss();
          this.menus.showToast(`REFIGHT: ${getBossDefinition(bossId).name.toUpperCase()}`, 'info');
        },
        onResume: () => {
          this.state.screen = 'playing';
        },
        onSwapLoadout: (index) => {
          switchLoadout(this.state.progression, index);
          this.audio.playSfx('loadout_swap');
          this.persistSave();
        },
        onRetryCheckpoint: () => {
          this.retryFromCheckpoint();
        },
        onRestartStage: () => {
          this.startStage(this.state.stageId, this.state.remix);
        },
        onReturnToHub: () => {
          this.startStage('hub', false);
        },
        onReturnToTitle: () => {
          this.state.activeHubTerminal = null;
          this.state.screen = 'title';
          this.audio.playBgm('bgm_title', 200);
        },
        onCloseHubModal: () => {
          this.state.activeHubTerminal = null;
          this.state.screen = 'playing';
        },
        onChangeHubTab: (tab) => {
          this.state.activeHubTerminal = tab;
        },
        onBuyBurst: (burstId) => {
          const res = purchaseBurst(this.state.progression, burstId);
          this.menus.showToast(res.ok ? 'BURST TECHNIQUE UNLOCKED!' : (res.reason ?? 'CANNOT PURCHASE'), res.ok ? 'unlock' : 'warn');
          this.audio.playSfx(res.ok ? 'menu_confirm' : 'menu_cancel');
          if (res.ok) this.persistSave();
        },
        onEquipBurst: (slot, burstId) => {
          if (equipBurst(this.state.progression, slot, burstId)) {
            this.audio.playSfx('loadout_swap');
            this.persistSave();
          }
        },
        onBuyChip: (chipId) => {
          const res = purchaseChip(this.state.progression, chipId);
          this.menus.showToast(res.ok ? 'BOOSTER CHIP UNLOCKED!' : (res.reason ?? 'CANNOT PURCHASE'), res.ok ? 'unlock' : 'warn');
          this.audio.playSfx(res.ok ? 'menu_confirm' : 'menu_cancel');
          if (res.ok) this.persistSave();
        },
        onEquipChip: (slotIndex, chipId) => {
          if (equipChip(this.state.progression, slotIndex, chipId)) {
            this.audio.playSfx('loadout_swap');
            this.persistSave();
          }
        },
        onEquipArmor: (armorId) => {
          if (equipArmor(this.state.progression, armorId)) {
            const def = getArmorPaintDefinition(armorId);
            this.audio.playSfx('loadout_swap');
            this.menus.showToast(`ARMOR: ${def.name.toUpperCase()} (${def.traitName})`, 'unlock');
            this.persistSave();
          }
        },
        onUpdateRenderSettings: (partial) => {
          this.renderSettings = { ...this.renderSettings, ...partial };
          this.persistSave();
          this.syncMenusNow();
        },
        onUpdateAudioSettings: (partial) => {
          this.audioSettings = { ...this.audioSettings, ...partial };
          this.audio.setSettings(this.audioSettings);
          this.persistSave();
          this.syncMenusNow();
        },
        onUpdateControls: (partial) => {
          this.controls = {
            ...this.controls,
            ...partial,
            keyboard: partial.keyboard
              ? { ...this.controls.keyboard, ...partial.keyboard }
              : { ...this.controls.keyboard },
          };
          this.input.setBindings(this.controls);
          this.persistSave();
          this.syncMenusNow();
        },
        onStartKeyCapture: (action, onCaptured) => {
          this.input.startKeyCapture(action, (code) => {
            this.controls = this.input.getBindings();
            this.persistSave();
            onCaptured(code);
            this.syncMenusNow();
          });
        },
        onResetControls: () => {
          this.input.resetBindings();
          this.controls = this.input.getBindings();
          this.persistSave();
          this.menus.showToast('CONTROLS RESET TO DEFAULT', 'info');
          this.syncMenusNow();
        },
        onToggleAssetMode: async (mode) => {
          await this.setAssetMode(mode);
        },
        onUploadCustomPackFolder: async (files) => {
          const result = await this.assets.importCustomPackFolder(files);
          this.menus.showToast(result.message, result.ok ? 'unlock' : 'warn');
          if (result.ok) {
            await this.setAssetMode('CUSTOM_PACK');
          }
        },
        onToggleFullscreen: () => {
          this.toggleFullscreen();
        },
        onMenuSfx: (key) => {
          this.audio.unlock();
          this.audio.playSfx(key);
        },
      },
      catalog,
      this.toastRoot,
    );

    this.debugDrawer = new DebugDrawer(this.debugRoot, {
      onLoadStage: (stageId, remix) => {
        this.startStage(stageId, remix);
      },
      onWarpToBoss: () => {
        this.warpPlayerToBoss();
      },
      onHealFull: () => {
        this.state.player.hp = this.state.player.maxHp;
      },
      onFullBurst: () => {
        this.state.player.burstEnergy =
          this.state.player.maxBurstCharges * PLAYER_PHYSICS.BURST_ENERGY_PER_CHARGE;
      },
      onUnlockAll: () => {
        unlockAllContent(this.state.progression);
        this.menus.showToast('ALL BURSTS, CHIPS & ARMORS UNLOCKED', 'unlock');
        this.persistSave();
      },
      onEquipArmor: (armorId) => {
        if (!this.state.progression.unlockedArmors.includes(armorId)) {
          this.state.progression.unlockedArmors.push(armorId);
        }
        equipArmor(this.state.progression, armorId);
        this.persistSave();
      },
      onSetAssetMode: (mode) => {
        void this.setAssetMode(mode);
      },
      onTestTouchOverlay: () => {
        const touch = this.input.getTouchOverlay();
        const next = !touch.isVisible();
        if (next) {
          this.qaGamepadSimActive = false;
          this.input.setSimulatedGamepad(null);
          touch.setVisible(true);
          if (typeof window !== 'undefined' && typeof PointerEvent !== 'undefined') {
            window.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', pointerId: 99, bubbles: true }));
          }
          this.menus.showToast('TOUCH OVERLAY ACTIVATED (PRESS ANY KEY TO HIDE)', 'info');
        } else {
          touch.setVisible(false);
          this.menus.showToast('TOUCH OVERLAY HIDDEN', 'info');
        }
        this.syncMenusNow();
      },
      onTestXboxGamepad: () => {
        this.qaGamepadSimActive = !this.qaGamepadSimActive;
        if (this.qaGamepadSimActive) {
          this.input.setSimulatedGamepad({
            id: 'Xbox Wireless Controller (STANDARD GAMEPAD)',
            connected: true,
            axes: [0.65, 0, 0, 0],
            buttons: [0, 0, 0, 0, 0, 0, 0, 0.85, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          });
          this.menus.showToast('XBOX/TESLA GAMEPAD SIM ACTIVE', 'unlock');
        } else {
          this.input.setSimulatedGamepad(null);
          this.menus.showToast('XBOX/TESLA GAMEPAD SIM CLEARED', 'info');
        }
        this.syncMenusNow();
      },
      getDiagnostics: () => ({
        fps: this.measuredFps,
        hash: hashSimState(this.state),
        tick: this.state.tick,
        stageId: this.state.stageId,
        remix: this.state.remix,
        modality: this.input.getModality(),
        touchState: this.input.getTouchOverlayState(),
        assetMode: this.renderSettings.assetMode,
        rendererBackend: 'webgl2',
        playerX: this.state.player.x,
        playerY: this.state.player.y,
        playerHp: this.state.player.hp,
        playerMaxHp: this.state.player.maxHp,
        burstEnergy: this.state.player.burstEnergy,
        activeArmorId:
          this.state.progression.loadouts[this.state.progression.activeLoadoutIndex].armorPaint,
      }),
    });

    if (loaded.recovered) {
      this.menus.showToast('CORRUPT SAVE RECOVERED — FRESH PROFILE', 'warn');
    }
  }

  private buildMenuCatalog(): MenuCatalogData {
    return {
      stages: OFFICIAL_STAGE_IDS.map((id) => {
        const def = getStageDefinition(id, false);
        const boss = def.bossId ? getBossDefinition(def.bossId) : undefined;
        return {
          id,
          name: def.name,
          subtitle: def.subtitle,
          bossId: def.bossId,
          bossName: boss?.name,
        };
      }),
      bursts: BURST_DEFINITIONS,
      chips: CHIP_DEFINITIONS,
      armors: ARMOR_PAINT_DEFINITIONS,
      bosses: BOSS_DEFINITIONS,
      challenges: CHALLENGE_DEFINITIONS,
      dataChips: DATACHIP_DEFINITIONS,
    };
  }

  public async boot(): Promise<void> {
    await this.assets.init();

    const atlas = this.assets.getAtlas();
    const atlasCanvas = atlas.toCanvas();
    const regions = atlas.getRegionsRecord();

    this.renderer.init(this.canvas, atlasCanvas, regions);
    if ('setSourcePalette' in this.renderer && typeof this.renderer.setSourcePalette === 'function') {
      (this.renderer as { setSourcePalette: (p: typeof PALETTE_KEY_COLORS) => void }).setSourcePalette(
        PALETTE_KEY_COLORS,
      );
    }

    // Wire dual-mode custom audio resolver
    this.audio.setCustomUrlResolver((kind, key) => {
      if (this.assets.getMode() !== 'CUSTOM_PACK') return null;
      return this.assets.getCustomAudioUrl(kind, key);
    });

    // Honor saved Custom Pack preference if pack is actually available
    if (this.renderSettings.assetMode === 'CUSTOM_PACK' && this.assets.isCustomPackAvailable()) {
      await this.setAssetMode('CUSTOM_PACK', true);
    } else {
      this.renderSettings.assetMode = 'BUILTIN';
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('pointerdown', this.handleUnlockGesture, { passive: true });
      window.addEventListener('keydown', this.handleUnlockGesture, { passive: true });
    }

    this.installDebugBridge();
    this.audio.playBgm('bgm_title', 200);

    this.lastRafTime = performance.now();
    this.lastRenderTime = this.lastRafTime;
    this.fpsWindowStart = this.lastRafTime;
    this.loop(this.lastRafTime);
  }

  private async setAssetMode(mode: AssetMode, silent = false): Promise<void> {
    const customSpriteKeys = ['player_hero', 'hook_tip', 'boss_prism', 'boss_siege_tread'] as const;

    if (mode === 'CUSTOM_PACK' && !this.assets.isCustomPackAvailable()) {
      if (!silent) {
        this.menus.showToast('NO LOCAL CUSTOM PACK FOUND — USE LOAD PACK FOLDER', 'warn');
      }
      this.renderSettings.assetMode = 'BUILTIN';
      for (const key of customSpriteKeys) {
        this.renderer.setCustomSpriteOverride(key, null);
      }
      this.syncMenusNow();
      return;
    }

    await this.assets.setMode(mode);
    this.renderSettings.assetMode = this.assets.getMode();

    if (this.renderSettings.assetMode === 'CUSTOM_PACK') {
      await this.assets.preloadCustomImages([...customSpriteKeys]);
      for (const key of customSpriteKeys) {
        const img = this.assets.getCustomImage(key);
        // Only apply direct single-frame overrides (never squish a packed multi-frame sheet into 32x32)
        if (img && img.naturalWidth > 0 && img.naturalWidth <= 96 && img.naturalHeight <= 96) {
          this.renderer.setCustomSpriteOverride(key, img);
        } else {
          this.renderer.setCustomSpriteOverride(key, null);
        }
      }
    } else {
      for (const key of customSpriteKeys) {
        this.renderer.setCustomSpriteOverride(key, null);
      }
    }

    if (!silent) {
      this.menus.showToast(
        this.renderSettings.assetMode === 'CUSTOM_PACK'
          ? 'ASSET MODE: OWNED CUSTOM PACK'
          : 'ASSET MODE: BUILT-IN KRUNKED ART',
        'unlock',
      );
    }
    this.persistSave();
    this.syncMenusNow();
  }

  public startStage(stageId: StageId, remix = false): void {
    if (stageId === 'boss_rush') {
      this.state.progression.mode = 'boss_rush';
      this.renderSettings.showSpeedrunTimer = true;
    } else if (this.state.progression.mode === 'boss_rush') {
      this.state.progression.mode = 'standard';
    }
    loadFullStage(this.state, stageId, remix);
    this.state.screen = 'playing';
    this.state.activeHubTerminal = null;
    this.prevSnapshot = captureRenderSnapshot(this.state);
    this.drainEvents();
    this.persistSave();
    this.syncMenusNow();
  }

  private retryFromCheckpoint(): void {
    if (this.state.progression.modifiers.singleCredit) {
      this.startStage(this.state.stageId, this.state.remix);
      return;
    }
    const p = this.state.player;
    p.hp = p.maxHp;
    p.x = p.lastSafeX;
    p.y = p.lastSafeY;
    p.vx = 0;
    p.vy = 0;
    p.invulnTimer = 60;
    p.hurtTimer = 0;
    p.action = 'idle';
    this.state.camera.lockedBossArena = false;
    if (this.state.boss && !this.state.boss.defeated) {
      this.state.boss.active = false;
      this.state.boss.hp = this.state.boss.maxHp;
      this.state.boss.phase = 1;
      this.state.boss.desperationTriggered = false;
      this.state.boss.aiState = 'idle';
    }
    this.state.screen = 'playing';
    this.prevSnapshot = captureRenderSnapshot(this.state);
    const stage = getStageDefinition(this.state.stageId, this.state.remix);
    this.audio.playBgm(stage.bgmKey, 200);
  }

  private warpPlayerToBoss(): void {
    const stage = getStageDefinition(this.state.stageId, this.state.remix);
    const bossCellLeft = stage.bossCellX * ENGINE_CONSTANTS.GAME_WIDTH;
    const bossCellTop = stage.bossCellY * ENGINE_CONSTANTS.GAME_HEIGHT;
    this.state.player.x = bossCellLeft + 36;
    this.state.player.y = bossCellTop + ENGINE_CONSTANTS.GAME_HEIGHT - 16 - this.state.player.h - 2;
    this.state.player.vx = 0;
    this.state.player.vy = 0;
    this.state.player.lastSafeX = this.state.player.x;
    this.state.player.lastSafeY = this.state.player.y;
    this.state.camera.cellX = stage.bossCellX;
    this.state.camera.cellY = stage.bossCellY;
    this.state.camera.x = bossCellLeft;
    this.state.camera.y = bossCellTop;
    this.state.camera.targetX = bossCellLeft;
    this.state.camera.targetY = bossCellTop;
    this.prevSnapshot = captureRenderSnapshot(this.state);
  }

  private toggleFullscreen(): void {
    if (typeof document === 'undefined') return;
    try {
      if (!document.fullscreenElement) {
        void document.documentElement.requestFullscreen?.();
      } else {
        void document.exitFullscreen?.();
      }
    } catch {
      // Ignore fullscreen denial
    }
  }

  private syncMenusNow(): void {
    this.menus.sync({
      screen: this.state.screen,
      activeHubTerminal: this.state.activeHubTerminal,
      progression: this.state.progression,
      stageStats: this.state.stageStats,
      renderSettings: this.renderSettings,
      audioSettings: this.audioSettings,
      controls: this.controls,
      modality: this.input.getModality(),
      gamepadName: this.input.getGamepadAdapter().getConnectedGamepadName(),
      hasSave: this.hasExistingSave,
      customPackAvailable: this.assets.isCustomPackAvailable(),
      touchVisible: this.input.getTouchOverlayState().visible,
    });
  }

  private persistSave(): void {
    this.hasExistingSave = true;
    this.saveManager.save({
      schemaVersion: ENGINE_CONSTANTS.SAVE_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      progression: this.state.progression,
      renderSettings: this.renderSettings,
      audioSettings: this.audioSettings,
      controls: this.controls,
    });
  }

  private drainEvents(): void {
    for (let i = 0; i < this.state.events.length; i++) {
      this.handleSimEvent(this.state.events[i]);
    }
    this.state.events.length = 0;
  }

  private handleSimEvent(event: SimEvent): void {
    switch (event.type) {
      case 'sfx':
      case 'bgm':
      case 'bgmStem':
        this.audio.handleSimEvent(event);
        break;
      case 'particle':
        this.renderer.spawnEventParticles(event);
        break;
      case 'rumble':
        this.input.rumble(event.weak, event.strong, event.durationMs);
        break;
      case 'toast':
        this.menus.showToast(event.text, event.tone ?? 'info');
        break;
      case 'bossIntro':
        if ('triggerBossIntro' in this.renderer && typeof this.renderer.triggerBossIntro === 'function') {
          (this.renderer as { triggerBossIntro: (name: string, title: string, ticks?: number) => void }).triggerBossIntro(
            event.name,
            event.title,
            75,
          );
        }
        break;
      case 'stageClear':
        this.persistSave();
        break;
      case 'gameOver':
        this.audio.playBgm('bgm_gameover', 200);
        break;
      case 'checkpoint':
        this.persistSave();
        break;
      case 'rescue':
        this.persistSave();
        break;
      case 'challengeUnlock':
        this.menus.showToast(`CHALLENGE: ${event.name}`, 'unlock');
        this.persistSave();
        break;
      case 'datachipUnlock':
        this.menus.showToast(`DATA CHIP: ${event.title}`, 'unlock');
        this.persistSave();
        break;
      case 'shake':
        break;
    }
  }

  private loop = (now: number): void => {
    if (this.disposed) return;

    const rawDt = Math.max(0, (now - this.lastRafTime) / 1000);
    this.lastRafTime = now;
    const clampedDt = Math.min(rawDt, MAX_FRAME_DT);

    this.accumulator += clampedDt;

    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
      const inputFrame = this.input.poll();
      if (this.state.screen === 'playing' && !this.menus.isOptionsOpen()) {
        this.prevSnapshot = captureRenderSnapshot(this.state);
        stepFullSim(this.state, inputFrame);
        this.drainEvents();
      } else {
        this.menus.handleInput(inputFrame);
      }
      this.accumulator -= FIXED_DT;
      steps += 1;
    }

    // Frame-paced rendering (30 / 60 / 120 FPS)
    const minRenderIntervalMs =
      this.renderSettings.targetFps >= 120 ? 0 : 1000 / this.renderSettings.targetFps - 0.8;

    if (now - this.lastRenderTime >= minRenderIntervalMs) {
      this.lastRenderTime = now;
      this.fpsSamples += 1;
      if (now - this.fpsWindowStart >= 500) {
        this.measuredFps = (this.fpsSamples * 1000) / Math.max(1, now - this.fpsWindowStart);
        this.fpsSamples = 0;
        this.fpsWindowStart = now;
      }

      const interpAlpha = this.renderSettings.classicSnap60
        ? 1
        : Math.max(0, Math.min(1, this.accumulator / FIXED_DT));

      const activeLoadout =
        this.state.progression.loadouts[this.state.progression.activeLoadoutIndex];
      const armorDef = getArmorPaintDefinition(activeLoadout.armorPaint);
      const stageDef = getStageDefinition(this.state.stageId, this.state.remix);
      const bossDef = this.state.boss ? getBossDefinition(this.state.boss.bossId) : undefined;

      this.renderer.render(
        this.prevSnapshot,
        this.state,
        interpAlpha,
        this.renderSettings,
        armorDef.palette,
        stageDef.palette,
        {
          heatHaze: stageDef.heatHaze,
          hasStars: stageDef.hasStars,
          biomeGimmick: stageDef.biomeGimmick,
          bossTitle: bossDef?.title,
        },
        this.input.getModality(),
        this.measuredFps,
      );

      this.menus.sync({
        screen: this.state.screen,
        activeHubTerminal: this.state.activeHubTerminal,
        progression: this.state.progression,
        stageStats: this.state.stageStats,
        renderSettings: this.renderSettings,
        audioSettings: this.audioSettings,
        controls: this.controls,
        modality: this.input.getModality(),
        gamepadName: this.input.getGamepadAdapter().getConnectedGamepadName(),
        hasSave: this.hasExistingSave,
        customPackAvailable: this.assets.isCustomPackAvailable(),
        touchVisible: this.input.getTouchOverlayState().visible,
      });
    }

    this.rafId = window.requestAnimationFrame(this.loop);
  };

  private installDebugBridge(): void {
    const bridge: KrunkedDebugBridge = {
      getState: () => this.state,
      getHash: () => hashSimState(this.state),
      getFps: () => Math.round(this.measuredFps),
      getRenderSettings: () => ({ ...this.renderSettings }),
      setRenderSettings: (partial) => {
        this.renderSettings = { ...this.renderSettings, ...partial };
        this.persistSave();
      },
      getAudioSettings: () => ({ ...this.audioSettings }),
      setAudioSettings: (partial) => {
        this.audioSettings = { ...this.audioSettings, ...partial };
        this.audio.setSettings(this.audioSettings);
        this.persistSave();
      },
      getModality: () => this.input.getModality(),
      getTouchOverlayState: () => this.input.getTouchOverlayState(),
      getAssetMode: () => this.renderSettings.assetMode,
      setAssetMode: async (mode) => {
        await this.setAssetMode(mode);
      },
      loadStage: (stageId, remix = false) => {
        this.startStage(stageId, remix);
      },
      startGame: (stageId = 'opening', remix = false) => {
        this.startStage(stageId, remix);
      },
      warpToBoss: () => {
        this.warpPlayerToBoss();
      },
      spawnEnemy: (archetypeId, x, y) => {
        const arch = getEnemyArchetype(archetypeId);
        const id = this.state.nextEntityId++;
        this.state.enemies.push({
          id,
          archetypeId: arch?.id ?? archetypeId,
          x,
          y,
          vx: 0,
          vy: 0,
          w: arch?.width ?? 16,
          h: arch?.height ?? 24,
          facing: -1,
          hp: arch?.hp ?? 3,
          maxHp: arch?.hp ?? 3,
          shielded: Boolean(arch?.shielded),
          stunTimer: 0,
          hurtFlash: 0,
          aiTimer: 0,
          aiPhase: 0,
          homeX: x,
          homeY: y,
          grounded: false,
          grabbed: false,
          dead: false,
          isMiniboss: false,
          spawnId: `dbg_${id}`,
        });
        return id;
      },
      setPlayerHp: (hp) => {
        this.state.player.hp = Math.max(0, Math.min(this.state.player.maxHp, hp));
      },
      setPlayerBurst: (energy) => {
        const cap = this.state.player.maxBurstCharges * PLAYER_PHYSICS.BURST_ENERGY_PER_CHARGE;
        this.state.player.burstEnergy = Math.max(0, Math.min(cap, energy));
      },
      unlockAll: () => {
        unlockAllContent(this.state.progression);
        this.persistSave();
      },
      equipLoadout: (index) => {
        switchLoadout(this.state.progression, index);
        this.persistSave();
      },
      equipArmor: (armorId) => {
        if (!this.state.progression.unlockedArmors.includes(armorId)) {
          this.state.progression.unlockedArmors.push(armorId);
        }
        equipArmor(this.state.progression, armorId);
        this.persistSave();
      },
      setDifficulty: (diff) => {
        this.state.progression.difficulty = diff;
        this.persistSave();
      },
      setModifiers: (partial) => {
        this.state.progression.modifiers = { ...this.state.progression.modifiers, ...partial };
        this.persistSave();
      },
      setGameMode: (mode) => {
        this.state.progression.mode = mode;
        this.persistSave();
      },
      stepTicks: (ticks, overrideInput?: Partial<InputFrame>) => {
        const frame: InputFrame = {
          ...createNeutralInput(this.input.getModality()),
          ...overrideInput,
        };
        for (let i = 0; i < ticks; i++) {
          this.prevSnapshot = captureRenderSnapshot(this.state);
          stepFullSim(this.state, frame);
          this.drainEvents();
        }
        return hashSimState(this.state);
      },
      simulateGamepad: (state: SimulatedGamepadState | null) => {
        this.input.setSimulatedGamepad(state);
      },
      openHubTerminal: (kind: HubTerminalKind | null) => {
        this.state.activeHubTerminal = kind;
        this.state.screen = kind ? 'hub_modal' : 'playing';
      },
      getCustomPackAvailable: () => this.assets.isCustomPackAvailable(),
    };
    installDebugBridge(bridge);
  }

  public dispose(): void {
    this.disposed = true;
    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointerdown', this.handleUnlockGesture);
      window.removeEventListener('keydown', this.handleUnlockGesture);
    }
    uninstallDebugBridge();
    this.debugDrawer.dispose();
    this.menus.dispose();
    this.input.dispose();
    this.audio.dispose();
    this.renderer.dispose();
    this.assets.dispose();
  }
}
