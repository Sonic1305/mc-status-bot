import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';
import { fileURLToPath } from 'node:url';
import { t } from './i18n.js';

// Schreibt jede Zeile in die Konsole und zusätzlich nach logs/bot.log,
// damit man auch nach einem Absturz noch nachlesen kann, was passiert ist.
const LOG_DIR = fileURLToPath(new URL('../logs/', import.meta.url));
const LOG_FILE = path.join(LOG_DIR, 'bot.log');
const MAX_LOG_BYTES = 5 * 1024 * 1024;

try {
  fs.mkdirSync(LOG_DIR, { recursive: true });
} catch {
  // Ohne Log-Ordner geht es trotzdem weiter, dann eben nur Konsole.
}

const stampFormat = new Intl.DateTimeFormat('sv-SE', {
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

function format(arg) {
  if (arg instanceof Error) return arg.stack ?? arg.message;
  if (typeof arg === 'string') return arg;
  return util.inspect(arg, { depth: 4 });
}

function write(level, args) {
  const labels = ['info', 'warn', 'error'].map((l) => t(`log.level.${l}`));
  const width = Math.max(...labels.map((l) => l.length));
  const line = `[${stampFormat.format(new Date())}] ${t(`log.level.${level}`).padEnd(width)} ${args.map(format).join(' ')}`;
  (level === 'error' ? console.error : console.log)(line);
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > MAX_LOG_BYTES) {
      fs.renameSync(LOG_FILE, `${LOG_FILE}.old`);
    }
    fs.appendFileSync(LOG_FILE, `${line}\n`);
  } catch {
    // Log-Datei ist optional.
  }
}

export const log = {
  info: (...args) => write('info', args),
  warn: (...args) => write('warn', args),
  error: (...args) => write('error', args),
};
