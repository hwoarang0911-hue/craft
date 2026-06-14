// Chunk materials: MeshStandardMaterial patched with
//  - atlas sampling via textureGrad on wrapped per-tile UVs (greedy quads repeat)
//  - per-vertex voxel light (sky + torch) and baked AO
//  - per-vertex emissive glow (torch heads, lava)
//  - vertex sway (leaves / plants horizontal, water vertical bob)
import * as THREE from 'three';

export const TORCH_COLOR = new THREE.Color(1.0, 0.55, 0.22);

function patch(mat, mode) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uMap = mat.userData.mapUniform;
    shader.uniforms.uTorchColor = { value: TORCH_COLOR.clone().multiplyScalar(1.5) };
    shader.uniforms.uEmissiveBoost = { value: mode === 'water' ? 3.4 : 2.6 };
    mat.userData.shader = shader;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 uvl;
        attribute vec2 tile;
        attribute vec3 voxel;
        attribute vec2 anim;
        uniform float uTime;
        varying vec2 vUvL;
        varying vec2 vTileId;
        varying vec3 vVoxel;
        varying vec2 vAnimV;
        varying vec3 vWp;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vUvL = uvl;
        vTileId = tile;
        vVoxel = voxel;
        vAnimV = anim;
        vec3 wp0 = (modelMatrix * vec4(transformed, 1.0)).xyz;
        ${mode === 'leaves' ? `
        float swayP = anim.x * 0.055;
        transformed.x += swayP * sin(uTime * 1.6 + wp0.x * 0.9 + wp0.y * 0.5 + wp0.z * 1.1);
        transformed.z += swayP * sin(uTime * 1.25 + wp0.z * 0.8 + wp0.x * 0.6 + 1.7);
        ` : ''}
        vWp = (modelMatrix * vec4(transformed, 1.0)).xyz;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uMap;
        uniform float uTime;
        uniform vec3 uTorchColor;
        uniform float uEmissiveBoost;
        varying vec2 vUvL;
        varying vec2 vTileId;
        varying vec3 vVoxel;
        varying vec2 vAnimV;
        varying vec3 vWp;`)
      .replace('#include <map_fragment>', `
        vec2 fuv = vec2(fract(vUvL.x), 1.0 - fract(vUvL.y));
        vec2 tuv = (vTileId * 32.0 + 8.0 + fuv * 16.0) / 256.0;
        vec2 guv = (vTileId * 32.0 + 8.0 + vec2(vUvL.x, -vUvL.y) * 16.0) / 256.0;
        vec4 texel = textureGrad(uMap, tuv, dFdx(guv), dFdy(guv));
        diffuseColor *= texel;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        ${mode === 'water' ? `
        // animated normal ripple, low frequency to avoid block-scale moire
        float rip = sin(vWp.x * 0.55 + uTime * 1.5) * sin(vWp.z * 0.4 - uTime * 1.1);
        float rip2 = sin(vWp.x * 1.3 - uTime * 2.2 + vWp.z * 0.9);
        normal = normalize(normal + vec3(rip * 0.13 + rip2 * 0.06, 0.0,
                                         rip * 0.1 - rip2 * 0.05));
        ` : ''}`)
      .replace('#include <aomap_fragment>', `
        float voxAo = vVoxel.z;
        float skyF = vVoxel.x;
        float skyCurve = skyF * skyF;
        float sunGate = smoothstep(0.02, 0.5, skyF);
        reflectedLight.directDiffuse *= voxAo * sunGate;
        reflectedLight.directSpecular *= voxAo * sunGate;
        reflectedLight.indirectDiffuse *= voxAo * mix(0.03, 1.0, skyCurve);
        reflectedLight.indirectSpecular *= voxAo * mix(0.06, 1.0, skyCurve);
        float torchL = pow(vVoxel.y, 2.8);
        reflectedLight.indirectDiffuse += diffuseColor.rgb * uTorchColor * torchL;
        ${mode === 'water' ? 'reflectedLight.indirectSpecular *= 2.6;' : ''}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * vAnimV.y * uEmissiveBoost;`);
  };
  // distinct programs per mode
  mat.customProgramCacheKey = () => 'voxel-' + mode;
}

export function makeChunkMaterials(atlasCanvas) {
  const atlasTex = new THREE.CanvasTexture(atlasCanvas);
  atlasTex.colorSpace = THREE.SRGBColorSpace;
  atlasTex.magFilter = THREE.NearestFilter;
  atlasTex.minFilter = THREE.LinearMipmapLinearFilter;
  atlasTex.generateMipmaps = true;
  atlasTex.flipY = false;
  atlasTex.anisotropy = 4;
  atlasTex.needsUpdate = true;
  const mapUniform = { value: atlasTex };

  const opaque = new THREE.MeshStandardMaterial({ roughness: 0.94, metalness: 0.0 });
  opaque.userData.mapUniform = mapUniform;
  patch(opaque, 'solid');

  const cutout = new THREE.MeshStandardMaterial({
    roughness: 0.8, metalness: 0.0, alphaTest: 0.45, side: THREE.DoubleSide,
  });
  cutout.userData.mapUniform = mapUniform;
  patch(cutout, 'leaves');

  const trans = new THREE.MeshStandardMaterial({
    roughness: 0.1, metalness: 0.0, transparent: true, depthWrite: false,
    side: THREE.DoubleSide, envMapIntensity: 0.75,
  });
  trans.userData.mapUniform = mapUniform;
  patch(trans, 'water');

  return { opaque, cutout, trans, atlasTex };
}

export function tickMaterials(materials, t) {
  for (const key of ['opaque', 'cutout', 'trans']) {
    const sh = materials[key].userData.shader;
    if (sh) sh.uniforms.uTime.value = t;
  }
}
