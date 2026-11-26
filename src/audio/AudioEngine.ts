// ============================================================================
// Krunked Circuit — Dual-Mode Web Audio Engine
// Supports Owned Custom Pack (OGG/WAV AudioBuffer decode/cache + HTMLAudio
// fallback) AND built-in 16-bit ProceduralSynth, with clean first-gesture
// unlock, 3-stem Hub crossfading, per-key SFX cooldowns, polyphony caps,
// stereo panning, pitch jitter, and safe no-op execution in headless/Node.
// ============================================================================

import {
  DEFAULT_AUDIO_SETTINGS,
  type AudioSettings,
  type SimEvent,
} from '../contracts/index';
import {
  getSfxSpec,
  getTrackSpec,
  resolveBgmKey,
  resolveSfxKey,
  type BgmKey,
  type HubStem,
  type SfxKey,
} from './soundManifest';
import { ProceduralSynth } from './ProceduralSynth';

export type CustomAudioUrlResolver = (kind: 'music' | 'sfx', key: string) => string | null;

export interface PlaySfxOptions {
  pan?: number;
  pitchJitter?: number;
  gain?: number;
}

export interface AudioEngineState {
  unlocked: boolean;
  currentBgm: string | null;
  hubStem: HubStem;
  usingCustomPack: boolean;
}

interface ActiveSfxVoice {
  readonly key: string;
  readonly priority: number;
  readonly startedAtMs: number;
  readonly expiresAtMs: number;
  readonly stop: () => void;
}

interface CustomBgmPlayback {
  readonly key: BgmKey;
  readonly mode: 'buffer' | 'stems' | 'html_audio';
  readonly busGain?: GainNode;
  readonly sources?: AudioBufferSourceNode[];
  readonly stemGains?: Readonly<Record<HubStem, GainNode>>;
  readonly htmlAudio?: HTMLAudioElement;
  fadeTimer?: ReturnType<typeof setInterval> | null;
  stopped: boolean;
}

const MAX_GLOBAL_SFX_VOICES = 16;

function clamp(v: number, min: number, max: number): number {
  if (Number.isNaN(v)) return min;
  return v < min ? min : v > max ? max : v;
}

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function getAudioContextCtor(): (new () => AudioContext) | null {
  if (typeof globalThis === 'undefined') return null;
  const g = globalThis as unknown as {
    AudioContext?: new () => AudioContext;
    webkitAudioContext?: new () => AudioContext;
  };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private bgmGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private synth: ProceduralSynth | null = null;

  private settings: AudioSettings = { ...DEFAULT_AUDIO_SETTINGS };
  private unlocked = false;
  private currentBgm: string | null = null;
  private currentBgmFadeMs = 350;
  private hubStem: HubStem = 'command';

  private customUrlResolver: CustomAudioUrlResolver | null = null;
  private readonly audioBufferCache = new Map<string, AudioBuffer>();
  private readonly pendingDecodes = new Map<string, Promise<AudioBuffer | null>>();
  private readonly failedUrls = new Set<string>();

  private activeCustomBgm: CustomBgmPlayback | null = null;
  private activeBgmSource: 'none' | 'procedural' | 'custom' = 'none';
  private bgmPlayToken = 0;

  private readonly lastSfxTimeMs = new Map<string, number>();
  private activeSfxVoices: ActiveSfxVoice[] = [];
  private jitterRng = 0x51a7f3c9;

  constructor(initialSettings?: Partial<AudioSettings>) {
    if (initialSettings) {
      this.settings = this.normalizeSettings({ ...DEFAULT_AUDIO_SETTINGS, ...initialSettings });
    }
  }

  // --------------------------------------------------------------------------
  // Gesture Unlock & Audio Graph Initialization
  // --------------------------------------------------------------------------

  public unlock(): void {
    const AudioCtxCtor = getAudioContextCtor();
    if (!AudioCtxCtor) {
      // Safe no-op in headless/Node environments
      return;
    }

    if (!this.ctx) {
      try {
        this.ctx = new AudioCtxCtor();
        this.buildMasterGraph(this.ctx);
      } catch {
        this.ctx = null;
        return;
      }
    }

    const ctx = this.ctx;
    if (!ctx) return;

    if (ctx.state === 'running') {
      const wasUnlocked = this.unlocked;
      this.unlocked = true;
      this.applySettingsToGraph();
      if (!wasUnlocked && this.currentBgm && this.activeBgmSource === 'none') {
        this.startCurrentBgm(this.currentBgm, this.currentBgmFadeMs);
      }
      return;
    }

    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      try {
        const res = ctx.resume();
        if (res && typeof res.then === 'function') {
          res
            .then(() => {
              if (!this.ctx || this.ctx !== ctx) return;
              this.unlocked = ctx.state === 'running';
              this.applySettingsToGraph();
              if (this.unlocked && this.currentBgm && this.activeBgmSource === 'none') {
                this.startCurrentBgm(this.currentBgm, this.currentBgmFadeMs);
              }
            })
            .catch(() => {
              // Suppress browser autoplay rejection cleanly
            });
        }
      } catch {
        // Suppress synchronous autoplay exceptions cleanly
      }
    }
  }

  private buildMasterGraph(ctx: AudioContext): void {
    const masterGain = ctx.createGain();
    const bgmGain = ctx.createGain();
    const sfxGain = ctx.createGain();

    let compressor: DynamicsCompressorNode | null = null;
    if (typeof ctx.createDynamicsCompressor === 'function') {
      try {
        compressor = ctx.createDynamicsCompressor();
        compressor.threshold.setValueAtTime(-10, ctx.currentTime);
        compressor.knee.setValueAtTime(14, ctx.currentTime);
        compressor.ratio.setValueAtTime(4, ctx.currentTime);
        compressor.attack.setValueAtTime(0.004, ctx.currentTime);
        compressor.release.setValueAtTime(0.12, ctx.currentTime);
      } catch {
        compressor = null;
      }
    }

    if (compressor) {
      bgmGain.connect(compressor);
      sfxGain.connect(compressor);
      compressor.connect(masterGain);
    } else {
      bgmGain.connect(masterGain);
      sfxGain.connect(masterGain);
    }
    masterGain.connect(ctx.destination);

    this.masterGain = masterGain;
    this.bgmGain = bgmGain;
    this.sfxGain = sfxGain;
    this.compressor = compressor;
    this.synth = new ProceduralSynth(ctx, bgmGain, sfxGain);
    this.synth.setHubStem(this.hubStem);

    this.applySettingsToGraph();

    if (typeof ctx.addEventListener === 'function') {
      try {
        ctx.addEventListener('statechange', () => {
          if (this.ctx !== ctx) return;
          this.unlocked = ctx.state === 'running';
          if (this.unlocked && this.currentBgm && this.activeBgmSource === 'none') {
            this.startCurrentBgm(this.currentBgm, this.currentBgmFadeMs);
          }
        });
      } catch {
        // ignore in minimal mock contexts
      }
    }
  }

  // --------------------------------------------------------------------------
  // Custom Pack URL Resolver
  // --------------------------------------------------------------------------

  public setCustomUrlResolver(fn: CustomAudioUrlResolver | null): void {
    this.customUrlResolver = fn;

    // If BGM is already playing and unlocked, seamlessly switch between custom/procedural
    if (this.currentBgm && this.isAudioRunning()) {
      const hasCustom = this.resolveCustomBgmUrl(this.currentBgm) !== null;
      const desiredSource = hasCustom ? 'custom' : 'procedural';
      if (this.activeBgmSource !== desiredSource) {
        this.startCurrentBgm(this.currentBgm, 260);
      }
    }
  }

  private resolveCustomUrl(kind: 'music' | 'sfx', key: string): string | null {
    if (!this.customUrlResolver) return null;
    try {
      const direct = this.customUrlResolver(kind, key);
      if (direct && !this.failedUrls.has(direct)) return direct;
    } catch {
      return null;
    }

    const candidates =
      kind === 'music'
        ? getTrackSpec(key)?.customPackKeys
        : getSfxSpec(key)?.customPackKeys;
    if (!candidates) return null;

    for (const alias of candidates) {
      if (alias === key) continue;
      try {
        const url = this.customUrlResolver(kind, alias);
        if (url && !this.failedUrls.has(url)) return url;
      } catch {
        return null;
      }
    }
    return null;
  }

  private resolveCustomBgmUrl(key: string): string | null {
    const resolved = resolveBgmKey(key);
    if (resolved === 'bgm_hub') {
      const stemUrls = this.resolveCustomHubStemUrls();
      if (stemUrls) {
        return stemUrls[this.hubStem] ?? stemUrls.command ?? stemUrls.medbay ?? stemUrls.dojo ?? null;
      }
    }
    return this.resolveCustomUrl('music', resolved ?? key);
  }

  private resolveCustomHubStemUrls(): Partial<Record<HubStem, string>> | null {
    if (!this.customUrlResolver) return null;
    const spec = getTrackSpec('bgm_hub');
    if (!spec?.customStemKeys) return null;

    const found: Partial<Record<HubStem, string>> = {};
    let count = 0;
    const stems: readonly HubStem[] = ['command', 'medbay', 'dojo'];
    for (const stem of stems) {
      for (const alias of spec.customStemKeys[stem]) {
        try {
          const url = this.customUrlResolver('music', alias);
          if (url && !this.failedUrls.has(url)) {
            found[stem] = url;
            count++;
            break;
          }
        } catch {
          return null;
        }
      }
    }
    return count > 0 ? found : null;
  }

  private detectUsingCustomPack(): boolean {
    if (!this.customUrlResolver) return false;
    if (this.activeBgmSource === 'custom') return true;
    if (this.currentBgm && this.resolveCustomBgmUrl(this.currentBgm) !== null) {
      return true;
    }
    return (
      this.resolveCustomUrl('music', 'bgm_title') !== null ||
      this.resolveCustomUrl('sfx', 'jump') !== null
    );
  }

  // --------------------------------------------------------------------------
  // BGM Playback & Dynamic Hub Stems
  // --------------------------------------------------------------------------

  public playBgm(key: string, fadeMs = 350): void {
    const canonical = resolveBgmKey(key) ?? key;
    const clampedFade = Math.max(0, fadeMs);

    // Avoid restarting identical already-active track
    if (
      this.currentBgm === canonical &&
      this.activeBgmSource !== 'none' &&
      this.isAudioRunning()
    ) {
      const hasCustom = this.resolveCustomBgmUrl(canonical) !== null;
      const expectedSource = hasCustom ? 'custom' : 'procedural';
      if (this.activeBgmSource === expectedSource) {
        return;
      }
    }

    this.currentBgm = canonical;
    this.currentBgmFadeMs = clampedFade;

    if (!this.isAudioRunning()) {
      // Deferred until unlock() resumes the AudioContext cleanly
      return;
    }

    this.startCurrentBgm(canonical, clampedFade);
  }

  public setHubStem(stem: HubStem): void {
    this.hubStem = stem;
    this.synth?.setHubStem(stem);

    const active = this.activeCustomBgm;
    if (active && !active.stopped && active.mode === 'stems' && active.stemGains && this.ctx) {
      const now = this.ctx.currentTime;
      const tau = 0.14;
      const stems: readonly HubStem[] = ['command', 'medbay', 'dojo'];
      for (const s of stems) {
        const gainNode = active.stemGains[s];
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setTargetAtTime(s === stem ? 1.0 : 0.0001, now, tau);
      }
    }
  }

  public stopBgm(fadeMs = 250): void {
    this.bgmPlayToken++;
    this.currentBgm = null;
    this.activeBgmSource = 'none';
    const clampedFade = Math.max(0, fadeMs);

    this.synth?.stopBgm(clampedFade);
    this.stopCustomBgm(clampedFade);
  }

  private startCurrentBgm(key: string, fadeMs: number): void {
    const token = ++this.bgmPlayToken;
    const resolved = resolveBgmKey(key);
    const customUrl = this.resolveCustomBgmUrl(key);

    if (customUrl && resolved && this.ctx && this.bgmGain) {
      this.startCustomBgm(resolved, customUrl, fadeMs, token);
      return;
    }

    this.stopCustomBgm(fadeMs);
    if (this.synth) {
      const started = this.synth.startBgm(key, fadeMs);
      this.activeBgmSource = started ? 'procedural' : 'none';
    }
  }

  private startCustomBgm(key: BgmKey, primaryUrl: string, fadeMs: number, token: number): void {
    const ctx = this.ctx;
    const bgmGain = this.bgmGain;
    const spec = getTrackSpec(key);
    if (!ctx || !bgmGain || !spec) return;

    // Special 3-stem crossfade path for Custom Pack bgm_hub
    if (key === 'bgm_hub') {
      const stemUrls = this.resolveCustomHubStemUrls();
      if (stemUrls && stemUrls.command && stemUrls.medbay && stemUrls.dojo) {
        const urls: Record<HubStem, string> = {
          command: stemUrls.command,
          medbay: stemUrls.medbay,
          dojo: stemUrls.dojo,
        };
        Promise.all([
          this.loadAudioBuffer(urls.command),
          this.loadAudioBuffer(urls.medbay),
          this.loadAudioBuffer(urls.dojo),
        ])
          .then(([cmdBuf, medBuf, dojoBuf]) => {
            if (token !== this.bgmPlayToken || !this.ctx || !this.bgmGain) return;
            if (cmdBuf && medBuf && dojoBuf) {
              this.playCustomHubStems({ command: cmdBuf, medbay: medBuf, dojo: dojoBuf }, spec.gain, fadeMs);
            } else {
              this.playCustomSingleOrFallback(key, primaryUrl, spec.loop, spec.gain, fadeMs, token);
            }
          })
          .catch(() => {
            if (token !== this.bgmPlayToken) return;
            this.fallbackToProceduralBgm(key, fadeMs);
          });
        return;
      }
    }

    this.playCustomSingleOrFallback(key, primaryUrl, spec.loop, spec.gain, fadeMs, token);
  }

  private playCustomSingleOrFallback(
    key: BgmKey,
    url: string,
    loop: boolean,
    trackGain: number,
    fadeMs: number,
    token: number,
  ): void {
    const cached = this.audioBufferCache.get(url);
    if (cached) {
      this.playCustomBufferBgm(key, cached, loop, trackGain, fadeMs);
      return;
    }

    this.loadAudioBuffer(url)
      .then((buffer) => {
        if (token !== this.bgmPlayToken) return;
        if (buffer) {
          this.playCustomBufferBgm(key, buffer, loop, trackGain, fadeMs);
        } else if (!this.tryHtmlAudioBgm(key, url, loop, trackGain, fadeMs)) {
          this.fallbackToProceduralBgm(key, fadeMs);
        }
      })
      .catch(() => {
        if (token !== this.bgmPlayToken) return;
        if (!this.tryHtmlAudioBgm(key, url, loop, trackGain, fadeMs)) {
          this.fallbackToProceduralBgm(key, fadeMs);
        }
      });
  }

  private playCustomBufferBgm(
    key: BgmKey,
    buffer: AudioBuffer,
    loop: boolean,
    trackGain: number,
    fadeMs: number,
  ): void {
    const ctx = this.ctx;
    const bgmGain = this.bgmGain;
    if (!ctx || !bgmGain) return;

    this.synth?.stopBgm(fadeMs);
    this.stopCustomBgm(fadeMs);

    const now = ctx.currentTime;
    const busGain = ctx.createGain();
    const target = Math.max(0.0001, trackGain);
    const fadeSec = Math.max(0.015, fadeMs / 1000);
    busGain.gain.setValueAtTime(0.0001, now);
    busGain.gain.exponentialRampToValueAtTime(target, now + fadeSec);
    busGain.connect(bgmGain);

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = loop;
    src.connect(busGain);
    src.start(now);

    const playback: CustomBgmPlayback = {
      key,
      mode: 'buffer',
      busGain,
      sources: [src],
      stopped: false,
    };
    this.activeCustomBgm = playback;
    this.activeBgmSource = 'custom';
  }

  private playCustomHubStems(
    buffers: Record<HubStem, AudioBuffer>,
    trackGain: number,
    fadeMs: number,
  ): void {
    const ctx = this.ctx;
    const bgmGain = this.bgmGain;
    if (!ctx || !bgmGain) return;

    this.synth?.stopBgm(fadeMs);
    this.stopCustomBgm(fadeMs);

    const now = ctx.currentTime;
    const busGain = ctx.createGain();
    const target = Math.max(0.0001, trackGain);
    const fadeSec = Math.max(0.015, fadeMs / 1000);
    busGain.gain.setValueAtTime(0.0001, now);
    busGain.gain.exponentialRampToValueAtTime(target, now + fadeSec);
    busGain.connect(bgmGain);

    const stems: readonly HubStem[] = ['command', 'medbay', 'dojo'];
    const sources: AudioBufferSourceNode[] = [];
    const stemGains = {} as Record<HubStem, GainNode>;

    for (const stem of stems) {
      const sGain = ctx.createGain();
      sGain.gain.setValueAtTime(stem === this.hubStem ? 1.0 : 0.0001, now);
      sGain.connect(busGain);

      const src = ctx.createBufferSource();
      src.buffer = buffers[stem];
      src.loop = true;
      src.connect(sGain);
      src.start(now + 0.02);

      stemGains[stem] = sGain;
      sources.push(src);
    }

    this.activeCustomBgm = {
      key: 'bgm_hub',
      mode: 'stems',
      busGain,
      sources,
      stemGains,
      stopped: false,
    };
    this.activeBgmSource = 'custom';
  }

  private tryHtmlAudioBgm(
    key: BgmKey,
    url: string,
    loop: boolean,
    trackGain: number,
    fadeMs: number,
  ): boolean {
    if (typeof Audio === 'undefined') return false;
    try {
      this.synth?.stopBgm(fadeMs);
      this.stopCustomBgm(fadeMs);

      const el = new Audio(url);
      el.loop = loop;
      el.preload = 'auto';
      const targetVol = this.computeHtmlBgmVolume(trackGain);
      el.volume = fadeMs > 0 ? 0 : targetVol;

      const playback: CustomBgmPlayback = {
        key,
        mode: 'html_audio',
        htmlAudio: el,
        fadeTimer: null,
        stopped: false,
      };
      this.activeCustomBgm = playback;
      this.activeBgmSource = 'custom';

      const playPromise = el.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          if (this.activeCustomBgm === playback && !playback.stopped) {
            this.failedUrls.add(url);
            this.stopCustomBgm(50);
            this.fallbackToProceduralBgm(key, 120);
          }
        });
      }

      if (fadeMs > 0) {
        const startMs = nowMs();
        playback.fadeTimer = setInterval(() => {
          if (playback.stopped) {
            if (playback.fadeTimer) clearInterval(playback.fadeTimer);
            return;
          }
          const t = clamp((nowMs() - startMs) / fadeMs, 0, 1);
          el.volume = this.computeHtmlBgmVolume(trackGain) * t;
          if (t >= 1 && playback.fadeTimer) {
            clearInterval(playback.fadeTimer);
            playback.fadeTimer = null;
          }
        }, 25);
      }

      return true;
    } catch {
      return false;
    }
  }

  private fallbackToProceduralBgm(key: BgmKey, fadeMs: number): void {
    this.stopCustomBgm(fadeMs);
    if (this.synth) {
      const started = this.synth.startBgm(key, fadeMs);
      this.activeBgmSource = started ? 'procedural' : 'none';
    }
  }

  private stopCustomBgm(fadeMs: number): void {
    const active = this.activeCustomBgm;
    if (!active) return;
    this.activeCustomBgm = null;
    active.stopped = true;

    if (active.fadeTimer) {
      clearInterval(active.fadeTimer);
      active.fadeTimer = null;
    }

    if (active.mode === 'html_audio' && active.htmlAudio) {
      const el = active.htmlAudio;
      if (fadeMs <= 20) {
        try {
          el.pause();
          el.currentTime = 0;
        } catch {
          // ignore
        }
      } else {
        const startVol = el.volume;
        const startMs = nowMs();
        const timer = setInterval(() => {
          const t = clamp((nowMs() - startMs) / fadeMs, 0, 1);
          el.volume = Math.max(0, startVol * (1 - t));
          if (t >= 1) {
            clearInterval(timer);
            try {
              el.pause();
              el.currentTime = 0;
            } catch {
              // ignore
            }
          }
        }, 25);
      }
      return;
    }

    const ctx = this.ctx;
    const busGain = active.busGain;
    const sources = active.sources ?? [];
    const fadeSec = Math.max(0.015, fadeMs / 1000);

    if (ctx && busGain) {
      const now = ctx.currentTime;
      try {
        busGain.gain.cancelScheduledValues(now);
        busGain.gain.setTargetAtTime(0.0001, now, fadeSec / 3);
      } catch {
        // ignore
      }
    }

    setTimeout(() => {
      for (const s of sources) {
        try {
          s.stop();
          s.disconnect();
        } catch {
          // already stopped
        }
      }
      try {
        busGain?.disconnect();
        if (active.stemGains) {
          active.stemGains.command.disconnect();
          active.stemGains.medbay.disconnect();
          active.stemGains.dojo.disconnect();
        }
      } catch {
        // already disconnected
      }
    }, Math.ceil(fadeMs + 120));
  }

  // --------------------------------------------------------------------------
  // SFX Playback (Cooldowns, Polyphony Caps, Stereo Panning, Pitch Jitter)
  // --------------------------------------------------------------------------

  public playSfx(key: string, opts?: PlaySfxOptions): void {
    if (!this.isAudioRunning() || !this.ctx || !this.sfxGain || !this.synth) {
      return;
    }
    if (this.settings.muted || this.settings.masterVolume <= 0 || this.settings.sfxVolume <= 0) {
      return;
    }

    const resolvedKey: SfxKey | undefined = resolveSfxKey(key);
    const spec = getSfxSpec(key);
    if (!resolvedKey || !spec) return;

    const now = nowMs();

    // 1. Per-key micro-cooldown
    const lastMs = this.lastSfxTimeMs.get(resolvedKey);
    if (lastMs !== undefined && now - lastMs < spec.cooldownMs) {
      return;
    }

    // Prune expired voice records
    this.pruneExpiredSfxVoices(now);

    // 2. Per-key polyphony cap (voice stealing on oldest instance)
    const sameKeyVoices = this.activeSfxVoices.filter((v) => v.key === resolvedKey);
    if (sameKeyVoices.length >= spec.maxVoices) {
      const oldest = sameKeyVoices[0];
      oldest.stop();
      this.activeSfxVoices = this.activeSfxVoices.filter((v) => v !== oldest);
    }

    // 3. Global polyphony cap to guarantee zero clipping
    if (this.activeSfxVoices.length >= MAX_GLOBAL_SFX_VOICES) {
      let victimIdx = -1;
      for (let i = 0; i < this.activeSfxVoices.length; i++) {
        const cand = this.activeSfxVoices[i];
        if (cand.priority <= spec.priority) {
          if (
            victimIdx === -1 ||
            cand.priority < this.activeSfxVoices[victimIdx].priority ||
            (cand.priority === this.activeSfxVoices[victimIdx].priority &&
              cand.startedAtMs < this.activeSfxVoices[victimIdx].startedAtMs)
          ) {
            victimIdx = i;
          }
        }
      }
      if (victimIdx === -1) {
        // Active voices all have higher priority
        return;
      }
      const victim = this.activeSfxVoices[victimIdx];
      victim.stop();
      this.activeSfxVoices.splice(victimIdx, 1);
    }

    this.lastSfxTimeMs.set(resolvedKey, now);

    // 4. Per-voice Gain + Stereo Panner chain
    const ctx = this.ctx;
    const voiceGain = ctx.createGain();
    const gainScale = clamp(opts?.gain ?? 1.0, 0, 2.0);
    voiceGain.gain.setValueAtTime(spec.baseGain * gainScale, ctx.currentTime);

    const pan = clamp(opts?.pan ?? 0, -1, 1);
    let voiceDest: AudioNode = voiceGain;
    let panner: StereoPannerNode | null = null;
    if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
      try {
        panner = ctx.createStereoPanner();
        panner.pan.setValueAtTime(pan, ctx.currentTime);
        voiceGain.connect(panner);
        panner.connect(this.sfxGain);
      } catch {
        panner = null;
        voiceGain.connect(this.sfxGain);
      }
    } else {
      voiceGain.connect(this.sfxGain);
    }

    // 5. Pitch jitter for organic arcade feel
    const jitterAmp = clamp(opts?.pitchJitter ?? spec.pitchJitter, 0, 0.35);
    const pitchRate = jitterAmp > 0 ? 1 + (this.nextAudioRand() * 2 - 1) * jitterAmp : 1.0;

    let bufferSrc: AudioBufferSourceNode | null = null;
    let durationMs = spec.durationMs;

    // 6. Custom Pack AudioBuffer if available & decoded; otherwise warm cache + ProceduralSynth
    const customUrl = this.resolveCustomUrl('sfx', resolvedKey);
    if (customUrl) {
      const cached = this.audioBufferCache.get(customUrl);
      if (cached) {
        bufferSrc = ctx.createBufferSource();
        bufferSrc.buffer = cached;
        bufferSrc.playbackRate.setValueAtTime(pitchRate, ctx.currentTime);
        bufferSrc.connect(voiceDest);
        bufferSrc.start(ctx.currentTime);
        durationMs = Math.max(60, Math.min(2500, Math.ceil((cached.duration * 1000) / pitchRate)));
      } else {
        // Warm cache in background and play crisp procedural fallback right now so zero input lag!
        void this.loadAudioBuffer(customUrl);
        this.synth.playSfx(resolvedKey, pitchRate, voiceDest);
      }
    } else {
      this.synth.playSfx(resolvedKey, pitchRate, voiceDest);
    }

    let cleaned = false;
    const stopVoice = (): void => {
      if (cleaned) return;
      cleaned = true;
      try {
        if (this.ctx) {
          voiceGain.gain.cancelScheduledValues(this.ctx.currentTime);
          voiceGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.008);
        }
        if (bufferSrc) {
          bufferSrc.stop(this.ctx ? this.ctx.currentTime + 0.025 : 0);
        }
      } catch {
        // ignore already-ended node
      }
      setTimeout(() => {
        try {
          bufferSrc?.disconnect();
          voiceGain.disconnect();
          panner?.disconnect();
        } catch {
          // ignore
        }
      }, 45);
    };

    const voiceRecord: ActiveSfxVoice = {
      key: resolvedKey,
      priority: spec.priority,
      startedAtMs: now,
      expiresAtMs: now + durationMs + 40,
      stop: stopVoice,
    };
    this.activeSfxVoices.push(voiceRecord);

    // Schedule clean node disconnection after voice completes
    setTimeout(() => {
      if (!cleaned) {
        cleaned = true;
        try {
          bufferSrc?.disconnect();
          voiceGain.disconnect();
          panner?.disconnect();
        } catch {
          // ignore
        }
      }
    }, durationMs + 120);
  }

  // --------------------------------------------------------------------------
  // Convenience SimEvent Dispatcher
  // --------------------------------------------------------------------------

  public handleSimEvent(event: SimEvent): void {
    if (event.type === 'sfx') {
      this.playSfx(event.key, {
        pan: event.pan,
        pitchJitter: event.pitchJitter,
        gain: event.gain,
      });
    } else if (event.type === 'bgm') {
      this.playBgm(event.key, event.fadeMs);
    } else if (event.type === 'bgmStem') {
      this.setHubStem(event.stem);
    }
  }

  // --------------------------------------------------------------------------
  // Settings & State Inspection
  // --------------------------------------------------------------------------

  public setSettings(settings: Partial<AudioSettings>): void {
    this.settings = this.normalizeSettings({ ...this.settings, ...settings });
    this.applySettingsToGraph();
  }

  public getSettings(): AudioSettings {
    return { ...this.settings };
  }

  public getState(): AudioEngineState {
    return {
      unlocked: this.unlocked && this.isAudioRunning(),
      currentBgm: this.currentBgm,
      hubStem: this.hubStem,
      usingCustomPack: this.detectUsingCustomPack(),
    };
  }

  public dispose(): void {
    this.stopBgm(10);
    for (const v of this.activeSfxVoices) {
      v.stop();
    }
    this.activeSfxVoices = [];
    this.lastSfxTimeMs.clear();
    this.synth?.dispose();
    this.synth = null;

    if (this.ctx) {
      const ctx = this.ctx;
      const compressor = this.compressor;
      this.ctx = null;
      this.masterGain = null;
      this.bgmGain = null;
      this.sfxGain = null;
      this.compressor = null;
      this.unlocked = false;
      try {
        compressor?.disconnect();
      } catch {
        // ignore
      }
      if (typeof ctx.close === 'function') {
        try {
          void ctx.close().catch(() => {});
        } catch {
          // ignore
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // Internals: AudioBuffer Cache, Settings Application & Helpers
  // --------------------------------------------------------------------------

  private isAudioRunning(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  private normalizeSettings(s: AudioSettings): AudioSettings {
    return {
      masterVolume: clamp(s.masterVolume, 0, 1),
      bgmVolume: clamp(s.bgmVolume, 0, 1),
      sfxVolume: clamp(s.sfxVolume, 0, 1),
      muted: Boolean(s.muted),
    };
  }

  private computeHtmlBgmVolume(trackGain: number): number {
    if (this.settings.muted) return 0;
    return clamp(this.settings.masterVolume * this.settings.bgmVolume * trackGain, 0, 1);
  }

  private applySettingsToGraph(): void {
    if (this.ctx && this.masterGain && this.bgmGain && this.sfxGain) {
      const now = this.ctx.currentTime;
      const master = this.settings.muted ? 0 : this.settings.masterVolume;
      try {
        this.masterGain.gain.setTargetAtTime(master, now, 0.018);
        this.bgmGain.gain.setTargetAtTime(this.settings.bgmVolume, now, 0.018);
        this.sfxGain.gain.setTargetAtTime(this.settings.sfxVolume, now, 0.018);
      } catch {
        this.masterGain.gain.value = master;
        this.bgmGain.gain.value = this.settings.bgmVolume;
        this.sfxGain.gain.value = this.settings.sfxVolume;
      }
    }

    if (
      this.activeCustomBgm &&
      !this.activeCustomBgm.stopped &&
      this.activeCustomBgm.mode === 'html_audio' &&
      this.activeCustomBgm.htmlAudio
    ) {
      const spec = getTrackSpec(this.activeCustomBgm.key);
      this.activeCustomBgm.htmlAudio.volume = this.computeHtmlBgmVolume(spec?.gain ?? 0.78);
    }
  }

  private loadAudioBuffer(url: string): Promise<AudioBuffer | null> {
    const cached = this.audioBufferCache.get(url);
    if (cached) return Promise.resolve(cached);
    if (this.failedUrls.has(url)) return Promise.resolve(null);

    const existing = this.pendingDecodes.get(url);
    if (existing) return existing;

    const ctx = this.ctx;
    if (!ctx || typeof fetch !== 'function' || typeof ctx.decodeAudioData !== 'function') {
      return Promise.resolve(null);
    }

    const promise = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.arrayBuffer();
      })
      .then((arr) => ctx.decodeAudioData(arr))
      .then((decoded) => {
        this.audioBufferCache.set(url, decoded);
        return decoded;
      })
      .catch(() => {
        this.failedUrls.add(url);
        return null;
      })
      .finally(() => {
        this.pendingDecodes.delete(url);
      });

    this.pendingDecodes.set(url, promise);
    return promise;
  }

  private pruneExpiredSfxVoices(now: number): void {
    if (this.activeSfxVoices.length === 0) return;
    this.activeSfxVoices = this.activeSfxVoices.filter((v) => v.expiresAtMs > now);
  }

  private nextAudioRand(): number {
    this.jitterRng = (Math.imul(this.jitterRng, 1664525) + 1013904223) >>> 0;
    return this.jitterRng / 0x100000000;
  }
}
