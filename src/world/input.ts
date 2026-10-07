// Keyboard + touch joystick, normalised into one input state.
export class Input {
  throttle = 0; // -1..1
  steer = 0; // -1..1 (positive = left)
  boost = false;
  lift = 0; // -1..1: climb / descend (the drone)
  private touchLift = 0;
  private keys = new Set<string>();
  private stick = { x: 0, y: 0, active: false };
  private handlers: Record<string, (() => void)[]> = {};

  constructor(private touchEls: { stick: HTMLElement; knob: HTMLElement; action: HTMLElement; lift: HTMLElement }) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    this.setupStick();
    touchEls.action.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.emit('action');
    });
    // the drone's ▲ / ▼ buttons: held down to climb or descend
    touchEls.lift.querySelectorAll<HTMLElement>('[data-lift]').forEach((b) => {
      const dir = Number(b.dataset.lift);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        this.touchLift = dir;
      });
      const end = () => this.touchLift === dir && (this.touchLift = 0);
      b.addEventListener('pointerup', end);
      b.addEventListener('pointercancel', end);
    });
  }

  on(evt: 'action' | 'roll' | 'kick' | 'reset' | 'honk' | 'escape' | 'camera' | 'any', fn: () => void) {
    (this.handlers[evt] ??= []).push(fn);
  }

  private emit(evt: string) {
    this.handlers[evt]?.forEach((f) => f());
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    // typing into a form field or using the time panel isn't playing the game
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.closest?.('.time-panel, #clock'))) return;
    const driving = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyZ', 'KeyQ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];
    if (driving.includes(e.code)) e.preventDefault();
    if (e.repeat) {
      this.keys.add(e.code);
      return;
    }
    this.keys.add(e.code);
    this.emit('any');
    if (e.code === 'KeyE' || e.code === 'Enter') {
      // Enter on a focused button should press the button, not the game.
      if (e.code === 'Enter' && target?.tagName === 'BUTTON') return;
      this.emit('action');
    }
    if (e.code === 'Space') this.emit('roll');
    if (e.code === 'KeyF') this.emit('kick');
    if (e.code === 'KeyR') this.emit('reset');
    if (e.code === 'KeyH') this.emit('honk');
    if (e.code === 'KeyC') this.emit('camera');
    if (e.code === 'Escape') this.emit('escape');
  };

  private setupStick() {
    const { stick, knob } = this.touchEls;
    let id = -1;
    const move = (e: PointerEvent) => {
      const r = stick.getBoundingClientRect();
      const max = r.width / 2;
      let x = e.clientX - (r.left + max);
      let y = e.clientY - (r.top + max);
      const len = Math.hypot(x, y);
      if (len > max) {
        x = (x / len) * max;
        y = (y / len) * max;
      }
      knob.style.transform = `translate(${x}px, ${y}px)`;
      this.stick.x = x / max;
      this.stick.y = y / max;
    };
    stick.addEventListener('pointerdown', (e) => {
      id = e.pointerId;
      stick.setPointerCapture(id);
      this.stick.active = true;
      move(e);
      this.emit('any');
    });
    stick.addEventListener('pointermove', (e) => e.pointerId === id && move(e));
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = -1;
      this.stick = { x: 0, y: 0, active: false };
      knob.style.transform = '';
    };
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);
  }

  update() {
    const k = this.keys;
    let t = 0;
    let s = 0;
    if (k.has('KeyW') || k.has('KeyZ') || k.has('ArrowUp')) t += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) t -= 1;
    if (k.has('KeyA') || k.has('KeyQ') || k.has('ArrowLeft')) s += 1;
    if (k.has('KeyD') || k.has('ArrowRight')) s -= 1;
    this.boost = k.has('ShiftLeft') || k.has('ShiftRight');
    let l = 0;
    if (k.has('Space') || k.has('PageUp')) l += 1;
    if (k.has('KeyX') || k.has('PageDown')) l -= 1;
    this.lift = this.touchLift || l;

    if (this.stick.active) {
      // Up = throttle, sideways = steer (behaves like the keyboard).
      const mag = Math.hypot(this.stick.x, this.stick.y);
      t = mag > 0.15 ? -this.stick.y : 0;
      s = Math.abs(this.stick.x) > 0.15 ? -this.stick.x : 0;
      this.boost = mag > 0.95;
    }
    this.throttle = t;
    this.steer = s;
  }

  get pressingAny() {
    return this.keys.size > 0 || this.stick.active;
  }
}
