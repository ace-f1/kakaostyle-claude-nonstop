/**
 * Account scoring and selection.
 *
 * Picks the best account based on usage — lowest effective utilization wins.
 * Effective utilization = max(sessionPercent, weeklyPercent) so we avoid
 * accounts that are near either limit.
 *
 * When usePriority is true, accounts with lower priority numbers are preferred
 * over accounts with lower utilization. Accounts at or above 98% utilization
 * are considered "near-exhausted" and skipped in favor of the next priority.
 */

const PRIORITY_THRESHOLD = 98;

/**
 * Pick the best account from a list of accounts with usage data.
 *
 * @param {Array<{name: string, configDir: string, token: string, usage: object, priority?: number}>} accounts
 * @param {string} [excludeName] - Account name to exclude (e.g., the one that just hit a limit)
 * @param {object} [options]
 * @param {boolean} [options.usePriority=false] - When true, prefer accounts by priority number
 * @returns {{ account: object, reason: string } | null}
 */
export function pickBestAccount(accounts, excludeName, options = {}) {
  const candidates = accounts.filter(a => {
    if (a.name === excludeName) return false;
    if (!a.token) return false;
    // HTTP 429 means the usage API itself is rate-limited, not that the account
    // is unusable. Treat it as unknown usage (0%) rather than disqualifying it.
    if (a.usage?.error && a.usage.error !== 'HTTP 429') return false;
    return true;
  });

  if (candidates.length === 0) return null;

  if (options.usePriority) {
    // Priority-aware sorting:
    // 1. Non-exhausted (< 98%) before exhausted (>= 98%)
    // 2. Within each group: lower priority number first (nulls last)
    // 3. Tiebreaker: lower utilization first
    candidates.sort((a, b) => {
      const aUtil = effectiveUtilization(a.usage);
      const bUtil = effectiveUtilization(b.usage);
      const aExhausted = aUtil >= PRIORITY_THRESHOLD;
      const bExhausted = bUtil >= PRIORITY_THRESHOLD;

      // Non-exhausted accounts always come first
      if (aExhausted !== bExhausted) return aExhausted ? 1 : -1;

      // Within same exhaustion group: sort by priority (lower = better, null = last)
      const aPri = a.priority ?? Infinity;
      const bPri = b.priority ?? Infinity;
      if (aPri !== bPri) return aPri - bPri;

      // Same priority: sort by utilization
      return aUtil - bUtil;
    });

    const best = candidates[0];
    const pri = best.priority != null ? `, priority: ${best.priority}` : '';

    return {
      account: best,
      reason: `priority selection (session: ${best.usage.sessionPercent}%, weekly: ${best.usage.weeklyPercent}%${pri})`,
    };
  }

  // Default: sort by effective utilization (ascending — lowest usage first)
  candidates.sort((a, b) => {
    const aUtil = effectiveUtilization(a.usage);
    const bUtil = effectiveUtilization(b.usage);
    return aUtil - bUtil;
  });

  const best = candidates[0];

  return {
    account: best,
    reason: `lowest utilization (session: ${best.usage.sessionPercent}%, weekly: ${best.usage.weeklyPercent}%)`,
  };
}

/**
 * Pick the best account using priority hierarchy.
 * Convenience wrapper for `use --priority`.
 *
 * @param {Array} accounts - Accounts with usage data
 * @returns {{ account: object, reason: string } | null}
 */
export function pickByPriority(accounts) {
  return pickBestAccount(accounts, undefined, { usePriority: true });
}

/**
 * Decide whether the runner should proactively fail back to a higher-priority
 * account that has recovered while a lower-priority fallback account is active.
 *
 * @param {Array<{name: string, priority?: number, usage?: object, token?: string}>} accounts
 * @param {{name: string, priority?: number}} currentAccount
 * @param {object} [options]
 * @param {boolean} [options.usePriority=false]
 * @param {number} [options.cooldownMs=0]
 * @param {number} [options.lastSwitchAt=0]
 * @param {number} [options.now=Date.now()]
 * @returns {{ account: object, reason: string } | null}
 */
export function findFailbackAccount(accounts, currentAccount, options = {}) {
  if (!options.usePriority || !currentAccount) return null;

  const currentPriority = currentAccount.priority ?? Infinity;
  if (currentPriority <= 1) return null;

  const now = options.now ?? Date.now();
  const cooldownMs = options.cooldownMs ?? 0;
  const lastSwitchAt = options.lastSwitchAt ?? 0;
  if (cooldownMs > 0 && now - lastSwitchAt < cooldownMs) {
    return null;
  }

  const best = pickBestAccount(accounts, undefined, { usePriority: true });
  if (!best) return null;
  if (best.account.name === currentAccount.name) return null;

  const bestPriority = best.account.priority ?? Infinity;
  if (bestPriority >= currentPriority) return null;
  if (effectiveUtilization(best.account.usage) >= PRIORITY_THRESHOLD) return null;

  return {
    account: best.account,
    reason: `higher-priority account recovered (${best.reason})`,
  };
}

/**
 * Calculate effective utilization — the higher of session or weekly.
 */
export function effectiveUtilization(usage) {
  if (!usage) return 100;
  return Math.max(usage.sessionPercent || 0, usage.weeklyPercent || 0);
}

export { PRIORITY_THRESHOLD };
