import './styles.css';

// The page is fully usable (and indexable) as plain HTML. Everything below is
// progressive enhancement: the 3D fair is code-split and loaded after first paint.

const intro = document.getElementById('intro')!;
const enterBtn = document.getElementById('enter') as HTMLButtonElement;
const enterLabel = enterBtn.querySelector('.btn-label')!;
const progressBar = document.getElementById('progress-bar')!;
const cvEl = document.getElementById('cv')!;
let lastFocus: HTMLElement | null = null;

// ---------- Classic CV drawer ----------
function openCv() {
  lastFocus = document.activeElement as HTMLElement;
  cvEl.classList.add('is-open');
  cvEl.setAttribute('aria-modal', 'true');
  cvEl.setAttribute('role', 'dialog');
  cvEl.focus({ preventScroll: true });
}
function closeCv() {
  cvEl.classList.remove('is-open');
  cvEl.removeAttribute('aria-modal');
  cvEl.removeAttribute('role');
  if (location.hash === '#cv') history.replaceState(null, '', location.pathname + location.search);
  lastFocus?.focus({ preventScroll: true });
}
document.querySelectorAll<HTMLAnchorElement>('a[href="#cv"], #open-cv').forEach((el) =>
  el.addEventListener('click', (e) => {
    e.preventDefault();
    openCv();
  }),
);
cvEl.querySelector('[data-close-cv]')!.addEventListener('click', closeCv);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && cvEl.classList.contains('is-open')) closeCv();
});
if (location.hash === '#cv') openCv();

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
  enterLabel.textContent = 'Read my CV';
  enterBtn.disabled = false;
  enterBtn.onclick = openCv;
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
    fallback('Your browser does not support WebGL 2, so the 3D funfair is unavailable — the classic CV has everything.');
    return;
  }
  try {
    progressBar.style.width = '8%';
    const [{ Game }] = await Promise.all([import('./world/Game'), fontsReady()]);
    progressBar.style.width = '20%';
    const game = new Game(document.getElementById('world')!);
    await game.build((p) => (progressBar.style.width = `${20 + p * 80}%`));

    intro.classList.add('is-world-ready');
    enterLabel.textContent = 'Enter the fair 🎪';
    enterBtn.disabled = false;
    enterBtn.focus({ preventScroll: true });
    enterBtn.onclick = () => {
      enterBtn.blur();
      intro.classList.add('is-hidden');
      intro.inert = true;
      game.enter();
    };
  } catch (err) {
    console.error(err);
    fallback('The 3D funfair could not load on this device — the classic CV has everything.');
  }
}

// Let the HTML paint first (good for LCP), then load the heavy stuff.
if (document.readyState === 'complete') setTimeout(boot, 0);
else window.addEventListener('load', () => setTimeout(boot, 0));
