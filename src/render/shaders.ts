// ============================================================================
// Krunked Circuit — WebGL2 GLSL 300 es Shaders & Color Utilities
// Strictly 400x240 nearest-neighbor pixel-art rendering with 6-color palette
// swapping, damage flash, 1px silhouette outlines, and post-process FX.
// ============================================================================

import type { Palette6 } from '../contracts/index';

/**
 * Canonical 6-color key palette used as default `uPaletteSrc` for hero/armor
 * palette swapping. Callers can override via `renderer.setSourcePalette(...)`
 * to match any ProceduralPixelAtlas key palette verbatim.
 */
export const DEFAULT_PALETTE_KEY_COLORS: Palette6 = [
  '#0d101b', // 0: outline / deep shadow
  '#1d3b72', // 1: armor dark
  '#3578d4', // 2: armor mid
  '#8cd4ff', // 3: armor highlight
  '#ff4b6e', // 4: scarf / primary accent
  '#ffe15a', // 5: visor / energy glow
] as const;

export const SPRITE_VERT_SRC = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aPos;
layout(location = 1) in vec2 aUv;
layout(location = 2) in vec4 aColor;
layout(location = 3) in vec4 aFlags;

uniform vec2 uResolution;

out vec2 vUv;
out vec4 vColor;
out vec4 vFlags;

void main() {
  // Convert top-left pixel coordinates [0..W, 0..H] to NDC [-1..1, 1..-1]
  vec2 ndc = (aPos / uResolution) * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
  vUv = aUv;
  vColor = aColor;
  vFlags = aFlags;
}
`;

export const SPRITE_FRAG_SRC = `#version 300 es
precision highp float;

in vec2 vUv;
in vec4 vColor;
in vec4 vFlags; // x: flash(0..1), y: paletteSwap(0|1), z: outline(0|1), w: useTex(0|1)

uniform sampler2D uTex;
uniform vec2 uTexelSize;
uniform vec3 uPaletteSrc[6];
uniform vec3 uPaletteDst[6];
uniform vec4 uOutlineColor;

out vec4 outColor;

void main() {
  if (vFlags.w < 0.5) {
    // Solid untextured pixel primitive (parallax, scarf, particles, HUD, procedural sprites)
    vec3 rgb = mix(vColor.rgb, vec3(1.0), clamp(vFlags.x, 0.0, 1.0));
    outColor = vec4(rgb, vColor.a);
    return;
  }

  vec4 tex = texture(uTex, vUv);

  // Optional 1px crisp silhouette outline on transparent boundary pixels
  if (vFlags.z > 0.5 && tex.a < 0.1) {
    float aL = texture(uTex, vUv + vec2(-uTexelSize.x, 0.0)).a;
    float aR = texture(uTex, vUv + vec2( uTexelSize.x, 0.0)).a;
    float aU = texture(uTex, vUv + vec2(0.0, -uTexelSize.y)).a;
    float aD = texture(uTex, vUv + vec2(0.0,  uTexelSize.y)).a;
    if (max(max(aL, aR), max(aU, aD)) > 0.5) {
      vec3 oRgb = mix(uOutlineColor.rgb, vec3(1.0), clamp(vFlags.x * 0.65, 0.0, 1.0));
      outColor = vec4(oRgb, uOutlineColor.a * vColor.a);
      return;
    }
    discard;
  }

  if (tex.a < 0.01) {
    discard;
  }

  vec3 rgb = tex.rgb;

  // 6-color palette swapper with crisp tolerance for 8-bit sRGB channels
  if (vFlags.y > 0.5) {
    for (int i = 0; i < 6; i++) {
      vec3 diff = abs(rgb - uPaletteSrc[i]);
      if (max(diff.r, max(diff.g, diff.b)) < 0.032) {
        rgb = uPaletteDst[i];
        break;
      }
    }
  }

  rgb *= vColor.rgb;
  // Damage white-flash
  rgb = mix(rgb, vec3(1.0), clamp(vFlags.x, 0.0, 1.0));
  outColor = vec4(rgb, tex.a * vColor.a);
}
`;

export const POST_VERT_SRC = `#version 300 es
precision highp float;

out vec2 vUv;

void main() {
  // Full-screen triangle via gl_VertexID (0, 1, 2) — zero VBO allocation
  vec2 pos = vec2(
    (gl_VertexID == 1) ? 3.0 : -1.0,
    (gl_VertexID == 2) ? 3.0 : -1.0
  );
  vUv = pos * 0.5 + 0.5;
  gl_Position = vec4(pos, 0.0, 1.0);
}
`;

export const POST_FRAG_SRC = `#version 300 es
precision highp float;

in vec2 vUv;

uniform sampler2D uSceneTex;
uniform vec2 uResolution;
uniform float uTime;
uniform float uHeatHaze;
uniform float uDesperationFlash;
uniform float uFreezeTint;
uniform float uOverloadPulse;

out vec4 outColor;

void main() {
  vec2 uv = vUv;

  // Pixel-quantized desert heat-haze shimmer (Optic Solar Relay)
  if (uHeatHaze > 0.005) {
    float row = floor(uv.y * uResolution.y);
    float wave = sin(row * 0.24 + uTime * 7.5) * 0.65 + sin(row * 0.11 - uTime * 4.2) * 0.35;
    // Stronger shimmer near lower/mid horizon, quantized to 1px steps for crispness
    float verticalMask = smoothstep(0.15, 0.85, 1.0 - uv.y);
    float pxOffset = floor(wave * uHeatHaze * 1.6 * verticalMask + 0.5);
    uv.x = clamp(uv.x + pxOffset / uResolution.x, 0.0, 1.0 - 0.5 / uResolution.x);
  }

  // Nearest-snapped texel center sample
  vec2 snappedUv = (floor(uv * uResolution) + 0.5) / uResolution;
  vec4 color = texture(uSceneTex, snappedUv);

  // Subtle solar warmth boost under heat haze
  if (uHeatHaze > 0.005) {
    float warmth = uHeatHaze * 0.045;
    color.rgb += vec3(warmth, warmth * 0.45, -warmth * 0.25);
  }

  // Freeze Field crystalline cyan wash
  if (uFreezeTint > 0.005) {
    color.rgb = mix(color.rgb, color.rgb * vec3(0.75, 0.96, 1.15) + vec3(0.0, 0.08, 0.14), uFreezeTint * 0.45);
  }

  // Function Overload golden edge glow
  if (uOverloadPulse > 0.005) {
    vec2 edge = abs(vUv - 0.5) * 2.0;
    float rim = smoothstep(0.68, 1.0, max(edge.x, edge.y));
    color.rgb += vec3(0.95, 0.68, 0.14) * rim * uOverloadPulse * 0.26;
  }

  // Boss Desperation crimson/amber screen flash & edge pulse
  if (uDesperationFlash > 0.005) {
    vec2 edge = abs(vUv - 0.5) * 2.0;
    float rim = smoothstep(0.55, 1.0, max(edge.x, edge.y));
    float pulse = 0.55 + 0.45 * sin(uTime * 22.0);
    vec3 alertColor = mix(vec3(1.0, 0.16, 0.26), vec3(1.0, 0.72, 0.18), pulse * 0.4);
    color.rgb = mix(color.rgb, alertColor, uDesperationFlash * (0.14 + rim * 0.34));
  }

  outColor = vec4(clamp(color.rgb, 0.0, 1.0), 1.0);
}
`;

export function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error('Failed to allocate WebGL2 shader object');
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'Unknown shader compile error';
    gl.deleteShader(shader);
    throw new Error(`WebGL2 shader compile error: ${log}`);
  }
  return shader;
}

export function createProgram(
  gl: WebGL2RenderingContext,
  vertSrc: string,
  fragSrc: string,
): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    throw new Error('Failed to allocate WebGL2 program object');
  }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'Unknown program link error';
    gl.deleteProgram(program);
    throw new Error(`WebGL2 program link error: ${log}`);
  }
  return program;
}

export interface RgbaFloat {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

const COLOR_CACHE = new Map<string, RgbaFloat>();
const FALLBACK_COLOR: RgbaFloat = { r: 1, g: 1, b: 1, a: 1 };

/**
 * Parses a `#RGB`, `#RRGGBB`, or `#RRGGBBAA` hex string into cached `[0..1]` RGBA floats.
 * Zero allocations after first parse per unique hex string.
 */
export function parseHexColor(hex: string): RgbaFloat {
  const cached = COLOR_CACHE.get(hex);
  if (cached) return cached;

  let clean = hex.trim();
  if (clean.startsWith('#')) clean = clean.slice(1);

  let r = 1;
  let g = 1;
  let b = 1;
  let a = 1;

  if (clean.length === 3) {
    r = parseInt(clean[0] + clean[0], 16) / 255;
    g = parseInt(clean[1] + clean[1], 16) / 255;
    b = parseInt(clean[2] + clean[2], 16) / 255;
  } else if (clean.length === 6) {
    r = parseInt(clean.slice(0, 2), 16) / 255;
    g = parseInt(clean.slice(2, 4), 16) / 255;
    b = parseInt(clean.slice(4, 6), 16) / 255;
  } else if (clean.length === 8) {
    r = parseInt(clean.slice(0, 2), 16) / 255;
    g = parseInt(clean.slice(2, 4), 16) / 255;
    b = parseInt(clean.slice(4, 6), 16) / 255;
    a = parseInt(clean.slice(6, 8), 16) / 255;
  } else {
    return FALLBACK_COLOR;
  }

  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b) || Number.isNaN(a)) {
    return FALLBACK_COLOR;
  }

  const parsed: RgbaFloat = { r, g, b, a };
  COLOR_CACHE.set(hex, parsed);
  return parsed;
}

/**
 * Writes a 6-color palette into a preallocated `Float32Array(18)` (zero allocation).
 */
export function writePaletteUniform(out: Float32Array, palette: Palette6): void {
  for (let i = 0; i < 6; i++) {
    const c = parseHexColor(palette[i]);
    const base = i * 3;
    out[base] = c.r;
    out[base + 1] = c.g;
    out[base + 2] = c.b;
  }
}
