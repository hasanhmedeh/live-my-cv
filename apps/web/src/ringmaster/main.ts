// The Ringmaster's Office (/ringmaster): the fair's back office. Staff sign in with their fair
// account; the server checks the role on every request (a player gets a 403), this page only
// decides what to show.
import './ringmaster.css';
import { api, ApiError, type User } from '../account/api';
import { AttractionsView } from './attractions';
import { GatesView } from './gates';
import { LedgerView } from './ledger';
import { LogbookView } from './logbook';
import { MembersView } from './members';
import { OverviewView } from './overview';
import { errorText, setApiErrorHandler, toast } from './util';

type Tab = 'overview' | 'attractions' | 'gates' | 'members' | 'ledger' | 'logbook';
const TABS: Tab[] = ['overview', 'attractions', 'gates', 'members', 'ledger', 'logbook'];
type Gate = 'loading' | 'login' | 'denied' | 'offline';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const tabsNav = $('tabs');
const whoami = $('whoami');
const logoutBtn = $<HTMLButtonElement>('logout');
const loginForm = $<HTMLFormElement>('login-form');
const loginError = $('login-error');

let me: User | null = null;

const views = {
  overview: new OverviewView($('view-overview')),
  attractions: new AttractionsView($('view-attractions')),
  gates: new GatesView($('view-gates')),
  members: new MembersView($('view-members'), () => me),
  ledger: new LedgerView($('view-ledger')),
  logbook: new LogbookView($('view-logbook')),
};

/** Shows one of the doors (or none, once staff are in). */
function showGate(gate: Gate | null) {
  for (const g of ['loading', 'login', 'denied', 'offline'] as const) $(`gate-${g}`).hidden = g !== gate;
  tabsNav.hidden = gate !== null;
  if (gate !== null) for (const v of document.querySelectorAll<HTMLElement>('.view')) v.hidden = true;
}

function setUser(user: User | null) {
  me = user;
  whoami.hidden = !user;
  logoutBtn.hidden = !user;
  whoami.textContent = user ? `${user.role === 'admin' ? '🎩 ' : ''}${user.username}` : '';
}

/** Who's at the door: staff go in, players are turned away, guests get the login form. */
async function knock() {
  showGate('loading');
  try {
    const { user } = await api.me();
    setUser(user);
    if (user.role !== 'admin') return deny(user);
    showGate(null);
    route();
  } catch (err) {
    setUser(null);
    if (err instanceof ApiError && err.status === 401) return showGate('login');
    $('offline-text').textContent = errorText(err);
    showGate('offline');
  }
}

function deny(user: User) {
  $('denied-text').textContent = `You're signed in as ${user.username}, a player. This door is for the people who run the fair.`;
  showGate('denied');
}

/** #overview, #members, #members/<id>… */
function route() {
  if (!me || me.role !== 'admin') return;
  const [rawTab, param] = location.hash.replace(/^#/, '').split('/');
  const tab: Tab = (TABS as string[]).includes(rawTab) ? (rawTab as Tab) : 'overview';
  for (const a of tabsNav.querySelectorAll<HTMLAnchorElement>('a[data-tab]')) {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  for (const v of document.querySelectorAll<HTMLElement>('.view')) v.hidden = v.dataset.view !== tab;
  document.title = `${tabsNav.querySelector(`a[data-tab="${tab}"]`)?.textContent?.replace(/^\S+\s/, '') ?? 'Office'} · The Ringmaster's Office`;
  if (tab === 'members') views.members.show(param ? decodeURIComponent(param) : undefined);
  else views[tab].show();
}

// A lost session or role mid-visit sends staff back to the door; anything else is a toast.
setApiErrorHandler((err) => {
  if (err instanceof ApiError && err.status === 401) {
    setUser(null);
    toast('Your session ended. Log in again.', true);
    return showGate('login');
  }
  if (err instanceof ApiError && err.status === 403 && me) {
    me = { ...me, role: 'player' };
    return deny(me);
  }
  toast(errorText(err), true);
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = new FormData(loginForm);
  const email = String(data.get('email') ?? '').trim();
  const password = String(data.get('password') ?? '');
  if (!email || !password) {
    loginError.textContent = 'Enter your email and password.';
    return;
  }
  const button = loginForm.querySelector<HTMLButtonElement>('[type="submit"]')!;
  button.disabled = true;
  loginError.textContent = '';
  try {
    const { user } = await api.login({ email, password });
    loginForm.reset();
    setUser(user);
    if (user.role !== 'admin') return deny(user);
    showGate(null);
    route();
    $('main').focus();
  } catch (err) {
    loginError.textContent = err instanceof ApiError && err.status === 401 ? 'That email and password don’t match.' : errorText(err);
  } finally {
    button.disabled = false;
  }
});

logoutBtn.addEventListener('click', async () => {
  logoutBtn.disabled = true;
  try {
    await api.logout();
  } catch {
    // the cookie expires on its own
  }
  logoutBtn.disabled = false;
  setUser(null);
  showGate('login');
});

$('retry').addEventListener('click', () => void knock());
window.addEventListener('hashchange', route);
void knock();
