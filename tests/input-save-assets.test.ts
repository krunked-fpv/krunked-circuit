import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_AUDIO_SETTINGS,
  DEFAULT_RENDER_SETTINGS,
  ENGINE_CONSTANTS,
  GAMEPAD_CONSTANTS,
  type SimulatedGamepadState,
} from '../src/contracts/index';
import {
  SaveManager,
  createDefaultSaveData,
  parseSaveData,
} from '../src/app/SaveManager';
import { AssetRegistry } from '../src/assets/AssetRegistry';
import { ProceduralPixelAtlas } from '../src/assets/ProceduralPixelAtlas';
import { GamepadAdapter } from '../src/input/GamepadAdapter';
import { InputManager } from '../src/input/InputManager';
import { TouchOverlay } from '../src/input/TouchOverlay';

function makeSimPad(overrides: Partial<SimulatedGamepadState> = {}): SimulatedGamepadState {
  return {
    id: 'Xbox Wireless Controller (STANDARD GAMEPAD)',
    connected: true,
    axes: [0, 0, 0, 0],
    buttons: new Array<number>(16).fill(0),
    ...overrides,
  };
}

describe('SaveManager, AssetRegistry, GamepadAdapter, TouchOverlay & InputManager', () => {
  const originalWindow = globalThis.window;
  const originalNavigator = globalThis.navigator;

  afterEach(() => {
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });
  });

  describe('SaveManager & parseSaveData', () => {
    it('round-trips valid SaveData cleanly through parseSaveData and mocked localStorage', () => {
      const store = new Map<string, string>();
      const mockStorage = {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
        removeItem: (k: string) => {
          store.delete(k);
        },
        clear: () => store.clear(),
        key: (i: number) => Array.from(store.keys())[i] ?? null,
        get length() {
          return store.size;
        },
      };
      Object.defineProperty(globalThis, 'window', {
        value: { localStorage: mockStorage },
        configurable: true,
        writable: true,
      });

      const mgr = new SaveManager();
      expect(mgr.hasSave()).toBe(false);

      const save = createDefaultSaveData();
      save.progression.bits = 1234;
      save.progression.rescueTokens = 12;
      save.progression.totalRescues = 16;
      save.progression.difficulty = 'hard';
      save.progression.mode = 'circuit';
      save.progression.modifiers.rudeEnemies = true;
      save.renderSettings.targetFps = 60;
      save.audioSettings.masterVolume = 0.5;
      save.controls.gamepadPreset = 'shoulder_hook';

      expect(mgr.save(save)).toBe(true);
      expect(mgr.hasSave()).toBe(true);

      const loaded = mgr.load();
      expect(loaded.existed).toBe(true);
      expect(loaded.recovered).toBe(false);
      expect(loaded.data.schemaVersion).toBe(ENGINE_CONSTANTS.SAVE_SCHEMA_VERSION);
      expect(loaded.data.progression.bits).toBe(1234);
      expect(loaded.data.progression.rescueTokens).toBe(12);
      expect(loaded.data.progression.difficulty).toBe('hard');
      expect(loaded.data.progression.mode).toBe('circuit');
      expect(loaded.data.progression.modifiers.rudeEnemies).toBe(true);
      expect(loaded.data.renderSettings.targetFps).toBe(60);
      expect(loaded.data.audioSettings.masterVolume).toBe(0.5);
      expect(loaded.data.controls.gamepadPreset).toBe('shoulder_hook');

      mgr.clear();
      expect(mgr.hasSave()).toBe(false);
    });

    it('recovers safely from malformed JSON corruption and non-object payloads', () => {
      const badJson = parseSaveData('{not-valid-json:::');
      expect(badJson.existed).toBe(true);
      expect(badJson.recovered).toBe(true);
      expect(badJson.data.progression.bits).toBe(0);
      expect(badJson.data.progression.difficulty).toBe('normal');

      const arrayPayload = parseSaveData('[1, 2, 3]');
      expect(arrayPayload.existed).toBe(true);
      expect(arrayPayload.recovered).toBe(true);

      const empty = parseSaveData(null);
      expect(empty.existed).toBe(false);
      expect(empty.recovered).toBe(false);
    });

    it('clamps out-of-range numeric fields and sanitizes invalid enum/loadout values', () => {
      const corruptPayload = JSON.stringify({
        progression: {
          bits: -500,
          rescueTokens: 999,
          totalRescues: 5000,
          difficulty: 'nightmare',
          mode: 'invalid_mode',
          activeLoadoutIndex: 99,
          unlockedBursts: [1, 999, -3, 'bad'],
          unlockedChips: [2, 100],
          unlockedArmors: [0, 42],
          loadouts: [
            {
              name: '',
              bursts: { neutral: 99, side: -1, up: 2, down: 3 },
              chips: [25, -4, 1],
              armorPaint: 88,
            },
          ],
        },
        renderSettings: {
          targetFps: 240,
          scaleMode: 'stretched',
          assetMode: 'UNKNOWN',
        },
        audioSettings: {
          masterVolume: 5.0,
          bgmVolume: -2.0,
          sfxVolume: Number.NaN,
          muted: 'yes',
        },
        controls: {
          gamepadPreset: 'custom_bad',
          gamepadDeadzone: 0.99,
          gamepadTriggerThreshold: 0.01,
        },
      });

      const { data, recovered } = parseSaveData(corruptPayload);
      expect(recovered).toBe(false);
      expect(data.progression.bits).toBe(0);
      expect(data.progression.rescueTokens).toBe(64);
      expect(data.progression.totalRescues).toBe(64);
      expect(data.progression.difficulty).toBe('normal');
      expect(data.progression.mode).toBe('standard');
      expect(data.progression.activeLoadoutIndex).toBe(0);
      expect(data.progression.unlockedBursts).toEqual([1]);
      expect(data.progression.unlockedChips).toEqual([2]);
      expect(data.progression.unlockedArmors).toEqual([0]);
      expect(data.progression.loadouts[0].armorPaint).toBe(0);
      expect(data.progression.loadouts[0].bursts.neutral).toBe(1);
      expect(data.renderSettings.targetFps).toBe(DEFAULT_RENDER_SETTINGS.targetFps);
      expect(data.renderSettings.scaleMode).toBe(DEFAULT_RENDER_SETTINGS.scaleMode);
      expect(data.renderSettings.assetMode).toBe('BUILTIN');
      expect(data.audioSettings.masterVolume).toBe(1);
      expect(data.audioSettings.bgmVolume).toBe(0);
      expect(data.audioSettings.sfxVolume).toBe(DEFAULT_AUDIO_SETTINGS.sfxVolume);
      expect(data.audioSettings.muted).toBe(false);
      expect(data.controls.gamepadPreset).toBe('default');
      expect(data.controls.gamepadDeadzone).toBe(0.6);
      expect(data.controls.gamepadTriggerThreshold).toBe(0.1);
    });
  });

  describe('AssetRegistry & ProceduralPixelAtlas', () => {
    it('constructs DOM-free in Built-In mode with 420+ logical keys and graceful Custom Pack fallback', async () => {
      const atlas = new ProceduralPixelAtlas();
      const sheet = atlas.getSheet();
      expect(sheet.width).toBeGreaterThan(0);
      expect(sheet.height).toBeGreaterThan(0);
      expect(sheet.pixels.length).toBe(sheet.width * sheet.height * 4);
      expect(atlas.toCanvas()).toBeNull(); // 100% DOM-free in Node

      const allKeys = atlas.getAllKeys();
      expect(allKeys.length).toBeGreaterThanOrEqual(420);

      const registry = new AssetRegistry();
      await registry.init();
      expect(registry.getMode()).toBe('BUILTIN');
      expect(registry.isCustomPackAvailable()).toBe(false);

      const requiredKeys = registry.getRequiredLogicalKeys();
      expect(requiredKeys.length).toBeGreaterThanOrEqual(420);
      for (const key of requiredKeys) {
        expect(registry.getAtlas().getRegion(key)).not.toBeNull();
      }

      // Requesting CUSTOM_PACK when unavailable falls back gracefully to BUILTIN
      await registry.setMode('CUSTOM_PACK');
      expect(registry.getMode()).toBe('BUILTIN');
      expect(registry.getCustomImage('player_hero')).toBeNull();
      expect(registry.getCustomAudioUrl('music', 'bgm_opening')).toBeNull();

      atlas.dispose();
      registry.dispose();
    });
  });

  describe('GamepadAdapter — Deadzone, Trigger Threshold, Presets & Non-Standard Tesla Fallback', () => {
    it('enforces 0.22 analog stick deadzone (0.18 -> 0, 0.85 -> 1) and 0.35 trigger threshold (0.25 -> false, 0.8 -> true)', () => {
      const adapter = new GamepadAdapter();
      expect(adapter.getDeadzone()).toBe(GAMEPAD_CONSTANTS.STICK_DEADZONE);
      expect(adapter.getTriggerThreshold()).toBe(GAMEPAD_CONSTANTS.TRIGGER_THRESHOLD);

      // Inside radial 0.22 deadzone (0.18 < 0.22) and below trigger threshold (0.25 < 0.35)
      const btnsLow = new Array<number>(16).fill(0);
      btnsLow[6] = 0.25; // LT
      btnsLow[7] = 0.25; // RT
      adapter.setSimulatedGamepad(
        makeSimPad({ axes: [0.18, 0, 0.15, 0], buttons: btnsLow }),
      );
      const low = adapter.poll();
      expect(low.connected).toBe(true);
      expect(low.moveX).toBe(0);
      expect(low.moveY).toBe(0);
      expect(low.sprint).toBe(false);
      expect(low.hookshot).toBe(false);
      expect(low.active).toBe(false);

      // Outside deadzone (0.85 > 0.22) and above trigger threshold (0.8 > 0.35)
      const btnsHigh = new Array<number>(16).fill(0);
      btnsHigh[6] = 0.8; // LT -> Sprint in default preset
      btnsHigh[7] = 0.8; // RT -> Hookshot in default preset
      adapter.setSimulatedGamepad(
        makeSimPad({ axes: [0.85, 0, 0, -0.85], buttons: btnsHigh }),
      );
      const high = adapter.poll();
      expect(high.moveX).toBe(1);
      expect(high.moveY).toBe(0);
      expect(high.aimX).toBe(0);
      expect(high.aimY).toBe(-1); // right-stick 8-dir aim override
      expect(high.sprint).toBe(true);
      expect(high.hookshot).toBe(true);
      expect(high.hookshotPressed).toBe(true);
      expect(high.active).toBe(true);

      adapter.dispose();
    });

    it('maps both default and shoulder_hook presets accurately', () => {
      const adapter = new GamepadAdapter({ preset: 'default' });

      // Default preset: A=Jump, B=Slide/Cancel, X=Attack, Y/RB=Burst, RT=Hookshot, LT=Sprint, LB=SwapLoadout
      const btns = new Array<number>(16).fill(0);
      btns[1] = 1; // B
      btns[4] = 1; // LB
      btns[5] = 1; // RB
      btns[6] = 0.9; // LT
      btns[7] = 0.9; // RT
      adapter.setSimulatedGamepad(makeSimPad({ buttons: btns }));

      const defRes = adapter.poll();
      expect(defRes.slide).toBe(true);
      expect(defRes.cancel).toBe(true);
      expect(defRes.swapLoadout).toBe(true);
      expect(defRes.burst).toBe(true);
      expect(defRes.sprint).toBe(true);
      expect(defRes.hookshot).toBe(true);

      // Switch to shoulder_hook preset: RB=Hookshot, LB=Sprint, LT=Slide, RT=SwapLoadout, B=Cancel only
      adapter.setPreset('shoulder_hook');
      const btns2 = new Array<number>(16).fill(0);
      btns2[5] = 1; // RB -> Hookshot
      btns2[4] = 1; // LB -> Sprint
      btns2[6] = 0.9; // LT -> Slide
      btns2[7] = 0.9; // RT -> SwapLoadout
      adapter.setSimulatedGamepad(makeSimPad({ buttons: btns2 }));

      const shRes = adapter.poll();
      expect(shRes.hookshot).toBe(true);
      expect(shRes.sprint).toBe(true);
      expect(shRes.slide).toBe(true);
      expect(shRes.swapLoadout).toBe(true);
      expect(shRes.burst).toBe(false); // RB is NOT Burst in shoulder_hook

      // Verify B is Cancel only (not Slide) in shoulder_hook
      const btnsB = new Array<number>(16).fill(0);
      btnsB[1] = 1;
      adapter.setSimulatedGamepad(makeSimPad({ buttons: btnsB }));
      const bRes = adapter.poll();
      expect(bRes.cancel).toBe(true);
      expect(bRes.slide).toBe(false);

      adapter.dispose();
    });

    it('decodes non-standard Tesla MCU POV hat axis (axes[9]) and fallback buttons', () => {
      const makeRawNativePad = (hatValue: number, pressedButtons: number[] = []): Gamepad => {
        const axes = [0, 0, 0, 0, 0, 0, 0, 0, 0, hatValue];
        const buttons = Array.from({ length: 12 }, (_, idx) => {
          const isDown = pressedButtons.includes(idx);
          return {
            pressed: isDown,
            touched: isDown,
            value: isDown ? 1 : 0,
          };
        });
        return {
          id: 'Tesla MCU USB Gamepad',
          index: 0,
          connected: true,
          timestamp: 100,
          mapping: '' as GamepadMappingType,
          axes,
          buttons,
          hapticActuators: [],
        } as unknown as Gamepad;
      };

      let activePad: Gamepad | null = makeRawNativePad(-0.43, [0, 2]); // Right on POV hat + A & X buttons
      Object.defineProperty(globalThis, 'navigator', {
        value: { getGamepads: () => [activePad] },
        configurable: true,
        writable: true,
      });

      const adapter = new GamepadAdapter();
      const rightPoll = adapter.poll();
      expect(rightPoll.connected).toBe(true);
      expect(rightPoll.moveX).toBe(1);
      expect(rightPoll.moveY).toBe(0);
      expect(rightPoll.jump).toBe(true);
      expect(rightPoll.attack).toBe(true);

      // Up on POV hat (-1.0)
      activePad = makeRawNativePad(-1.0);
      const upPoll = adapter.poll();
      expect(upPoll.moveX).toBe(0);
      expect(upPoll.moveY).toBe(-1);

      // Left on POV hat (+0.71)
      activePad = makeRawNativePad(0.71);
      const leftPoll = adapter.poll();
      expect(leftPoll.moveX).toBe(-1);
      expect(leftPoll.moveY).toBe(0);

      // Centered POV hat (~3.28)
      activePad = makeRawNativePad(3.28);
      const neutralPoll = adapter.poll();
      expect(neutralPoll.moveX).toBe(0);
      expect(neutralPoll.moveY).toBe(0);
      expect(neutralPoll.active).toBe(false);

      adapter.dispose();
    });
  });

  describe('TouchOverlay & InputManager — Hidden by Default & Instant Modality Hiding', () => {
    it('starts strictly hidden, reveals on touch, and hides IMMEDIATELY on keyboard or gamepad input', () => {
      // Capture window touch listeners in Node without DOM dependency
      const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
      Object.defineProperty(globalThis, 'window', {
        value: {
          addEventListener: (ev: string, fn: (...args: unknown[]) => void) => {
            if (!listeners.has(ev)) listeners.set(ev, new Set());
            listeners.get(ev)!.add(fn);
          },
          removeEventListener: (ev: string, fn: (...args: unknown[]) => void) => {
            listeners.get(ev)?.delete(fn);
          },
        },
        configurable: true,
        writable: true,
      });

      const standaloneTouch = new TouchOverlay(null);
      expect(standaloneTouch.isVisible()).toBe(false);
      expect(standaloneTouch.getState().visible).toBe(false);
      standaloneTouch.dispose();

      const manager = new InputManager({ touchContainer: null });
      // Strictly hidden on boot
      expect(manager.getTouchOverlayState().visible).toBe(false);
      expect(manager.getModality()).toBe('keyboard');

      // Non-touch mouse pointerdown must NOT reveal touch overlay
      for (const fn of listeners.get('pointerdown') ?? []) {
        fn({ pointerType: 'mouse' });
      }
      expect(manager.getTouchOverlayState().visible).toBe(false);

      // Genuine touch pointerdown reveals TouchOverlay & switches modality to 'touch'
      for (const fn of listeners.get('pointerdown') ?? []) {
        fn({ pointerType: 'touch' });
      }
      expect(manager.getTouchOverlayState().visible).toBe(true);
      expect(manager.getModality()).toBe('touch');

      // ANY keyboard key hides TouchOverlay IMMEDIATELY
      manager.simulateKeyDown('ArrowRight');
      expect(manager.getTouchOverlayState().visible).toBe(false);
      expect(manager.getModality()).toBe('keyboard');
      const kbFrame = manager.poll();
      expect(kbFrame.moveX).toBe(1);
      expect(kbFrame.modality).toBe('keyboard');
      manager.simulateKeyUp('ArrowRight');

      // Reveal again via touchstart
      for (const fn of listeners.get('touchstart') ?? []) {
        fn();
      }
      expect(manager.getTouchOverlayState().visible).toBe(true);
      expect(manager.getModality()).toBe('touch');

      // ANY gamepad stick/button activity hides TouchOverlay IMMEDIATELY
      manager.setSimulatedGamepad(makeSimPad({ axes: [0.9, 0, 0, 0] }));
      const gpFrame = manager.poll();
      expect(manager.getTouchOverlayState().visible).toBe(false);
      expect(manager.getModality()).toBe('gamepad');
      expect(gpFrame.moveX).toBe(1);
      expect(gpFrame.modality).toBe('gamepad');

      manager.dispose();
    });
  });
});
