import './styles.css';
import { authDialog, type AuthMode } from './account/auth-dialog';
import type { GoogleOutcome } from './account/api';
import { everyHours, session } from './account/session';

// The 3D fair is code-split and loaded after first paint, while the intro card shows progress.

const intro = document.getElementById('intro')!;
const enterBtn = document.getElementById('enter') as HTMLButtonElement;
const enterLabel = enterBtn.querySelector('.btn-label')!;
const progressBar = document.getElementById('progress-bar')!;
const guestRow = document.getElementById('intro-guest')!;
const memberRow = document.getElementById('intro-member')!;
const logoutBtn = document.getElementById('intro-logout') as HTMLButtonElement;
const closedCard = document.getElementById('intro-closed')!;
const worksCard = document.getElementById('intro-works')!;

let worldReady = false;
let closed = false;

// ---------- Account ----------
// Who's visiting, and whether the gates are open, are checked alongside the world build; neither
// holds up the loading.
void session.refresh();
void session.loadPark(true);

/**
 * The card follows the session: guests are offered an account, members are greeted. While the park
 * is closed it shows the sign (visitors can still walk in and look around; staff can still ride).
 * While it's under maintenance it shows that sign instead, and the way in stays shut to everyone
 * but staff (the account buttons stay, so staff can log in).
 */
function renderAccount() {
  const user = session.user;
  guestRow.hidden = closed || !session.known || !!user;
  memberRow.hidden = closed || !user;
  if (user) document.getElementById('intro-username')!.textContent = user.username;
  document.getElementById('intro-guest-text')!.textContent =
    `Walk in as a guest, or sign up for free tickets: ${session.packSize} ${everyHours(session.cooldownHours)}, for every ride and game.`;

  const works = session.parkUnderMaintenance;
  worksCard.hidden = closed || !works;
  document.getElementById('intro-works-message')!.textContent = works
    ? (session.park?.maintenanceMessage ?? "We're giving the fair some care, so nobody can come in for now. Come back soon!")
    : '';
  document.getElementById('intro-works-staff')!.hidden = !session.isStaff;

  const parkClosed = !session.parkOpen && !works;
  closedCard.hidden = closed || !parkClosed;
  document.getElementById('intro-closed-message')!.textContent = parkClosed
    ? (session.park?.message ?? 'The rides and the Ticket Booth are paused for now. Come back soon!')
    : '';
  document.getElementById('intro-closed-staff')!.hidden = !session.isStaff;

  if (worldReady) {
    enterBtn.disabled = session.shutOut;
    enterLabel.textContent = session.shutOut
      ? 'Under maintenance 🛠️'
      : parkClosed && !session.isStaff
        ? 'Look around 🎪'
        : session.known && !user
          ? 'Continue as guest 🎪'
          : 'Enter the fair 🎪';
  }
}
session.onChange(renderAccount);
session.onPark(renderAccount);

for (const b of intro.querySelectorAll<HTMLButtonElement>('[data-auth]'))
  b.addEventListener('click', async () => {
    const user = await authDialog.open(b.dataset.auth as AuthMode);
    // the button that opened the dialog is gone now: hand the focus to the way in
    if (user) (worldReady ? enterBtn : memberRow.querySelector('button'))?.focus({ preventScroll: true });
  });

// Back from Google (where the popup couldn't open, the whole page went there): carry on in the
// dialog (a new account picks a username; anything missing from an account is asked for).
{
  const params = new URLSearchParams(window.location.search);
  const google = params.get('google');
  if (google) {
    params.delete('google');
    const message = params.get('message') ?? '';
    params.delete('message');
    const rest = params.toString();
    history.replaceState(history.state, '', `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`);
    const outcome: GoogleOutcome =
      google === 'login' || google === 'signup' || google === 'cancelled' ? { google } : { google: 'error', message };
    void authDialog.resume(outcome);
  }
}

logoutBtn.addEventListener('click', async () => {
  logoutBtn.disabled = true;
  await session.logout();
  logoutBtn.disabled = false;
  intro.querySelector<HTMLButtonElement>('[data-auth="signup"]')?.focus({ preventScroll: true });
});

// ---------- 3D fair ----------
function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && c.getContext('webgl2'));
  } catch {
    return false;
  }
}

function fallback(message: string) {
  closed = true;
  renderAccount();
  enterLabel.textContent = 'The fair is closed';
  enterBtn.disabled = true;
  progressBar.parentElement!.hidden = true;
  const note = document.createElement('p');
  note.className = 'intro-hint';
  note.textContent = message;
  enterBtn.parentElement!.after(note);
}

async function fontsReady() {
  const timeout = new Promise((r) => setTimeout(r, 2500));
  await Promise.race([
    Promise.all([document.fonts.load('64px "Lilita One"'), document.fonts.load('700 32px "DM Sans"'), document.fonts.load('32px "DM Sans"')]),
    timeout,
  ]);
}

async function boot() {
  if (!webglAvailable()) {
    fallback('Your browser does not support WebGL 2, so the 3D funfair cannot open here. Try a recent Chrome, Edge, Firefox or Safari.');
    return;
  }
  try {
    progressBar.style.width = '8%';
    const [{ Game }] = await Promise.all([import('./world/Game'), fontsReady()]);
    progressBar.style.width = '20%';
    const game = new Game(document.getElementById('world')!);
    await game.build((p) => (progressBar.style.width = `${20 + p * 80}%`));

    intro.classList.add('is-world-ready');
    worldReady = true;
    renderAccount();
    if (!authDialog.isOpen) enterBtn.focus({ preventScroll: true });
    // the park can go under maintenance at any time: the intro comes back, and the way in stays shut until it's over
    session.watchPark();
    game.onShutOut = () => {
      intro.classList.remove('is-hidden');
      intro.inert = false;
      renderAccount();
      if (!authDialog.isOpen) enterBtn.focus({ preventScroll: true });
    };
    enterBtn.onclick = () => {
      if (session.shutOut) return;
      enterBtn.blur();
      intro.classList.add('is-hidden');
      intro.inert = true;
      game.enter();
    };
  } catch (err) {
    console.error(err);
    fallback('The 3D funfair could not load on this device. Try reloading, or a different browser.');
  }
}

// Let the HTML paint first (good for LCP), then load the heavy stuff.
if (document.readyState === 'complete') setTimeout(boot, 0);
else window.addEventListener('load', () => setTimeout(boot, 0));
