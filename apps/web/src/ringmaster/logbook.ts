// What staff changed, and when: the admin_actions table, in words.
import { isAttraction, ringmaster, type AdminAction, type SuggestionStatus } from '../account/api';
import { STATUSES } from '../account/ideas';
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

  /** Live: the newest entries (on the page being read). */
  refresh() {
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
    case 'park.maintenance.on': {
      const works = typeof after.maintenanceMessage === 'string' ? ` with the sign “${esc(after.maintenanceMessage)}”` : '';
      return ['🛠️', `Put the park under maintenance${works}: only staff can come in.${rules(after)}`];
    }
    case 'park.maintenance.off':
      return ['🎪', `Ended the park's maintenance: visitors can come back in.${rules(after)}`];
    case 'park.close':
      return ['🚧', `Closed the park${sign}.${rules(after)}`];
    case 'park.open':
      return ['🎪', `Opened the park.${rules(after)}`];
    case 'settings.update':
      return ['⚙️', `Changed the park's settings.${rules(after)}${'closedMessage' in after && !sign ? ' Cleared the closed sign.' : sign ? ` Sign: “${esc(after.closedMessage)}”.` : ''}`];
    case 'access.on': {
      const { added } = d as { added?: unknown };
      const own = typeof added === 'string' ? ` Let in their own address, <strong>${esc(added)}</strong>.` : '';
      return ['🔒', `Made the fair private: only the allowed addresses can come in.${own}`];
    }
    case 'access.off':
      return ['🌍', 'Opened the fair to everyone again (private access off).'];
    case 'access.ip.add':
      return ['➕', `Let in <strong>${target}</strong>${typeof after.label === 'string' ? ` (${esc(after.label)})` : ''}.`];
    case 'access.ip.remove':
      return ['➖', `Took <strong>${target}</strong>${typeof before.label === 'string' ? ` (${esc(before.label)})` : ''} off the allowed addresses.`];
    case 'attraction.close':
      return ['🔧', `Closed <strong>${ride}</strong> for maintenance${sign}.${price(before, after)}`];
    case 'attraction.open':
      return ['✅', `Reopened <strong>${ride}</strong>.${price(before, after)}`];
    case 'price.update':
      return ['🎟️', `Changed the price of <strong>${ride}</strong>.${price(before, after)}`];
    case 'attraction.update':
      return ['🪧', `Changed the maintenance sign of <strong>${ride}</strong>${sign || ' back to the default'}.`];
    case 'shop.price':
      return ['🍭', `Changed the price of <strong>${target}</strong> at the shop.${price(before, after)}`];
    case 'shop.stock':
      return ['📦', `${stock(before, after, target)}`];
    case 'shop.update':
      return ['🍭', `Changed <strong>${target}</strong> at the shop.${price(before, after)} ${stock(before, after, target)}`];
    case 'user.tickets':
      return ['🎟️', `Set <strong>${target}</strong>'s tickets from ${esc(before.tickets)} to ${esc(after.tickets)}.`];
    case 'user.role':
      return ['🎩', after.role === 'admin' ? `Made <strong>${target}</strong> staff.` : `Made <strong>${target}</strong> a player again.`];
    case 'user.cooldown':
      return ['⏳', `Let <strong>${target}</strong> pick up their next pack right away.`];
    case 'suggestion.reply':
      return [
        '💌',
        `Answered <strong>${target}</strong>'s idea ${idea(d)}${typeof after.status === 'string' ? ` and marked it ${statusName(after.status)}` : ''}: “${esc(after.reply)}”`,
      ];
    case 'suggestion.status':
      return ['💡', `Marked <strong>${target}</strong>'s idea ${idea(d)} ${statusName(after.status)} (was ${statusName(before.status)}).`];
    case 'user.delete':
      return ['🗑️', `Deleted the account <strong>${target}</strong>${before.username ? ` (${esc(before.username)})` : ''}.`];
    default:
      return ['📝', `${esc(a.action)} ${target}`];
  }
}

/** The start of the idea, as the logbook kept it. */
const idea = (d: Change & { excerpt?: unknown }) => (typeof d.excerpt === 'string' ? `“${esc(d.excerpt)}”` : '');

const statusName = (s: unknown) => (typeof s === 'string' && s in STATUSES ? `“${esc(STATUSES[s as SuggestionStatus].label)}”` : esc(s));

const price = (before: Record<string, unknown>, after: Record<string, unknown>) =>
  'tickets' in after ? ` Price ${esc(before.tickets)} → ${esc(after.tickets)} tickets.` : '';

const stock = (before: Record<string, unknown>, after: Record<string, unknown>, target: string) => {
  const was = before.stock === null || before.stock === undefined ? 'no limit' : `${esc(before.stock)} in stock`;
  if (after.stock === null) return `Took the stock limit off <strong>${target}</strong> (was ${was}).`;
  if (after.stock === 0) return `Marked <strong>${target}</strong> sold out (was ${was}).`;
  return `Set <strong>${target}</strong>'s stock to ${esc(after.stock)} (was ${was}).`;
};

const rules = (after: Record<string, unknown>) =>
  [
    'packSize' in after ? ` Packs now hold ${esc(after.packSize)} tickets.` : '',
    'cooldownHours' in after ? ` One pack every ${esc(after.cooldownHours)} h.` : '',
  ].join('');
