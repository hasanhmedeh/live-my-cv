// The Idea Box: what members suggested at the kiosk in the fair. Staff answer each suggestion once
// (the answer can't be changed afterwards) and move its status along as often as needed; the
// member sees both at the Idea Box, live if they're in the fair.
import { ringmaster, SUGGESTION_MAX, type AdminSuggestion, type SuggestionStatus } from '../account/api';
import { STATUSES, STATUS_IDS, TOPICS } from '../account/ideas';
import { ask } from './dialog';
import { busy, esc, num, onApiError, pagerHtml, plural, toast, when } from './util';

const LIMIT = 20;

const STATUS_PILL: Record<SuggestionStatus, string> = {
  pending: 'pill-staff',
  accepted: 'pill-good',
  in_development: 'pill-good',
  done: 'pill-good',
  declined: 'pill-bad',
};

export class IdeasView {
  private status: SuggestionStatus | null = 'pending';
  private offset = 0;
  private rows: AdminSuggestion[] | null = null;
  private total = 0;
  private counts: Record<SuggestionStatus, number> | null = null;

  /** `onCounts` hears how many suggestions are in each status (the tab's badge shows those waiting). */
  constructor(
    private el: HTMLElement,
    private onCounts: (counts: Record<SuggestionStatus, number>) => void = () => {},
  ) {
    el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const filter = t.closest<HTMLButtonElement>('[data-status]');
      if (filter) {
        this.status = (filter.dataset.status || null) as SuggestionStatus | null;
        this.offset = 0;
        return void this.load();
      }
      const page = t.closest<HTMLButtonElement>('[data-page]');
      if (page) {
        this.offset = Number(page.dataset.page);
        void this.load();
      }
    });
    el.addEventListener('submit', (e) => {
      e.preventDefault();
      const form = e.target as HTMLFormElement;
      void this.save(form.dataset.id!, form);
    });
    // the reply's counter and the button's words follow what's typed and picked
    el.addEventListener('input', (e) => {
      const form = (e.target as HTMLElement).closest<HTMLFormElement>('form[data-id]');
      if (form) this.syncForm(form);
    });
  }

  show() {
    void this.load();
  }

  /** Live: a new suggestion, or one answered by other staff (main.ts holds off while a reply is being written). */
  refresh() {
    void this.load(true);
  }

  /** Just the counts, for the tab's badge while another view is on screen. */
  async loadCounts() {
    try {
      const { counts } = await ringmaster.suggestions({ limit: 1, offset: 0 });
      this.counts = counts;
      this.onCounts(counts);
    } catch {
      // the badge waits for the next look; the view reports its own errors
    }
  }

  private async load(quiet = false): Promise<void> {
    if (!this.el.querySelector('#ideas-body') || !quiet) this.el.innerHTML = `${this.head()}<div id="ideas-body"><p class="empty">Opening the box…</p></div>`;
    try {
      const res = await ringmaster.suggestions({ status: this.status, limit: LIMIT, offset: this.offset });
      // a page emptied by answering its last suggestion: back one
      if (!res.suggestions.length && this.offset > 0) {
        this.offset = Math.max(0, this.offset - LIMIT);
        return this.load(quiet);
      }
      this.rows = res.suggestions;
      this.total = res.total;
      this.counts = res.counts;
      this.onCounts(res.counts);
      this.render();
    } catch (err) {
      onApiError(err);
    }
  }

  private head() {
    const c = this.counts;
    const all = c ? Object.values(c).reduce((a, b) => a + b, 0) : null;
    const count = (n: number | null | undefined) => (n === null || n === undefined ? '' : ` <span class="num">${num(n)}</span>`);
    const filters = [
      `<button type="button" data-status="" aria-pressed="${this.status === null}">All${count(all)}</button>`,
      ...STATUS_IDS.map(
        (s) => `<button type="button" data-status="${s}" aria-pressed="${this.status === s}">${STATUSES[s].icon} ${esc(STATUSES[s].label)}${count(c?.[s])}</button>`,
      ),
    ].join('');
    const waiting = c?.pending ? ` <strong>${plural(c.pending, 'suggestion is', 'suggestions are')} waiting for an answer.</strong>` : '';
    return `<div class="view-head"><div><h2 id="h-ideas">Idea Box</h2><p class="muted">What members suggested at the Idea Box in the fair. Answer each one once (an answer can't be changed afterwards) and move it along as it goes: they see both straight away.${waiting}</p></div></div>
      <div class="segmented ideas-filter" role="group" aria-label="Show">${filters}</div>`;
  }

  private render() {
    const rows = this.rows ?? [];
    const label = this.status ? `“${STATUSES[this.status].label}”` : '';
    const body = rows.length
      ? `<div class="ideas">${rows.map(cardHtml).join('')}</div>${pagerHtml(this.offset, LIMIT, this.total)}`
      : `<div class="card"><p class="empty">${this.status === 'pending' ? 'All caught up: every suggestion has an answer. 🎉' : `No suggestions ${label ? `marked ${label}` : 'yet'}.`}</p></div>`;
    this.el.innerHTML = `${this.head()}<div id="ideas-body">${body}</div>`;
    for (const form of this.el.querySelectorAll<HTMLFormElement>('form[data-id]')) this.syncForm(form);
  }

  private syncForm(form: HTMLFormElement) {
    const row = this.rows?.find((r) => r.id === form.dataset.id);
    if (!row) return;
    const reply = form.querySelector<HTMLTextAreaElement>('textarea[name="reply"]');
    const status = form.querySelector<HTMLSelectElement>('select[name="status"]')!.value as SuggestionStatus;
    const text = reply?.value.trim() ?? '';
    const chars = form.querySelector<HTMLElement>('[data-chars]');
    if (chars && reply) {
      const left = SUGGESTION_MAX - reply.value.length;
      chars.textContent = left < 60 ? `${num(left)} characters left` : `${num(reply.value.length)} / ${num(SUGGESTION_MAX)}`;
      chars.classList.toggle('is-low', left < 60);
    }
    const button = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
    button.textContent = text ? (status !== row.status ? 'Send reply & save status' : 'Send reply') : 'Save status';
    button.disabled = !text && status === row.status;
  }

  private async save(id: string, form: HTMLFormElement) {
    const row = this.rows?.find((r) => r.id === id);
    if (!row) return;
    const reply = form.querySelector<HTMLTextAreaElement>('textarea[name="reply"]')?.value.trim() ?? '';
    const status = form.querySelector<HTMLSelectElement>('select[name="status"]')!.value as SuggestionStatus;
    const body: { status?: SuggestionStatus; reply?: string } = {};
    if (status !== row.status) body.status = status;
    if (reply) body.reply = reply;
    if (!Object.keys(body).length) return toast('Nothing to save.');
    if (reply.length > SUGGESTION_MAX) return toast(`Keep the reply to ${num(SUGGESTION_MAX)} characters.`, true);

    // an answer is for good: say so before it goes
    if (reply) {
      const ok = await ask({
        icon: '💌',
        title: `Send your reply to ${row.user.username}?`,
        body: `They'll see it at the Idea Box${body.status ? `, with the status “${STATUSES[status].label}”` : ''}. A suggestion is answered once, and the answer can't be changed afterwards.`,
        confirm: 'Send the reply',
      });
      if (!ok) return;
    }
    const button = form.querySelector<HTMLButtonElement>('[type="submit"]');
    const saved = await busy(button, () => ringmaster.updateSuggestion(id, body));
    if (!saved) {
      // answered by someone else meanwhile (a 409): show theirs
      return void this.load(true);
    }
    toast(reply ? `Reply sent to ${saved.user.username}.` : `Marked “${STATUSES[saved.status].label}”.`);
    // still in the list being shown? redraw it in place; otherwise it moves out of this filter
    if (this.status && saved.status !== this.status) return void this.load(true);
    this.rows = this.rows!.map((r) => (r.id === id ? saved : r));
    if (this.counts && body.status) {
      this.counts = { ...this.counts, [row.status]: this.counts[row.status] - 1, [saved.status]: this.counts[saved.status] + 1 };
      this.onCounts(this.counts);
    }
    this.render();
    this.el.querySelector<HTMLElement>(`form[data-id="${CSS.escape(id)}"] select`)?.focus();
  }
}

function cardHtml(s: AdminSuggestion) {
  const id = esc(s.id);
  const topic = TOPICS[s.topic];
  const status = STATUSES[s.status];
  const options = STATUS_IDS.map((x) => `<option value="${x}" ${x === s.status ? 'selected' : ''}>${STATUSES[x].icon} ${esc(STATUSES[x].label)}</option>`).join('');
  const answer = s.reply
    ? `<div class="idea-reply"><p class="idea-reply-who">💌 Answered by ${esc(s.repliedBy ?? 'staff')} · ${esc(when(s.repliedAt))}</p><p class="idea-text">${esc(s.reply)}</p></div>`
    : `<label>Reply to ${esc(s.user.username)} <span class="hint">Once only: it can't be edited after it's sent.</span>
        <textarea name="reply" rows="3" maxlength="${SUGGESTION_MAX}" placeholder="Thanks for the idea! …"></textarea></label>
       <span class="idea-chars" data-chars aria-live="polite"></span>`;
  return `<form class="idea is-${s.status}" data-id="${id}" novalidate aria-labelledby="idea-${id}">
    <div class="attraction-head"><span class="idea-topic" id="idea-${id}">${topic.icon} ${esc(topic.label)}</span><span class="pill ${STATUS_PILL[s.status]}">${status.icon} ${esc(status.label)}</span></div>
    <p class="idea-text">${esc(s.message)}</p>
    <p class="attraction-stats">From <a href="#members/${encodeURIComponent(s.user.id)}">${esc(s.user.username)}</a> · ${esc(when(s.createdAt))}${
      s.statusChangedAt ? ` · status changed ${esc(when(s.statusChangedAt))}` : ''
    }</p>
    ${answer}
    <div class="form-actions"><label class="idea-pick">Status <select name="status">${options}</select></label><button type="submit" class="btn btn-primary btn-small">Save status</button></div>
  </form>`;
}
