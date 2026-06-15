// Mobile/touch controls — active ONLY on coarse-pointer (touch) devices.
// On desktop nothing is created and nothing changes. Uses no Pointer Lock, so
// it works on iPad/iPhone Safari where Pointer Lock is unavailable:
//   left half  = movement joystick (dynamic origin)
//   right half = drag to look
//   buttons    = break (hold) / place (hold) / jump (hold) / fly (toggle)
//   hotbar     = tap a slot to select a block
import { HOTBAR } from './blocks.js';

export function isTouchDevice() {
  return (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches)
    || ('ontouchstart' in window)
    || ((navigator.maxTouchPoints || 0) > 0);
}

const STYLE = `
html.touch, html.touch body { touch-action: none; overscroll-behavior: none; }
#tc { position: fixed; inset: 0; z-index: 30; touch-action: none;
  -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent; }
#tc .ctrls { position: absolute; inset: 0; opacity: 0; transition: opacity .25s; pointer-events: none; }
#tc.started .ctrls { opacity: 1; }
#tc .btn { position: absolute; pointer-events: auto; border-radius: 50%; color: #fff;
  background: rgba(18,22,30,.42); border: 2px solid rgba(255,255,255,.22);
  display: flex; align-items: center; justify-content: center;
  font: 700 12px/1 system-ui, sans-serif; letter-spacing: .3px;
  -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); }
#tc .btn.press { background: rgba(255,232,180,.34); border-color: rgba(255,228,165,.95); }
#tc .btn.on { background: rgba(150,230,160,.32); border-color: rgba(150,230,160,.95); }
#tc .break { width: 68px; height: 68px; right: 104px; bottom: 108px; }
#tc .place { width: 60px; height: 60px; right: 24px; bottom: 140px; }
#tc .jump  { width: 76px; height: 76px; right: 26px; bottom: 30px; }
#tc .fly   { width: 50px; height: 50px; right: 120px; bottom: 36px; font-size: 11px; }
#tc .joy { position: absolute; width: 124px; height: 124px; border-radius: 50%; display: none;
  border: 2px solid rgba(255,255,255,.18); background: rgba(18,22,30,.26); }
#tc .knob { position: absolute; left: 50%; top: 50%; width: 56px; height: 56px; border-radius: 50%;
  background: rgba(255,255,255,.34); transform: translate(-50%, -50%); }
html.touch #hotbar { z-index: 40; bottom: 20px; }
html.touch #hotbar .slot { pointer-events: auto; width: 50px; height: 50px; }
html.touch #hotbar .slot canvas { width: 36px; height: 36px; }
`;

export class TouchControls {
  constructor(player, interact) {
    this.player = player;
    this.interact = interact;
    if (!isTouchDevice()) return;        // desktop: do nothing
    player.isTouch = true;
    document.documentElement.classList.add('touch');
    this.started = false;
    this.joyId = null;
    this.lookId = null;
    this.joyBase = { x: 0, y: 0 };
    this.lookLast = { x: 0, y: 0 };
    this._build();
    this._wire();
    this._setHint();
  }

  _build() {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.id = 'tc';
    const ctrls = document.createElement('div');
    ctrls.className = 'ctrls';
    const mk = (cls, txt) => {
      const b = document.createElement('div');
      b.className = 'btn ' + cls;
      b.textContent = txt;
      return b;
    };
    this.joy = document.createElement('div');
    this.joy.className = 'joy';
    this.knob = document.createElement('div');
    this.knob.className = 'knob';
    this.joy.appendChild(this.knob);
    this.bBreak = mk('break', 'BREAK');
    this.bPlace = mk('place', 'PLACE');
    this.bJump = mk('jump', 'JUMP');
    this.bFly = mk('fly', 'FLY');
    ctrls.append(this.joy, this.bBreak, this.bPlace, this.bJump, this.bFly);
    root.appendChild(ctrls);
    document.body.appendChild(root);
    this.root = root;
  }

  _hold(el, on) {
    const f = (v) => (e) => { e.preventDefault(); e.stopPropagation(); el.classList.toggle('press', v); on(v); };
    el.addEventListener('touchstart', f(true), { passive: false });
    el.addEventListener('touchend', f(false), { passive: false });
    el.addEventListener('touchcancel', f(false), { passive: false });
  }

  _tap(el, fn) {
    el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add('press'); }, { passive: false });
    el.addEventListener('touchend', (e) => { e.preventDefault(); e.stopPropagation(); el.classList.remove('press'); fn(); }, { passive: false });
  }

  _wire() {
    this._hold(this.bBreak, (v) => { if (v) this.interact.buttons |= 1; else this.interact.buttons &= ~1; });
    this._hold(this.bPlace, (v) => { if (v) this.interact.buttons |= 4; else this.interact.buttons &= ~4; });
    this._hold(this.bJump, (v) => { this.player.touchJump = v; });
    this._tap(this.bFly, () => { const on = this.player.toggleFly(); this.bFly.classList.toggle('on', on); });

    document.querySelectorAll('#hotbar .slot').forEach((el, i) => {
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); this.interact.selectSlot(i); });
    });

    const r = this.root;
    r.addEventListener('touchstart', (e) => this._start(e), { passive: false });
    r.addEventListener('touchmove', (e) => this._move(e), { passive: false });
    r.addEventListener('touchend', (e) => this._end(e), { passive: false });
    r.addEventListener('touchcancel', (e) => this._end(e), { passive: false });
  }

  _begin() {
    this.started = true;
    this.player.touchActive = true;
    this.root.classList.add('started');
    const hint = document.getElementById('hint'); if (hint) hint.style.display = 'none';
    const cr = document.getElementById('crosshair'); if (cr) cr.style.display = '';
  }

  _start(e) {
    e.preventDefault();
    if (!this.started) { this._begin(); return; }   // first tap starts the game
    const half = window.innerWidth * 0.5;
    for (const t of e.changedTouches) {
      if (t.clientX < half && this.joyId === null) {
        this.joyId = t.identifier;
        this.joyBase = { x: t.clientX, y: t.clientY };
        this.joy.style.display = 'block';
        this.joy.style.left = (t.clientX - 62) + 'px';
        this.joy.style.top = (t.clientY - 62) + 'px';
        this._knob(0, 0);
      } else if (this.lookId === null) {
        this.lookId = t.identifier;
        this.lookLast = { x: t.clientX, y: t.clientY };
      }
    }
  }

  _move(e) {
    if (!this.started) return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === this.joyId) {
        let dx = t.clientX - this.joyBase.x, dy = t.clientY - this.joyBase.y;
        const max = 56, len = Math.hypot(dx, dy);
        if (len > max) { dx = dx / len * max; dy = dy / len * max; }
        this._knob(dx, dy);
        this.player.touchMove.s = dx / max;     // strafe
        this.player.touchMove.f = -dy / max;    // forward
      } else if (t.identifier === this.lookId) {
        this.player.addLook(t.clientX - this.lookLast.x, t.clientY - this.lookLast.y);
        this.lookLast = { x: t.clientX, y: t.clientY };
      }
    }
  }

  _end(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === this.joyId) {
        this.joyId = null;
        this.joy.style.display = 'none';
        this.player.touchMove.f = 0;
        this.player.touchMove.s = 0;
      } else if (t.identifier === this.lookId) {
        this.lookId = null;
      }
    }
  }

  _knob(dx, dy) {
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  _setHint() {
    const hint = document.getElementById('hint');
    if (!hint) return;
    hint.innerHTML = '<b>Voxelscape</b><br>탭하여 시작 / Tap to play<br>'
      + '<span style="font-size:13px;opacity:0.85">왼쪽 드래그: 이동 · 오른쪽 드래그: 시점<br>'
      + 'BREAK 부수기 · PLACE 놓기 · JUMP 점프 · 핫바 탭으로 블록 선택</span>';
  }
}
