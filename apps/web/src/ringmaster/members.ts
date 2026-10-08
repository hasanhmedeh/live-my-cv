// The members: search them, and look after one (tickets, cooldown, staff role, deletion).
import { ATTRACTION_IDS, ringmaster, type AdminUser, type AdminUserDetail, type User } from '../account/api';
import { formatStat, statLabel } from '../account/stats';
import { busy, esc, num, onApiError, pagerHtml, plural, rideLabel, toast, when } from './util';

const LIMIT = 25;

export class MembersView {
  private q = '';
  private offset = 0;
  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  private detail: AdminUserDetail | null = null;

  constructor(
    private el: HTMLElement,
    private me: () => User | null,
  ) {
    el.addEventListener('input', (e) => {
      const input = e.target as HTMLInputElement;
      if (input.name !== 'q') return;
      clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => {
        this.q = input.value;
        this.offset = 0;
        void this.loadList(false);
      }, 300);
    });
    el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const page = t.closest<HTMLButtonElement>('[data-page]');
      if (page) {
        this.offset = Number(page.dataset.page);
        void this.loadList(false);
        return;
      }
      const row = t.closest<HTMLElement>('tr[data-member]');
      if (row && !t.closest('a')) location.hash = `#members/${encodeURIComponent(row.dataset.member!)}`;
      const action = t.closest<HTMLButtonElement>('[data-action]');
      if (action) void this.act(action);
    });
    el.addEventListener('keydown', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('tr[data-member]');
      if (row && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        location.hash = `#members/${encodeURIComponent(row.dataset.member!)}`;
      }
    });
  }

  /** `id` opens one member; without it, the list. */
  show(id?: string) {
    if (id) void this.loadDetail(id);
    else void this.loadList(true);
  }

  // ---------- The list ----------

  private async loadList(fresh: boolean) {
    if (fresh || !this.el.querySelector('#members-list')) {
      this.el.innerHTML = `<div class="view-head"><div><h2 id="h-members">Members</h2><p class="muted">Everyone with an account. Open one to change their tickets or role.</p></div>
        <div class="view-tools"><input class="search" type="search" name="q" placeholder="Search by name or email" aria-label="Search members" value="${esc(this.q)}" /></div></div>
        <div class="card" id="members-list"><p class="empty">Looking through the guest book…</p></div>`;
    }
    try {
      const { users, total } = await ringmaster.users({ q: this.q, limit: LIMIT, offset: this.offset });
      const list = this.el.querySelector('#members-list');
      if (list) list.innerHTML = users.length ? `${tableHtml(users)}${pagerHtml(this.offset, LIMIT, total)}` : `<p class="empty">${this.q ? 'Nobody matches that.' : 'No members yet.'}</p>`;
    } catch (err) {
      onApiError(err);
    }
  }

  // ---------- One member ----------

  private async loadDetail(id: string) {
    this.el.innerHTML = `<p><a href="#members">← All members</a></p><p class="empty">Fetching their file…</p>`;
    try {
      this.detail = await ringmaster.user(id);
      this.renderDetail();
    } catch (err) {
      onApiError(err);
    }
  }

  private renderDetail() {
    const { user: u, purchases, rounds, byRide } = this.detail!;
    const self = this.me()?.id === u.id;
    const staff = u.role === 'admin';
    const played = ATTRACTION_IDS.filter((id) => byRide[id]?.rounds)
      .sort((a, b) => byRide[b]!.rounds - byRide[a]!.rounds)
      .map((id) => `<tr><td>${esc(rideLabel(id))}</td><td class="r">${num(byRide[id]!.rounds)}</td><td class="r">${num(byRide[id]!.ticketsSpent)}</td></tr>`)
      .join('');
    const roundRows = rounds
      .map((r) => {
        const state = r.completed ? '<span class="pill pill-good">Finished</span>' : r.endedAt ? '<span class="pill pill-muted">Left early</span>' : '<span class="pill pill-staff">Playing</span>';
        const stats = Object.entries(r.stats ?? {})
          .slice(0, 3)
          .map(([k, v]) => `${statLabel(k)} ${formatStat(k, v)}`)
          .join(' · ');
        return `<tr><td>${esc(when(r.startedAt))}</td><td>${esc(rideLabel(r.ride))}</td><td>${state}</td><td class="r">${num(r.ticketsSpent)}</td><td class="muted">${esc(stats)}</td></tr>`;
      })
      .join('');
    const purchaseRows = purchases
      .map((p) => `<tr><td>${esc(when(p.createdAt))}</td><td class="r">+${num(p.quantity)}</td><td class="r">${p.balanceAfter === undefined ? '—' : num(p.balanceAfter)}</td></tr>`)
      .join('');

    this.el.innerHTML = `<p><a href="#members">← All members</a></p>
      <div class="member-detail">
        <div class="view-head"><div><h2 id="h-members">${esc(u.username)} ${staff ? '<span class="pill pill-staff">🎩 Staff</span>' : ''}</h2>
          <p class="muted">${esc(u.email)} · joined ${esc(when(u.createdAt))} · ${plural(u.rounds, 'round', 'rounds')} · ${plural(u.purchases, 'pack', 'packs')}</p></div></div>
        <div class="member-actions">
          <div class="member-action"><h4>🎟️ Tickets</h4><p class="hint">They have <strong>${num(u.ticketBalance)}</strong>. Set a new balance:</p>
            <div class="inline"><input type="number" min="0" max="100000" step="1" inputmode="numeric" value="${u.ticketBalance}" aria-label="New ticket balance" data-balance />
            <button type="button" class="btn btn-primary btn-small" data-action="balance">Set</button></div></div>
          <div class="member-action"><h4>⏳ Next free pack</h4><p class="hint">${u.lastPurchaseAt ? `Last pack ${esc(when(u.lastPurchaseAt))}.` : 'They can pick one up now.'}</p>
            <button type="button" class="btn btn-ghost btn-small" data-action="cooldown" ${u.lastPurchaseAt ? '' : 'disabled'}>Let them buy one now</button></div>
          <div class="member-action"><h4>🎩 Staff</h4><p class="hint">${self ? "That's you: another member of staff has to change your role." : staff ? 'Can open this office and ride closed attractions.' : 'A player. Staff can open this office.'}</p>
            <button type="button" class="btn btn-ghost btn-small" data-action="role" ${self ? 'disabled' : ''}>${staff ? 'Make a player again' : 'Make staff'}</button></div>
          <div class="member-action"><h4>🗑️ Delete account</h4><p class="hint">Deletes the account with its tickets, rounds and purchases, for good.</p>
            <button type="button" class="btn btn-danger btn-small" data-action="delete" ${self ? 'disabled' : ''}>Delete…</button></div>
        </div>
        <div class="grid grid-2">
          <div class="card"><h3>Per attraction</h3>${played ? `<div class="table-wrap"><table><thead><tr><th>Attraction</th><th class="r">Rounds</th><th class="r">Tickets</th></tr></thead><tbody>${played}</tbody></table></div>` : '<p class="empty">Hasn\'t played yet.</p>'}</div>
          <div class="card"><h3>Latest packs</h3>${purchaseRows ? `<div class="table-wrap"><table><thead><tr><th>When</th><th class="r">Tickets</th><th class="r">Balance after</th></tr></thead><tbody>${purchaseRows}</tbody></table></div>` : '<p class="empty">No packs yet.</p>'}</div>
        </div>
        <div class="card"><h3>Latest rounds</h3>${roundRows ? `<div class="table-wrap"><table><thead><tr><th>Started</th><th>Attraction</th><th>Result</th><th class="r">Tickets</th><th>Stats</th></tr></thead><tbody>${roundRows}</tbody></table></div>` : '<p class="empty">No rounds yet.</p>'}</div>
      </div>`;
  }

  private async act(button: HTMLButtonElement) {
    const u = this.detail?.user;
    if (!u) return;
    const update = async (body: Parameters<typeof ringmaster.updateUser>[1], done: string) => {
      const saved = await busy(button, () => ringmaster.updateUser(u.id, body));
      if (!saved) return;
      this.detail = { ...this.detail!, user: saved };
      this.renderDetail();
      toast(done);
    };
    switch (button.dataset.action) {
      case 'balance': {
        const value = Number(this.el.querySelector<HTMLInputElement>('[data-balance]')!.value);
        if (!Number.isInteger(value) || value < 0 || value > 100_000) return toast('A balance is 0 to 100 000 tickets.', true);
        if (value === u.ticketBalance) return toast('Nothing to change.');
        return update({ ticketBalance: value }, `${u.username} now has ${plural(value, 'ticket', 'tickets')}.`);
      }
      case 'cooldown':
        return update({ resetCooldown: true }, `${u.username} can pick up a pack now.`);
      case 'role': {
        const role = u.role === 'admin' ? 'player' : 'admin';
        if (role === 'admin' && !confirm(`Make ${u.username} staff? They'll be able to open this office and change anything in it.`)) return;
        return update({ role }, role === 'admin' ? `🎩 ${u.username} is staff now.` : `${u.username} is a player again.`);
      }
      case 'delete': {
        const typed = prompt(`This deletes ${u.username}'s account, tickets and history for good.\nType their username to confirm:`);
        if (typed === null) return;
        if (typed.trim() !== u.username) return toast("That doesn't match their username, so nothing was deleted.", true);
        const ok = await busy(button, async () => (await ringmaster.deleteUser(u.id), true));
        if (!ok) return;
        toast(`${u.username}'s account is gone.`);
        location.hash = '#members';
      }
    }
  }
}

function tableHtml(users: AdminUser[]) {
  const rows = users
    .map(
      (u) =>
        `<tr class="clickable" data-member="${esc(u.id)}" tabindex="0"><td><a href="#members/${encodeURIComponent(u.id)}" class="cell-main">${esc(u.username)}</a>${
          u.role === 'admin' ? ' <span class="pill pill-staff">🎩 Staff</span>' : ''
        }<span class="cell-sub">${esc(u.email)}</span></td><td class="r">${num(u.ticketBalance)}</td><td class="r">${num(u.rounds)}</td><td class="r">${num(u.purchases)}</td><td>${esc(when(u.createdAt))}</td></tr>`,
    )
    .join('');
  return `<div class="table-wrap"><table><thead><tr><th>Member</th><th class="r">Tickets</th><th class="r">Rounds</th><th class="r">Packs</th><th>Joined</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
