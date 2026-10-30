import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const tempDirs: string[] = [];

async function makeRunsDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rig-digest-routes-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('digest routes', () => {
  it('returns the same complete digest from HTML and JSON, preserving visible data safely', async () => {
    const runsDir = await makeRunsDir();
    const night = '2026-10-29';
    const unsafeJob = '<script>alert("x")</script>';
    await writeFile(join(runsDir, `${night}.jsonl`), [
      JSON.stringify({ at: '2026-10-29T09:00:00+05:30', job: 'zeta', status: 'ok', owner: 'Mira' }),
      JSON.stringify({ at: '2026-10-29T08:00:00-04:00', job: unsafeJob, status: 'retry', owner: 'Lee', error: 'first < issue' }),
      '{not json',
      JSON.stringify({ at: '2026-10-29T08:10:00-04:00', job: unsafeJob, status: 'retry', owner: null }),
      JSON.stringify({ at: '2026-10-29T08:20:00-04:00', job: unsafeJob, status: 'retry', owner: 'Lee' }),
      JSON.stringify({ at: '2026-10-29T08:30:00-04:00', job: unsafeJob, status: 'fail', owner: null, error: 'last & final' }),
    ].join('\n'));

    const app = createApp({ adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir });
    const htmlResponse = await app.request(`/digest/${night}`);
    const jsonResponse = await app.request(`/api/digest/${night}`);
    expect(htmlResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);

    const digest = await jsonResponse.json();
    expect(digest).toEqual({
      night,
      counts: { ok: 1, retry: 3, fail: 1 },
      badLines: 1,
      rows: [
        {
          job: unsafeJob,
          owner: null,
          runs: 4,
          retries: 3,
          lastStatus: 'fail',
          lastError: 'last & final',
          firstAt: '2026-10-29T08:00:00-04:00',
          lastAt: '2026-10-29T08:30:00-04:00',
        },
        {
          job: 'zeta',
          owner: 'Mira',
          runs: 1,
          retries: 0,
          lastStatus: 'ok',
          lastError: null,
          firstAt: '2026-10-29T09:00:00+05:30',
          lastAt: '2026-10-29T09:00:00+05:30',
        },
      ],
    });

    const html = await htmlResponse.text();
    expect(html).toContain('Bad lines: 1');
    expect(html).toContain('—');
    expect(html).toContain('2026-10-29T08:00:00-04:00');
    expect(html).toContain('2026-10-29T09:00:00+05:30');
    expect(html).toContain('last &amp; final');
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toMatch(/<td class="warn">3<\/td>/);
    expect(html).toMatch(/<td class="warn">fail<\/td>/);
    expect(html.indexOf('&lt;script&gt;')).toBeLessThan(html.indexOf('>zeta</td>'));
    expect(digest.rows.map((row: { job: string }) => row.job)).toEqual([unsafeJob, 'zeta']);
  });

  it('returns 404 from both routes when the night file is missing', async () => {
    const app = createApp({ adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: await makeRunsDir() });

    expect((await app.request('/digest/2026-10-29')).status).toBe(404);
    expect((await app.request('/api/digest/2026-10-29')).status).toBe(404);
  });

  it('renders an existing empty night as no rows and zero counts', async () => {
    const runsDir = await makeRunsDir();
    const night = '2026-10-29';
    await writeFile(join(runsDir, `${night}.jsonl`), '');
    const app = createApp({ adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir });

    const htmlResponse = await app.request(`/digest/${night}`);
    const jsonResponse = await app.request(`/api/digest/${night}`);
    expect(htmlResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);
    expect(await htmlResponse.text()).toContain('nothing ran');
    expect(await jsonResponse.json()).toEqual({ night, counts: { ok: 0, retry: 0, fail: 0 }, rows: [], badLines: 0 });
  });

  it('keeps valid rows when a line is malformed', async () => {
    const runsDir = await makeRunsDir();
    const night = '2026-10-29';
    await writeFile(join(runsDir, `${night}.jsonl`), [
      JSON.stringify({ at: '2026-10-29T10:00:00+02:00', job: 'kept', status: 'ok', owner: null }),
      'not-json',
    ].join('\n'));
    const app = createApp({ adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir });

    const htmlResponse = await app.request(`/digest/${night}`);
    const jsonResponse = await app.request(`/api/digest/${night}`);
    expect(htmlResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);
    const html = await htmlResponse.text();
    expect(html).toContain('kept');
    expect(html).toContain('Bad lines: 1');
    const digest = await jsonResponse.json();
    expect(digest.rows.map((row: { job: string }) => row.job)).toEqual(['kept']);
    expect(digest.badLines).toBe(1);
    expect(digest.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
  });
});
