// Thin wrapper over the HUD DOM declared in index.html.
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export class UI {
  hud = $('hud');
  private promptEl = $('prompt');
  private panelEl = $('panel');
  private scoreEl = $('score');
  private countdownEl = $('countdown');
  private rideExitEl = $('ride-exit');
  private promptKey = '';
  private panelKey = '';
  onPromptClick: (() => void) | null = null;
  onPanelClose: (() => void) | null = null;
  onRideExit: (() => void) | null = null;

  constructor(private mobile: boolean) {
    this.promptEl.addEventListener('click', () => this.onPromptClick?.());
    this.rideExitEl.querySelector('button')!.addEventListener('click', () => this.onRideExit?.());
    // transient badges dismiss on click too
    this.scoreEl.addEventListener('click', () => (this.scoreEl.hidden = true));
    $('rh-toast').addEventListener('click', (e) => ((e.currentTarget as HTMLElement).hidden = true));
    this.panelEl.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-panel-close]')) {
        this.hidePanel();
        this.onPanelClose?.();
      }
    });
  }

  prompt(key: string, title: string, action: string) {
    if (this.promptKey === key) return;
    this.promptKey = key;
    if (!key) {
      this.promptEl.hidden = true;
      return;
    }
    const k = this.mobile ? 'Tap <kbd>E</kbd>' : 'Press <kbd>E</kbd>';
    this.promptEl.innerHTML = `${escapeHtml(title)}<small>${k} · ${escapeHtml(action)}</small>`;
    this.promptEl.hidden = false;
  }

  /** Shows an info card. `key` avoids re-rendering identical content every frame. */
  panel(key: string, html: string, opts: { left?: boolean; accent?: string } = {}) {
    if (this.panelKey === key && !this.panelEl.hidden) return;
    this.panelKey = key;
    this.panelEl.innerHTML =
      '<button class="close" type="button" data-panel-close aria-label="Close" title="Close (Esc)">✕</button>' + html;
    this.panelEl.classList.toggle('panel-left', !!opts.left);
    this.panelEl.style.borderTopColor = opts.accent ?? '';
    this.panelEl.hidden = false;
    // restart entry animation
    this.panelEl.style.animation = 'none';
    void this.panelEl.offsetWidth;
    this.panelEl.style.animation = '';
  }

  get panelElement() {
    return this.panelEl;
  }

  get panelOpenKey() {
    return this.panelEl.hidden ? '' : this.panelKey;
  }

  hidePanel() {
    this.panelEl.hidden = true;
    this.panelKey = '';
  }

  score(text: string | null) {
    if (text === null) {
      this.scoreEl.hidden = true;
      return;
    }
    this.scoreEl.textContent = text;
    this.scoreEl.hidden = false;
  }

  countdown(text: string | null) {
    if (text === null) {
      this.countdownEl.hidden = true;
      return;
    }
    this.countdownEl.textContent = text;
    this.countdownEl.hidden = false;
    this.countdownEl.classList.remove('pop');
    void this.countdownEl.offsetWidth;
    this.countdownEl.classList.add('pop');
  }

  rideExit(show: boolean) {
    this.rideExitEl.hidden = !show;
  }

  /** Hide driving-only chrome during rides. */
  cinematic(on: boolean) {
    document.body.classList.toggle('is-cinematic', on);
  }
}
