import type * as THREE from 'three';

export type Tier = 'lowest' | 'low' | 'medium' | 'high';
/** What the visitor picked in the graphics menu: a fixed tier, or let us detect one. */
export type QualityChoice = Tier | 'auto';

export const TIERS: Tier[] = ['high', 'medium', 'low', 'lowest'];
export const TIER_LABELS: Record<Tier, string> = { high: 'High', medium: 'Medium', low: 'Low', lowest: 'Very low' };

export interface Quality {
  tier: Tier;
  /** The tier auto-detection would pick on this device (shown next to "Auto" in the menu). */
  detected: Tier;
  choice: QualityChoice;
  /** Max device-pixel-ratio we render at (adaptive scaling goes below this). */
  dpr: number;
  /** Lowest render scale adaptive resolution may drop to. */
  minScale: number;
  ao: boolean;
  aoMode: 'Performance' | 'Low' | 'Medium';
  /** null skips the anti-aliasing pass entirely. */
  smaa: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  bloom: boolean;
  shadows: boolean;
  shadowSize: number;
  /** Grass clumps per m² (0 disables grass). */
  grass: number;
  grassDistance: number;
  /** Headlight spot + rocket engine light. Fixed at startup so shaders never recompile. */
  extraLights: boolean;
  clouds: boolean;
}

type Preset = Omit<Quality, 'tier' | 'detected' | 'choice' | 'dpr'> & { dprCap: number };

const PRESETS: Record<Tier, Preset> = {
  high: { dprCap: 1.75, minScale: 0.55, ao: true, aoMode: 'Medium', smaa: 'HIGH', bloom: true, shadows: true, shadowSize: 2048, grass: 4, grassDistance: 90, extraLights: true, clouds: true },
  medium: { dprCap: 1.5, minScale: 0.55, ao: true, aoMode: 'Performance', smaa: 'MEDIUM', bloom: true, shadows: true, shadowSize: 2048, grass: 2.2, grassDistance: 70, extraLights: true, clouds: true },
  low: { dprCap: 1.25, minScale: 0.55, ao: false, aoMode: 'Performance', smaa: 'LOW', bloom: true, shadows: true, shadowSize: 1024, grass: 0.9, grassDistance: 50, extraLights: false, clouds: true },
  // for very old laptops and budget phones: no shadows, grass, bloom or AA, rendered below native resolution
  lowest: { dprCap: 0.85, minScale: 0.45, ao: false, aoMode: 'Performance', smaa: null, bloom: false, shadows: false, shadowSize: 512, grass: 0, grassDistance: 0, extraLights: false, clouds: false },
};

const STORAGE_KEY = 'funfair-quality';

export function loadQualityChoice(): QualityChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'auto' || (v && v in PRESETS)) return v as QualityChoice;
  } catch {
    /* storage unavailable */
  }
  return 'auto';
}

export function saveQualityChoice(choice: QualityChoice) {
  try {
    localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    /* storage unavailable */
  }
}

function detectTier(renderer: THREE.WebGLRenderer, mobile: boolean): Tier {
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
  if (software) return 'lowest';
  if (mobile) return cores >= 8 && !/mali|powervr/.test(gpu) ? 'medium' : 'low';
  return integrated ? 'medium' : 'high';
}

/** Pick a tier: `?quality=` override, then the visitor's saved choice, then GPU/device detection. */
export function detectQuality(renderer: THREE.WebGLRenderer, mobile: boolean): Quality {
  const forced = new URLSearchParams(location.search).get('quality');
  const detected = detectTier(renderer, mobile);
  const choice: QualityChoice = forced && forced in PRESETS ? (forced as Tier) : loadQualityChoice();
  const tier = choice === 'auto' ? detected : choice;
  const { dprCap, ...preset } = PRESETS[tier];
  return { tier, detected, choice, dpr: Math.min(devicePixelRatio || 1, dprCap), ...preset };
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
