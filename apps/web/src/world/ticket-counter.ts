// The Ticket Booth's counter: what a guest is told, a member's wallet with the free pack (or the
// countdown to the next one), the price list, their rounds and their latest purchases.
import { ATTRACTION_IDS, type AttractionId } from '../account/api';
import { formatWait, session } from '../account/session';
import { MAP_PLACES } from './minimap';
import { escapeHtml } from './ui';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "1 ticket", "5 tickets". */
export const ticketsText = (n: number) => plural(n, 'ticket', 'tickets');

/** Sign up / log in buttons for a card; with a `ride`, signing in boards it straight after. */
export function accountButtons(ride?: AttractionId) {
  const r = ride ? ` data-ride="${ride}"` : '';
  return `<p class="panel-actions"><button class="btn btn-primary btn-small" type="button" data-auth="signup"${r}>Sign up — it's free</button><button class="btn btn-outline btn-small" type="button" data-auth="login"${r}>Log in</button></p>`;
}

/** The Terms and Privacy links every ticket card carries. */
export const legalLinksHtml = () =>
  '<p class="legal-links"><a href="/terms.html" target="_blank" rel="noopener">Terms of Service</a> · <a href="/privacy.html" target="_blank" rel="noopener">Privacy Policy</a></p>';

/** "Next pack in 03:12:45": the clock ticks while the card is open (see Game.tickCountdowns). */
export function waitHtml(ms: number, id = '') {
  const attrs = `class="ticket-wait"${id ? ` id="${id}"` : ''}`;
  return ms > 0
    ? `<p ${attrs}>Your next free pack is ready in <b data-countdown>${formatWait(ms)}</b>.</p>`
    : `<p ${attrs}>Your free pack of 20 is ready at the Ticket Booth.</p>`;
}

/** Every attraction and what a round costs (the server's prices once they're in). */
function priceListHtml() {
  const rows = ATTRACTION_IDS.map((id) => {
    const p = MAP_PLACES.find((m) => m.id === id)!;
    return `<li><span>${p.icon} ${escapeHtml(p.label)}</span><b>${ticketsText(session.cost(id))}</b></li>`;
  }).join('');
  return `<h3>Price list · one round each</h3><ul class="ticket-list">${rows}</ul>`;
}

/** The member's wallet: the balance, the free pack (or how long until the next one), and how the last purchase went. */
function walletHtml(state: CounterState) {
  const t = session.tickets;
  if (!t)
    return state.error
      ? `<p class="booth-account">🎟️ ${escapeHtml(state.error)}</p>`
      : `<p class="booth-account">🎟️ Signed in as <strong>${escapeHtml(session.user!.username)}</strong> · counting your tickets…</p>`;
  const wait = session.msUntilPurchase() ?? 0;
  // aria-disabled rather than disabled, so a keyboard user's focus stays on the button
  const button =
    wait > 0
      ? `<button class="btn btn-primary btn-small" type="button" data-buy aria-disabled="true" aria-describedby="ticket-wait">Buy ${t.packSize} tickets</button>`
      : `<button class="btn btn-primary btn-small" type="button" data-buy${state.buying ? ' aria-disabled="true" aria-busy="true"' : ''}>${
          state.buying ? 'Printing your tickets…' : `Buy ${t.packSize} tickets · free`
        }</button>`;
  const note = state.error
    ? `<p class="ticket-error" role="alert">${escapeHtml(state.error)}</p>`
    : state.flash
      ? `<p class="ticket-flash" role="status">${escapeHtml(state.flash)}</p>`
      : '';
  return `<div class="ticket-wallet"><span>Your tickets</span><b>🎟️ ${t.balance}</b></div><p class="panel-actions">${button}</p>${
    wait > 0 ? waitHtml(wait, 'ticket-wait') : ''
  }${note}<p class="sub">Tickets are free for now: one pack of ${t.packSize} every ${t.cooldownHours} hours, and leftover tickets carry over.</p>`;
}

/** The member's rounds so far and their latest purchases. */
function historyHtml() {
  const stats = session.stats;
  const rounds = stats
    ? stats.totalRounds
      ? `${plural(stats.totalRounds, 'round', 'rounds')} played · ${ticketsText(stats.ticketsSpent)} spent`
      : 'No rounds yet: pick an attraction!'
    : 'Counting your rounds…';
  const purchases = session.purchases;
  const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const list =
    purchases === null
      ? '<p class="sub">Looking up your purchases…</p>'
      : purchases.length
        ? `<ul class="ticket-list">${purchases
            .map((p) => `<li><span>${escapeHtml(when(p.createdAt))}</span><b>+${ticketsText(p.quantity)}${p.priceCents ? '' : ' · free'}</b></li>`)
            .join('')}</ul>`
        : '<p>No purchases yet: your first pack is on the house.</p>';
  return `<h3>Your fair so far</h3><p>🎢 ${rounds}</p><h3>Latest purchases</h3>${list}`;
}

export interface CounterState {
  /** A purchase is on its way to the server. */
  buying: boolean;
  /** What went wrong with the last purchase (or loading the wallet). */
  error: string | null;
  /** What went right with it. */
  flash: string | null;
}

/** Everything under the booth card's title (redrawn in place as the wallet changes). */
export function boothBodyHtml(state: CounterState) {
  if (!session.user)
    return `<p class="booth-account">🎟️ Every ride and game costs tickets, and tickets need a free account. Sign up (it's free) and pick up <strong>20 free tickets</strong> right here, every 5 hours.</p>${accountButtons()}${priceListHtml()}${legalLinksHtml()}`;
  return `${walletHtml(state)}${priceListHtml()}${historyHtml()}${legalLinksHtml()}`;
}

/** The whole booth card. */
export function boothPanelHtml(state: CounterState) {
  return `<p class="eyebrow">Ticket Booth · Ticket counter</p><h2>Tickets, please! 🎟️</h2><div class="booth-body">${boothBodyHtml(state)}</div>`;
}
