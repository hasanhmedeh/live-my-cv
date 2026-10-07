import * as THREE from 'three';

/**
 * Sun-aware fog: distant things fade toward the sun's colour when you look at it, and to the
 * plain fog colour elsewhere. The direction and colour are shared uniforms that the day cycle
 * updates every frame (sunrise glow in the east, sunset in the west, a faint moon glow at night).
 */
export const fogSun = {
  uFogSunDir: { value: new THREE.Vector3(-0.95, 0.05, -0.2).normalize() },
  uFogSunColor: { value: new THREE.Color('#f0a06a') },
};

/** Gives a shader the shared fog uniforms (call from custom onBeforeCompile hooks). */
export function withFogSun(shader: { uniforms: Record<string, THREE.IUniform> }) {
  Object.assign(shader.uniforms, fogSun);
}

export function installSunFog() {
  const C = THREE.ShaderChunk;
  if (C.fog_fragment.includes('vFogDir')) return;
  C.fog_pars_vertex = C.fog_pars_vertex.replace('varying float vFogDepth;', 'varying float vFogDepth;\n\tvarying vec3 vFogDir;');
  // world-space view direction: multiplying by viewMatrix on the right applies its inverse rotation
  C.fog_vertex = C.fog_vertex.replace('vFogDepth = - mvPosition.z;', 'vFogDepth = - mvPosition.z;\n\tvFogDir = ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;');
  C.fog_pars_fragment = C.fog_pars_fragment.replace(
    'varying float vFogDepth;',
    'varying float vFogDepth;\n\tvarying vec3 vFogDir;\n\tuniform vec3 uFogSunDir;\n\tuniform vec3 uFogSunColor;',
  );
  C.fog_fragment = C.fog_fragment.replace(
    'gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );',
    `float sunAmt = pow( max( dot( normalize( vFogDir ), uFogSunDir ), 0.0 ), 5.0 );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, mix( fogColor, uFogSunColor, sunAmt ), fogFactor );`,
  );
  // every built-in material picks up the shared uniforms (materials with their own hook call
  // withFogSun; any that don't simply get no sun tint)
  THREE.Material.prototype.onBeforeCompile = function (shader: THREE.WebGLProgramParametersWithUniforms) {
    withFogSun(shader);
  };
}
