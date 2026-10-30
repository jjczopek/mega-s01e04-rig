import { Hono } from 'hono';
import { loadConfig, type RigConfig } from './config.js';
import { lane } from './lane.js';
import { readStatus } from './status.js';
import { readNight } from './digest/reader.js';
import { Layout } from './views/layout.js';
import { StatusBoard } from './views/status.js';
import { DigestPage } from './views/digest.js';

export function createApp(config: RigConfig = loadConfig()) {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true, lane: lane().id }));

  app.get('/', async (c) => {
    const status = readStatus(config);
    const digests = Object.fromEntries(await Promise.all(
      status.nights.map(async (night) => [night, await readNight(config.runsDir, night)] as const),
    ));
    return c.html(
      <Layout title="status" lane={lane()}>
        <StatusBoard status={status} digests={digests} />
      </Layout>,
    );
  });

  app.get('/digest/:night', async (c) => {
    const digest = await readNight(config.runsDir, c.req.param('night'));
    if (digest === null) return c.notFound();
    return c.html(
      <Layout title={`digest · ${digest.night}`} lane={lane()}>
        <DigestPage digest={digest} />
      </Layout>,
    );
  });

  app.get('/api/digest/:night', async (c) => {
    const digest = await readNight(config.runsDir, c.req.param('night'));
    if (digest === null) return c.notFound();
    return c.json(digest);
  });

  return app;
}
