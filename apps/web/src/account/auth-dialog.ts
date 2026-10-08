import { ApiError, type User } from './api';
import { session } from './session';

export type AuthMode = 'signup' | 'login';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME = /^[a-zA-Z0-9_]+$/;

const COPY: Record<AuthMode, { kicker: string; title: string; lead: string; submit: string; busy: string }> = {
  signup: {
    kicker: 'Free account',
    title: 'Join the fair 🎟️',
    lead: 'A free account lets you pick up free tickets at the Ticket Booth: 20 every 5 hours, for every ride and game.',
    submit: "Sign up — it's free",
    busy: 'Printing your ticket…',
  },
  login: {
    kicker: 'Members',
    title: 'Welcome back 🎪',
    lead: 'Log in to use your tickets on the coasters, the rocket, the wheel and the rest.',
    submit: 'Log in',
    busy: 'Checking your ticket…',
  },
};

type Field = 'email' | 'username' | 'password';
type Errors = Partial<Record<Field | 'terms', string>>;

/** The same rules the server applies, so most mistakes are caught before a round trip. */
function validate(mode: AuthMode, v: Record<Field, string>, terms: boolean): Errors {
  const e: Errors = {};
  if (!v.email) e.email = 'Enter your email address.';
  else if (!EMAIL.test(v.email)) e.email = 'That doesn’t look like an email address.';
  if (mode === 'signup') {
    if (v.username.length < 3 || v.username.length > 20) e.username = 'Pick a username of 3 to 20 characters.';
    else if (!USERNAME.test(v.username)) e.username = 'Use only letters, numbers and underscores.';
    if (v.password.length < 8) e.password = 'Use at least 8 characters.';
    else if (v.password.length > 72) e.password = 'Use at most 72 characters.';
    if (!terms) e.terms = 'Please tick the box to accept the Terms of Service and the Privacy Policy.';
  } else if (!v.password) e.password = 'Enter your password.';
  return e;
}

/**
 * The sign up / log in modal, on a native <dialog>: it traps focus, closes on Esc and puts the
 * focus back where it was. `open()` resolves with the user once they're in, or null if they
 * close it.
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
  private modeBtns = [...this.el.querySelectorAll<HTMLButtonElement>('[data-auth-mode]')];
  private inputs: Record<Field, HTMLInputElement> = {
    email: this.el.querySelector('#auth-email')!,
    username: this.el.querySelector('#auth-username')!,
    password: this.el.querySelector('#auth-password')!,
  };
  /** Signing up: 15 or older (or a parent's permission), and the Terms and Privacy Policy accepted. */
  private terms = this.el.querySelector<HTMLInputElement>('#auth-terms')!;
  private mode: AuthMode = 'signup';
  private busy = false;
  private pending: Promise<User | null> | null = null;
  private resolve: ((user: User | null) => void) | null = null;
  private returnFocus: HTMLElement | null = null;
  private toggles = new Set<(open: boolean) => void>();

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
    for (const [field, input] of Object.entries(this.inputs) as [Field, HTMLInputElement][])
      input.addEventListener('input', () => this.fieldError(field, ''));
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
  }

  get isOpen() {
    return this.el.open;
  }

  /** Called with true when the dialog opens and false when it closes (the game pauses its keys). */
  onToggle(fn: (open: boolean) => void) {
    this.toggles.add(fn);
  }

  /** Opens in `mode`; `lead` replaces the default line under the title (e.g. naming a ride). */
  open(mode: AuthMode, lead?: string): Promise<User | null> {
    this.setMode(mode);
    this.lead.textContent = lead ?? COPY[mode].lead;
    if (this.el.open && this.pending) return this.pending;
    const active = document.activeElement;
    this.returnFocus = active instanceof HTMLElement && active !== document.body ? active : null;
    this.reset();
    this.el.showModal();
    this.focusFirst();
    for (const fn of this.toggles) fn(true);
    return (this.pending = new Promise((r) => (this.resolve = r)));
  }

  close(user: User | null = null) {
    if (this.busy) return;
    this.settle(user);
    if (this.el.open) this.el.close();
  }

  private settle(user: User | null) {
    this.resolve?.(user);
    this.resolve = null;
    this.pending = null;
  }

  private onClosed() {
    this.settle(null);
    for (const fn of this.toggles) fn(false);
    // browsers mostly do this themselves; make sure focus doesn't end up on <body>
    const back = this.returnFocus;
    this.returnFocus = null;
    if (back?.isConnected && !back.closest('[inert], [hidden]') && (!document.activeElement || document.activeElement === document.body))
      back.focus({ preventScroll: true });
  }

  private setMode(mode: AuthMode, user = false) {
    if (this.busy) return;
    this.mode = mode;
    const c = COPY[mode];
    this.kicker.textContent = c.kicker;
    this.title.textContent = c.title;
    this.submitBtn.textContent = c.submit;
    if (user) this.lead.textContent = c.lead;
    for (const b of this.modeBtns) b.setAttribute('aria-pressed', String(b.dataset.authMode === mode));
    const signup = mode === 'signup';
    for (const el of this.el.querySelectorAll<HTMLElement>('[data-signup-only]')) el.hidden = !signup;
    this.inputs.username.disabled = !signup;
    this.terms.disabled = !signup;
    this.inputs.password.autocomplete = signup ? 'new-password' : 'current-password';
    this.inputs.password.setAttribute('aria-describedby', signup ? 'auth-password-hint auth-password-error' : 'auth-password-error');
    this.errorEl.textContent = '';
    for (const f of ['username', 'password'] as const) this.fieldError(f, '');
    this.termsError('');
    if (user) this.focusFirst();
  }

  private reset() {
    this.form.reset();
    this.setBusy(false);
    this.inputs.password.type = 'password';
    this.revealBtn.textContent = 'Show';
    this.revealBtn.setAttribute('aria-pressed', 'false');
    this.errorEl.textContent = '';
    for (const f of Object.keys(this.inputs) as Field[]) this.fieldError(f, '');
    this.termsError('');
  }

  private focusFirst() {
    const order: Field[] = this.mode === 'signup' ? ['email', 'username', 'password'] : ['email', 'password'];
    const first = order.find((f) => !this.inputs[f].value) ?? 'email';
    this.inputs[first].focus();
  }

  private values(): Record<Field, string> {
    return {
      email: this.inputs.email.value.trim().toLowerCase(),
      username: this.inputs.username.value.trim(),
      password: this.inputs.password.value,
    };
  }

  private fieldError(field: Field, message: string) {
    const input = this.inputs[field];
    const out = this.el.querySelector<HTMLElement>(`#auth-${field}-error`)!;
    out.textContent = message;
    out.hidden = !message;
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  private termsError(message: string) {
    const out = this.el.querySelector<HTMLElement>('#auth-terms-error')!;
    out.textContent = message;
    out.hidden = !message;
    if (message) this.terms.setAttribute('aria-invalid', 'true');
    else this.terms.removeAttribute('aria-invalid');
  }

  private setBusy(busy: boolean) {
    this.busy = busy;
    this.form.setAttribute('aria-busy', String(busy));
    this.submitBtn.disabled = busy;
    this.submitBtn.textContent = busy ? COPY[this.mode].busy : COPY[this.mode].submit;
    this.closeBtn.disabled = busy;
    for (const b of this.modeBtns) b.disabled = busy;
    for (const input of Object.values(this.inputs)) input.readOnly = busy;
    this.terms.disabled = busy || this.mode !== 'signup';
  }

  private async submit() {
    if (this.busy) return;
    const v = this.values();
    const errors = validate(this.mode, v, this.mode !== 'signup' || this.terms.checked);
    this.errorEl.textContent = '';
    for (const f of Object.keys(this.inputs) as Field[]) this.fieldError(f, errors[f] ?? '');
    this.termsError(errors.terms ?? '');
    const invalid = (['email', 'username', 'password', 'terms'] as const).find((f) => errors[f]);
    if (invalid) {
      (invalid === 'terms' ? this.terms : this.inputs[invalid]).focus();
      return;
    }

    this.setBusy(true);
    let user: User | null = null;
    try {
      user =
        this.mode === 'signup'
          ? await session.signup({ email: v.email, username: v.username, password: v.password })
          : await session.login({ email: v.email, password: v.password });
    } catch (err) {
      this.showServerError(err);
    } finally {
      this.setBusy(false);
    }
    if (user) this.close(user);
    // the submit button was disabled while busy, which drops the focus: bring it back
    else if (!this.el.contains(document.activeElement)) this.submitBtn.focus();
  }

  private showServerError(err: unknown) {
    if (!(err instanceof ApiError)) {
      this.errorEl.textContent = 'Something went wrong. Please try again.';
      return;
    }
    // a taken email or username belongs next to its field
    if (err.status === 409) {
      const field: Field | null = /username/i.test(err.message) ? 'username' : /email/i.test(err.message) ? 'email' : null;
      if (field) {
        this.fieldError(field, err.message);
        this.inputs[field].focus();
        return;
      }
    }
    // the server insists on the Terms too (e.g. an old page that didn't send them)
    if (err.status === 400 && /terms|privacy/i.test(err.message)) {
      this.termsError(err.message);
      this.terms.focus();
      return;
    }
    this.errorEl.textContent = err.message;
    if (err.status === 401) {
      this.inputs.password.focus();
      this.inputs.password.select();
    }
  }
}

export const authDialog = new AuthDialog();
