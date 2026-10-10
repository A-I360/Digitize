/**
 * Aether Drift — input.
 *
 * Three sources feed the same shape: keyboard, on-screen touch controls, and
 * (for online play) nothing at all — remote players are driven by the network.
 *
 * The game only listens while it is running, and it swallows the keys that
 * would otherwise scroll the page, so playing never fights the browser.
 */

export const SCHEMES = {
  p1: { left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'],
        jump: ['ArrowUp', 'KeyW', 'Space'], down: ['ArrowDown', 'KeyS'] },
  p2: { left: ['KeyJ'], right: ['KeyL'], jump: ['KeyI'], down: ['KeyK'] },
};

/** Keys the game owns — prevented from their default browser behaviour. */
const CAPTURED = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space',
  'KeyA', 'KeyD', 'KeyW', 'KeyS', 'KeyI', 'KeyJ', 'KeyK', 'KeyL',
]);

export class Keyboard {
  constructor(target = window) {
    this.down = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.enabled = false;

    this.onKeyDown = (e) => {
      if (!this.enabled) return;
      if (e.repeat) return;
      // Never steal keys while the visitor is typing somewhere else.
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      if (CAPTURED.has(e.code)) e.preventDefault();
      this.down.add(e.code);
      this.pressed.add(e.code);
    };
    this.onKeyUp = (e) => {
      if (!this.enabled) return;
      this.down.delete(e.code);
      this.released.add(e.code);
    };
    this.onBlur = () => { this.down.clear(); };

    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    this.target = target;
  }

  isDown(code) { return this.down.has(code); }
  wasPressed(code) { return this.pressed.has(code); }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
  }

  destroy() {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }
}

/** On-screen touch controls, driven by DOM buttons with data-touch attributes. */
export class TouchPad {
  constructor(root) {
    this.state = { left: false, right: false, jump: false, jumpPressed: false, down: false };
    this.handlers = [];
    if (!root) return;

    root.querySelectorAll('[data-touch]').forEach((btn) => {
      const action = btn.dataset.touch;
      const set = (on) => (e) => {
        e.preventDefault();
        if (on && action === 'jump' && !this.state.jump) this.state.jumpPressed = true;
        this.state[action] = on;
        btn.classList.toggle('is-active', on);
      };
      const onDown = set(true);
      const onUp = set(false);
      btn.addEventListener('pointerdown', onDown);
      btn.addEventListener('pointerup', onUp);
      btn.addEventListener('pointercancel', onUp);
      btn.addEventListener('pointerleave', onUp);
      this.handlers.push([btn, 'pointerdown', onDown], [btn, 'pointerup', onUp],
                         [btn, 'pointercancel', onUp], [btn, 'pointerleave', onUp]);
    });
  }

  endFrame() { this.state.jumpPressed = false; }

  destroy() {
    this.handlers.forEach(([el, type, fn]) => el.removeEventListener(type, fn));
    this.handlers = [];
  }
}

/** Merges the sources for one player into a single snapshot. */
export class PlayerInput {
  constructor(scheme, { keyboard, touch } = {}) {
    this.scheme = scheme;
    this.keyboard = keyboard;
    this.touch = touch;
    this.state = { left: false, right: false, jumpHeld: false, jumpPressed: false, down: false };
  }

  any(list) {
    if (!this.keyboard) return false;
    return list.some((code) => this.keyboard.isDown(code));
  }
  anyPressed(list) {
    if (!this.keyboard) return false;
    return list.some((code) => this.keyboard.wasPressed(code));
  }

  read() {
    const s = this.state;
    const k = this.scheme;
    const left = this.any(k.left) || Boolean(this.touch?.state.left);
    const right = this.any(k.right) || Boolean(this.touch?.state.right);
    const jumpHeld = this.any(k.jump) || Boolean(this.touch?.state.jump);
    const jumpPressed = this.anyPressed(k.jump) || Boolean(this.touch?.state.jumpPressed);
    const down = this.any(k.down) || Boolean(this.touch?.state.down);

    s.left = left; s.right = right;
    s.jumpHeld = jumpHeld; s.jumpPressed = jumpPressed; s.down = down;
    return s;
  }
}

/** Serialises a set of touch-state bits so a phone can drive a remote player. */
export const EMPTY_INPUT = Object.freeze({
  left: false, right: false, jumpHeld: false, jumpPressed: false, down: false,
});
