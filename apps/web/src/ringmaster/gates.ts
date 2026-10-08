// The whole park's switches (open or closed, and maintenance), their signs, and the free-ticket rules.
import { ringmaster, type ParkSettings } from '../account/api';
import { ask } from './dialog';
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
      if (input.name === 'open') el.querySelector('[data-switch-text="open"]')!.textContent = input.checked ? 'Open to visitors' : 'Closed';
      if (input.name === 'underMaintenance')
        el.querySelector('[data-switch-text="works"]')!.textContent = input.checked ? 'Under maintenance' : 'Off';
    });
  }

  /** Live: the latest switches and rules (main.ts holds off while the form is being edited). */
  refresh() {
    void this.show();
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
    const [icon, status] = p.underMaintenance
      ? ['🛠️', 'The park is under maintenance']
      : p.open
        ? ['🎪', 'The park is open']
        : ['🚧', 'The park is closed'];
    this.el.innerHTML = `${head()}<div class="card"><form class="gates-form" novalidate>
      <div class="big-status"><span aria-hidden="true" style="font-size:2rem">${icon}</span><div><strong>${status}</strong><p class="hint">Last changed ${esc(when(p.updatedAt))}</p></div></div>
      <h3>Open or closed</h3>
      <label class="switch"><input type="checkbox" name="open" ${p.open ? 'checked' : ''} /><span data-switch-text="open">${p.open ? 'Open to visitors' : 'Closed'}</span></label>
      <p class="hint">Closed: visitors can still walk in and look around, but nobody can board or pick up tickets (staff excepted).</p>
      <label>Sign on the gate <textarea name="closedMessage" maxlength="200" rows="2" placeholder="The park is closed right now. Come back soon!">${esc(p.closedMessage ?? '')}</textarea>
        <span class="hint">Shown while the park is closed. Leave blank for the default.</span></label>
      <h3>Maintenance</h3>
      <label class="switch"><input type="checkbox" name="underMaintenance" ${p.underMaintenance ? 'checked' : ''} /><span data-switch-text="works">${p.underMaintenance ? 'Under maintenance' : 'Off'}</span></label>
      <p class="hint">Stricter than closed: nobody but staff can come into the fair at all. Visitors already in it are sent back to the entrance at once, and any round they're playing is stopped and refunded. Accounts keep working, so staff can still log in and go in.</p>
      <label>Maintenance sign <textarea name="maintenanceMessage" maxlength="200" rows="2" placeholder="The fair is under maintenance. Come back soon!">${esc(p.maintenanceMessage ?? '')}</textarea>
        <span class="hint">Shown at the entrance while the park is under maintenance. Leave blank for the default.</span></label>
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
    const underMaintenance = (form.elements.namedItem('underMaintenance') as HTMLInputElement).checked;
    const maintenanceMessage = String(data.get('maintenanceMessage') ?? '').trim() || null;
    const packSize = Number(data.get('packSize'));
    const cooldownHours = Number(data.get('cooldownHours'));
    if (!Number.isInteger(packSize) || packSize < 1 || packSize > 1000) return toast('A pack holds 1 to 1000 tickets.', true);
    if (!Number.isInteger(cooldownHours) || cooldownHours < 0 || cooldownHours > 168) return toast('The wait is 0 to 168 hours.', true);

    const body: Parameters<typeof ringmaster.updatePark>[0] = {};
    if (open !== p.open) body.open = open;
    if (message !== p.closedMessage) body.closedMessage = message;
    if (underMaintenance !== p.underMaintenance) body.underMaintenance = underMaintenance;
    if (maintenanceMessage !== p.maintenanceMessage) body.maintenanceMessage = maintenanceMessage;
    if (packSize !== p.packSize) body.packSize = packSize;
    if (cooldownHours !== p.cooldownHours) body.cooldownHours = cooldownHours;
    if (!Object.keys(body).length) return toast('Nothing to save.');
    if (
      body.underMaintenance === true &&
      !(await ask({
        icon: '🛠️',
        title: 'Put the park under maintenance?',
        body: 'Everyone but staff is sent out of the fair right away, and any round they are playing is stopped and refunded. Nobody else can come in until you switch it off.',
        confirm: 'Start maintenance',
      }))
    )
      return;
    if (
      body.open === false &&
      !(await ask({
        icon: '🚧',
        title: 'Close the whole park?',
        body: 'Visitors can still walk around, but nobody except staff can board anything or pick up tickets until you open it again.',
        confirm: 'Close the park',
      }))
    )
      return;

    const saved = await busy(form.querySelector<HTMLButtonElement>('[type="submit"]'), () => ringmaster.updatePark(body));
    if (!saved) return;
    this.park = saved;
    this.render();
    toast(
      body.underMaintenance === true
        ? '🛠️ The park is under maintenance.'
        : body.underMaintenance === false
          ? '🎪 Maintenance is over: visitors can come back in.'
          : body.open === false
            ? '🚧 The park is closed.'
            : body.open === true
              ? '🎪 The park is open!'
              : 'Saved.',
    );
  }
}

const head = () =>
  `<div class="view-head"><div><h2 id="h-gates">Park gates</h2><p class="muted">Open or close the whole fair, put it under maintenance, and set the free-ticket rules. Visitors see changes at once.</p></div></div>`;
