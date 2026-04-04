import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { CONFIG_DIR } from '../../../lib/config.js';
import {
  saveRateLimitHit,
  clearRateLimitHit,
  isKnownRateLimited,
  applyRateLimitState,
} from '../../../lib/rate-limit-state.js';

const STATE_PATH = join(CONFIG_DIR, 'data', 'rate-limit-state.json');

// Save and restore the real state file around tests
let savedState = null;

beforeEach(() => {
  mkdirSync(join(CONFIG_DIR, 'data'), { recursive: true });
  savedState = existsSync(STATE_PATH) ? readFileSync(STATE_PATH, 'utf8') : null;
  writeFileSync(STATE_PATH, '{}');
});

afterEach(() => {
  if (savedState !== null) {
    writeFileSync(STATE_PATH, savedState);
  } else if (existsSync(STATE_PATH)) {
    writeFileSync(STATE_PATH, '{}');
  }
});

describe('saveRateLimitHit', () => {
  it('records a rate limit hit for an account', () => {
    const before = Date.now();
    saveRateLimitHit('work', '1am (Asia/Seoul)');
    const state = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
    assert.ok(state.work, 'work entry should exist');
    assert.ok(state.work.limitedAt >= before, 'limitedAt should be recent');
    assert.equal(state.work.resetTimeStr, '1am (Asia/Seoul)');
  });

  it('overwrites a previous entry for the same account', () => {
    saveRateLimitHit('work', 'old');
    const first = JSON.parse(readFileSync(STATE_PATH, 'utf8')).work.limitedAt;
    saveRateLimitHit('work', 'new');
    const state = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
    assert.equal(state.work.resetTimeStr, 'new');
    assert.ok(state.work.limitedAt >= first);
  });

  it('does not affect other accounts', () => {
    saveRateLimitHit('work', 'reset-soon');
    saveRateLimitHit('personal', 'reset-later');
    const state = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
    assert.ok(state.work);
    assert.ok(state.personal);
  });
});

describe('clearRateLimitHit', () => {
  it('removes the entry for the account', () => {
    saveRateLimitHit('work', '1am');
    clearRateLimitHit('work');
    const state = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
    assert.equal(state.work, undefined);
  });

  it('is a no-op for accounts not in state', () => {
    assert.doesNotThrow(() => clearRateLimitHit('nonexistent'));
  });

  it('does not remove other accounts', () => {
    saveRateLimitHit('work', '1am');
    saveRateLimitHit('personal', '1am');
    clearRateLimitHit('work');
    const state = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
    assert.ok(state.personal, 'personal should remain');
  });
});

describe('isKnownRateLimited', () => {
  it('returns true within the 5-hour window', () => {
    saveRateLimitHit('work', '1am');
    assert.equal(isKnownRateLimited('work'), true);
  });

  it('returns false for accounts not in state', () => {
    assert.equal(isKnownRateLimited('unknown'), false);
  });

  it('returns false after the 5-hour window has expired', () => {
    const FIVE_HOURS_AGO = Date.now() - 5 * 60 * 60 * 1000 - 1000;
    writeFileSync(STATE_PATH, JSON.stringify({
      work: { limitedAt: FIVE_HOURS_AGO, resetTimeStr: '1am' },
    }));
    assert.equal(isKnownRateLimited('work'), false);
  });

  it('accepts a pre-read state object to avoid re-reading the file', () => {
    const state = { work: { limitedAt: Date.now(), resetTimeStr: '1am' } };
    assert.equal(isKnownRateLimited('work', state), true);
    assert.equal(isKnownRateLimited('personal', state), false);
  });
});

describe('applyRateLimitState', () => {
  const makeAccount = (name, errorOrPercent) => ({
    name,
    usage: typeof errorOrPercent === 'string'
      ? { sessionPercent: 0, weeklyPercent: 0, error: errorOrPercent, sessionResetsAt: null, weeklyResetsAt: null }
      : { sessionPercent: errorOrPercent, weeklyPercent: 0, error: null, sessionResetsAt: null, weeklyResetsAt: null },
  });

  it('overrides 429 account to 100% when known rate-limited', () => {
    saveRateLimitHit('work', '1am');
    const accounts = [makeAccount('work', 'HTTP 429'), makeAccount('personal', 'HTTP 429')];
    const result = applyRateLimitState(accounts);
    const work = result.find(a => a.name === 'work');
    assert.equal(work.usage.sessionPercent, 100);
    assert.equal(work.usage.error, null);
  });

  it('does not override when usage API returns real data (no error)', () => {
    saveRateLimitHit('work', '1am');
    const accounts = [makeAccount('work', 10)];
    const result = applyRateLimitState(accounts);
    assert.equal(result[0].usage.sessionPercent, 10);
  });

  it('does not override 429 account when not known rate-limited', () => {
    const accounts = [makeAccount('work', 'HTTP 429')];
    const result = applyRateLimitState(accounts);
    assert.equal(result[0].usage.error, 'HTTP 429');
    assert.equal(result[0].usage.sessionPercent, 0);
  });

  it('sets sessionResetsAt based on limitedAt + 5 hours for sleep calculation', () => {
    const before = Date.now();
    saveRateLimitHit('work', '1am');
    const accounts = [makeAccount('work', 'HTTP 429')];
    const result = applyRateLimitState(accounts);
    const work = result.find(a => a.name === 'work');
    const resetMs = new Date(work.usage.sessionResetsAt).getTime();
    assert.ok(resetMs > before + 4 * 60 * 60 * 1000, 'reset should be ~5h from now');
  });

  it('leaves accounts without errors unchanged', () => {
    const accounts = [makeAccount('personal', 5)];
    const result = applyRateLimitState(accounts);
    assert.equal(result[0].usage.sessionPercent, 5);
  });
});
