// ============================================================================
// Krunked Circuit — High-Performance 400x240 WebGL2 Pixel-Art Renderer
// Features:
//  - Strictly 400x240 nearest-neighbor (gl.NEAREST) offscreen FBO + screen pass
//  - Preallocated dynamic vertex buffer (ZERO per-frame GPU allocations!)
//  - 6-color GPU palette swapper (uPaletteSrc / uPaletteDst), damage white-flash,
//    and 1px crisp silhouette outlines in a single sprite/tile batch shader
//  - Full-screen post-process shader (heat haze shimmer, boss desperation flash,
//    freeze field tint, overload edge glow)
//  - Crisp 400x240 pixel HUD drawn post-FX so HUD text never distorts
//  - Automatic graceful fallback to Canvas2DFallback if WebGL2 is unavailable
// ============================================================================

import {
  ENGINE_CONSTANTS,
  type InputModality,
  type Palette6,
  type RenderSettings,
  type RenderSnapshot,
  type ScaleMode,
  type SimEvent,
  type SimState,
  type StageDefinition,
} from '../contracts/index';
import { HudRenderer } from '../ui/HudRenderer';
import {
  Canvas2DFallback,
  RegionLookup,
  applyCanvasScale,
  drawWorldScene,
  type AtlasRect,
  type GameRenderer,
  type SceneBatcher,
  type StageRenderMeta,
} from './Canvas2DFallback';
import { ParallaxRenderer } from './ParallaxRenderer';
import { ParticlePool } from './ParticlePool';
import {
  DEFAULT_PALETTE_KEY_COLORS,
  POST_FRAG_SRC,
  POST_VERT_SRC,
  SPRITE_FRAG_SRC,
  SPRITE_VERT_SRC,
  createProgram,
  parseHexColor,
  writePaletteUniform,
} from './shaders';

export type { AtlasRect, GameRenderer, StageRenderMeta };
export { applyCanvasScale };

const W = ENGINE_CONSTANTS.GAME_WIDTH;
const H = ENGINE_CONSTANTS.GAME_HEIGHT;
const MAX_QUADS = 16384;
// Per vertex: pos(2), uv(2), color(4), flags(4) = 12 floats
const FLOATS_PER_VERTEX = 12;
const VERTS_PER_QUAD = 6;
const MAX_FLOATS = MAX_QUADS * VERTS_PER_QUAD * FLOATS_PER_VERTEX;

interface SpriteProgramUniforms {
  uResolution: WebGLUniformLocation | null;
  uTex: WebGLUniformLocation | null;
  uTexelSize: WebGLUniformLocation | null;
  uPaletteSrc: WebGLUniformLocation | null;
  uPaletteDst: WebGLUniformLocation | null;
  uOutlineColor: WebGLUniformLocation | null;
}

interface PostProgramUniforms {
  uSceneTex: WebGLUniformLocation | null;
  uResolution: WebGLUniformLocation | null;
  uTime: WebGLUniformLocation | null;
  uHeatHaze: WebGLUniformLocation | null;
  uDesperationFlash: WebGLUniformLocation | null;
  uFreezeTint: WebGLUniformLocation | null;
  uOverloadPulse: WebGLUniformLocation | null;
}

interface CustomTextureEntry {
  texture: WebGLTexture;
  width: number;
  height: number;
  uploaded: boolean;
  img: HTMLImageElement;
}

export class WebGL2Renderer implements GameRenderer {
  private _backend: 'webgl2' | 'canvas2d' = 'webgl2';
  private fallback: Canvas2DFallback | null = null;

  private canvas: HTMLCanvasElement | null = null;
  private gl: WebGL2RenderingContext | null = null;

  private spriteProg: WebGLProgram | null = null;
  private postProg: WebGLProgram | null = null;
  private spriteUniforms: SpriteProgramUniforms | null = null;
  private postUniforms: PostProgramUniforms | null = null;

  private spriteVao: WebGLVertexArrayObject | null = null;
  private postVao: WebGLVertexArrayObject | null = null;
  private spriteVbo: WebGLBuffer | null = null;
  private readonly vertexData = new Float32Array(MAX_FLOATS);
  private floatCursor = 0;

  private fbo: WebGLFramebuffer | null = null;
  private fboTex: WebGLTexture | null = null;

  private atlasTex: WebGLTexture | null = null;
  private atlasWidth = 1;
  private atlasHeight = 1;
  private dummyTex: WebGLTexture | null = null;
  private boundTex: WebGLTexture | null = null;
  private boundTexW = 1;
  private boundTexH = 1;

  private readonly customTextures = new Map<string, CustomTextureEntry>();
  private readonly lookup = new RegionLookup();
  private readonly particles = new ParticlePool();
  private readonly parallax = new ParallaxRenderer();
  private readonly hud = new HudRenderer();

  private readonly paletteSrcBuf = new Float32Array(18);
  private readonly paletteDstBuf = new Float32Array(18);
  private paletteSrcDirty = true;
  private lastPaletteDstKey = '';

  private lastScaleMode: ScaleMode | null = null;
  private lastTickSeen = -1;
  private elapsedSeconds = 0;

  private readonly batcher: SceneBatcher;

  constructor() {
    writePaletteUniform(this.paletteSrcBuf, DEFAULT_PALETTE_KEY_COLORS);
    writePaletteUniform(this.paletteDstBuf, DEFAULT_PALETTE_KEY_COLORS);

    this.batcher = {
      fillRect: (x, y, w, h, hexColor, alpha = 1, flash = 0) => {
        if (alpha <= 0 || w <= 0 || h <= 0) return;
        const c = parseHexColor(hexColor);
        this.pushQuad(
          Math.round(x),
          Math.round(y),
          Math.round(w),
          Math.round(h),
          0,
          0,
          0,
          0,
          c.r,
          c.g,
          c.b,
          c.a * alpha,
          flash,
          0,
          0,
          0, // useTex = 0 (solid)
        );
      },
      drawAtlas: (region, dx, dy, dw, dh, flipX, alpha, flash, paletteSwap, outline) => {
        if (!this.atlasTex || alpha <= 0) return;
        this.bindTexture(this.atlasTex, this.atlasWidth, this.atlasHeight);
        const u0 = region.x / this.atlasWidth;
        const v0 = region.y / this.atlasHeight;
        const u1 = (region.x + region.w) / this.atlasWidth;
        const v1 = (region.y + region.h) / this.atlasHeight;
        this.pushQuad(
          Math.round(dx),
          Math.round(dy),
          Math.round(dw),
          Math.round(dh),
          flipX ? u1 : u0,
          v0,
          flipX ? u0 : u1,
          v1,
          1,
          1,
          1,
          alpha,
          flash,
          paletteSwap ? 1 : 0,
          outline ? 1 : 0,
          1, // useTex = 1
        );
      },
      drawCustom: (key, dx, dy, dw, dh, flipX, alpha, flash) => {
        const entry = this.customTextures.get(key);
        if (!entry || alpha <= 0) return;
        if (!entry.uploaded) {
          if (!entry.img.complete || entry.img.naturalWidth <= 0) return;
          this.uploadCustomTexture(entry);
        }
        this.bindTexture(entry.texture, entry.width, entry.height);
        this.pushQuad(
          Math.round(dx),
          Math.round(dy),
          Math.round(dw),
          Math.round(dh),
          flipX ? 1 : 0,
          0,
          flipX ? 0 : 1,
          1,
          1,
          1,
          1,
          alpha,
          flash,
          0,
          0,
          1,
        );
      },
      resolveRegion: (key) => this.lookup.get(key),
      resolveTileRegion: (stageId, tileType) => this.lookup.getTile(stageId, tileType),
      hasCustomOverride: (key) => {
        const entry = this.customTextures.get(key);
        return Boolean(entry && entry.img.complete && entry.img.naturalWidth > 0);
      },
    };
  }

  public get backend(): 'webgl2' | 'canvas2d' {
    return this._backend;
  }

  public init(
    canvas: HTMLCanvasElement,
    atlasCanvas: HTMLCanvasElement | null,
    atlasRegions: Record<string, AtlasRect>,
    sourcePalette?: Palette6,
  ): void {
    this.canvas = canvas;
    canvas.width = W;
    canvas.height = H;
    canvas.style.imageRendering = 'pixelated';

    this.lookup.setRegions(atlasRegions);
    if (sourcePalette) {
      writePaletteUniform(this.paletteSrcBuf, sourcePalette);
      this.paletteSrcDirty = true;
    }

    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });

    if (!gl) {
      this.activateFallback(canvas, atlasCanvas, atlasRegions, sourcePalette);
      return;
    }

    try {
      this.gl = gl;
      this.initGlResources(gl, atlasCanvas);
      this._backend = 'webgl2';
      this.fallback = null;
    } catch {
      this.disposeGlOnly();
      this.activateFallback(canvas, atlasCanvas, atlasRegions, sourcePalette);
    }
  }

  private activateFallback(
    canvas: HTMLCanvasElement,
    atlasCanvas: HTMLCanvasElement | null,
    atlasRegions: Record<string, AtlasRect>,
    sourcePalette?: Palette6,
  ): void {
    this._backend = 'canvas2d';
    this.fallback = new Canvas2DFallback();
    this.fallback.init(canvas, atlasCanvas, atlasRegions, sourcePalette);
  }

  private initGlResources(
    gl: WebGL2RenderingContext,
    atlasCanvas: HTMLCanvasElement | null,
  ): void {
    // Compile & link shaders
    this.spriteProg = createProgram(gl, SPRITE_VERT_SRC, SPRITE_FRAG_SRC);
    this.postProg = createProgram(gl, POST_VERT_SRC, POST_FRAG_SRC);

    this.spriteUniforms = {
      uResolution: gl.getUniformLocation(this.spriteProg, 'uResolution'),
      uTex: gl.getUniformLocation(this.spriteProg, 'uTex'),
      uTexelSize: gl.getUniformLocation(this.spriteProg, 'uTexelSize'),
      uPaletteSrc: gl.getUniformLocation(this.spriteProg, 'uPaletteSrc[0]'),
      uPaletteDst: gl.getUniformLocation(this.spriteProg, 'uPaletteDst[0]'),
      uOutlineColor: gl.getUniformLocation(this.spriteProg, 'uOutlineColor'),
    };

    this.postUniforms = {
      uSceneTex: gl.getUniformLocation(this.postProg, 'uSceneTex'),
      uResolution: gl.getUniformLocation(this.postProg, 'uResolution'),
      uTime: gl.getUniformLocation(this.postProg, 'uTime'),
      uHeatHaze: gl.getUniformLocation(this.postProg, 'uHeatHaze'),
      uDesperationFlash: gl.getUniformLocation(this.postProg, 'uDesperationFlash'),
      uFreezeTint: gl.getUniformLocation(this.postProg, 'uFreezeTint'),
      uOverloadPulse: gl.getUniformLocation(this.postProg, 'uOverloadPulse'),
    };

    // Preallocate dynamic sprite VAO + VBO (ZERO per-frame GPU buffer allocations)
    this.spriteVao = gl.createVertexArray();
    this.spriteVbo = gl.createBuffer();
    gl.bindVertexArray(this.spriteVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteVbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.vertexData.byteLength, gl.DYNAMIC_DRAW);

    const stride = FLOATS_PER_VERTEX * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 8);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 16);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, stride, 32);

    this.postVao = gl.createVertexArray();
    gl.bindVertexArray(null);

    // 1x1 white fallback texture so sampler2D is always valid
    this.dummyTex = this.createNearestTexture(gl);
    gl.bindTexture(gl.TEXTURE_2D, this.dummyTex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([255, 255, 255, 255]),
    );

    // Offscreen 400x240 pixel framebuffer with strictly gl.NEAREST filtering
    this.fbo = gl.createFramebuffer();
    this.fboTex = this.createNearestTexture(gl);
    gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Upload sprite atlas ONCE
    if (atlasCanvas) {
      this.uploadAtlasCanvas(atlasCanvas);
    }

    // Set static sprite uniforms once
    gl.useProgram(this.spriteProg);
    gl.uniform2f(this.spriteUniforms.uResolution, W, H);
    gl.uniform1i(this.spriteUniforms.uTex, 0);
    gl.uniform4f(this.spriteUniforms.uOutlineColor, 0.051, 0.063, 0.106, 1.0); // #0d101b
    gl.uniform3fv(this.spriteUniforms.uPaletteSrc, this.paletteSrcBuf);
    gl.uniform3fv(this.spriteUniforms.uPaletteDst, this.paletteDstBuf);
    this.paletteSrcDirty = false;

    gl.useProgram(this.postProg);
    gl.uniform1i(this.postUniforms.uSceneTex, 0);
    gl.uniform2f(this.postUniforms.uResolution, W, H);

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  private createNearestTexture(gl: WebGL2RenderingContext): WebGLTexture {
    const tex = gl.createTexture();
    if (!tex) throw new Error('Failed to create WebGL2 texture');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private uploadAtlasCanvas(atlasCanvas: HTMLCanvasElement): void {
    const gl = this.gl;
    if (!gl) return;
    if (!this.atlasTex) {
      this.atlasTex = this.createNearestTexture(gl);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlasCanvas);
    this.atlasWidth = Math.max(1, atlasCanvas.width);
    this.atlasHeight = Math.max(1, atlasCanvas.height);
  }

  private uploadCustomTexture(entry: CustomTextureEntry): void {
    const gl = this.gl;
    if (!gl) return;
    gl.bindTexture(gl.TEXTURE_2D, entry.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, entry.img);
    entry.width = Math.max(1, entry.img.naturalWidth || entry.img.width);
    entry.height = Math.max(1, entry.img.naturalHeight || entry.img.height);
    entry.uploaded = true;
  }

  public setAtlas(
    atlasCanvas: HTMLCanvasElement | null,
    atlasRegions: Record<string, AtlasRect>,
  ): void {
    this.lookup.setRegions(atlasRegions);
    if (this.fallback) {
      this.fallback.setAtlas(atlasCanvas, atlasRegions);
      return;
    }
    if (atlasCanvas) {
      this.uploadAtlasCanvas(atlasCanvas);
    }
  }

  public setSourcePalette(palette: Palette6): void {
    writePaletteUniform(this.paletteSrcBuf, palette);
    this.paletteSrcDirty = true;
    if (this.fallback) {
      this.fallback.setSourcePalette(palette);
    }
  }

  public setCustomSpriteOverride(key: string, img: HTMLImageElement | null): void {
    if (this.fallback) {
      this.fallback.setCustomSpriteOverride(key, img);
      return;
    }
    const gl = this.gl;
    const prev = this.customTextures.get(key);
    if (!img) {
      if (prev && gl) gl.deleteTexture(prev.texture);
      this.customTextures.delete(key);
      return;
    }
    if (!gl) return;
    if (prev) {
      prev.img = img;
      prev.uploaded = false;
      if (img.complete && img.naturalWidth > 0) {
        this.uploadCustomTexture(prev);
      }
      return;
    }
    const tex = this.createNearestTexture(gl);
    const entry: CustomTextureEntry = {
      texture: tex,
      width: 1,
      height: 1,
      uploaded: false,
      img,
    };
    if (img.complete && img.naturalWidth > 0) {
      this.uploadCustomTexture(entry);
    }
    this.customTextures.set(key, entry);
  }

  public triggerBossIntro(name: string, title: string): void {
    this.hud.triggerBossIntro(name, title);
    if (this.fallback) {
      this.fallback.triggerBossIntro(name, title);
    }
  }

  public spawnEventParticles(event: SimEvent): void {
    if (event.type === 'bossIntro') {
      this.hud.triggerBossIntro(event.name, event.title);
    }
    if (this.fallback) {
      this.fallback.spawnEventParticles(event);
      return;
    }
    this.particles.spawnFromEvent(event);
  }

  private bindTexture(tex: WebGLTexture, w: number, h: number): void {
    if (this.boundTex === tex) return;
    this.flushBatch();
    this.boundTex = tex;
    this.boundTexW = w;
    this.boundTexH = h;
    const gl = this.gl;
    if (gl && this.spriteUniforms) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform2f(this.spriteUniforms.uTexelSize, 1 / w, 1 / h);
    }
  }

  private pushQuad(
    x: number,
    y: number,
    w: number,
    h: number,
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    r: number,
    g: number,
    b: number,
    a: number,
    flash: number,
    paletteSwap: number,
    outline: number,
    useTex: number,
  ): void {
    if (this.floatCursor + VERTS_PER_QUAD * FLOATS_PER_VERTEX > MAX_FLOATS) {
      this.flushBatch();
    }

    const x1 = x + w;
    const y1 = y + h;
    const buf = this.vertexData;
    let o = this.floatCursor;

    // Triangle 1: (x, y), (x1, y), (x, y1)
    buf[o++] = x;  buf[o++] = y;  buf[o++] = u0; buf[o++] = v0;
    buf[o++] = r;  buf[o++] = g;  buf[o++] = b;  buf[o++] = a;
    buf[o++] = flash; buf[o++] = paletteSwap; buf[o++] = outline; buf[o++] = useTex;

    buf[o++] = x1; buf[o++] = y;  buf[o++] = u1; buf[o++] = v0;
    buf[o++] = r;  buf[o++] = g;  buf[o++] = b;  buf[o++] = a;
    buf[o++] = flash; buf[o++] = paletteSwap; buf[o++] = outline; buf[o++] = useTex;

    buf[o++] = x;  buf[o++] = y1; buf[o++] = u0; buf[o++] = v1;
    buf[o++] = r;  buf[o++] = g;  buf[o++] = b;  buf[o++] = a;
    buf[o++] = flash; buf[o++] = paletteSwap; buf[o++] = outline; buf[o++] = useTex;

    // Triangle 2: (x1, y), (x1, y1), (x, y1)
    buf[o++] = x1; buf[o++] = y;  buf[o++] = u1; buf[o++] = v0;
    buf[o++] = r;  buf[o++] = g;  buf[o++] = b;  buf[o++] = a;
    buf[o++] = flash; buf[o++] = paletteSwap; buf[o++] = outline; buf[o++] = useTex;

    buf[o++] = x1; buf[o++] = y1; buf[o++] = u1; buf[o++] = v1;
    buf[o++] = r;  buf[o++] = g;  buf[o++] = b;  buf[o++] = a;
    buf[o++] = flash; buf[o++] = paletteSwap; buf[o++] = outline; buf[o++] = useTex;

    buf[o++] = x;  buf[o++] = y1; buf[o++] = u0; buf[o++] = v1;
    buf[o++] = r;  buf[o++] = g;  buf[o++] = b;  buf[o++] = a;
    buf[o++] = flash; buf[o++] = paletteSwap; buf[o++] = outline; buf[o++] = useTex;

    this.floatCursor = o;
  }

  private flushBatch(): void {
    const gl = this.gl;
    if (!gl || this.floatCursor === 0 || !this.spriteVbo) return;
    const vertCount = this.floatCursor / FLOATS_PER_VERTEX;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteVbo);
    // WebGL2 5-arg bufferSubData: ZERO subarray allocation!
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.vertexData, 0, this.floatCursor);
    gl.drawArrays(gl.TRIANGLES, 0, vertCount);
    this.floatCursor = 0;
  }

  public render(
    prev: RenderSnapshot,
    state: SimState,
    interpAlpha: number,
    settings: RenderSettings,
    activePalette: Palette6,
    stagePalette: StageDefinition['palette'],
    stageMeta?: StageRenderMeta,
    activeModality: InputModality = 'keyboard',
    fps?: number,
  ): void {
    if (this.fallback) {
      this.fallback.render(
        prev,
        state,
        interpAlpha,
        settings,
        activePalette,
        stagePalette,
        stageMeta,
        activeModality,
        fps,
      );
      return;
    }

    const gl = this.gl;
    if (!gl || !this.spriteProg || !this.postProg || !this.spriteUniforms || !this.postUniforms) {
      return;
    }

    if (this.canvas && this.lastScaleMode !== settings.scaleMode) {
      applyCanvasScale(this.canvas, settings.scaleMode);
      this.lastScaleMode = settings.scaleMode;
    }

    const tickDelta =
      this.lastTickSeen >= 0 ? Math.max(0, Math.min(4, state.tick - this.lastTickSeen)) : 1;
    this.lastTickSeen = state.tick;
    if (tickDelta > 0) {
      this.particles.update(tickDelta);
      this.elapsedSeconds += tickDelta / ENGINE_CONSTANTS.SIM_HZ;
    }

    // ---- PASS 1: Render 400x240 pixel scene into offscreen FBO ----
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0.043, 0.059, 0.102, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.spriteProg);
    gl.bindVertexArray(this.spriteVao);

    if (this.paletteSrcDirty) {
      gl.uniform3fv(this.spriteUniforms.uPaletteSrc, this.paletteSrcBuf);
      this.paletteSrcDirty = false;
    }

    const palKey = `${activePalette[0]}${activePalette[2]}${activePalette[4]}${activePalette[5]}`;
    if (palKey !== this.lastPaletteDstKey) {
      writePaletteUniform(this.paletteDstBuf, activePalette);
      gl.uniform3fv(this.spriteUniforms.uPaletteDst, this.paletteDstBuf);
      this.lastPaletteDstKey = palKey;
    }

    const defaultTex = this.atlasTex ?? this.dummyTex;
    if (defaultTex) {
      this.boundTex = defaultTex;
      this.boundTexW = this.atlasTex ? this.atlasWidth : 1;
      this.boundTexH = this.atlasTex ? this.atlasHeight : 1;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, defaultTex);
      gl.uniform2f(
        this.spriteUniforms.uTexelSize,
        1 / this.boundTexW,
        1 / this.boundTexH,
      );
    }

    this.floatCursor = 0;

    drawWorldScene(
      this.batcher,
      prev,
      state,
      interpAlpha,
      settings,
      activePalette,
      stagePalette,
      this.particles,
      this.parallax,
      stageMeta,
    );

    this.flushBatch();

    // ---- PASS 2: Full-Screen Post-Process (Heat Haze, Desperation, Freeze, Overload) ----
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND);

    gl.useProgram(this.postProg);
    gl.bindVertexArray(this.postVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fboTex);

    const heatHaze = stageMeta?.heatHaze ? 1.0 : 0.0;
    const despFlash =
      state.boss && state.boss.desperationBannerTicks > 0
        ? Math.min(1, state.boss.desperationBannerTicks / 30)
        : state.boss && state.boss.desperationTriggered
          ? 0.22
          : 0.0;
    const freezeTint = state.player.freezeFieldTimer > 0 ? 1.0 : 0.0;
    const overloadPulse = state.player.overloadTimer > 0 ? 1.0 : 0.0;

    gl.uniform1f(this.postUniforms.uTime, this.elapsedSeconds);
    gl.uniform1f(this.postUniforms.uHeatHaze, heatHaze);
    gl.uniform1f(this.postUniforms.uDesperationFlash, despFlash);
    gl.uniform1f(this.postUniforms.uFreezeTint, freezeTint);
    gl.uniform1f(this.postUniforms.uOverloadPulse, overloadPulse);

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ---- PASS 3: Crisp In-Canvas Pixel HUD (Unaffected by Heat Haze) ----
    gl.enable(gl.BLEND);
    gl.useProgram(this.spriteProg);
    gl.bindVertexArray(this.spriteVao);
    if (defaultTex) {
      this.boundTex = defaultTex;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, defaultTex);
    }
    this.floatCursor = 0;

    this.hud.render(this.batcher, {
      state,
      settings,
      activePalette,
      activeModality,
      fps,
      bossIntroTitle: stageMeta?.bossTitle,
    });

    this.flushBatch();
    gl.bindVertexArray(null);
  }

  private disposeGlOnly(): void {
    const gl = this.gl;
    if (!gl) return;
    if (this.spriteProg) gl.deleteProgram(this.spriteProg);
    if (this.postProg) gl.deleteProgram(this.postProg);
    if (this.spriteVao) gl.deleteVertexArray(this.spriteVao);
    if (this.postVao) gl.deleteVertexArray(this.postVao);
    if (this.spriteVbo) gl.deleteBuffer(this.spriteVbo);
    if (this.fbo) gl.deleteFramebuffer(this.fbo);
    if (this.fboTex) gl.deleteTexture(this.fboTex);
    if (this.atlasTex) gl.deleteTexture(this.atlasTex);
    if (this.dummyTex) gl.deleteTexture(this.dummyTex);
    for (const entry of this.customTextures.values()) {
      gl.deleteTexture(entry.texture);
    }
    this.customTextures.clear();
    this.gl = null;
    this.spriteProg = null;
    this.postProg = null;
    this.spriteVao = null;
    this.postVao = null;
    this.spriteVbo = null;
    this.fbo = null;
    this.fboTex = null;
    this.atlasTex = null;
    this.dummyTex = null;
  }

  public dispose(): void {
    this.particles.clear();
    if (this.fallback) {
      this.fallback.dispose();
      this.fallback = null;
    }
    this.disposeGlOnly();
    this.canvas = null;
  }
}

/**
 * Factory creating a WebGL2Renderer (which automatically degrades cleanly to
 * Canvas2DFallback if WebGL2 context creation fails).
 */
export function createGameRenderer(): GameRenderer {
  return new WebGL2Renderer();
}
