import * as THREE from 'three';
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import type { Quality } from './quality';

/**
 * HDR pipeline: scene → ambient occlusion → (bloom + filmic tone mapping + vignette, merged
 * into a single fullscreen pass) → SMAA. Everything renders into half-float buffers so
 * emissive bulbs above 1.0 bloom naturally.
 */
export class Post {
  composer: EffectComposer;
  private ao: N8AOPostPass | null = null;
  bloom: BloomEffect;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, q: Quality) {
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, stencilBuffer: false });
    this.composer.addPass(new RenderPass(scene, camera));

    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    if (q.ao) {
      const ao = new N8AOPostPass(scene, camera, size.x, size.y);
      ao.setQualityMode(q.aoMode);
      Object.assign(ao.configuration, {
        aoRadius: 2.2,
        distanceFalloff: 1.0,
        intensity: 2.4,
        halfRes: true,
        depthAwareUpsampling: true,
        gammaCorrection: false,
        // labels/glows don't write depth, so skip the extra transparency render
        transparencyAware: false,
      });
      ao.configuration.color = new THREE.Color('#1c0f2e');
      this.composer.addPass(ao);
      this.ao = ao;
    }

    this.bloom = new BloomEffect({
      mipmapBlur: true,
      luminanceThreshold: 1.0,
      luminanceSmoothing: 0.3,
      intensity: 0.9,
      radius: 0.72,
      levels: q.tier === 'high' || q.tier === 'medium' ? 7 : 5,
    });
    // ACES keeps the carnival colours punchy while rolling off the bright sunset sky
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    const vignette = new VignetteEffect({ offset: 0.32, darkness: 0.42 });
    const dbg = import.meta.env.DEV ? (new URLSearchParams(location.search).get('post') ?? '') : '';
    if (dbg.includes('noao') && this.ao) this.ao.enabled = false;
    if (dbg.includes('nobloom') || !q.bloom) this.composer.addPass(new EffectPass(camera, tone, vignette));
    else this.composer.addPass(new EffectPass(camera, this.bloom, tone, vignette));
    if (q.smaa) this.composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset[q.smaa] })));
  }

  setSize(w: number, h: number) {
    this.composer.setSize(w, h, false);
  }

  /** Space has no surfaces to occlude — skip the AO cost while the rocket is up there. */
  setAOEnabled(on: boolean) {
    if (this.ao) this.ao.enabled = on;
  }

  render(dt: number) {
    this.composer.render(dt);
  }
}
