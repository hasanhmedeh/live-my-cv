import { ApiError, ATTRACTION_IDS } from './api';
import { authDialog } from './auth-dialog';
import { formatWait, session } from './session';
import { ZONES } from '../world/layout';
import { escapeHtml } from '../world/ui';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The HUD account chip. Guests get a shortcut to sign up; members see their tickets on the chip
 * and open a small card with their rounds, a copy of their data, the way to delete the account
 * and a log-out button (it shares the graphics panel's look and behaviour).
 */
export class AccountMenu {
  private chip = document.getElementById('account-chip') as HTMLButtonElement;
  private panel = document.getElementById('account-panel')!;
  private nameEl = this.panel.querySelector<HTMLElement>('.account-name')!;
  private ticketsEl = this.panel.querySelector<HTMLElement>('.account-tickets')!;
  private ridesEl = this.panel.querySelector<HTMLElement>('.account-rides')!;
  private listEl = this.panel.querySelector<HTMLElement>('.account-list')!;
  private noteEl = this.panel.querySelector<HTMLElement>('.account-note')!;
  private logoutBtn = this.panel.querySelector<HTMLButtonElement>('[data-account-logout]')!;
  private exportBtn = this.panel.querySelector<HTMLButtonElement>('[data-account-export]')!;
  private deleteLink = this.panel.querySelector<HTMLButtonElement>('[data-account-delete]')!;
  private deleteForm = this.panel.querySelector<HTMLFormElement>('.account-delete')!;
  private deleteInput = this.deleteForm.querySelector<HTMLInputElement>('input')!;
  private deleteError = this.deleteForm.querySelector<HTMLElement>('.account-delete-error')!;
  private deleteBtn = this.deleteForm.querySelector<HTMLButtonElement>('[type="submit"]')!;
  private statsFailed = false;
  private busy = false;

  /** `notify` puts a message on the game's card (e.g. once the account is gone). */
  constructor(private notify: (title: string, text: string) => void = () => {}) {
    this.chip.addEventListener('click', (e) => {
      e.stopPropagation();
      if (session.user) this.toggle();
      else void authDialog.open('signup');
    });
    this.panel.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => this.toggle(false));
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || this.panel.hidden || this.busy) return;
      const inside = this.panel.contains(document.activeElement);
      this.toggle(false);
      if (inside) this.chip.focus({ preventScroll: true });
    });
    this.logoutBtn.addEventListener('click', async () => {
      this.logoutBtn.disabled = true;
      this.logoutBtn.textContent = 'Logging out…';
      await session.logout();
      this.logoutBtn.disabled = false;
      this.logoutBtn.textContent = 'Log out';
    });
    this.exportBtn.addEventListener('click', () => void this.download());
    this.deleteLink.addEventListener('click', () => this.askDelete(true));
    this.deleteForm.querySelector('[data-account-delete-cancel]')!.addEventListener('click', () => this.askDelete(false));
    this.deleteForm.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.deleteAccount();
    });
    this.deleteInput.addEventListener('input', () => (this.deleteError.textContent = ''));
    session.onChange(() => this.render());
    // the countdown to the next pack ticks while the card is open
    setInterval(() => !this.panel.hidden && this.renderTickets(), 1000);
    this.render();
  }

  private toggle(open = this.panel.hidden) {
    if (open && !session.user) open = false;
    if (this.busy && !open) return;
    if (open === !this.panel.hidden) return;
    this.panel.hidden = !open;
    if (session.user) this.chip.setAttribute('aria-expanded', String(open));
    if (!open) {
      this.askDelete(false, false);
      this.note('');
      return;
    }
    // the card takes the focus so the game's keys (E, Esc) don't fire while it's open
    this.panel.focus({ preventScroll: true });
    this.statsFailed = false;
    this.renderStats();
    void session.loadTickets();
    void session.loadStats().then((stats) => {
      if (stats || session.stats) return;
      this.statsFailed = true;
      this.renderStats();
    });
  }

  private render() {
    const user = session.user;
    if (user) {
      // the name drops out on narrow screens, like the other pills' labels (it's in the card)
      const balance = session.balance;
      this.chip.innerHTML = `👤 <span>${escapeHtml(user.username)}${balance === null ? '' : ' · '}</span>${balance === null ? '' : `🎟️ ${balance}`}`;
      this.chip.title = `Signed in as ${user.username}${balance === null ? '' : ` · ${plural(balance, 'ticket', 'tickets')}`}`;
      this.chip.setAttribute('aria-label', `Your account: ${user.username}${balance === null ? '' : `, ${plural(balance, 'ticket', 'tickets')}`}`);
      this.chip.setAttribute('aria-haspopup', 'true');
      this.chip.setAttribute('aria-controls', 'account-panel');
      this.chip.setAttribute('aria-expanded', String(!this.panel.hidden));
      this.nameEl.textContent = user.username;
      this.renderTickets();
      this.renderStats();
    } else {
      this.busy = false;
      this.toggle(false);
      // "Guest ·" drops out on narrow screens, like the other pills' labels
      this.chip.innerHTML = '👤 <span>Guest · </span>Sign up';
      this.chip.title = 'Sign up for a free account and free tickets';
      this.chip.setAttribute('aria-label', 'Guest: sign up for free tickets');
      this.chip.setAttribute('aria-haspopup', 'dialog');
      this.chip.removeAttribute('aria-controls');
      this.chip.removeAttribute('aria-expanded');
    }
  }

  private renderTickets() {
    if (this.panel.hidden) return;
    const t = session.tickets;
    if (!t) {
      this.ticketsEl.textContent = 'Counting your tickets…';
      return;
    }
    const wait = session.msUntilPurchase() ?? 0;
    const next = wait > 0 ? `next free pack in ${formatWait(wait)}` : 'a free pack is waiting at the Ticket Booth';
    this.ticketsEl.innerHTML = `🎟️ <strong>${plural(t.balance, 'ticket', 'tickets')}</strong> · ${next}`;
  }

  private renderStats() {
    if (this.panel.hidden) return;
    const stats = session.stats;
    this.ridesEl.textContent = stats
      ? stats.totalRounds
        ? `🎢 ${plural(stats.totalRounds, 'round', 'rounds')} played · ${plural(stats.ticketsSpent, 'ticket', 'tickets')} spent`
        : '🎢 No rounds yet: pick an attraction!'
      : this.statsFailed
        ? 'Your rounds are unavailable right now.'
        : 'Counting your rounds…';
    const byRide = stats?.byRide;
    const rows = byRide ? ATTRACTION_IDS.filter((id) => byRide[id]?.rounds > 0).sort((a, b) => byRide[b].rounds - byRide[a].rounds) : [];
    this.listEl.innerHTML = rows.map((id) => `<li><span>${escapeHtml(ZONES[id].title)}</span><b>${byRide![id].rounds}</b></li>`).join('');
    this.listEl.hidden = !rows.length;
  }

  private note(text: string) {
    this.noteEl.textContent = text;
    this.noteEl.hidden = !text;
  }

  /** Saves everything the fair keeps about the member as a JSON file. */
  private async download() {
    this.exportBtn.disabled = true;
    this.note('Gathering your data…');
    try {
      const data = await session.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'funfair-data.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.note('Saved as funfair-data.json.');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) session.expire();
      this.note(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      this.exportBtn.disabled = false;
    }
  }

  /** Shows (or hides) the "are you sure? enter your password" step. */
  private askDelete(show: boolean, focus = true) {
    if (this.busy) return;
    this.deleteForm.hidden = !show;
    this.deleteLink.setAttribute('aria-expanded', String(show));
    this.deleteForm.reset();
    this.deleteError.textContent = '';
    this.deleteInput.removeAttribute('aria-invalid');
    if (!focus) return;
    if (show) this.deleteInput.focus();
    else this.deleteLink.focus({ preventScroll: true });
  }

  private async deleteAccount() {
    if (this.busy) return;
    const password = this.deleteInput.value;
    if (!password) {
      this.deleteError.textContent = 'Enter your password to confirm.';
      this.deleteInput.setAttribute('aria-invalid', 'true');
      this.deleteInput.focus();
      return;
    }
    const name = session.user?.username ?? '';
    this.busy = true;
    this.deleteBtn.disabled = true;
    this.deleteBtn.textContent = 'Deleting…';
    this.deleteInput.readOnly = true;
    try {
      await session.deleteAccount(password);
      this.busy = false;
      // the session is a guest's now, which closes this card
      this.chip.focus({ preventScroll: true });
      this.notify('Account deleted', `Goodbye${name ? `, ${name}` : ''}: your account, tickets and ride history are gone for good. You can keep exploring the fair as a guest.`);
    } catch (err) {
      this.busy = false;
      // a 401 here is the password being wrong (the server says so); anything else is shown as is
      const wrong = err instanceof ApiError && err.status === 401 && /password/i.test(err.message);
      if (err instanceof ApiError && err.status === 401 && !wrong) {
        session.expire();
        return;
      }
      this.deleteError.textContent = wrong ? 'That password isn’t right.' : err instanceof ApiError ? err.message : 'Something went wrong. Please try again.';
      this.deleteInput.setAttribute('aria-invalid', 'true');
      this.deleteInput.focus();
      this.deleteInput.select();
    } finally {
      this.deleteBtn.disabled = false;
      this.deleteBtn.textContent = 'Delete for good';
      this.deleteInput.readOnly = false;
    }
  }
}
