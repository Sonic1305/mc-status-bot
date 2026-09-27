import de from './locales/de.js';
import en from './locales/en.js';

// Alle Texte des Bots (Discord, Ansagen im Spiel, Konsole) kommen aus src/locales/<sprache>.js.
// Einträge sind Texte oder Funktionen, die ein Objekt mit Werten bekommen, z. B. t('alert.online', { name }).
// Fehlt ein Eintrag in der gewählten Sprache, wird der englische genommen.

export const LANGUAGES = { en, de };
export const DEFAULT_LANGUAGE = 'en';

let active = en;
let activeCode = DEFAULT_LANGUAGE;

export function setLanguage(code) {
  if (!LANGUAGES[code]) throw new Error(`Unknown language: ${code}`);
  active = LANGUAGES[code];
  activeCode = code;
}

export const getLanguage = () => activeCode;

/** BCP-47-Kürzel der aktiven Sprache für Intl (Sortierung, Datumsformat). */
export const locale = () => active._locale;

export function t(key, vars = {}) {
  const entry = active[key] ?? en[key];
  if (entry === undefined) return key;
  return typeof entry === 'function' ? entry(vars) : entry;
}
