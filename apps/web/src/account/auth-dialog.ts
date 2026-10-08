import { api, ApiError, googleStartUrl, missingInfo, type Gender, type GoogleOutcome, type User } from './api';
import { everyHours, session } from './session';

export type AuthMode = 'signup' | 'login';
/**
 * Besides signing up and logging in: `finish` is a Google account with no account here yet, picking
 * a username; `profile` is a member who just logged in, telling us what their account is missing.
 */
type Mode = AuthMode | 'finish' | 'profile';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME = /^[a-zA-Z0-9_]+$/;
const GENDERS: readonly string[] = ['female', 'male', 'other', 'prefer_not_to_say'] satisfies Gender[];
/** The popup tells the game on this channel (apps/api/src/auth/google.controller.ts). */
const GOOGLE_CHANNEL = 'funfair-google';

/** The line under the title: a function, so the pack rules are the park's live ones. */
const COPY: Record<Mode, { kicker: string; title: string; lead: () => string; submit: string; busy: string }> = {
  signup: {
    kicker: 'Free account',
    title: 'Join the fair 🎟️',
    lead: () =>
      `A free account lets you pick up free tickets at the Ticket Booth: ${session.packSize} ${everyHours(session.cooldownHours)}, for every ride and game.`,
    submit: "Sign up — it's free",
    busy: 'Printing your ticket…',
  },
  login: {
    kicker: 'Members',
    title: 'Welcome back 🎪',
    lead: () => 'Log in to use your tickets on the coasters, the rocket, the wheel and the rest.',
    submit: 'Log in',
    busy: 'Checking your ticket…',
  },
  finish: {
    kicker: 'Almost there',
    title: 'One last thing 🎟️',
    lead: () => 'Pick a username and you’re in.',
    submit: 'Finish signing up',
    busy: 'Printing your ticket…',
  },
  profile: {
    kicker: 'Your account',
    title: 'A quick question 🎪',
    lead: () => 'Your account is missing a detail or two. It only takes a second.',
    submit: 'Save',
    busy: 'Saving…',
  },
};

type Field = 'email' | 'username' | 'password';
/** The parts of the form, each shown only in the modes that need it. */
type Group = 'modes' | 'google' | Field | 'gender' | 'terms';
type Errors = Partial<Record<Field | 'gender' | 'terms', string>>;
interface Values extends Record<Field, string> {
  gender: string;
  terms: boolean;
}

/**
 * The sign up / log in modal, on a native <dialog>: it traps focus, closes on Esc and puts the
 * focus back where it was. `open()` resolves with the user once they're in, or null if they
 * close it. "Continue with Google" opens a popup (or, where popups are blocked, leaves the page and
 * comes back through `resume()`); a new Google account then picks a username here, and anyone who
 * logs in with details missing (gender, the Terms) is asked for them before the dialog lets go.
 */
class AuthDialog {
  private el = document.getElementById('auth') as HTMLDialogElement;
  private form = this.el.querySelector('form')!;
  private kicker = this.el.querySelector<HTMLElement>('#auth-kicker')!;
  private title = this.el.querySelector<HTMLElement>('#auth-title')!;
  private lead = this.el.querySelector<HTMLElement>('#auth-lead')!;
  private errorEl = this.el.querySelector<HTMLElement>('#auth-error')!;
  private submitBtn = this.el.querySelector<HTMLButtonElement>('.auth-submit')!;
  private closeBtn = this.el.querySelector<HTMLButtonElement>('[data-auth-close]')!;
  private revealBtn = this.el.querySelector<HTMLButtonElement>('.auth-reveal')!;
  private googleBtn = this.el.querySelector<HTMLButtonElement>('.auth-google-btn')!;
  private googleNote = this.el.querySelector<HTMLElement>('.auth-google-note')!;
  private passwordHint = this.el.querySelector<HTMLElement>('#auth-password-hint')!;
  private emailLabel = this.el.querySelector<HTMLLabelElement>('label[for="auth-email"]')!;
  private modeBtns = [...this.el.querySelectorAll<HTMLButtonElement>('[data-auth-mode]')];
  private groups = [...this.el.querySelectorAll<HTMLElement>('[data-group]')];
  private inputs: Record<Field, HTMLInputElement> = {
    email: this.el.querySelector('#auth-email')!,
    username: this.el.querySelector('#auth-username')!,
    password: this.el.querySelector('#auth-password')!,
  };
  private gender = this.el.querySelector<HTMLSelectElement>('#auth-gender')!;
  /** Signing up: 15 or older (or a parent's permission), and the Terms and Privacy Policy accepted. */
  private terms = this.el.querySelector<HTMLInputElement>('#auth-terms')!;
  private mode: Mode = 'signup';
  /** Builds the line under the title; run again whenever the park's rules change while it's open. */
  private leadFn: () => string = COPY.signup.lead;
  private busy = false;
  private pending: Promise<User | null> | null = null;
  private resolve: ((user: User | null) => void) | null = null;
  private returnFocus: HTMLElement | null = null;
  private toggles = new Set<(open: boolean) => void>();
  /** The server has Google sign-in set up (the button shows). */
  private googleReady = false;
  /** This tab sent someone to Google and is waiting to hear how it went. */
  private googleStarted = false;
  /** In `profile` mode: what the account is missing. */
  private missing: { gender: boolean; terms: boolean } = { gender: false, terms: false };

  constructor() {
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.submit();
    });
    this.closeBtn.addEventListener('click', () => this.close());
    for (const b of this.modeBtns) b.addEventListener('click', () => this.setMode(b.dataset.authMode as AuthMode, true));
    this.revealBtn.addEventListener('click', () => {
      const show = this.inputs.password.type === 'password';
      this.inputs.password.type = show ? 'text' : 'password';
      this.revealBtn.textContent = show ? 'Hide' : 'Show';
      this.revealBtn.setAttribute('aria-pressed', String(show));
      this.inputs.password.focus();
    });
    this.googleBtn.addEventListener('click', () => this.continueWithGoogle());
    for (const [field, input] of Object.entries(this.inputs) as [Field, HTMLInputElement][])
      input.addEventListener('input', () => this.fieldError(field, ''));
    this.gender.addEventListener('change', () => this.genderError(''));
    this.terms.addEventListener('change', () => this.termsError(''));
    // the backdrop is the dialog element itself; only a click that starts and ends there closes it
    // (so dragging a text selection out of a field doesn't)
    let downOnBackdrop = false;
    this.el.addEventListener('pointerdown', (e) => (downOnBackdrop = e.target === this.el));
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el && downOnBackdrop) this.close();
    });
    // Esc: no closing mid-request, so a ticket isn't issued to a dialog that's gone
    this.el.addEventListener('cancel', (e) => this.busy && e.preventDefault());
    this.el.addEventListener('close', () => this.onClosed());
    // the pack rules can change in the office while the dialog is open
    session.onChange(() => this.el.open && this.renderLead());

    // the Google popup says how it went on a channel every tab of the fair hears
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(GOOGLE_CHANNEL);
      channel.addEventListener('message', (e: MessageEvent<GoogleOutcome>) => void this.onGoogleMessage(e.data));
    }
    api
      .googleEnabled()
      .then(({ enabled }) => {
        this.googleReady = enabled === true;
        this.showGroups();
      })
      .catch(() => {});
  }

  get isOpen() {
    return this.el.open;
  }

  /** Called with true when the dialog opens and false when it closes (the game pauses its keys). */
  onToggle(fn: (open: boolean) => void) {
    this.toggles.add(fn);
  }

  /**
   * Opens in `mode`; `lead` replaces the default line under the title (e.g. naming a ride). Pass a
   * function when it quotes the park's rules, so it stays live.
   */
  open(mode: AuthMode, lead?: string | (() => string)): Promise<User | null> {
    return this.show(mode, typeof lead === 'function' ? lead : lead !== undefined ? () => lead : undefined);
  }

  /**
   * The page came back from Google (`?google=` in the address, where the popup couldn't open):
   * finishes the signup, or asks for what the account is missing, or shows what went wrong.
   * Resolves like `open()`; at once with the user when there's nothing to ask.
   */
  async resume(outcome: GoogleOutcome): Promise<User | null> {
    if (outcome.google === 'cancelled') return null;
    if (outcome.google === 'login') {
      const user = await session.refresh();
      if (user && !missingInfo(user)) return user;
    }
    const done = this.show(outcome.google === 'signup' ? 'signup' : 'login');
    this.googleStarted = true;
    void this.onGoogle(outcome);
    return done;
  }

  close(user: User | null = null) {
    if (this.busy) return;
    this.settle(user ?? this.keptUser());
    if (this.el.open) this.el.close();
  }

  private show(mode: Mode, lead?: () => string): Promise<User | null> {
    this.setMode(mode);
    this.leadFn = lead ?? COPY[mode].lead;
    this.renderLead();
    if (this.el.open && this.pending) return this.pending;
    const active = document.activeElement;
    this.returnFocus = active instanceof HTMLElement && active !== document.body ? active : null;
    this.reset();
    this.el.showModal();
    this.focusFirst();
    for (const fn of this.toggles) fn(true);
    return (this.pending = new Promise((r) => (this.resolve = r)));
  }

  /** Closing while asked for missing details still leaves them logged in ("later"). */
  private keptUser() {
    return this.mode === 'profile' ? session.user : null;
  }

  private settle(user: User | null) {
    this.resolve?.(user);
    this.resolve = null;
    this.pending = null;
  }

  private onClosed() {
    this.settle(this.keptUser());
    for (const fn of this.toggles) fn(false);
    // browsers mostly do this themselves; make sure focus doesn't end up on <body>
    const back = this.returnFocus;
    this.returnFocus = null;
    if (back?.isConnected && !back.closest('[inert], [hidden]') && (!document.activeElement || document.activeElement === document.body))
      back.focus({ preventScroll: true });
  }

  private setMode(mode: Mode, user = false) {
    if (this.busy) return;
    this.mode = mode;
    const c = COPY[mode];
    this.kicker.textContent = c.kicker;
    this.title.textContent = c.title;
    this.submitBtn.textContent = c.submit;
    if (user) {
      this.leadFn = c.lead;
      this.renderLead();
    }
    for (const b of this.modeBtns) b.setAttribute('aria-pressed', String(b.dataset.authMode === mode));
    this.showGroups();
    const signup = mode === 'signup';
    // logging in takes the email or the username in the one field
    this.emailLabel.textContent = mode === 'login' ? 'Email or username' : 'Email';
    this.inputs.email.type = mode === 'login' ? 'text' : 'email';
    this.inputs.email.inputMode = mode === 'login' ? 'text' : 'email';
    this.inputs.email.autocomplete = mode === 'login' ? 'username' : 'email';
    this.passwordHint.hidden = !signup;
    this.inputs.password.autocomplete = signup ? 'new-password' : 'current-password';
    this.inputs.password.setAttribute('aria-describedby', signup ? 'auth-password-hint auth-password-error' : 'auth-password-error');
    this.errorEl.textContent = '';
    this.setGoogleNote('');
    for (const f of ['username', 'password'] as const) this.fieldError(f, '');
    this.genderError('');
    this.termsError('');
    if (user) this.focusFirst();
  }

  private shows(group: Group): boolean {
    const m = this.mode;
    const entry = m === 'signup' || m === 'login';
    switch (group) {
      case 'modes':
      case 'email':
      case 'password':
        return entry;
      case 'google':
        return entry && this.googleReady;
      case 'username':
        return m === 'signup' || m === 'finish';
      case 'gender':
        return m === 'signup' || m === 'finish' || (m === 'profile' && this.missing.gender);
      case 'terms':
        return m === 'signup' || m === 'finish' || (m === 'profile' && this.missing.terms);
    }
  }

  /** Shows the parts of the form this mode needs; the rest are hidden and disabled (so autofill leaves them be). */
  private showGroups() {
    for (const el of this.groups) {
      const on = this.shows(el.dataset.group as Group);
      el.hidden = !on;
      // while busy, text fields only go read-only (setBusy), so they keep the focus
      for (const control of el.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input, select, button')) {
        if (control === this.revealBtn) continue;
        const text = control instanceof HTMLInputElement && control !== this.terms;
        control.disabled = !on || (this.busy && !text);
      }
    }
  }

  private renderLead() {
    this.lead.textContent = this.leadFn();
  }

  private reset() {
    this.form.reset();
    this.setBusy(false);
    this.inputs.password.type = 'password';
    this.revealBtn.textContent = 'Show';
    this.revealBtn.setAttribute('aria-pressed', 'false');
    this.errorEl.textContent = '';
    this.setGoogleNote('');
    for (const f of Object.keys(this.inputs) as Field[]) this.fieldError(f, '');
    this.genderError('');
    this.termsError('');
  }

  private focusFirst() {
    const order: (Field | 'gender' | 'terms')[] = ['email', 'username', 'password', 'gender', 'terms'];
    const empty = (f: Field | 'gender' | 'terms') =>
      f === 'gender' ? !this.gender.value : f === 'terms' ? !this.terms.checked : !this.inputs[f].value;
    const visible = order.filter((f) => this.shows(f));
    const first = visible.find(empty) ?? visible[0];
    if (first) this.control(first).focus();
    else this.submitBtn.focus();
  }

  private control(f: Field | 'gender' | 'terms'): HTMLElement {
    return f === 'gender' ? this.gender : f === 'terms' ? this.terms : this.inputs[f];
  }

  private values(): Values {
    return {
      email: this.inputs.email.value.trim().toLowerCase(),
      username: this.inputs.username.value.trim(),
      password: this.inputs.password.value,
      gender: this.gender.value,
      terms: this.terms.checked,
    };
  }

  /** The same rules the server applies, so most mistakes are caught before a round trip. */
  private validate(v: Values): Errors {
    const e: Errors = {};
    if (this.mode === 'login') {
      if (!v.email) e.email = 'Enter your email or username.';
    } else if (this.shows('email')) {
      if (!v.email) e.email = 'Enter your email address.';
      else if (!EMAIL.test(v.email)) e.email = 'That doesn’t look like an email address.';
    }
    if (this.shows('username')) {
      if (v.username.length < 3 || v.username.length > 20) e.username = 'Pick a username of 3 to 20 characters.';
      else if (!USERNAME.test(v.username)) e.username = 'Use only letters, numbers and underscores.';
    }
    if (this.mode === 'signup') {
      if (v.password.length < 8) e.password = 'Use at least 8 characters.';
      else if (v.password.length > 72) e.password = 'Use at most 72 characters.';
    } else if (this.mode === 'login' && !v.password) e.password = 'Enter your password.';
    if (this.shows('gender') && !GENDERS.includes(v.gender)) e.gender = 'Choose one of the options.';
    if (this.shows('terms') && !v.terms) e.terms = 'Please tick the box to accept the Terms of Service and the Privacy Policy.';
    return e;
  }

  private fieldError(field: Field, message: string) {
    const input = this.inputs[field];
    const out = this.el.querySelector<HTMLElement>(`#auth-${field}-error`)!;
    out.textContent = message;
    out.hidden = !message;
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  private genderError(message: string) {
    const out = this.el.querySelector<HTMLElement>('#auth-gender-error')!;
    out.textContent = message;
    out.hidden = !message;
    if (message) this.gender.setAttribute('aria-invalid', 'true');
    else this.gender.removeAttribute('aria-invalid');
  }

  private termsError(message: string) {
    const out = this.el.querySelector<HTMLElement>('#auth-terms-error')!;
    out.textContent = message;
    out.hidden = !message;
    if (message) this.terms.setAttribute('aria-invalid', 'true');
    else this.terms.removeAttribute('aria-invalid');
  }

  private setGoogleNote(text: string) {
    this.googleNote.textContent = text;
    this.googleNote.hidden = !text;
  }

  private setBusy(busy: boolean) {
    this.busy = busy;
    this.form.setAttribute('aria-busy', String(busy));
    this.submitBtn.disabled = busy;
    this.submitBtn.textContent = busy ? COPY[this.mode].busy : COPY[this.mode].submit;
    this.closeBtn.disabled = busy;
    for (const input of Object.values(this.inputs)) input.readOnly = busy;
    this.showGroups();
    // the Google button stays usable, but not while a request is out
    this.googleBtn.disabled = busy || !this.shows('google');
  }

  private async submit() {
    if (this.busy) return;
    const v = this.values();
    const errors = this.validate(v);
    this.errorEl.textContent = '';
    for (const f of Object.keys(this.inputs) as Field[]) this.fieldError(f, errors[f] ?? '');
    this.genderError(errors.gender ?? '');
    this.termsError(errors.terms ?? '');
    const invalid = (['email', 'username', 'password', 'gender', 'terms'] as const).find((f) => errors[f]);
    if (invalid) {
      this.control(invalid).focus();
      return;
    }

    const mode = this.mode;
    const gender = v.gender as Gender;
    this.setBusy(true);
    let user: User | null = null;
    try {
      if (mode === 'signup') user = await session.signup({ email: v.email, username: v.username, password: v.password, gender });
      else if (mode === 'login') user = await session.login({ login: v.email, password: v.password });
      else if (mode === 'finish') user = await session.googleSignup({ username: v.username, gender });
      else
        user = await session.updateProfile({
          ...(this.missing.gender ? { gender } : {}),
          ...(this.missing.terms ? { acceptTerms: true as const } : {}),
        });
    } catch (err) {
      this.showServerError(err);
    } finally {
      this.setBusy(false);
    }
    if (user && mode === 'login') this.loggedIn(user);
    else if (user) this.close(user);
    // the submit button was disabled while busy, which drops the focus: bring it back
    else if (!this.el.contains(document.activeElement)) this.submitBtn.focus();
  }

  /** In: done, unless the account is missing something, which is asked for first. */
  private loggedIn(user: User) {
    const missing = missingInfo(user);
    if (!missing) return this.close(user);
    this.missing = missing;
    this.form.reset();
    this.setMode('profile', true);
  }

  private showServerError(err: unknown) {
    if (!(err instanceof ApiError)) {
      this.errorEl.textContent = 'Something went wrong. Please try again.';
      return;
    }
    // a taken email or username belongs next to its field (when it's on the form)
    if (err.status === 409) {
      const field: Field | null = /username/i.test(err.message) ? 'username' : /email/i.test(err.message) ? 'email' : null;
      if (field && this.shows(field)) {
        this.fieldError(field, err.message);
        this.inputs[field].focus();
        return;
      }
    }
    // the server insists on the Terms too (e.g. an old page that didn't send them)
    if (err.status === 400 && /terms|privacy/i.test(err.message) && this.shows('terms')) {
      this.termsError(err.message);
      this.terms.focus();
      return;
    }
    // a username that passes for staff, or isn't allowed
    if (err.status === 400 && /username/i.test(err.message) && this.shows('username')) {
      this.fieldError('username', err.message);
      this.inputs.username.focus();
      this.inputs.username.select();
      return;
    }
    if (err.status === 400 && /gender/i.test(err.message) && this.shows('gender')) {
      this.genderError(err.message);
      this.gender.focus();
      return;
    }
    this.errorEl.textContent = err.message;
    if (err.status === 401 && this.mode === 'login') {
      this.inputs.password.focus();
      this.inputs.password.select();
    }
  }

  // ---------- Continue with Google ----------

  /**
   * Opens Google in a popup, so the fair stays loaded behind it. Where popups are blocked (or the
   * popup can't report back), the whole page goes to Google and `resume()` picks up on return.
   */
  private continueWithGoogle() {
    if (this.busy) return;
    this.errorEl.textContent = '';
    const w = 480;
    const h = 640;
    const left = Math.max(0, window.screenX + (window.outerWidth - w) / 2);
    const top = Math.max(0, window.screenY + (window.outerHeight - h) / 2);
    const popup =
      typeof BroadcastChannel !== 'undefined'
        ? window.open(googleStartUrl(true), 'funfair-google', `popup,width=${w},height=${h},left=${Math.round(left)},top=${Math.round(top)}`)
        : null;
    if (!popup) {
      window.location.assign(googleStartUrl(false));
      return;
    }
    this.googleStarted = true;
    this.setGoogleNote('Finish signing in in the Google window…');
  }

  private async onGoogleMessage(outcome: GoogleOutcome) {
    if (!outcome || typeof outcome !== 'object' || typeof outcome.google !== 'string') return;
    // another tab's trip to Google: catch up with who's logged in, nothing to show here
    if (!this.googleStarted) {
      if (outcome.google === 'login') void session.refresh();
      return;
    }
    // the dialog was closed while Google was open: bring it back if there's more to do
    if (!this.el.open) return void this.resume(outcome);
    await this.onGoogle(outcome);
  }

  /** How the trip to Google went, with the dialog open: carry on from there. */
  private async onGoogle(outcome: GoogleOutcome) {
    this.googleStarted = false;
    this.setGoogleNote('');
    if (outcome.google === 'cancelled') return;
    if (outcome.google === 'error') {
      this.errorEl.textContent = outcome.message || 'Signing in with Google didn’t work. Please try again.';
      return;
    }

    this.setBusy(true);
    try {
      if (outcome.google === 'login') {
        const user = await session.refresh();
        this.setBusy(false);
        if (user) this.loggedIn(user);
        else this.errorEl.textContent = 'Signing in with Google didn’t work. Please try again.';
        return;
      }
      const pending = await api.googlePending();
      this.setBusy(false);
      this.form.reset();
      this.setMode('finish', true);
      this.lead.textContent = `Signed in with Google as ${pending.email}. Pick a username and you’re in.`;
      this.leadFn = () => `Signed in with Google as ${pending.email}. Pick a username and you’re in.`;
      this.inputs.username.value = pending.username;
      this.focusFirst();
    } catch (err) {
      this.setBusy(false);
      this.showServerError(err);
    }
  }
}

export const authDialog = new AuthDialog();
