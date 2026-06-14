// Sky dome (gradient + sun + moon + stars in one shader), drifting clouds,
// sun/moon lighting rig with PCF shadows, fog sync, PMREM environment.
import * as THREE from 'three';
import { DAY_SECONDS, NIGHT_SECONDS, RENDER_DIST, CHUNK } from './config.js';

// day occupies t in [0.21, 0.79] (sun up incl. dawn/dusk), night the rest.
// advance `t` at different rates so day lasts DAY_SECONDS, night NIGHT_SECONDS.
const DAY_LO = 0.21, DAY_HI = 0.79;
const DAY_RATE = (DAY_HI - DAY_LO) / DAY_SECONDS;        // t per second during day
const NIGHT_RATE = (1 - (DAY_HI - DAY_LO)) / NIGHT_SECONDS; // t per second during night

const SKY_SHADER = {
  uniforms: {
    sunDir: { value: new THREE.Vector3(0, 1, 0) },
    zenithCol: { value: new THREE.Color() },
    horizonCol: { value: new THREE.Color() },
    sunCol: { value: new THREE.Color() },
    nightF: { value: 0 },
    duskF: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec3 vDir;
    void main() {
      vDir = normalize(position);
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_Position.z = gl_Position.w; // pin to far plane
    }
  `,
  fragmentShader: /* glsl */`
    varying vec3 vDir;
    uniform vec3 sunDir;
    uniform vec3 zenithCol;
    uniform vec3 horizonCol;
    uniform vec3 sunCol;
    uniform float nightF;
    uniform float duskF;

    float hash13(vec3 p) {
      p = fract(p * 0.1031);
      p += dot(p, p.zyx + 31.32);
      return fract((p.x + p.y) * p.z);
    }

    void main() {
      vec3 d = normalize(vDir);
      float elev = d.y;
      float h = pow(1.0 - clamp(elev, 0.0, 1.0), 2.2);
      vec3 col = mix(zenithCol, horizonCol, h);

      // warm halo around the sun at dawn/dusk
      float sunDot = dot(d, sunDir);
      float halo = pow(clamp(sunDot, 0.0, 1.0), 6.0);
      col += sunCol * halo * (0.12 + duskF * 0.8) * (1.0 - nightF);

      // sun disc
      float disc = smoothstep(0.99935, 0.99975, sunDot);
      col += sunCol * disc * 5.0 * (1.0 - nightF);
      // soft glow
      col += sunCol * pow(clamp(sunDot, 0.0, 1.0), 320.0) * 0.9 * (1.0 - nightF);

      // moon (opposite the sun), slightly textured
      vec3 moonDir = -sunDir;
      float moonDot = dot(d, moonDir);
      float mdisc = smoothstep(0.99955, 0.99985, moonDot);
      if (mdisc > 0.0) {
        float crater = hash13(floor(d * 700.0)) * 0.3;
        col += (vec3(0.86, 0.9, 1.0) - crater) * mdisc * 1.6 * nightF;
      }
      col += vec3(0.7, 0.78, 0.95) * pow(clamp(moonDot, 0.0, 1.0), 350.0) * 0.5 * nightF;

      // stars: stable cell hash, fade in at night, fade near horizon
      if (nightF > 0.01 && elev > 0.0) {
        vec3 cell = floor(d * 110.0);
        float star = hash13(cell);
        if (star > 0.985) {
          vec3 cc = (cell + 0.5) / 110.0;
          float dist = length(d - normalize(cc));
          float spark = smoothstep(0.004, 0.0005, dist);
          float tw = 0.7 + 0.3 * hash13(cell + floor(sunDir * 50.0));
          col += vec3(0.9, 0.93, 1.0) * spark * tw * nightF * smoothstep(0.0, 0.18, elev) * (star - 0.985) * 130.0;
        }
      }
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

// time-of-day palette stops: [t, zenith, horizon, sun, sunIntensity, ambient]
function lerpColor(a, b, t, out) { return out.copy(a).lerp(b, t); }

const C = (hex) => new THREE.Color(hex);
const STOPS = [
  // t (0=midnight, .25 sunrise, .5 noon, .75 sunset)
  { t: 0.00, zen: C(0x060a18), hor: C(0x0b1226), sun: C(0x223355), sunI: 0.0, amb: 0.32, fog: C(0x0a0f1f) },
  { t: 0.21, zen: C(0x0a1230), hor: C(0x27264a), sun: C(0xff9955), sunI: 0.0, amb: 0.34, fog: C(0x1b1c38) },
  { t: 0.25, zen: C(0x3f5e9e), hor: C(0xffac6e), sun: C(0xffb070), sunI: 1.6, amb: 0.55, fog: C(0xe8a878) },
  { t: 0.32, zen: C(0x4a7ad1), hor: C(0xa6c6e6), sun: C(0xffe7c4), sunI: 2.5, amb: 0.85, fog: C(0xa6c6e6) },
  { t: 0.50, zen: C(0x3a72d9), hor: C(0xaccfec), sun: C(0xfff5e0), sunI: 2.9, amb: 1.0, fog: C(0xaccfec) },
  { t: 0.68, zen: C(0x4a73c4), hor: C(0xb5b6d6), sun: C(0xffe0b0), sunI: 2.4, amb: 0.85, fog: C(0xb1a9cc) },
  { t: 0.75, zen: C(0x35436e), hor: C(0xff8e4d), sun: C(0xff7e3e), sunI: 1.4, amb: 0.5, fog: C(0xd98a5e) },
  { t: 0.79, zen: C(0x101736), hor: C(0x4a3158), sun: C(0xcc5533), sunI: 0.0, amb: 0.36, fog: C(0x281f3a) },
  { t: 1.00, zen: C(0x060a18), hor: C(0x0b1226), sun: C(0x223355), sunI: 0.0, amb: 0.32, fog: C(0x0a0f1f) },
];

export class SkySystem {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.time = 0.34; // morning start

    this.skyMat = new THREE.ShaderMaterial({
      ...SKY_SHADER,
      uniforms: THREE.UniformsUtils.clone(SKY_SHADER.uniforms),
      side: THREE.BackSide, depthWrite: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), this.skyMat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    scene.add(this.dome);

    // clouds: two drifting translucent noise planes
    this.cloudTex = makeCloudTexture();
    this.clouds = [];
    for (let i = 0; i < 2; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.cloudTex, transparent: true, depthWrite: false,
        opacity: 0.62 - i * 0.2, fog: false, side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.y = 120 + i * 22;
      m.renderOrder = -5;
      m.frustumCulled = false;
      scene.add(m);
      this.clouds.push(m);
    }

    // lighting rig
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 320;
    const ext = 88;
    this.sun.shadow.camera.left = -ext;
    this.sun.shadow.camera.right = ext;
    this.sun.shadow.camera.top = ext;
    this.sun.shadow.camera.bottom = -ext;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.06;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbcd3e8, 0x6a5a44, 1);
    scene.add(this.hemi);

    const fogDist = RENDER_DIST * CHUNK;
    scene.fog = new THREE.Fog(0xc3dcf0, fogDist * 0.62, fogDist * 1.06);
    this.baseFogNear = fogDist * 0.62;
    this.baseFogFar = fogDist * 1.06;
    this.underwater = false;

    // PMREM environment from a mini sky scene
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envMat = this.skyMat.clone();
    this.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 16, 8), this.envMat));
    this.envRT = null;
    this.lastEnvTime = -1;

    this.tmp = { zen: new THREE.Color(), hor: new THREE.Color(), sun: new THREE.Color(), fog: new THREE.Color() };
  }

  palette(t) {
    let a = STOPS[0], b = STOPS[STOPS.length - 1];
    for (let i = 0; i < STOPS.length - 1; i++) {
      if (t >= STOPS[i].t && t <= STOPS[i + 1].t) { a = STOPS[i]; b = STOPS[i + 1]; break; }
    }
    const f = (t - a.t) / Math.max(1e-5, b.t - a.t);
    const o = this.tmp;
    lerpColor(a.zen, b.zen, f, o.zen);
    lerpColor(a.hor, b.hor, f, o.hor);
    lerpColor(a.sun, b.sun, f, o.sun);
    lerpColor(a.fog, b.fog, f, o.fog);
    o.sunI = a.sunI + (b.sunI - a.sunI) * f;
    o.amb = a.amb + (b.amb - a.amb) * f;
    return o;
  }

  sunDirection(t, out) {
    const theta = (t - 0.25) * Math.PI * 2; // 0.25 = sunrise at horizon
    out.set(Math.cos(theta), Math.sin(theta), 0.0);
    // tilt the orbital plane so noon shadows have direction
    const tilt = 0.42;
    const y = out.y * Math.cos(tilt);
    out.z = out.y * Math.sin(tilt);
    out.y = y;
    return out.normalize();
  }

  update(dt, playerPos, frozen = false) {
    if (!frozen) {
      const isDay = this.time >= DAY_LO && this.time < DAY_HI;
      this.time = (this.time + dt * (isDay ? DAY_RATE : NIGHT_RATE)) % 1;
    }
    const t = this.time;
    const pal = this.palette(t);
    const sunDir = this.sunDirection(t, new THREE.Vector3());
    const dayF = THREE.MathUtils.smoothstep(sunDir.y, -0.08, 0.12);
    const nightF = 1 - dayF;
    const duskF = Math.max(0, 1 - Math.abs(sunDir.y) * 5) * dayF;

    // sky dome
    const u = this.skyMat.uniforms;
    u.sunDir.value.copy(sunDir);
    u.zenithCol.value.copy(pal.zen);
    u.horizonCol.value.copy(pal.hor);
    u.sunCol.value.copy(pal.sun);
    u.nightF.value = nightF;
    u.duskF.value = duskF;
    this.dome.position.copy(playerPos);

    // sun / moon light
    const lightDir = dayF > 0.02 ? sunDir : sunDir.clone().negate();
    this.sun.position.copy(playerPos).addScaledVector(lightDir, 180);
    this.sun.target.position.copy(playerPos);
    // snap shadow camera to texel grid to avoid shimmer
    const texel = (88 * 2) / 2048;
    this.sun.target.position.x = Math.round(this.sun.target.position.x / texel) * texel;
    this.sun.target.position.z = Math.round(this.sun.target.position.z / texel) * texel;
    if (dayF > 0.02) {
      this.sun.color.copy(pal.sun);
      this.sun.intensity = pal.sunI;
    } else {
      this.sun.color.set(0x9db1e8);
      this.sun.intensity = 0.62;
    }

    // ambient hemisphere follows sky; cool moonlit floor at night
    this.hemi.color.copy(pal.zen).lerp(pal.hor, 0.45)
      .lerp(new THREE.Color(0x44608f), nightF * 0.9);
    this.hemi.groundColor.copy(pal.fog).multiplyScalar(0.4).lerp(new THREE.Color(0x47402f), 0.5)
      .lerp(new THREE.Color(0x2a3a55), nightF * 0.8);
    this.hemi.intensity = 0.5 + pal.amb * 0.75 + nightF * 0.45;

    // fog matches horizon; underwater swaps to dense deep blue
    if (this.underwater) {
      this.scene.fog.color.set(0x0a3157).lerp(pal.fog, dayF * 0.15);
      this.scene.fog.near = 1.5;
      this.scene.fog.far = 26;
    } else {
      this.scene.fog.color.copy(pal.fog);
      this.scene.fog.near = this.baseFogNear;
      this.scene.fog.far = this.baseFogFar;
    }

    // clouds drift, tinted by daylight
    for (let i = 0; i < this.clouds.length; i++) {
      const c = this.clouds[i];
      c.position.x = playerPos.x;
      c.position.z = playerPos.z;
      const off = c.material.map.offset;
      off.x += dt * (0.0018 + i * 0.0011);
      off.y += dt * 0.0007;
      c.material.color.copy(pal.sun).lerp(new THREE.Color(0xffffff), 0.55).multiplyScalar(0.5 + dayF * 0.62);
      c.material.opacity = (0.62 - i * 0.2) * (0.3 + dayF * 0.7);
    }

    // refresh PMREM environment when sky has moved enough
    if (this.lastEnvTime < 0 || Math.abs(t - this.lastEnvTime) > 0.012) {
      this.lastEnvTime = t;
      const eu = this.envMat.uniforms;
      eu.sunDir.value.copy(sunDir);
      eu.zenithCol.value.copy(pal.zen);
      eu.horizonCol.value.copy(pal.hor);
      eu.sunCol.value.copy(pal.sun);
      eu.nightF.value = nightF;
      eu.duskF.value = duskF;
      const old = this.envRT;
      this.envRT = this.pmrem.fromScene(this.envScene, 0.06);
      this.scene.environment = this.envRT.texture;
      this.scene.environmentIntensity = 0.25 + pal.amb * 0.55;
      old?.dispose();
    }
    return { dayF, nightF, pal, sunDir };
  }

  setUnderwater(on) {
    this.underwater = on;
  }
}

function makeCloudTexture() {
  const S = 512;
  const canvas = document.createElement('canvas');
  canvas.width = S; canvas.height = S;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(S, S);
  // layered wrap-around value noise -> soft cumulus blobs
  const rnd = [];
  for (let o = 0; o < 4; o++) {
    const res = 8 << o;
    const grid = new Float32Array(res * res);
    for (let i = 0; i < res * res; i++) grid[i] = Math.sin(i * 127.1 + o * 311.7) * 43758.5453 % 1;
    rnd.push({ res, grid: grid.map((v) => Math.abs(v)) });
  }
  const sample = (layer, x, y) => {
    const { res, grid } = rnd[layer];
    const fx = (x / S) * res, fy = (y / S) * res;
    const x0 = Math.floor(fx) % res, y0 = Math.floor(fy) % res;
    const x1 = (x0 + 1) % res, y1 = (y0 + 1) % res;
    const tx = fx - Math.floor(fx), ty = fy - Math.floor(fy);
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    return (grid[y0 * res + x0] * (1 - sx) + grid[y0 * res + x1] * sx) * (1 - sy)
      + (grid[y1 * res + x0] * (1 - sx) + grid[y1 * res + x1] * sx) * sy;
  };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let v = 0, amp = 1, norm = 0;
      for (let o = 0; o < 4; o++) { v += sample(o, x, y) * amp; norm += amp; amp *= 0.55; }
      v /= norm;
      // distinct cumulus blobs with soft edges, clear sky between them
      const t = Math.min(1, Math.max(0, (v - 0.54) / 0.16));
      const a = t * t * (3 - 2 * t);
      const i = (y * S + x) * 4;
      img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 255;
      img.data[i + 3] = Math.min(255, a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  return tex;
}
