// Every attraction's price, and the maintenance switch with its sign.
import { ringmaster, type AttractionId, type AttractionSettings } from '../account/api';
import { busy, esc, num, onApiError, rideLabel, rideName, toast, when } from './util';

const MESSAGE_MAX = 200;

export class AttractionsView {
  private rows: AttractionSettings[] | null = null;

  constructor(private el: HTMLElement) {
    el.addEventListener('submit', (e) => {
      e.preventDefault();
      const form = e.target as HTMLFormElement;
      void this.save(form.dataset.ride as AttractionId, form);
    });
    // the switch's words follow it, before saving
    el.addEventListener('change', (e) => {
      const input = e.target as HTMLInputElement;
      if (input.name !== 'open') return;
      input.closest('form')!.querySelector('[data-switch-text]')!.textContent = input.checked ? 'Running' : 'Under maintenance';
    });
  }

  /** Live: the latest prices and switches (main.ts holds off while a card is being edited). */
  refresh() {
    void this.show();
  }

  async show() {
    if (!this.rows) this.el.innerHTML = `${head()}<p class="empty">Walking the midway…</p>`;
    try {
      this.rows = (await ringmaster.attractions()).attractions;
      this.render();
    } catch (err) {
      onApiError(err);
    }
  }

  private render() {
    const rows = this.rows ?? [];
    const closed = rows.filter((r) => !r.open).length;
    this.el.innerHTML = `${head(closed)}<div class="attractions">${rows.map(cardHtml).join('')}</div>`;
  }

  private async save(ride: AttractionId, form: HTMLFormElement) {
    const current = this.rows?.find((r) => r.attraction === ride);
    if (!current) return;
    const data = new FormData(form);
    const tickets = Number(data.get('tickets'));
    const open = (form.elements.namedItem('open') as HTMLInputElement).checked;
    const message = String(data.get('closedMessage') ?? '').trim();
    if (!Number.isInteger(tickets) || tickets < 1 || tickets > 1000) {
      toast('A round costs 1 to 1000 tickets.', true);
      (form.elements.namedItem('tickets') as HTMLInputElement).focus();
      return;
    }
    // only what changed goes to the server, so the logbook says exactly what happened
    const body: Partial<Pick<AttractionSettings, 'tickets' | 'open' | 'closedMessage'>> = {};
    if (tickets !== current.tickets) body.tickets = tickets;
    if (open !== current.open) body.open = open;
    if ((message || null) !== current.closedMessage) body.closedMessage = message || null;
    if (!Object.keys(body).length) return toast('Nothing to save.');

    const button = form.querySelector<HTMLButtonElement>('[type="submit"]');
    const saved = await busy(button, () => ringmaster.updateAttraction(ride, body));
    if (!saved) return;
    this.rows = this.rows!.map((r) => (r.attraction === ride ? saved : r));
    this.render();
    toast(
      body.open === false
        ? `🔧 ${rideName(ride)} is closed for maintenance.`
        : body.open === true
          ? `✅ ${rideName(ride)} is running again.`
          : `Saved ${rideName(ride)}.`,
    );
    this.el.querySelector<HTMLElement>(`form[data-ride="${ride}"] [type="submit"]`)?.focus();
  }
}

const head = (closed?: number) =>
  `<div class="view-head"><div><h2 id="h-attractions">Attractions</h2><p class="muted">Prices and maintenance. Changes reach the fair at once; staff can still ride a closed attraction to test it.${
    closed ? ` <strong>${num(closed)} under maintenance.</strong>` : ''
  }</p></div></div>`;

function cardHtml(a: AttractionSettings) {
  const id = a.attraction;
  return `<form class="attraction${a.open ? '' : ' is-closed'}" data-ride="${id}" novalidate aria-labelledby="att-${id}">
    <div class="attraction-head"><h3 id="att-${id}">${esc(rideLabel(id))}</h3>${a.open ? '<span class="pill pill-good">Running</span>' : '<span class="pill pill-bad">Maintenance</span>'}</div>
    <p class="attraction-stats">Last changed ${esc(when(a.updatedAt))}</p>
    <div class="price-row"><label>Tickets per round <input type="number" name="tickets" min="1" max="1000" step="1" inputmode="numeric" value="${a.tickets}" required /></label></div>
    <label class="switch"><input type="checkbox" name="open" ${a.open ? 'checked' : ''} /><span data-switch-text>${a.open ? 'Running' : 'Under maintenance'}</span></label>
    <label>Maintenance sign <textarea name="closedMessage" maxlength="${MESSAGE_MAX}" rows="2" placeholder="Under maintenance. Back soon!">${esc(a.closedMessage ?? '')}</textarea>
      <span class="hint">Shown to visitors while it's under maintenance. Leave blank for the default.</span></label>
    <div class="form-actions"><button type="submit" class="btn btn-primary btn-small">Save</button></div>
  </form>`;
}
