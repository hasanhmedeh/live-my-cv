/**
 * Which usernames are turned away at signup (both kinds): any that pass for staff or for the park
 * itself, and offensive ones. Checked on what a name could be read as, not just how it's typed:
 * any case, leetspeak (4dm1n), separators (ring_master, a_d_m_i_n) and stretched letters
 * (aaadmin). A few ordinary words that happen to contain a blocked one ("badminton") are let
 * through. Existing accounts aren't affected. Edit the lists below to tune it.
 */

/** Found anywhere in the name: staff and the park. */
const STAFF = [
  'admin', 'administrat', 'administrateur', 'ringmaster', 'ringleader', 'moderat', 'staff', 'sysop', 'sysadmin',
  'superuser', 'superadmin', 'webmaster', 'postmaster', 'gamemaster', 'official', 'officiel', 'support', 'helpdesk',
  'customerservice', 'serviceclient', 'funfair', 'owner', 'founder', 'manager', 'employee', 'developer', 'security',
  'system', 'operator', 'verified', 'director', 'directeur',
];
/** Only as a whole word (Big_Mod, ModBob), being too short to look for inside other words. */
const STAFF_WORDS = ['mod', 'mods', 'dev', 'devs', 'ceo', 'gm', 'root', 'sudo', 'team', 'boss', 'host', 'crew'];

/** Found anywhere in the name: offensive in English, French or Arabic (transliterated). */
const OFFENSIVE = [
  'fuck', 'shit', 'cunt', 'nigger', 'nigga', 'faggot', 'retard', 'whore', 'slut', 'bitch', 'biatch', 'bastard', 'wank',
  'jizz', 'dildo', 'penis', 'vagina', 'pussy', 'porn', 'hentai', 'nazi', 'hitler', 'molest', 'pedophil', 'paedophil',
  'incest', 'bollock', 'douche', 'cocksuck', 'killyourself', 'chink', 'wetback', 'raghead', 'towelhead', 'tranny',
  'merde', 'putain', 'salope', 'connard', 'connasse', 'encule', 'batard', 'niquer', 'niquetamere', 'couille',
  'branleur', 'pouffiasse', 'bougnoul', 'negre', 'youpin', 'sharmout', 'sharmoot', 'charmout', 'kosomak', 'kusomak',
  'kossomak', 'manyak', 'manyok', 'kahba', 'qahba',
];
/** Only as a whole word (too short, or part of too many ordinary words). */
const OFFENSIVE_WORDS = [
  'ass', 'arse', 'cum', 'sex', 'tit', 'tits', 'fag', 'fck', 'dick', 'cock', 'anal', 'rape', 'rapist', 'pedo', 'prick',
  'kys', 'kkk', 'heil', 'kike', 'gook', 'dyke', 'coon', 'twat', 'xxx', 'nsfw', 'nique', 'fdp', 'ntm', 'pute', 'pd',
  'zebi', 'ayri',
];
/** Also caught at the very start or end of a name run together (bigdick, cockface). */
const OFFENSIVE_EDGES = ['dick', 'cock', 'tits', 'twat'];

/** Ordinary words that contain one of the above: taken out before looking. */
const ALLOWED = [
  'badminton', 'scunthorpe', 'shiitake', 'shitake', 'cocktail', 'cockatoo', 'cockpit', 'cockney', 'cockroach',
  'peacock', 'hancock', 'hitchcock', 'woodcock', 'shuttlecock', 'babcock', 'dickens', 'dickinson', 'dickson', 'sussex',
  'essex', 'middlesex', 'downer', 'ecosystem', 'supporter', 'stafford', 'manyakis', 'nazir', 'kshitij',
];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '2': 'z', '3': 'e', '4': 'a', '5': 's', '6': 'g', '7': 't', '8': 'b', '9': 'g' };

/** aaadmin -> admin (staff -> staf: blocked words are squashed the same way before comparing). */
const squash = (s: string) => s.replace(/(.)\1+/g, '$1');
const letters = (s: string) => s.replace(/[^a-z]/g, '');

/** The ways a name can be read: digits dropped or as letters (1 as i or l, l as i), separators gone. */
function readings(name: string): string[] {
  const lower = name.toLowerCase();
  const leet = lower.replace(/[0-9]/g, (d) => LEET[d] ?? '');
  const leetL = lower.replace(/1/g, 'l').replace(/[0-9]/g, (d) => LEET[d] ?? '');
  const forms = [letters(lower), letters(leet), letters(leetL), letters(leet).replace(/l/g, 'i')];
  return [...new Set(forms.map(stripAllowed))].filter(Boolean);
}

/** The allowed words, also as the l-as-i reading sees them (cocktail -> cocktaii). */
const ALLOWED_FORMS = [...new Set(ALLOWED.flatMap((w) => [w, w.replace(/l/g, 'i')]))];

function stripAllowed(s: string) {
  let out = s;
  for (const word of ALLOWED_FORMS) out = out.split(word).join(' ');
  return out;
}

/** The name's words: split at underscores and where lower case meets upper case (BigMod -> big, mod). */
function words(name: string): string[] {
  const raw = name.split(/_+|(?<=[a-z0-9])(?=[A-Z])/).filter(Boolean);
  const out = new Set<string>();
  for (const w of raw) {
    const lower = w.toLowerCase();
    out.add(letters(lower));
    out.add(letters(lower.replace(/[0-9]/g, (d) => LEET[d] ?? '')));
    out.add(squash(letters(lower)));
  }
  out.delete('');
  return [...out];
}

function containsAny(readings: string[], list: string[]) {
  return readings.some((r) => {
    const squashed = squash(r);
    return list.some((term) => r.includes(term) || squashed.includes(squash(term)));
  });
}

function wordIn(words: string[], list: string[]) {
  return words.some((w) => list.includes(w) || (w.endsWith('s') && list.includes(w.slice(0, -1))));
}

function atEdge(readings: string[], list: string[]) {
  return readings.some((r) => r.split(' ').some((part) => list.some((term) => part.startsWith(term) || part.endsWith(term))));
}

/**
 * Why `username` can't be used, or null when it's fine. The wording names the field ("username"),
 * so the game shows it there.
 */
export function usernameProblem(username: string): string | null {
  const r = readings(username);
  // ShuttleCock: an allowed word is one word, however it's capitalised
  const w = words(ALLOWED.reduce((name, word) => name.replace(new RegExp(word, 'gi'), '_'), username));
  if (containsAny(r, STAFF) || wordIn(w, STAFF_WORDS))
    return 'That username looks like it belongs to staff or the park (admin, ringmaster, mod…). Pick another one.';
  if (containsAny(r, OFFENSIVE) || wordIn(w, OFFENSIVE_WORDS) || atEdge(r, OFFENSIVE_EDGES))
    return 'That username isn’t allowed. Pick another one.';
  return null;
}
