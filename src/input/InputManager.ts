// ============================================================================
// Krunked Circuit — Unified Multi-Modal Input Manager
// Combines Rebindable Keyboard, GamepadAdapter (Xbox/PS/Switch/Tesla MCU),
// and Touch-Activated TouchOverlay into a single crisp 60 Hz InputFrame.
// Strictly enforces TASTE_NOTES modality switching:
//   - TouchOverlay starts HIDDEN (`visible === false`).
//   - Any keyboard key press OR gamepad stick/button/trigger activity
//     IMMEDIATELY switches modality and hides TouchOverlay.
// ============================================================================

import {
  DEFAULT_CONTROL_BINDINGS,
  type ActionKey,
  type ControlBindings,
  type InputFrame,
  type InputModality,
  type SimulatedGamepadState,
  type TouchOverlayState,
} from '../contracts/index';
import { GamepadAdapter } from './GamepadAdapter';
import { TouchOverlay } from './TouchOverlay';

export interface InputManagerOptions {
  touchContainer?: HTMLElement | null;
  bindings?: ControlBindings;
  onModalityChange?: (modality: InputModality) => void;
  onToast?: (text: string, tone?: 'info' | 'unlock' | 'warn') => void;
}

const PREVENT_SCROLL_CODES = new Set<string>([
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Tab',
]);

function cloneBindings(src: ControlBindings): ControlBindings {
  return {
    keyboard: { ...src.keyboard },
    gamepadPreset: src.gamepadPreset,
    gamepadDeadzone: src.gamepadDeadzone,
    gamepadTriggerThreshold: src.gamepadTriggerThreshold,
    rumbleEnabled: src.rumbleEnabled,
  };
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof HTMLElement === 'undefined') return false;
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export class InputManager {
  private bindings: ControlBindings;
  private activeModality: InputModality = 'keyboard';
  private readonly onModalityChange?: (modality: InputModality) => void;
  private readonly onToast?: (text: string, tone?: 'info' | 'unlock' | 'warn') => void;

  private readonly gamepad: GamepadAdapter;
  private readonly touchOverlay: TouchOverlay;

  private readonly keysDown = new Set<string>();
  // Edge latch so sub-16ms taps between sim ticks are never missed
  private readonly keysJustPressed = new Set<string>();

  private keyCaptureCallback: ((code: string) => void) | null = null;

  // Unified previous held flags for crisp single-tick edge detection
  private prevJump = false;
  private prevAttack = false;
  private prevHookshot = false;
  private prevBurst = false;
  private prevSlide = false;
  private prevSwapLoadout = false;
  private prevPause = false;
  private prevAccept = false;
  private prevCancel = false;
  private prevMap = false;

  private readonly handleKeyDown = (e: KeyboardEvent): void => {
    const code = e.code;
    if (!code) return;

    // Allow F9 debug drawer or F11/F12 dev keys without trapping capture
    if (this.keyCaptureCallback) {
      e.preventDefault();
      e.stopPropagation();
      if (code === 'Escape') {
        this.keyCaptureCallback = null;
        return;
      }
      const cb = this.keyCaptureCallback;
      this.keyCaptureCallback = null;
      cb(code);
      return;
    }

    if (!isEditableTarget(e.target) && PREVENT_SCROLL_CODES.has(code)) {
      e.preventDefault();
    }

    if (!e.repeat && !this.keysDown.has(code)) {
      this.keysJustPressed.add(code);
    }
    this.keysDown.add(code);

    // TASTE_NOTES: ANY keyboard key press immediately hides TouchOverlay
    this.setModality('keyboard');
  };

  private readonly handleKeyUp = (e: KeyboardEvent): void => {
    if (e.code) {
      this.keysDown.delete(e.code);
    }
  };

  private readonly handleWindowBlur = (): void => {
    this.keysDown.clear();
    this.keysJustPressed.clear();
  };

  constructor(options: InputManagerOptions = {}) {
    this.bindings = cloneBindings(options.bindings ?? DEFAULT_CONTROL_BINDINGS);
    this.onModalityChange = options.onModalityChange;
    this.onToast = options.onToast;

    this.gamepad = new GamepadAdapter({
      preset: this.bindings.gamepadPreset,
      deadzone: this.bindings.gamepadDeadzone,
      triggerThreshold: this.bindings.gamepadTriggerThreshold,
      rumbleEnabled: this.bindings.rumbleEnabled,
      onConnectionChange: (connected, name) => {
        if (connected) {
          this.onToast?.(`Controller Connected: ${name}`, 'info');
        } else {
          this.onToast?.(`Controller Disconnected: ${name}`, 'warn');
        }
      },
    });

    this.touchOverlay = new TouchOverlay(options.touchContainer ?? null, {
      onTouchDetected: () => {
        this.setModality('touch');
      },
    });

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('keydown', this.handleKeyDown, { passive: false });
      window.addEventListener('keyup', this.handleKeyUp);
      window.addEventListener('blur', this.handleWindowBlur);
    }
  }

  private setModality(next: InputModality): void {
    // Always guarantee TouchOverlay hides immediately on keyboard/gamepad
    if (next !== 'touch' && this.touchOverlay.isVisible()) {
      this.touchOverlay.setVisible(false);
    }
    if (this.activeModality !== next) {
      this.activeModality = next;
      this.onModalityChange?.(next);
    }
  }

  public getModality(): InputModality {
    return this.activeModality;
  }

  public getBindings(): ControlBindings {
    return cloneBindings(this.bindings);
  }

  public setBindings(partial: Partial<ControlBindings>): void {
    if (partial.keyboard) {
      this.bindings.keyboard = { ...this.bindings.keyboard, ...partial.keyboard };
    }
    if (partial.gamepadPreset !== undefined) {
      this.bindings.gamepadPreset = partial.gamepadPreset;
      this.gamepad.setPreset(partial.gamepadPreset);
    }
    if (partial.gamepadDeadzone !== undefined) {
      this.bindings.gamepadDeadzone = partial.gamepadDeadzone;
      this.gamepad.setDeadzone(partial.gamepadDeadzone);
    }
    if (partial.gamepadTriggerThreshold !== undefined) {
      this.bindings.gamepadTriggerThreshold = partial.gamepadTriggerThreshold;
      this.gamepad.setTriggerThreshold(partial.gamepadTriggerThreshold);
    }
    if (partial.rumbleEnabled !== undefined) {
      this.bindings.rumbleEnabled = partial.rumbleEnabled;
      this.gamepad.setRumbleEnabled(partial.rumbleEnabled);
    }
  }

  public setKeyBinding(action: ActionKey, code: string): void {
    this.bindings.keyboard[action] = code;
  }

  public resetBindings(): void {
    this.setBindings(cloneBindings(DEFAULT_CONTROL_BINDINGS));
  }

  public startKeyCapture(action: ActionKey, onCaptured: (code: string) => void): void {
    this.keyCaptureCallback = (code: string) => {
      this.setKeyBinding(action, code);
      onCaptured(code);
    };
  }

  public cancelKeyCapture(): void {
    this.keyCaptureCallback = null;
  }

  public isCapturingKey(): boolean {
    return this.keyCaptureCallback !== null;
  }

  public getGamepadAdapter(): GamepadAdapter {
    return this.gamepad;
  }

  public getTouchOverlay(): TouchOverlay {
    return this.touchOverlay;
  }

  public getTouchOverlayState(): TouchOverlayState {
    return this.touchOverlay.getState();
  }

  public setSimulatedGamepad(state: SimulatedGamepadState | null): void {
    this.gamepad.setSimulatedGamepad(state);
  }

  public rumble(weak: number, strong: number, durationMs: number): void {
    if (!this.bindings.rumbleEnabled) return;
    this.gamepad.rumble(weak, strong, durationMs);
  }

  /**
   * Programmatic key press injection (handy for automated testing without DOM KeyboardEvent).
   */
  public simulateKeyDown(code: string): void {
    if (!this.keysDown.has(code)) {
      this.keysJustPressed.add(code);
    }
    this.keysDown.add(code);
    this.setModality('keyboard');
  }

  public simulateKeyUp(code: string): void {
    this.keysDown.delete(code);
  }

  private isActionDown(action: ActionKey): boolean {
    const code = this.bindings.keyboard[action];
    if (this.keysDown.has(code)) return true;
    // Universal ergonomic secondary keys that never conflict with rebinds
    if (action === 'pause' && this.keysDown.has('Escape')) return true;
    if (action === 'cancel' && this.keysDown.has('Escape')) return true;
    if (action === 'accept' && this.keysDown.has('Enter')) return true;
    return false;
  }

  private wasActionTapped(action: ActionKey): boolean {
    const code = this.bindings.keyboard[action];
    if (this.keysJustPressed.has(code)) return true;
    if (action === 'pause' && this.keysJustPressed.has('Escape')) return true;
    if (action === 'cancel' && this.keysJustPressed.has('Escape')) return true;
    if (action === 'accept' && this.keysJustPressed.has('Enter')) return true;
    return false;
  }

  public poll(): InputFrame {
    const gp = this.gamepad.poll();

    // TASTE_NOTES: Any gamepad stick/button/trigger activity immediately switches
    // modality to 'gamepad' and hides TouchOverlay!
    if (gp.active) {
      this.setModality('gamepad');
    }

    const touch = this.touchOverlay.pollTouchInput();

    // Keyboard directional axes
    const kbLeft = this.isActionDown('left');
    const kbRight = this.isActionDown('right');
    const kbUp = this.isActionDown('up');
    const kbDown = this.isActionDown('down');
    const kbMoveX: -1 | 0 | 1 = kbLeft && !kbRight ? -1 : kbRight && !kbLeft ? 1 : 0;
    const kbMoveY: -1 | 0 | 1 = kbUp && !kbDown ? -1 : kbDown && !kbUp ? 1 : 0;

    // Merge directions across modalities (prioritize active source)
    const moveX: -1 | 0 | 1 =
      gp.moveX !== 0 ? gp.moveX : touch.moveX !== 0 ? touch.moveX : kbMoveX;
    const moveY: -1 | 0 | 1 =
      gp.moveY !== 0 ? gp.moveY : touch.moveY !== 0 ? touch.moveY : kbMoveY;
    const aimX: -1 | 0 | 1 =
      gp.aimX !== 0 ? gp.aimX : touch.aimX !== 0 ? touch.aimX : kbMoveX;
    const aimY: -1 | 0 | 1 =
      gp.aimY !== 0 ? gp.aimY : touch.aimY !== 0 ? touch.aimY : kbMoveY;

    const jump = this.isActionDown('jump') || gp.jump || touch.jump;
    const attack = this.isActionDown('attack') || gp.attack || touch.attack;
    const hookshot = this.isActionDown('hookshot') || gp.hookshot || touch.hookshot;
    const burst = this.isActionDown('burst') || gp.burst || touch.burst;
    const sprint = this.isActionDown('sprint') || gp.sprint || touch.sprint;
    const slide = this.isActionDown('slide') || gp.slide || touch.slide;
    const swapLoadout = this.isActionDown('swapLoadout') || gp.swapLoadout || touch.swapLoadout;
    const pause = this.isActionDown('pause') || gp.pause || touch.pause;
    const accept = this.isActionDown('accept') || gp.accept || touch.accept;
    const cancel = this.isActionDown('cancel') || gp.cancel || touch.cancel;
    const map = this.isActionDown('map') || gp.map;

    const frame: InputFrame = {
      moveX,
      moveY,
      aimX,
      aimY,
      jump,
      jumpPressed: (jump && !this.prevJump) || this.wasActionTapped('jump'),
      jumpReleased: !jump && this.prevJump,
      attack,
      attackPressed: (attack && !this.prevAttack) || this.wasActionTapped('attack'),
      hookshot,
      hookshotPressed: (hookshot && !this.prevHookshot) || this.wasActionTapped('hookshot'),
      burst,
      burstPressed: (burst && !this.prevBurst) || this.wasActionTapped('burst'),
      sprint,
      slide,
      slidePressed: (slide && !this.prevSlide) || this.wasActionTapped('slide'),
      swapLoadoutPressed:
        (swapLoadout && !this.prevSwapLoadout) || this.wasActionTapped('swapLoadout'),
      pausePressed: (pause && !this.prevPause) || this.wasActionTapped('pause'),
      acceptPressed: (accept && !this.prevAccept) || this.wasActionTapped('accept'),
      cancelPressed: (cancel && !this.prevCancel) || this.wasActionTapped('cancel'),
      mapPressed: (map && !this.prevMap) || this.wasActionTapped('map'),
      modality: this.activeModality,
    };

    this.prevJump = jump;
    this.prevAttack = attack;
    this.prevHookshot = hookshot;
    this.prevBurst = burst;
    this.prevSlide = slide;
    this.prevSwapLoadout = swapLoadout;
    this.prevPause = pause;
    this.prevAccept = accept;
    this.prevCancel = cancel;
    this.prevMap = map;
    this.keysJustPressed.clear();

    return frame;
  }

  public dispose(): void {
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('keydown', this.handleKeyDown);
      window.removeEventListener('keyup', this.handleKeyUp);
      window.removeEventListener('blur', this.handleWindowBlur);
    }
    this.gamepad.dispose();
    this.touchOverlay.dispose();
    this.keysDown.clear();
    this.keysJustPressed.clear();
  }
}
