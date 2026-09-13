import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { createCodex } from '../../dist/index.js';
import { createCodexHandler } from '../../dist/server.js';
import { createOpenAIMedia } from '../../dist/media.js';
const port = Number(process.env.PORT ?? 8787);
const token = process.env.CODEX_COMPONENT_TOKEN ?? randomBytes(32).toString('hex');
const workspace = path.resolve(process.env.CODEX_WORKSPACE ?? '.codex-component/workspace');
await mkdir(workspace, { recursive: true });
const ai = createCodex({ bin: process.env.CODEX_BIN, codexHome: process.env.CODEX_COMPONENT_HOME, workspace, experimental: true });
const media = process.env.OPENAI_API_KEY ? createOpenAIMedia({ apiKey: process.env.OPENAI_API_KEY }) : undefined;
const origins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
const handler = createCodexHandler({ codex: ai, token, media, allowedOrigins: origins });
const files = new Map([
  ['/', [new URL('./index.html', import.meta.url), 'text/html; charset=utf-8']],
  ['/app.js', [new URL('./app.js', import.meta.url), 'text/javascript']],
  ['/sdk/browser.js', [new URL('../../dist/browser.js', import.meta.url), 'text/javascript']],
  ['/sdk/types.js', [new URL('../../dist/types.js', import.meta.url), 'text/javascript']],
]);
const server = createServer(async (req, res) => {
  if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(req.headers.host)) { res.writeHead(403); res.end('Host denied'); return; }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.url?.startsWith('/api/ai/')) { await handler(req, res); return; }
  const file = files.get(new URL(req.url ?? '/', origins[0]).pathname);
  if (!file) { res.writeHead(404); res.end('Not found'); return; }
  try { res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'" }); res.end(await readFile(file[0])); }
  catch { res.writeHead(500); res.end('Cannot read demo file'); }
});
server.listen(port, '127.0.0.1', () => {
  console.log(`Codex Component → ${origins[0]}/#token=${token}`);
  console.log(`Media API adapter: ${media ? 'enabled (separate API billing)' : 'disabled (set OPENAI_API_KEY to enable)'}`);
});
const shutdown = () => { ai.close(); server.closeAllConnections(); server.close(); };
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
