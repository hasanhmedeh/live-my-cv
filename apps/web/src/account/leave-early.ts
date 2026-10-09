import { escapeHtml } from '../world/ui';

/**
 * "Leave before the end?" on a native <dialog> like the results screen: asked when the visitor
 * bails out of a round in progress (Esc, the exit button), since its tickets aren't given back.
 * Esc, the backdrop and "Keep going" all mean stay.
 */
class LeaveEarlyDialog {
  private el = document.getElementById('leave-early') as HTMLDialogElement;
  private body = this.el.querySelector<HTMLElement>('.leave-early-body')!;
  private resolve: ((leave: boolean) => void) | null = null;
  private leave = false;
  private shown = false;
  private toggles = new Set<(open: boolean) => void>();

  constructor() {
    this.body.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-leave]');
      if (b) this.close(b.dataset.leave === 'go');
    });
    let downOnBackdrop = false;
    this.el.addEventListener('pointerdown', (e) => (downOnBackdrop = e.target === this.el));
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el && downOnBackdrop) this.close(false);
    });
    this.el.addEventListener('close', () => this.onClosed());
  }

  get isOpen() {
    return this.el.open;
  }

  /** Called with true when the dialog opens and false when it closes (the game pauses its keys). */
  onToggle(fn: (open: boolean) => void) {
    this.toggles.add(fn);
  }

  /** Asks about leaving `title`'s round, which cost `tickets`. Resolves true to leave, false to stay. */
  ask(title: string, tickets: number, game: boolean): Promise<boolean> {
    if (this.el.open) this.close(false);
    this.leave = false;
    const cost = tickets === 1 ? 'its ticket' : `its ${tickets} tickets`;
    // a free round (a staff test) has nothing to lose but the rest of the round
    const lose = tickets > 0 ? `the round counts as used and ${cost} won't be refunded` : 'the round ends here';
    this.body.innerHTML = `<button type="button" class="auth-close" data-leave aria-label="Keep going" title="Keep going (Esc)">✕</button><p class="auth-kicker">${escapeHtml(
      title,
    )} · Round in progress</p><h2 id="leave-early-title">Leave before the end?</h2><p class="auth-lead" id="leave-early-lead">If you ${
      game ? 'stop now' : 'hop off now'
    }, ${lose}.</p><div class="results-actions"><button type="button" class="btn btn-primary" data-leave="stay">${
      game ? 'Keep playing' : 'Keep riding'
    }</button><button type="button" class="btn btn-outline" data-leave="go">Leave early</button></div>`;
    this.el.showModal();
    this.shown = true;
    this.body.querySelector<HTMLElement>('[data-leave="stay"]')?.focus();
    for (const fn of this.toggles) fn(true);
    return new Promise((r) => (this.resolve = r));
  }

  close(leave: boolean) {
    if (!this.el.open) return;
    this.leave = leave;
    this.el.close();
    this.onClosed();
  }

  /** Runs once per opening: from close(), or from the close event when Esc shut the dialog. */
  private onClosed() {
    if (!this.shown || this.el.open) return;
    this.shown = false;
    const resolve = this.resolve;
    this.resolve = null;
    for (const fn of this.toggles) fn(false);
    resolve?.(this.leave);
  }
}

export const leaveEarly = new LeaveEarlyDialog();
