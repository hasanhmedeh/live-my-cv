import type * as THREE from 'three';

export type Tier = 'low' | 'medium' | 'high';

export interface Quality {
  tier: Tier;
  /** Max device-pixel-ratio we render at (adaptive scaling goes below this). */
  dpr: number;
  ao: boolean;
  aoMode: 'Performance' | 'Low' | 'Medium';
  smaa: 'LOW' | 'MEDIUM' | 'HIGH';
  shadowSize: number;
  /** Grass clumps per m² (0 disables grass). */
  grass: number;
  grassDistance: number;
  /** Headlight spot + rocket engine light. Fixed at startup so shaders never recompile. */
  extraLights: boolean;
  clouds: boolean;
}

const PRESETS: Record<Tier, Omit<Quality, 'tier' | 'dpr'>> = {
  high: { ao: true, aoMode: 'Medium', smaa: 'HIGH', shadowSize: 2048, grass: 4, grassDistance: 90, extraLights: true, clouds: true },
  medium: { ao: true, aoMode: 'Performance', smaa: 'MEDIUM', shadowSize: 2048, grass: 2.2, grassDistance: 70, extraLights: true, clouds: true },
  low: { ao: false, aoMode: 'Performance', smaa: 'LOW', shadowSize: 1024, grass: 0.9, grassDistance: 50, extraLights: false, clouds: true },
};

/** Pick a tier from the GPU, the device class and an optional `?quality=` override. */
export function detectQuality(renderer: THREE.WebGLRenderer, mobile: boolean): Quality {
  const forced = new URLSearchParams(location.search).get('quality') as Tier | null;
  let tier: Tier;
  if (forced && forced in PRESETS) tier = forced;
  else {
    let gpu = '';
    try {
      const gl = renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).toLowerCase();
    } catch {
      /* ignore */
    }
    const software = /swiftshader|llvmpipe|software|basic render/.test(gpu);
    const integrated = /intel|uhd|iris|mali|adreno [1-5]|powervr|videocore/.test(gpu);
    const cores = navigator.hardwareConcurrency ?? 4;
    if (software) tier = 'low';
    else if (mobile) tier = cores >= 8 && !/mali|powervr/.test(gpu) ? 'medium' : 'low';
    else tier = integrated ? 'medium' : 'high';
  }
  const dprCap = tier === 'high' ? 1.75 : tier === 'medium' ? 1.5 : 1.25;
  return { tier, dpr: Math.min(devicePixelRatio || 1, dprCap), ...PRESETS[tier] };
}

/**
 * Dynamic resolution: watches the frame time and nudges the render scale so the
 * fair stays smooth. Returns true when the scale changed.
 */
export class AdaptiveResolution {
  scale = 1;
  private acc = 0;
  private frames = 0;
  private goodStreak = 0;
  private warmup = 2.5; // ignore the first seconds (shader compiles, texture uploads)

  constructor(private min = 0.55) {}

  update(dt: number): boolean {
    if (this.warmup > 0) {
      this.warmup -= dt;
      return false;
    }
    this.acc += dt;
    this.frames++;
    if (this.acc < 1.5) return false;
    const fps = this.frames / this.acc;
    this.acc = 0;
    this.frames = 0;

    if (fps < 48 && this.scale > this.min) {
      this.scale = Math.max(this.min, this.scale - (fps < 32 ? 0.2 : 0.1));
      this.goodStreak = 0;
      return true;
    }
    if (fps > 58) {
      this.goodStreak++;
      if (this.goodStreak >= 3 && this.scale < 1) {
        this.scale = Math.min(1, this.scale + 0.1);
        this.goodStreak = 0;
        return true;
      }
    } else this.goodStreak = 0;
    return false;
  }
}
