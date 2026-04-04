/**
 * Persistent rate-limit state for accounts.
 *
 * When Claude detects a rate limit, we record which account hit it and when.
 * At startup, if the usage API is unavailable (HTTP 429), we fall back to
 * this local state so exhausted accounts are not re-selected.
 *
 * State file: ~/.claude-nonstop/data/rate-limit-state.json
 * Format: { "<accountName>": { limitedAt: <ms>, resetTimeStr: "<string>" } }
 *
 * Entries expire after FALLBACK_WINDOW_MS (5 hours) to match the session reset window.
 */

import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR } from './config.js';

const STATE_PATH = path.join(CONFIG_DIR, 'data', 'rate-limit-state.json');
/** Fallback expiry window when reset time can't be parsed (5 hours). */
const FALLBACK_WINDOW_MS = 5 * 60 * 60 * 1000;

function readState() {
  try {
    if (!fs.existsSync(STATE_PATH)) return {};
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(state) {
  const dir = path.dirname(STATE_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${STATE_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, STATE_PATH);
}

/**
 * Record that an account hit a rate limit.
 *
 * @param {string} accountName
 * @param {string|null} resetTimeStr - Raw reset time string from Claude output (e.g. "Dec 17 at 6am")
 */
export function saveRateLimitHit(accountName, resetTimeStr) {
  try {
    const state = readState();
    state[accountName] = {
      limitedAt: Date.now(),
      resetTimeStr: resetTimeStr || null,
    };
    writeState(state);
  } catch {
    // Non-fatal — worst case we re-select the exhausted account once
  }
}

/**
 * Clear the rate-limit entry for an account (called when it runs successfully).
 *
 * @param {string} accountName
 */
export function clearRateLimitHit(accountName) {
  try {
    const state = readState();
    if (!state[accountName]) return;
    delete state[accountName];
    writeState(state);
  } catch {
    // Non-fatal
  }
}

/**
 * Returns true if the account is known to be rate-limited right now.
 *
 * @param {string} accountName
 * @param {object} [state] - Pre-read state (avoids re-reading file each call)
 */
export function isKnownRateLimited(accountName, state) {
  const s = state ?? readState();
  const entry = s[accountName];
  if (!entry) return false;
  return Date.now() < (entry.limitedAt || 0) + FALLBACK_WINDOW_MS;
}

/**
 * Overlay local rate-limit state onto usage data.
 *
 * Only applies when the usage API returned an error (e.g. HTTP 429) — if real
 * usage data is available, we trust that over the local cache.
 *
 * Accounts that are known rate-limited appear as 100% utilization so the
 * scorer places them in the exhausted group and prefers other accounts.
 *
 * @param {Array<{name: string, usage: object}>} accountsWithUsage
 * @returns {Array}
 */
export function applyRateLimitState(accountsWithUsage) {
  const state = readState();
  return accountsWithUsage.map(a => {
    // Only override when usage data is unavailable
    if (a.usage?.error && isKnownRateLimited(a.name, state)) {
      const entry = state[a.name];
      // Provide a fake reset time (limitedAt + 5h) so findEarliestReset can
      // calculate a sleep duration when all accounts are exhausted.
      const resetAt = new Date((entry.limitedAt || 0) + FALLBACK_WINDOW_MS).toISOString();
      return {
        ...a,
        usage: {
          sessionPercent: 100,
          weeklyPercent: 100,
          sessionResetsAt: resetAt,
          weeklyResetsAt: null,
          error: null,
        },
      };
    }
    return a;
  });
}
