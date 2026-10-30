import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const night = '2026-10-28';
const valid = { at: `${night}T23:00:00+01:00`, job: 'job', status: 'ok', owner: 'owner' };
let runsDir: string;

beforeEach(async () => {
  runsDir = await mkdtemp(join(tmpdir(), 'rig-digest-'));
});

afterEach(async () => {
  await rm(runsDir, { recursive: true, force: true });
});

async function writeRecords(records: unknown[]) {
  await writeFile(join(runsDir, `${night}.jsonl`), records.map(record => JSON.stringify(record)).join('\n'));
}

describe('readNight', () => {
  it('reads the course fixture as five jobs and one bad line', async () => {
    expect(await readNight('runs', night)).toEqual({
      night,
      badLines: 1,
      counts: { ok: 10, retry: 4, fail: 1 },
      rows: [
        { job: 'digest/render', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00' },
        { job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, lastStatus: 'ok', lastError: 'upstream 503',
          firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00' },
        { job: 'lane/sync', owner: 'rook', runs: 8, retries: 1, lastStatus: 'ok', lastError: 'lock held',
          firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00' },
        { job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'fail', lastError: 'quota exceeded',
          firstAt: '2026-10-29T04:00:01+01:00', lastAt: '2026-10-29T04:00:01+01:00' },
        { job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-28T23:00:02+01:00', lastAt: '2026-10-28T23:00:02+01:00' },
      ],
    });
  });

  it('returns null for a missing file', async () => {
    expect(await readNight(runsDir, night)).toBeNull();
  });

  it.each(['../2026-10-28', '2026-10-28/other', '2026-1-01', '2026-02-29', '2026-04-31', '2026-13-01', ''])
  ('rejects invalid night %j even when a file exists', async invalidNight => {
    await writeRecords([valid]);
    expect(await readNight(runsDir, invalidNight)).toBeNull();
  });

  it('accepts a real leap day', async () => {
    await writeFile(join(runsDir, '2024-02-29.jsonl'), '');
    expect(await readNight(runsDir, '2024-02-29')).toEqual({ night: '2024-02-29', rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
  });

  it.each(['', '\n \t\r\n\n'])('keeps empty and blank files as existing nights', async contents => {
    await writeFile(join(runsDir, `${night}.jsonl`), contents);
    expect(await readNight(runsDir, night)).toEqual({ night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
  });

  it('counts every nonblank bad line in an all-invalid file', async () => {
    await writeFile(join(runsDir, `${night}.jsonl`), 'broken\n\nnull\r\n{}\n');
    expect(await readNight(runsDir, night)).toEqual({ night, rows: [], badLines: 3, counts: { ok: 0, retry: 0, fail: 0 } });
  });

  it('rejects malformed shapes and fields without losing valid records', async () => {
    const invalid = [
      null, [], 7, 'text', {},
      { ...valid, job: '' }, { ...valid, job: 3 },
      { ...valid, status: 'pending' }, { ...valid, status: null },
      { ...valid, owner: undefined }, { ...valid, owner: 3 },
      { ...valid, error: null }, { ...valid, error: 5 },
      { ...valid, at: undefined }, { ...valid, at: 0 },
      { ...valid, at: '2026-10-28T23:00:00' },
      { ...valid, at: '2026-02-30T23:00:00Z' },
      { ...valid, at: '2026-10-28T25:00:00Z' },
      { ...valid, at: '2026-10-28T23:60:00Z' },
      { ...valid, at: '2026-10-28T23:00:00+25:00' },
      { ...valid, at: 'October 28, 2026 23:00 GMT' },
    ];
    await writeRecords([valid, ...invalid, { ...valid, owner: null }]);
    const digest = await readNight(runsDir, night);
    expect(digest?.badLines).toBe(invalid.length);
    expect(digest?.counts).toEqual({ ok: 2, retry: 0, fail: 0 });
    expect(digest?.rows).toEqual([{
      job: 'job', owner: null, runs: 2, retries: 0, lastStatus: 'ok', lastError: null,
      firstAt: valid.at, lastAt: valid.at,
    }]);
  });

  it('orders by instant and file order on ties, retaining offsets and the latest supplied error', async () => {
    await writeRecords([
      { ...valid, at: '2026-10-29T00:30:00-01:00', owner: 'latest' },
      { ...valid, at: '2026-10-29T01:00:00Z', status: 'fail', error: ' latest error ' },
      { ...valid, at: '2026-10-29T02:00:00+02:00', status: 'retry', error: 'old error' },
      { ...valid, at: '2026-10-29T01:00:00+01:00', status: 'retry' },
      { ...valid, at: '2026-10-29T01:30:00Z', owner: null, status: 'fail' },
    ]);
    expect(await readNight(runsDir, night)).toEqual({
      night, badLines: 0, counts: { ok: 1, retry: 2, fail: 2 }, rows: [{
        job: 'job', owner: null, runs: 5, retries: 2, lastStatus: 'fail', lastError: ' latest error ',
        firstAt: '2026-10-29T02:00:00+02:00', lastAt: '2026-10-29T01:30:00Z',
      }],
    });
  });

  it('preserves strings, accepts extra fields and sorts jobs by string comparison', async () => {
    await writeRecords(['a', 'Z', ' job ', '__proto__'].map(job => ({
      ...valid, job, owner: ' owner ', error: '', extra: { ignored: true },
    })));
    const digest = await readNight(runsDir, night);
    expect(digest?.rows.map(row => row.job)).toEqual([' job ', 'Z', '__proto__', 'a']);
    expect(digest?.rows.every(row => row.owner === ' owner ' && row.lastError === '')).toBe(true);
    expect(digest?.badLines).toBe(0);
    expect(digest?.counts).toEqual({ ok: 4, retry: 0, fail: 0 });
  });

  it('counts valid records by status independently of each job’s last status', async () => {
    await writeRecords([
      { ...valid, status: 'retry' },
      { ...valid, status: 'fail' },
      { ...valid, status: 'ok' },
      { ...valid, status: 'pending' },
    ]);
    const digest = await readNight(runsDir, night);
    expect(digest?.counts).toEqual({ ok: 1, retry: 1, fail: 1 });
    expect(digest?.rows[0].lastStatus).toBe('ok');
  });

  it('propagates filesystem errors other than missing files', async () => {
    const file = join(runsDir, 'not-a-directory');
    await writeFile(file, '');
    await expect(readNight(file, night)).rejects.toMatchObject({ code: 'ENOTDIR' });
  });
});
