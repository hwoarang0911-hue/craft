// Post chain: render -> GTAO (SSAO) -> bloom -> tonemap/output -> vignette+grain+underwater.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uUnderwater: { value: 0 },
    uVignette: { value: 0.36 },
    uGrain: { value: 0.035 },
    uFlash: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uUnderwater;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uFlash;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime * 61.7) * 43758.5453);
    }

    void main() {
      vec2 uv = vUv;
      // slight refraction wobble underwater
      if (uUnderwater > 0.5) {
        uv += vec2(sin(uv.y * 28.0 + uTime * 2.4), cos(uv.x * 24.0 + uTime * 2.1)) * 0.0025;
      }
      vec3 col = texture2D(tDiffuse, uv).rgb;
      if (uUnderwater > 0.5) {
        col = mix(col, col * vec3(0.2, 0.45, 0.85), 0.6);
        col += vec3(0.008, 0.035, 0.075);
      }
      // vignette
      float d = distance(vUv, vec2(0.5));
      col *= 1.0 - uVignette * smoothstep(0.42, 0.86, d);
      // film grain
      col += (hash(vUv * vec2(1920.0, 1080.0)) - 0.5) * uGrain;
      // explosion flash, brightest at screen center
      col += uFlash * vec3(1.0, 0.86, 0.6) * (1.2 - 0.6 * smoothstep(0.0, 0.8, distance(vUv, vec2(0.5))));
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class Post {
  constructor(renderer, scene, camera) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.88;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const size = renderer.getSize(new THREE.Vector2());
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    this.gtao = new GTAOPass(scene, camera, size.x, size.y);
    this.gtao.output = GTAOPass.OUTPUT.Default;
    this.gtao.blendIntensity = 0.9;
    this.gtao.updateGtaoMaterial({
      radius: 0.4, distanceExponent: 1.6, thickness: 1.2,
      scale: 1.4, samples: 12, distanceFallOff: 0.6, screenSpaceRadius: false,
    });
    this.composer.addPass(this.gtao);

    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.35, 0.35, 0.9);
    this.composer.addPass(this.bloom);

    this.composer.addPass(new OutputPass());

    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.final);
  }

  setUnderwater(on) {
    this.final.uniforms.uUnderwater.value = on ? 1 : 0;
  }

  setFlash(v) {
    this.final.uniforms.uFlash.value = v;
  }

  setNight(nightF) {
    // bloom breathes a little wider at night so torches carry
    this.bloom.strength = 0.35 + nightF * 0.3;
  }

  resize(w, h) {
    this.composer.setSize(w, h);
    this.gtao.setSize(w, h);
  }

  render(dt) {
    this.final.uniforms.uTime.value += dt;
    this.composer.render(dt);
  }
}
