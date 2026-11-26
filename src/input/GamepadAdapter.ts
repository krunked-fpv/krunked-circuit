// ============================================================================
// Krunked Circuit — W3C / Xbox / PlayStation / Switch / Tesla MCU Gamepad Adapter
// - 0.22 analog stick deadzone & 0.35 trigger threshold (LT/RT)
// - 8-way left stick + D-pad movement & optional right-stick 8-dir aim
// - 2 authentic presets: 'default' and 'shoulder_hook'
// - Tesla MCU non-standard mapping fallback + hot-plug toast notifications
// - Safe dual-rumble vibrationActuator wrapper + SimulatedGamepadState support
// ============================================================================

import {
  GAMEPAD_CONSTANTS,
  type GamepadPreset,
  type SimulatedGamepadState,
} from '../contracts/index';

export interface GamepadPollResult {
  connected: boolean;
  active: boolean;
  gamepadName: string | null;
  moveX: -1 | 0 | 1;
  moveY: -1 | 0 | 1;
  aimX: -1 | 0 | 1;
  aimY: -1 | 0 | 1;
  jump: boolean;
  jumpPressed: boolean;
  jumpReleased: boolean;
  attack: boolean;
  attackPressed: boolean;
  hookshot: boolean;
  hookshotPressed: boolean;
  burst: boolean;
  burstPressed: boolean;
  sprint: boolean;
  slide: boolean;
  slidePressed: boolean;
  swapLoadout: boolean;
  swapLoadoutPressed: boolean;
  pause: boolean;
  pausePressed: boolean;
  accept: boolean;
  acceptPressed: boolean;
  cancel: boolean;
  cancelPressed: boolean;
  map: boolean;
  mapPressed: boolean;
}

export interface GamepadAdapterOptions {
  preset?: GamepadPreset;
  deadzone?: number;
  triggerThreshold?: number;
  rumbleEnabled?: boolean;
  onConnectionChange?: (connected: boolean, name: string) => void;
}

interface RawPadSnapshot {
  id: string;
  mapping: string;
  axes: readonly number[];
  buttons: readonly number[];
  pressedFlags: readonly boolean[];
  nativeGamepad: Gamepad | null;
}

const OCTANT_SIN = Math.sin(Math.PI / 8); // ~0.38268 for crisp 8-way stick sectors

function quantizeStick8Way(ax: number, ay: number, deadzone: number): { x: -1 | 0 | 1; y: -1 | 0 | 1; active: boolean } {
  const safeX = Number.isFinite(ax) ? ax : 0;
  const safeY = Number.isFinite(ay) ? ay : 0;
  const mag = Math.hypot(safeX, safeY);
  if (mag < deadzone) {
    return { x: 0, y: 0, active: false };
  }
  const nx = safeX / mag;
  const ny = safeY / mag;
  const x: -1 | 0 | 1 = Math.abs(nx) >= OCTANT_SIN ? (nx > 0 ? 1 : -1) : 0;
  const y: -1 | 0 | 1 = Math.abs(ny) >= OCTANT_SIN ? (ny > 0 ? 1 : -1) : 0;
  return { x, y, active: true };
}

/**
 * Decodes common Linux/Chromium/Tesla non-standard POV hat axis (`axes[9]`)
 * when standard D-pad buttons 12..15 are absent.
 */
function decodePovHatAxis(hat: number | undefined): { x: -1 | 0 | 1; y: -1 | 0 | 1 } {
  if (hat === undefined || !Number.isFinite(hat) || Math.abs(hat) > 1.2) {
    return { x: 0, y: 0 };
  }
  // Standard Linux/W3C POV hat values: -1=Up, -0.71=UpRight, -0.43=Right,
  // -0.14=DownRight, +0.14=Down, +0.43=DownLeft, +0.71=Left, +1.0=UpLeft, >1.2 or ~3.28=Centered
  if (hat < -0.85) return { x: 0, y: -1 };
  if (hat < -0.57) return { x: 1, y: -1 };
  if (hat < -0.28) return { x: 1, y: 0 };
  if (hat < 0.0) return { x: 1, y: 1 };
  if (hat < 0.28) return { x: 0, y: 1 };
  if (hat < 0.57) return { x: -1, y: 1 };
  if (hat < 0.85) return { x: -1, y: 0 };
  if (hat <= 1.05) return { x: -1, y: -1 };
  return { x: 0, y: 0 };
}

export class GamepadAdapter {
  private preset: GamepadPreset;
  private deadzone: number;
  private triggerThreshold: number;
  private rumbleEnabled: boolean;
  private onConnectionChange?: (connected: boolean, name: string) => void;

  private simulated: SimulatedGamepadState | null = null;
  private connectedName: string | null = null;
  private lastNativeGamepad: Gamepad | null = null;

  // Previous held states for single-tick edge detection
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

  private readonly handleConnected = (ev: GamepadEvent): void => {
    const name = this.formatGamepadName(ev.gamepad?.id ?? 'Gamepad');
    this.connectedName = name;
    this.lastNativeGamepad = ev.gamepad ?? null;
    this.onConnectionChange?.(true, name);
  };

  private readonly handleDisconnected = (ev: GamepadEvent): void => {
    const name = this.formatGamepadName(ev.gamepad?.id ?? this.connectedName ?? 'Gamepad');
    if (this.lastNativeGamepad && ev.gamepad && this.lastNativeGamepad.index === ev.gamepad.index) {
      this.lastNativeGamepad = null;
    }
    this.connectedName = null;
    this.onConnectionChange?.(false, name);
  };

  constructor(options: GamepadAdapterOptions = {}) {
    this.preset = options.preset ?? 'default';
    this.deadzone = options.deadzone ?? GAMEPAD_CONSTANTS.STICK_DEADZONE;
    this.triggerThreshold = options.triggerThreshold ?? GAMEPAD_CONSTANTS.TRIGGER_THRESHOLD;
    this.rumbleEnabled = options.rumbleEnabled ?? true;
    this.onConnectionChange = options.onConnectionChange;

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('gamepadconnected', this.handleConnected);
      window.addEventListener('gamepaddisconnected', this.handleDisconnected);
    }
  }

  public setPreset(preset: GamepadPreset): void {
    this.preset = preset;
  }

  public getPreset(): GamepadPreset {
    return this.preset;
  }

  public setDeadzone(deadzone: number): void {
    this.deadzone = Math.max(0.05, Math.min(0.6, deadzone));
  }

  public getDeadzone(): number {
    return this.deadzone;
  }

  public setTriggerThreshold(threshold: number): void {
    this.triggerThreshold = Math.max(0.05, Math.min(0.95, threshold));
  }

  public getTriggerThreshold(): number {
    return this.triggerThreshold;
  }

  public setRumbleEnabled(enabled: boolean): void {
    this.rumbleEnabled = enabled;
  }

  public setSimulatedGamepad(state: SimulatedGamepadState | null): void {
    const wasConnected = this.simulated?.connected ?? false;
    this.simulated = state;
    if (state && state.connected && !wasConnected) {
      const name = this.formatGamepadName(state.id || 'Simulated Controller');
      this.connectedName = name;
      this.onConnectionChange?.(true, name);
    } else if ((!state || !state.connected) && wasConnected) {
      const prevName = this.connectedName ?? 'Simulated Controller';
      this.connectedName = null;
      this.onConnectionChange?.(false, prevName);
    }
  }

  public getConnectedGamepadName(): string | null {
    return this.connectedName;
  }

  private formatGamepadName(rawId: string): string {
    const cleaned = rawId.replace(/\s*\(STANDARD GAMEPAD.*?\)/i, '').trim();
    if (!cleaned) return 'Controller';
    return cleaned.length > 34 ? `${cleaned.slice(0, 31)}...` : cleaned;
  }

  private readActivePad(): RawPadSnapshot | null {
    // 1. Simulated gamepad takes precedence for deterministic automated tests
    if (this.simulated !== null) {
      if (!this.simulated.connected) return null;
      const btns = this.simulated.buttons ?? [];
      const flags = btns.map((v) => v >= 0.5);
      return {
        id: this.simulated.id || 'Simulated Gamepad',
        mapping: 'standard',
        axes: this.simulated.axes ?? [0, 0, 0, 0],
        buttons: btns,
        pressedFlags: flags,
        nativeGamepad: null,
      };
    }

    // 2. Native W3C Gamepad API (safe on Node/SSR/Tesla MCU)
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
      return null;
    }

    let pads: (Gamepad | null)[];
    try {
      pads = Array.from(navigator.getGamepads() ?? []);
    } catch {
      return null;
    }

    let chosen: Gamepad | null = null;
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (p && p.connected) {
        chosen = p;
        break;
      }
    }

    if (!chosen) {
      this.lastNativeGamepad = null;
      return null;
    }

    this.lastNativeGamepad = chosen;
    if (!this.connectedName) {
      this.connectedName = this.formatGamepadName(chosen.id);
    }

    const buttons: number[] = [];
    const pressedFlags: boolean[] = [];
    const btnLen = Math.min(chosen.buttons.length, 20);
    for (let i = 0; i < btnLen; i++) {
      const b = chosen.buttons[i];
      buttons.push(b ? (Number.isFinite(b.value) ? b.value : b.pressed ? 1 : 0) : 0);
      pressedFlags.push(Boolean(b?.pressed));
    }

    return {
      id: chosen.id,
      mapping: chosen.mapping || 'non-standard',
      axes: chosen.axes ?? [],
      buttons,
      pressedFlags,
      nativeGamepad: chosen,
    };
  }

  private btnPressed(pad: RawPadSnapshot, idx: number): boolean {
    if (idx < 0 || idx >= pad.buttons.length) return false;
    return pad.pressedFlags[idx] || pad.buttons[idx] >= 0.5;
  }

  private triggerPressed(pad: RawPadSnapshot, idx: number): boolean {
    if (idx < 0 || idx >= pad.buttons.length) return false;
    const val = pad.buttons[idx];
    // Strictly enforce analog trigger threshold (0.35 by default)
    return val >= this.triggerThreshold;
  }

  public poll(): GamepadPollResult {
    const pad = this.readActivePad();

    if (!pad) {
      const jumpReleased = this.prevJump;
      this.resetPrevHeld();
      return {
        connected: false,
        active: false,
        gamepadName: null,
        moveX: 0,
        moveY: 0,
        aimX: 0,
        aimY: 0,
        jump: false,
        jumpPressed: false,
        jumpReleased,
        attack: false,
        attackPressed: false,
        hookshot: false,
        hookshotPressed: false,
        burst: false,
        burstPressed: false,
        sprint: false,
        slide: false,
        slidePressed: false,
        swapLoadout: false,
        swapLoadoutPressed: false,
        pause: false,
        pausePressed: false,
        accept: false,
        acceptPressed: false,
        cancel: false,
        cancelPressed: false,
        map: false,
        mapPressed: false,
      };
    }

    // Left analog stick (axes[0], axes[1]) with 0.22 deadzone
    const leftStick = quantizeStick8Way(pad.axes[0] ?? 0, pad.axes[1] ?? 0, this.deadzone);
    // Right analog stick (axes[2], axes[3]) optional 8-dir hookshot aim
    const rightStick = quantizeStick8Way(pad.axes[2] ?? 0, pad.axes[3] ?? 0, this.deadzone);

    // D-pad buttons 12..15 (with Tesla/Linux POV hat axes[9] fallback if non-standard)
    let dpadX: -1 | 0 | 1 = 0;
    let dpadY: -1 | 0 | 1 = 0;
    const dUp = this.btnPressed(pad, 12);
    const dDown = this.btnPressed(pad, 13);
    const dLeft = this.btnPressed(pad, 14);
    const dRight = this.btnPressed(pad, 15);
    if (dLeft && !dRight) dpadX = -1;
    else if (dRight && !dLeft) dpadX = 1;
    if (dUp && !dDown) dpadY = -1;
    else if (dDown && !dUp) dpadY = 1;

    if (dpadX === 0 && dpadY === 0 && pad.mapping !== 'standard' && pad.axes.length > 9) {
      const hat = decodePovHatAxis(pad.axes[9]);
      dpadX = hat.x;
      dpadY = hat.y;
    }

    const moveX: -1 | 0 | 1 = dpadX !== 0 ? dpadX : leftStick.x;
    const moveY: -1 | 0 | 1 = dpadY !== 0 ? dpadY : leftStick.y;

    // Right stick overrides hookshot 8-dir aim whenever active; otherwise mirrors movement
    const aimX: -1 | 0 | 1 = rightStick.active ? rightStick.x : moveX;
    const aimY: -1 | 0 | 1 = rightStick.active ? rightStick.y : moveY;

    // Raw standard / fallback button readings
    const btnA = this.btnPressed(pad, 0);
    const btnB = this.btnPressed(pad, 1);
    const btnX = this.btnPressed(pad, 2);
    const btnY = this.btnPressed(pad, 3);
    const btnLB = this.btnPressed(pad, 4);
    const btnRB = this.btnPressed(pad, 5);
    const btnLT = this.triggerPressed(pad, 6);
    const btnRT = this.triggerPressed(pad, 7);
    const btnBack = this.btnPressed(pad, 8);
    const btnStart = this.btnPressed(pad, 9);

    // Apply exact preset mappings
    let jump: boolean;
    let accept: boolean;
    let cancel: boolean;
    let attack: boolean;
    let burst: boolean;
    let hookshot: boolean;
    let sprint: boolean;
    let slide: boolean;
    let swapLoadout: boolean;
    const pause = btnStart;
    const map = btnBack;

    if (this.preset === 'shoulder_hook') {
      // 'shoulder_hook': A=Jump/Accept, B=Cancel, X=Attack, Y=Burst,
      // RB=Hookshot, LB=Sprint, LT=Slide, RT=SwapLoadout, Start=Pause, Back=Map
      jump = btnA;
      accept = btnA;
      cancel = btnB;
      attack = btnX;
      burst = btnY;
      hookshot = btnRB;
      sprint = btnLB;
      slide = btnLT;
      swapLoadout = btnRT;
    } else {
      // 'default': A=Jump/Accept, B=Slide/Cancel, X=Attack, Y=Burst,
      // RT=Hookshot, RB=Burst, LT=Sprint, LB=SwapLoadout, Start=Pause, Back=Map
      jump = btnA;
      accept = btnA;
      cancel = btnB;
      slide = btnB;
      attack = btnX;
      burst = btnY || btnRB;
      hookshot = btnRT;
      sprint = btnLT;
      swapLoadout = btnLB;
    }

    const active =
      leftStick.active ||
      rightStick.active ||
      dpadX !== 0 ||
      dpadY !== 0 ||
      btnA ||
      btnB ||
      btnX ||
      btnY ||
      btnLB ||
      btnRB ||
      btnLT ||
      btnRT ||
      btnBack ||
      btnStart;

    const result: GamepadPollResult = {
      connected: true,
      active,
      gamepadName: this.formatGamepadName(pad.id),
      moveX,
      moveY,
      aimX,
      aimY,
      jump,
      jumpPressed: jump && !this.prevJump,
      jumpReleased: !jump && this.prevJump,
      attack,
      attackPressed: attack && !this.prevAttack,
      hookshot,
      hookshotPressed: hookshot && !this.prevHookshot,
      burst,
      burstPressed: burst && !this.prevBurst,
      sprint,
      slide,
      slidePressed: slide && !this.prevSlide,
      swapLoadout,
      swapLoadoutPressed: swapLoadout && !this.prevSwapLoadout,
      pause,
      pausePressed: pause && !this.prevPause,
      accept,
      acceptPressed: accept && !this.prevAccept,
      cancel,
      cancelPressed: cancel && !this.prevCancel,
      map,
      mapPressed: map && !this.prevMap,
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

    return result;
  }

  public rumble(weak: number, strong: number, durationMs: number): void {
    if (!this.rumbleEnabled || durationMs <= 0) return;
    const gp = this.lastNativeGamepad;
    if (!gp) return;

    const actuator = (gp as Gamepad & {
      vibrationActuator?: {
        playEffect?: (
          type: string,
          params: {
            startDelay: number;
            duration: number;
            weakMagnitude: number;
            strongMagnitude: number;
          },
        ) => Promise<unknown>;
      };
    }).vibrationActuator;

    if (!actuator || typeof actuator.playEffect !== 'function') return;

    try {
      const p = actuator.playEffect('dual-rumble', {
        startDelay: 0,
        duration: Math.max(10, Math.min(1000, Math.round(durationMs))),
        weakMagnitude: Math.max(0, Math.min(1, weak)),
        strongMagnitude: Math.max(0, Math.min(1, strong)),
      });
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          // Safely ignore browser haptic permission / Tesla MCU rejections
        });
      }
    } catch {
      // Safely ignore unsupported dual-rumble implementations
    }
  }

  private resetPrevHeld(): void {
    this.prevJump = false;
    this.prevAttack = false;
    this.prevHookshot = false;
    this.prevBurst = false;
    this.prevSlide = false;
    this.prevSwapLoadout = false;
    this.prevPause = false;
    this.prevAccept = false;
    this.prevCancel = false;
    this.prevMap = false;
  }

  public dispose(): void {
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('gamepadconnected', this.handleConnected);
      window.removeEventListener('gamepaddisconnected', this.handleDisconnected);
    }
    this.simulated = null;
    this.lastNativeGamepad = null;
  }
}
