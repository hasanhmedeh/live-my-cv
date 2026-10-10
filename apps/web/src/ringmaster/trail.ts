// The Rally Trail: its daily leaderboards (noon to noon, Beirut time), today's or any earlier one,
// how the trail does, and the runs taken off a board. Nothing is deleted at the turnover: every
// board stays here to look back at.
import { ringmaster, type TrailOffice } from '../account/api';
import { trailTime } from '../account/stats';
import { renderBarChart } from './charts';
import { ask } from './dialog';
import { busy, esc, num, onApiError, pct, plural, toast, when } from './util';

/** "9 Oct" for a board day "2026-10-09". */
const dayName = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
/** "Fri 9 Oct" */
const dayLong = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
/** "12:00" in Beirut and on the viewer's clock, e.g. "12:00 Beirut (11:00 here)". */
function clockAt(iso: string, zone: string) {
  const opts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  const there = new Date(iso).toLocaleTimeString('en-GB', { ...opts, timeZone: zone });
  const here = new Date(iso).toLocaleTimeString('en-GB', opts);
  return here === there ? `${there} Beirut` : `${there} Beirut (${here} here)`;
}
const left = (ms: number) => {
  const min = Math.max(0, Math.floor(ms / 60_000));
  return min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min` : `${min} min`;
};

export class TrailView {
  /** The board on screen (null: today's, following the turnover). */
  private day: string | null = null;
  private data: TrailOffice | null = null;
  private loading = false;
  /** Asked again (another day picked, a live change) while a look was on its way: one more look after it. */
  private again = false;

  constructor(private el: HTMLElement) {
    el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const day = t.closest<HTMLButtonElement>('[data-day]');
      if (day) {
        this.day = day.dataset.day || null;
        return void this.load();
      }
      if (t.closest('[data-refresh]')) return void this.load();
      const dq = t.closest<HTMLButtonElement>('[data-dq]');
      if (dq) void this.disqualify(dq, dq.dataset.dq!, dq.dataset.state === 'off');
    });
    el.addEventListener('change', (e) => {
      const select = e.target as HTMLSelectElement;
      if (select.name !== 'day') return;
      this.day = select.value || null;
      void this.load();
    });
  }

  show() {
    if (!this.data) this.el.innerHTML = `${this.headHtml()}<p class="empty">Timing the runs…</p>`;
    void this.load();
  }

  /** Live: a new time, or one taken off (here or by other staff). */
  refresh() {
    void this.load();
  }

  private async load() {
    if (this.loading) {
      this.again = true;
      return;
    }
    this.loading = true;
    this.el.querySelector('[data-refresh]')?.setAttribute('aria-busy', 'true');
    const day = this.day;
    try {
      const data = await ringmaster.trail(day);
      // a different board was picked meanwhile: the look after this one shows it
      if (day === this.day) {
        this.data = data;
        this.render(data);
      }
    } catch (err) {
      onApiError(err);
      this.el.querySelector('[data-refresh]')?.removeAttribute('aria-busy');
    } finally {
      this.loading = false;
      if (this.again || day !== this.day) {
        this.again = false;
        void this.load();
      }
    }
  }

  private headHtml(d?: TrailOffice) {
    const sub = 'The daily leaderboard: a new board starts every day at 12:00 Beirut time. Earlier boards are kept, to look back at here.';
    if (!d) return `<div class="view-head"><div><h2 id="h-trail">🚙 Rally Trail</h2><p class="muted">${esc(sub)}</p></div></div>`;
    const days = d.daily
      .slice()
      .reverse()
      .map((r) => `<option value="${r.day === d.today ? '' : r.day}" ${r.day === d.day ? 'selected' : ''}>${esc(dayLong(r.day))}${r.day === d.today ? ' (today)' : ''}${r.runs ? ` · ${plural(r.runs, 'run', 'runs')}` : ''}</option>`)
      .join('');
    const prev = d.daily.find((_, i, a) => a[i + 1]?.day === d.day)?.day;
    const next = d.daily.find((_, i, a) => a[i - 1]?.day === d.day)?.day;
    return `<div class="view-head"><div><h2 id="h-trail">🚙 Rally Trail</h2><p class="muted">${esc(sub)}</p></div>
      <div class="view-tools">
        <button type="button" class="btn btn-ghost btn-small" data-day="${prev ?? ''}" ${prev ? '' : 'disabled'} aria-label="The board before">←</button>
        <select name="day" class="board-pick" aria-label="Board">${days}</select>
        <button type="button" class="btn btn-ghost btn-small" data-day="${next && next !== d.today ? next : ''}" ${next ? '' : 'disabled'} aria-label="The board after">→</button>
        <button type="button" class="btn btn-ghost btn-small" data-refresh>↻ Refresh</button>
      </div></div>`;
  }

  private render(d: TrailOffice) {
    const span = `${dayLong(d.day)} ${clockAt(d.startsAt, d.timeZone)} → ${dayLong(addDay(d.day))} ${clockAt(d.endsAt, d.timeZone)}`;
    const status = d.current
      ? `<div class="notice notice-info"><p><strong>🏁 Today's board is open:</strong> ${esc(span)}. A new one starts in <strong>${esc(left(Date.parse(d.endsAt) - Date.now()))}</strong>; this one stays here.</p></div>`
      : `<div class="notice notice-info"><p><strong>📜 An earlier board:</strong> ${esc(span)}. <button type="button" class="btn btn-ghost btn-small" data-day="">Back to today's</button></p></div>`;
    const leader = d.board[0];
    const tile = (label: string, value: string, note: string) =>
      `<div class="tile"><p class="tile-label">${label}</p><p class="tile-value">${value}</p><p class="tile-note">${note}</p></div>`;
    const tiles = [
      tile('Fastest on this board', leader ? trailTime(leader.timeMs) : '—', leader ? esc(leader.username) : 'No times yet'),
      tile('Drivers', num(d.stats.players), `${plural(d.stats.runs, 'run', 'runs')} that crossed the line`),
      tile('Average run', d.stats.avgMs === null ? '—' : trailTime(d.stats.avgMs), d.stats.medianMs === null ? 'Over every run on this board' : `Median ${trailTime(d.stats.medianMs)}`),
      tile('Rounds', num(d.stats.rounds), `${pct(d.stats.completed, d.stats.rounds)} finished · ${plural(d.stats.rounds - d.stats.completed, 'left early', 'left early')}`),
      tile('Trail record', d.record ? trailTime(d.record.timeMs) : '—', d.record ? `${esc(d.record.username)} · ${esc(dayName(d.record.day))}` : 'Set on the first run'),
      tile('Taken off', num(d.disqualified.length), 'Runs disqualified on this board'),
    ].join('');

    this.el.innerHTML = `${this.headHtml(d)}${status}
      <div class="tiles">${tiles}</div>
      <div class="card"><h3>Leaderboard</h3><p class="sub">Each driver's fastest run on this board (ties go to whoever set it first). Players see the top ten. Times are measured in the player's browser and checked against how long the round lasted: take off anything that looks impossible.</p>${this.boardTable(d)}</div>
      ${d.disqualified.length ? `<div class="card"><h3>Taken off this board</h3><p class="sub">Kept, and can be put back.</p>${this.dqTable(d)}</div>` : ''}
      <div class="grid grid-2">
        <div class="card"><h3>Runs per board</h3><p class="sub">The last 30 boards, today's on the right.</p><div class="chart" id="c-trail-runs"></div></div>
        <div class="card"><h3>Drivers per board</h3><p class="sub">Players with a time on each board.</p><div class="chart" id="c-trail-players"></div></div>
      </div>
      <div class="card"><h3>Every board</h3><p class="sub">Who won each of the last 30 days. Pick one to see its full board.</p>${this.historyTable(d)}</div>`;

    const ticks = d.daily.map((r) => dayName(r.day));
    renderBarChart(this.el.querySelector('#c-trail-runs')!, {
      label: 'Runs per board',
      values: d.daily.map((r) => r.runs),
      ticks,
      tips: d.daily.map((r) => `${dayLong(r.day)}\n${plural(r.runs, 'run', 'runs')}${r.bestMs === null ? '' : ` · best ${trailTime(r.bestMs)}`}`),
    });
    renderBarChart(this.el.querySelector('#c-trail-players')!, {
      label: 'Drivers per board',
      values: d.daily.map((r) => r.players),
      ticks,
      tips: d.daily.map((r) => `${dayLong(r.day)}\n${plural(r.players, 'driver', 'drivers')}${r.winner ? ` · won by ${r.winner}` : ''}`),
    });
  }

  private boardTable(d: TrailOffice) {
    if (!d.board.length) return `<p class="empty">${d.current ? 'No times yet on today’s board.' : 'Nobody crossed the line on this board.'}</p>`;
    const first = d.board[0].timeMs;
    const rows = d.board
      .map(
        (e) =>
          `<tr><td class="r">${e.rank <= 3 ? ['🥇', '🥈', '🥉'][e.rank - 1] : num(e.rank)}</td><td><a href="#members/${encodeURIComponent(e.userId)}" class="cell-main">${esc(e.username)}</a></td><td class="r"><strong>${trailTime(e.timeMs)}</strong></td><td class="r muted">${e.rank === 1 ? '—' : `+${((e.timeMs - first) / 1000).toFixed(2)} s`}</td><td class="r">${num(e.runs)}</td><td>${esc(when(e.at))}</td><td class="r"><button type="button" class="btn btn-danger btn-small" data-dq="${esc(e.runId)}" data-state="on" data-name="${esc(e.username)}" data-time="${esc(trailTime(e.timeMs))}">Disqualify</button></td></tr>`,
      )
      .join('');
    return `<div class="table-wrap"><table><thead><tr><th class="r">#</th><th>Driver</th><th class="r">Best</th><th class="r">Gap</th><th class="r">Runs</th><th>Set</th><th class="r"><span class="visually-hidden">Actions</span></th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  private dqTable(d: TrailOffice) {
    const rows = d.disqualified
      .map(
        (r) =>
          `<tr><td><a href="#members/${encodeURIComponent(r.userId)}">${esc(r.username)}</a></td><td class="r">${trailTime(r.timeMs)}</td><td>${esc(when(r.at))}</td><td class="r"><button type="button" class="btn btn-ghost btn-small" data-dq="${esc(r.id)}" data-state="off" data-name="${esc(r.username)}" data-time="${esc(trailTime(r.timeMs))}">Put back</button></td></tr>`,
      )
      .join('');
    return `<div class="table-wrap"><table><thead><tr><th>Driver</th><th class="r">Time</th><th>Set</th><th class="r"><span class="visually-hidden">Actions</span></th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  private historyTable(d: TrailOffice) {
    const rows = d.daily
      .slice()
      .reverse()
      .filter((r) => r.runs || r.day === d.today)
      .map(
        (r) =>
          `<tr class="clickable${r.day === d.day ? ' is-current' : ''}" data-day="${r.day === d.today ? '' : r.day}"><td>${esc(dayLong(r.day))}${r.day === d.today ? ' <span class="pill pill-good">Today</span>' : ''}</td><td>${r.winner ? `🥇 ${esc(r.winner)}` : '—'}</td><td class="r">${r.bestMs === null ? '—' : trailTime(r.bestMs)}</td><td class="r">${num(r.players)}</td><td class="r">${num(r.runs)}</td></tr>`,
      )
      .join('');
    return `<div class="table-wrap"><table><thead><tr><th>Board</th><th>Winner</th><th class="r">Best</th><th class="r">Drivers</th><th class="r">Runs</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  /** Takes a run off its board (asking first), or puts it back. */
  private async disqualify(button: HTMLButtonElement, id: string, reinstate: boolean) {
    const name = button.dataset.name ?? 'this driver';
    const time = button.dataset.time ?? '';
    if (
      !reinstate &&
      !(await ask({
        icon: '🚩',
        title: `Disqualify ${name}'s ${time}?`,
        body: `It comes off the board at once, for everyone, and ${name}'s next-best run on this board (if any) takes its place. The run is kept: you can put it back.`,
        confirm: 'Disqualify the run',
        danger: true,
      }))
    )
      return;
    const done = await busy(button, () => ringmaster.updateTrailRun(id, !reinstate));
    if (!done) return;
    toast(reinstate ? `${name}'s ${time} is back on the board.` : `${name}'s ${time} is off the board.`);
    void this.load();
  }
}

const addDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
