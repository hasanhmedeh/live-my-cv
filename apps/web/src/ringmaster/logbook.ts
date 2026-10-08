// What staff changed, and when: the admin_actions table, in words.
import { isAttraction, ringmaster, type AdminAction } from '../account/api';
import { esc, onApiError, pagerHtml, rideName, when } from './util';

const LIMIT = 30;

export class LogbookView {
  private offset = 0;

  constructor(private el: HTMLElement) {
    el.addEventListener('click', (e) => {
      const page = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-page]');
      if (!page) return;
      this.offset = Number(page.dataset.page);
      void this.load();
    });
  }

  show() {
    void this.load();
  }

  private async load() {
    const head = `<div class="view-head"><div><h2 id="h-logbook">Logbook</h2><p class="muted">Every change made in this office (and by <code>pnpm staff:*</code>), newest first.</p></div></div>`;
    if (!this.el.querySelector('#log-body')) this.el.innerHTML = `${head}<div class="card" id="log-body"><p class="empty">Opening the logbook…</p></div>`;
    try {
      const { actions, total } = await ringmaster.actions({ limit: LIMIT, offset: this.offset });
      this.el.querySelector('#log-body')!.innerHTML = actions.length
        ? `<ul class="log">${actions.map(entryHtml).join('')}</ul>${pagerHtml(this.offset, LIMIT, total)}`
        : '<p class="empty">Nothing yet: changes made here will be listed.</p>';
    } catch (err) {
      onApiError(err);
    }
  }
}

type Change = { before?: Record<string, unknown>; after?: Record<string, unknown> };

function entryHtml(a: AdminAction) {
  const [icon, text] = describe(a);
  const who = a.actorName === 'cli' ? 'the command line' : a.actorName;
  return `<li><span class="log-icon" aria-hidden="true">${icon}</span><span>${text}</span><span class="log-when">${esc(when(a.createdAt))} · by ${esc(who)}</span></li>`;
}

/** An icon and a sentence (already escaped) for one logbook entry. */
function describe(a: AdminAction): [string, string] {
  const d = (a.details ?? {}) as Change;
  const after = d.after ?? {};
  const before = d.before ?? {};
  const target = esc(a.target ?? '');
  const ride = a.target && isAttraction(a.target) ? esc(rideName(a.target)) : target;
  const sign = typeof after.closedMessage === 'string' ? ` with the sign “${esc(after.closedMessage)}”` : '';
  switch (a.action) {
    case 'park.close':
      return ['🚧', `Closed the park${sign}.${rules(after)}`];
    case 'park.open':
      return ['🎪', `Opened the park.${rules(after)}`];
    case 'settings.update':
      return ['⚙️', `Changed the park's settings.${rules(after)}${'closedMessage' in after && !sign ? ' Cleared the closed sign.' : sign ? ` Sign: “${esc(after.closedMessage)}”.` : ''}`];
    case 'attraction.close':
      return ['🔧', `Closed <strong>${ride}</strong> for maintenance${sign}.${price(before, after)}`];
    case 'attraction.open':
      return ['✅', `Reopened <strong>${ride}</strong>.${price(before, after)}`];
    case 'price.update':
      return ['🎟️', `Changed the price of <strong>${ride}</strong>.${price(before, after)}`];
    case 'attraction.update':
      return ['🪧', `Changed the maintenance sign of <strong>${ride}</strong>${sign || ' back to the default'}.`];
    case 'user.tickets':
      return ['🎟️', `Set <strong>${target}</strong>'s tickets from ${esc(before.tickets)} to ${esc(after.tickets)}.`];
    case 'user.role':
      return ['🎩', after.role === 'admin' ? `Made <strong>${target}</strong> staff.` : `Made <strong>${target}</strong> a player again.`];
    case 'user.cooldown':
      return ['⏳', `Let <strong>${target}</strong> pick up their next pack right away.`];
    case 'user.delete':
      return ['🗑️', `Deleted the account <strong>${target}</strong>${before.username ? ` (${esc(before.username)})` : ''}.`];
    default:
      return ['📝', `${esc(a.action)} ${target}`];
  }
}

const price = (before: Record<string, unknown>, after: Record<string, unknown>) =>
  'tickets' in after ? ` Price ${esc(before.tickets)} → ${esc(after.tickets)} tickets.` : '';

const rules = (after: Record<string, unknown>) =>
  [
    'packSize' in after ? ` Packs now hold ${esc(after.packSize)} tickets.` : '',
    'cooldownHours' in after ? ` One pack every ${esc(after.cooldownHours)} h.` : '',
  ].join('');
