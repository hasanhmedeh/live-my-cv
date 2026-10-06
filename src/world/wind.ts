import * as THREE from 'three';

/** One set of uniforms drives every swaying thing, updated once per frame. */
export const wind = {
  uTime: { value: 0 },
  uCar: { value: new THREE.Vector3(0, 0, 9999) },
};

/**
 * Injects world-space wind into an instanced material. `aSway` (0 at the root, 1 at the
 * tip) controls how much each vertex moves. `push` makes the car flatten nearby blades.
 */
export function addWind(material: THREE.Material, amount: number, push = false) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = wind.uTime;
    shader.uniforms.uCar = wind.uCar;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        attribute float aSway;
        uniform float uTime;
        uniform vec3 uCar;`,
      )
      .replace(
        '#include <project_vertex>',
        /* glsl */ `
        vec4 mvPosition = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        vec4 wPos = modelMatrix * mvPosition;
        #ifdef USE_INSTANCING
          vec3 root = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        #else
          vec3 root = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        #endif
        float sway = aSway * aSway;
        float gust = sin(uTime * 0.6 + root.x * 0.05) * 0.5 + 0.5;
        float w = sin(uTime * 1.7 + root.x * 0.31 + root.z * 0.23) + 0.4 * sin(uTime * 3.3 + root.z * 0.7);
        wPos.x += w * ${amount.toFixed(3)} * (0.6 + gust) * sway;
        wPos.z += w * ${(amount * 0.45).toFixed(3)} * sway;
        ${
          push
            ? /* glsl */ `
        vec2 away = root.xz - uCar.xz;
        float d = length(away);
        float k = smoothstep(2.8, 0.6, d);
        wPos.xz += (away / max(d, 0.001)) * k * 0.55 * sway;
        wPos.y -= k * 0.35 * aSway;`
            : ''
        }
        mvPosition = viewMatrix * wPos;
        gl_Position = projectionMatrix * mvPosition;`,
      );
  };
  // distinct program cache key per variant
  material.customProgramCacheKey = () => `wind-${amount}-${push}`;
}
