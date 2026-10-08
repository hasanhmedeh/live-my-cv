// The Idea Box: step up to the kiosk on the entrance plaza and leave a suggestion for the park.
// The camera moves to an over-the-shoulder view of the post box, and a sheet opens beside it with
// two tabs: the form (what it's about, and what to say) and the member's own ideas, each with where
// it stands and staff's answer from The Ringmaster's Office. Answers arrive live (session.ts).
import * as THREE from 'three';
import { ApiError, SUGGESTION_MAX, SuggestionLimitError, type Suggestion, type SuggestionStatus, type SuggestionTopic } from '../account/api';
import type { AuthMode } from '../account/auth-dialog';
import { STATUSES, TOPIC_IDS, TOPICS } from '../account/ideas';
import { session } from '../account/session';
import type { Sfx } from './audio';
import { ideaKioskPoint, type IdeaKiosk } from './attractions/idea-kiosk';
import { escapeHtml } from './ui';

type Tab = 'new' | 'mine';
const TABS: Tab[] = ['new', 'mine'];

/** The way an idea goes, as the little track on each card shows it (declined steps off it). */
const TRACK: SuggestionStatus[] = ['pending', 'accepted', 'in_development', 'done'];

/** "8 Oct, 14:05" in the visitor's time zone. */
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export interface IdeasOptions {
  root: HTMLElement;
  kiosk: IdeaKiosk;
  sfx: Sfx;
  /** Sign up / log in from the kiosk. */
  onAuth: (mode: AuthMode) => void;
  /** Back to the fair (Esc, the button). */
  onLeave: () => void;
}

export class Ideas {
  isOpen = false;
  private tab: Tab = 'new';
  private panel: HTMLElement;
  private count: HTMLElement;
  /** What the visitor has typed so far, kept across redraws and visits. */
  private draft = { topic: 'attraction' as SuggestionTopic, message: '' };
  private sending = false;
  /** Just posted: the form says thanks until the visitor writes another. */
  private posted: Suggestion | null = null;
  /** Answers that were news when the list was opened: they stay highlighted while it's on screen. */
  private fresh = new Set<string>();
  private loading = false;
  /** Whose ideas the sheet shows. */
  private who = session.user?.id ?? null;

  constructor(private o: IdeasOptions) {
    const r = o.root;
    this.panel = r.querySelector('[data-ideas-panel]')!;
    this.count = r.querySelector('[data-ideas-count]')!;

    r.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-ideas-tab], [data-ideas-leave], [data-ideas-another], [data-auth]');
      if (!b) return;
      if (b.dataset.ideasTab) this.choose(b.dataset.ideasTab as Tab);
      else if (b.hasAttribute('data-ideas-leave')) this.o.onLeave();
      else if (b.hasAttribute('data-ideas-another')) {
        this.posted = null;
        this.choose('new', true);
      } else if (b.dataset.auth) this.o.onAuth(b.dataset.auth as AuthMode);
    });
    r.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.send();
    });
    // the draft follows the form, and the counter the text
    r.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement | HTMLTextAreaElement;
      if (t.name === 'message') {
        this.draft.message = t.value;
        this.renderChars();
        this.error('');
      } else if (t.name === 'topic') this.draft.topic = t.value as SuggestionTopic;
    });
    // the kiosk has the keyboard (the game's keys don't reach it): Esc goes back to the fair
    r.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      this.o.onLeave();
    });
    // the two tabs: arrow keys move between them
    r.querySelector('[role="tablist"]')!.addEventListener('keydown', (e) => {
      const k = (e as KeyboardEvent).key;
      if (k !== 'ArrowRight' && k !== 'ArrowLeft' && k !== 'Home' && k !== 'End') return;
      e.preventDefault();
      const next = k === 'Home' ? 'new' : k === 'End' ? 'mine' : TABS[(TABS.indexOf(this.tab) + 1) % TABS.length];
      this.choose(next);
      r.querySelector<HTMLElement>(`[data-ideas-tab="${next}"]`)?.focus();
    });

    // signed in or out at the kiosk: the sheet starts over for whoever it is now (and only then:
    // the form isn't redrawn under the visitor's fingers for a change of ticket balance)
    session.onChange(() => {
      const who = session.user?.id ?? null;
      if (who === this.who) return;
      this.who = who;
      this.posted = null;
      if (this.isOpen) this.render();
    });
    // an idea posted, or news from staff: the list catches up, or just the tab's badge while writing
    session.onSuggestions(() => {
      if (!this.isOpen) return;
      if (this.tab === 'mine') {
        this.seeNews();
        this.render();
      } else this.renderTabs();
    });
  }

  // ---------- Stepping up and leaving ----------

  /** The visitor is at the kiosk: the sheet opens on their news if there is any, the form otherwise. */
  open() {
    this.isOpen = true;
    this.o.root.hidden = false;
    this.posted = null;
    this.tab = session.suggestions?.unread ? 'mine' : 'new';
    if (this.tab === 'mine') this.seeNews();
    this.render();
    if (session.user) {
      this.loading = !session.suggestions;
      void session.loadSuggestions().finally(() => {
        this.loading = false;
        if (this.isOpen) this.render();
      });
    }
    this.o.sfx.chime();
    const first = this.tab === 'new' && session.user ? this.panel.querySelector<HTMLElement>('textarea') : this.o.root.querySelector<HTMLElement>(`[data-ideas-tab="${this.tab}"]`);
    first?.focus({ preventScroll: true });
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.o.root.hidden = true;
    this.fresh.clear();
  }

  /** Where the camera looks from at the kiosk: over the visitor's right shoulder, at the post box and the bulb. */
  shot() {
    const pos = ideaKioskPoint(-1.8, 5.9);
    const look = ideaKioskPoint(0.15, 0);
    return { pos: new THREE.Vector3(pos.x, 2.95, pos.z), look: new THREE.Vector3(look.x, 2.75, look.z) };
  }

  /** Where the visitor stands at the kiosk, facing its slot. */
  get standSpot() {
    const p = ideaKioskPoint(0, 1.2);
    return { x: p.x, z: p.z, heading: Math.PI / 2 };
  }

  /** How far to shift the picture so the kiosk shows beside the sheet, not under it (as at the booth). */
  viewOffset(w: number, h: number) {
    const sheet = this.o.root.querySelector<HTMLElement>('.shop-sheet');
    if (!sheet) return { x: 0, y: 0 };
    const r = sheet.getBoundingClientRect();
    return w > 720 ? { x: Math.round(Math.min(r.width, w * 0.6) / 2), y: 0 } : { x: 0, y: Math.round(Math.min(r.height, h * 0.7) / 2) };
  }

  // ---------- The tabs ----------

  private choose(tab: Tab, force = false) {
    if (tab === this.tab && !force) return;
    this.tab = tab;
    if (tab === 'mine') this.seeNews();
    this.render();
    this.panel.scrollTop = 0;
    if (tab === 'new') this.panel.querySelector<HTMLElement>('textarea')?.focus({ preventScroll: true });
  }

  /** The list is on screen: what's new from staff stays highlighted for now, and counts as read. */
  private seeNews() {
    for (const s of session.suggestions?.suggestions ?? []) if (s.unread) this.fresh.add(s.id);
    session.markSuggestionsSeen();
  }

  /** The tabs: which is chosen, and how many answers are news. */
  private renderTabs() {
    for (const b of this.o.root.querySelectorAll<HTMLElement>('[role="tab"][data-ideas-tab]')) {
      const on = b.dataset.ideasTab === this.tab;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    this.panel.setAttribute('aria-labelledby', `ideas-tab-${this.tab}`);
    const unread = session.suggestions?.unread ?? 0;
    this.count.hidden = !unread;
    this.count.textContent = String(unread);
    this.count.setAttribute('aria-label', `${unread} new ${unread === 1 ? 'answer' : 'answers'}`);
  }

  private render() {
    this.renderTabs();
    // keep the keyboard where it was across a redraw of the form
    const active = document.activeElement as HTMLElement | null;
    const focused = active && this.panel.contains(active) ? (active.getAttribute('name') ?? null) : null;
    this.panel.innerHTML = this.tab === 'new' ? this.formHtml() : this.listHtml();
    if (this.tab === 'new') {
      this.renderChars();
      if (focused) this.panel.querySelector<HTMLElement>(`[name="${focused}"]${focused === 'topic' ? ':checked' : ''}`)?.focus({ preventScroll: true });
    }
  }

  private formHtml() {
    if (!session.user)
      return `<div class="ideas-intro"><p class="ideas-intro-art" aria-hidden="true">💡</p><div>
          <h3>Help us build the fair</h3>
          <p>A ride you'd love, a treat you miss, something that's broken: drop it in the box. Staff read every one, answer it, and you can follow what becomes of it right here.</p>
          <p>Ideas come from members, so we can tell you what happens to yours.</p>
          <p class="shop-actions"><button type="button" class="btn btn-primary" data-auth="signup">Sign up, it's free</button><button type="button" class="btn btn-outline" data-auth="login">Log in</button></p>
        </div></div>`;
    if (this.posted)
      return `<div class="ideas-thanks" role="status"><p class="ideas-intro-art" aria-hidden="true">💌</p>
          <h3>It's in the box!</h3>
          <p>Thanks, ${escapeHtml(session.user.username)}. Staff will read your idea in The Ringmaster's Office and answer it. You'll find their answer, and where your idea stands, under <strong>My ideas</strong>.</p>
          <p class="shop-actions"><button type="button" class="btn btn-primary" data-ideas-tab="mine">See my ideas</button><button type="button" class="btn btn-outline" data-ideas-another>Share another</button></p>
        </div>`;
    const topics = TOPIC_IDS.map(
      (id) =>
        `<label class="ideas-topic"><input type="radio" name="topic" value="${id}" ${id === this.draft.topic ? 'checked' : ''} /><span><b aria-hidden="true">${TOPICS[id].icon}</b> ${escapeHtml(TOPICS[id].label)}</span></label>`,
    ).join('');
    return `<form class="ideas-form" novalidate>
        <fieldset class="ideas-topics"><legend>What's it about?</legend>${topics}</fieldset>
        <label class="ideas-field" for="ideas-message">Your idea</label>
        <textarea id="ideas-message" name="message" rows="5" maxlength="${SUGGESTION_MAX}" aria-describedby="ideas-chars ideas-error" placeholder="${escapeHtml(this.placeholder())}">${escapeHtml(this.draft.message)}</textarea>
        <div class="ideas-form-foot">
          <span class="ideas-chars" id="ideas-chars" data-ideas-chars></span>
          <button type="submit" class="btn btn-primary" ${this.sending ? 'aria-busy="true"' : ''}>${this.sending ? 'Posting…' : 'Post it in the box 💌'}</button>
        </div>
        <p class="ideas-error" id="ideas-error" role="alert" data-ideas-error></p>
      </form>
      <p class="shop-note">Staff read every idea in The Ringmaster's Office. They answer each one once, and mark where it stands: waiting, accepted, in development, done or declined.</p>`;
  }

  private placeholder() {
    switch (this.draft.topic) {
      case 'attraction':
        return 'A log flume by the lake, with a big splash at the end…';
      case 'shop':
        return 'Hot chocolate at the booth for chilly evenings…';
      case 'park':
        return 'More benches near the Giant Wheel…';
      case 'problem':
        return 'What happened, and where? E.g. the kart got stuck at the second bend…';
      default:
        return 'Tell the Ringmaster anything…';
    }
  }

  private renderChars() {
    const el = this.panel.querySelector<HTMLElement>('[data-ideas-chars]');
    if (!el) return;
    const left = SUGGESTION_MAX - this.draft.message.length;
    el.textContent = left < 60 ? `${left} characters left` : `${this.draft.message.length} / ${SUGGESTION_MAX}`;
    el.classList.toggle('is-low', left < 60);
  }

  private error(text: string) {
    const el = this.panel.querySelector<HTMLElement>('[data-ideas-error]');
    if (el) el.textContent = text;
  }

  private listHtml() {
    if (!session.user)
      return `<div class="ideas-intro"><p class="ideas-intro-art" aria-hidden="true">📬</p><div><h3>Your ideas live here</h3>
          <p>Log in to see the ideas you've shared, where they stand and what staff said.</p>
          <p class="shop-actions"><button type="button" class="btn btn-primary" data-auth="login">Log in</button><button type="button" class="btn btn-outline" data-auth="signup">Sign up</button></p></div></div>`;
    const mine = session.suggestions;
    if (!mine) return `<p class="shop-note">${this.loading ? 'Opening the box…' : 'Can’t reach the box right now. Try again in a moment.'}</p>`;
    if (!mine.suggestions.length)
      return `<div class="ideas-intro"><p class="ideas-intro-art" aria-hidden="true">📭</p><div><h3>Nothing in the box yet</h3>
          <p>Ideas you share show up here, with staff's answer and where each one stands.</p>
          <p class="shop-actions"><button type="button" class="btn btn-primary" data-ideas-tab="new">Share an idea</button></p></div></div>`;
    const more = mine.total > mine.suggestions.length ? `<p class="shop-note">Showing your latest ${mine.suggestions.length} of ${mine.total}.</p>` : '';
    return `<ol class="ideas-list">${mine.suggestions.map((s) => this.cardHtml(s)).join('')}</ol>${more}`;
  }

  private cardHtml(s: Suggestion) {
    const topic = TOPICS[s.topic];
    const status = STATUSES[s.status];
    const news = this.fresh.has(s.id);
    const reply = s.reply
      ? `<div class="ideas-reply"><p class="ideas-reply-who">🎩 ${escapeHtml(s.repliedBy ?? 'Staff')} <span>· answered ${escapeHtml(when(s.repliedAt ?? s.createdAt))}</span></p><p class="ideas-text">${escapeHtml(s.reply)}</p></div>`
      : s.status === 'pending'
        ? '<p class="ideas-waiting">No answer yet. Staff read every idea, so hang tight!</p>'
        : '';
    return `<li class="ideas-card is-${s.status}${news ? ' is-news' : ''}">
        <div class="ideas-card-head">
          <span class="ideas-chip">${topic.icon} ${escapeHtml(topic.label)}</span>
          ${news ? '<span class="ideas-new">New answer</span>' : ''}
          <span class="ideas-status is-${s.status}">${status.icon} ${escapeHtml(status.label)}</span>
        </div>
        <p class="ideas-text">${escapeHtml(s.message)}</p>
        <p class="ideas-meta">Shared ${escapeHtml(when(s.createdAt))}${s.statusChangedAt ? ` · updated ${escapeHtml(when(s.statusChangedAt))}` : ''}</p>
        ${trackHtml(s.status)}
        ${reply}
      </li>`;
  }

  // ---------- Posting ----------

  private async send() {
    if (this.sending || !session.user) return;
    const message = this.draft.message.trim();
    if (!message) {
      this.error('Write your idea first.');
      this.panel.querySelector<HTMLElement>('textarea')?.focus();
      return;
    }
    this.sending = true;
    this.render();
    try {
      this.posted = await session.suggest(this.draft.topic, message);
      this.draft.message = '';
      this.o.kiosk.post();
      this.o.sfx.ding();
    } catch (err) {
      this.o.sfx.beep();
      this.sending = false;
      this.render();
      this.error(
        err instanceof SuggestionLimitError
          ? `${err.message}${err.nextAt ? ` (from ${when(err.nextAt)})` : ''}`
          : err instanceof ApiError && err.status === 401
            ? 'Your session ran out. Log in again to post your idea (it’s still here).'
            : err instanceof ApiError
              ? err.message
              : 'The box is stuck. Try again in a moment?',
      );
      this.panel.querySelector<HTMLElement>('textarea')?.focus();
      return;
    }
    this.sending = false;
    this.render();
    this.panel.querySelector<HTMLElement>('[data-ideas-tab="mine"]')?.focus({ preventScroll: true });
  }
}

/** Waiting → Accepted → In development → Done, lit up to where the idea is (declined says so instead). */
function trackHtml(status: SuggestionStatus) {
  if (status === 'declined') return `<p class="ideas-blurb">${escapeHtml(STATUSES.declined.blurb)}</p>`;
  const at = TRACK.indexOf(status);
  const steps = TRACK.map((s, i) => `<li class="${i < at ? 'is-past' : i === at ? 'is-now' : ''}" ${i === at ? 'aria-current="step"' : ''}>${escapeHtml(STATUSES[s].label)}</li>`).join('');
  return `<ol class="ideas-track" aria-label="Progress">${steps}</ol><p class="ideas-blurb">${escapeHtml(STATUSES[status].blurb)}</p>`;
}
