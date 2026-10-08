import './styles.css';
import { authDialog, type AuthMode } from './account/auth-dialog';
import { session } from './account/session';

// The 3D fair is code-split and loaded after first paint, while the intro card shows progress.

const intro = document.getElementById('intro')!;
const enterBtn = document.getElementById('enter') as HTMLButtonElement;
const enterLabel = enterBtn.querySelector('.btn-label')!;
const progressBar = document.getElementById('progress-bar')!;
const guestRow = document.getElementById('intro-guest')!;
const memberRow = document.getElementById('intro-member')!;
const logoutBtn = document.getElementById('intro-logout') as HTMLButtonElement;

let worldReady = false;
let closed = false;

// ---------- Account ----------
// Who's visiting is checked alongside the world build; it never holds up the loading.
void session.refresh();

/** The card follows the session: guests are offered an account, members are greeted. */
function renderAccount() {
  const user = session.user;
  guestRow.hidden = closed || !session.known || !!user;
  memberRow.hidden = closed || !user;
  if (user) document.getElementById('intro-username')!.textContent = user.username;
  if (worldReady) enterLabel.textContent = session.known && !user ? 'Continue as guest 🎪' : 'Enter the fair 🎪';
}
session.onChange(renderAccount);

for (const b of intro.querySelectorAll<HTMLButtonElement>('[data-auth]'))
  b.addEventListener('click', async () => {
    const user = await authDialog.open(b.dataset.auth as AuthMode);
    // the button that opened the dialog is gone now: hand the focus to the way in
    if (user) (worldReady ? enterBtn : memberRow.querySelector('button'))?.focus({ preventScroll: true });
  });

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
    enterBtn.disabled = false;
    if (!authDialog.isOpen) enterBtn.focus({ preventScroll: true });
    enterBtn.onclick = () => {
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
