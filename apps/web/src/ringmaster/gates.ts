// The whole park's switch, its sign, and the free-ticket rules.
import { ringmaster, type ParkSettings } from '../account/api';
import { busy, esc, onApiError, toast, when } from './util';

export class GatesView {
  private park: ParkSettings | null = null;

  constructor(private el: HTMLElement) {
    el.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.save(e.target as HTMLFormElement);
    });
    el.addEventListener('change', (e) => {
      const input = e.target as HTMLInputElement;
      if (input.name === 'open') el.querySelector('[data-switch-text]')!.textContent = input.checked ? 'Open to visitors' : 'Closed';
    });
  }

  async show() {
    if (!this.park) this.el.innerHTML = `${head()}<p class="empty">Checking the gates…</p>`;
    try {
      this.park = await ringmaster.park();
      this.render();
    } catch (err) {
      onApiError(err);
    }
  }

  private render() {
    const p = this.park!;
    this.el.innerHTML = `${head()}<div class="card"><form class="gates-form" novalidate>
      <div class="big-status"><span aria-hidden="true" style="font-size:2rem">${p.open ? '🎪' : '🚧'}</span><div><strong>${p.open ? 'The park is open' : 'The park is closed'}</strong><p class="hint">Last changed ${esc(when(p.updatedAt))}</p></div></div>
      <label class="switch"><input type="checkbox" name="open" ${p.open ? 'checked' : ''} /><span data-switch-text>${p.open ? 'Open to visitors' : 'Closed'}</span></label>
      <p class="hint">Closed: visitors can still walk in and look around, but nobody can board or pick up tickets (staff excepted).</p>
      <label>Sign on the gate <textarea name="closedMessage" maxlength="200" rows="2" placeholder="The park is closed right now. Come back soon!">${esc(p.closedMessage ?? '')}</textarea>
        <span class="hint">Shown while the park is closed. Leave blank for the default.</span></label>
      <h3>Free tickets</h3>
      <div class="gates-pair">
        <label>Tickets in a pack <input type="number" name="packSize" min="1" max="1000" step="1" inputmode="numeric" value="${p.packSize}" /></label>
        <label>Hours between packs <input type="number" name="cooldownHours" min="0" max="168" step="1" inputmode="numeric" value="${p.cooldownHours}" />
          <span class="hint">0 means no wait.</span></label>
      </div>
      <div class="form-actions"><button type="submit" class="btn btn-primary">Save</button></div>
    </form></div>`;
  }

  private async save(form: HTMLFormElement) {
    const p = this.park!;
    const data = new FormData(form);
    const open = (form.elements.namedItem('open') as HTMLInputElement).checked;
    const message = String(data.get('closedMessage') ?? '').trim() || null;
    const packSize = Number(data.get('packSize'));
    const cooldownHours = Number(data.get('cooldownHours'));
    if (!Number.isInteger(packSize) || packSize < 1 || packSize > 1000) return toast('A pack holds 1 to 1000 tickets.', true);
    if (!Number.isInteger(cooldownHours) || cooldownHours < 0 || cooldownHours > 168) return toast('The wait is 0 to 168 hours.', true);

    const body: Parameters<typeof ringmaster.updatePark>[0] = {};
    if (open !== p.open) body.open = open;
    if (message !== p.closedMessage) body.closedMessage = message;
    if (packSize !== p.packSize) body.packSize = packSize;
    if (cooldownHours !== p.cooldownHours) body.cooldownHours = cooldownHours;
    if (!Object.keys(body).length) return toast('Nothing to save.');
    if (body.open === false && !confirm('Close the whole park? Nobody but staff will be able to board or pick up tickets.')) return;

    const saved = await busy(form.querySelector<HTMLButtonElement>('[type="submit"]'), () => ringmaster.updatePark(body));
    if (!saved) return;
    this.park = saved;
    this.render();
    toast(body.open === false ? '🚧 The park is closed.' : body.open === true ? '🎪 The park is open!' : 'Saved.');
  }
}

const head = () =>
  `<div class="view-head"><div><h2 id="h-gates">Park gates</h2><p class="muted">Open or close the whole fair, and set the free-ticket rules. Visitors see changes within a minute.</p></div></div>`;
