import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { createCodex, type Codex } from './index.js';
import { createCodexHandler } from './server.js';

export function siteOrigin(value: string): string {
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) {
    throw new Error('Site must use HTTPS (HTTP is allowed only for localhost development)');
  }
  return url.origin;
}

/** One user's loopback-only bridge. The token is scoped to this process and these origins. */
export async function startLocalBridge(options: {
  origins: string[]; browserLogin?: boolean; port?: number; workspace?: string; bin?: string; codexHome?: string;
  /** Inject an already configured client, e.g. in tests. Closed together with the bridge. */
  codex?: Codex;
}) {
  if (!options.origins.length) throw new Error('Specify at least one trusted Site URL with --origin');
  const origins = [...new Set(options.origins.map(siteOrigin))];
  const port = options.port ?? 8787;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
  const workspace = path.resolve(options.workspace ?? path.join(homedir(), '.codex-component', 'workspace'));
  await mkdir(workspace, { recursive: true });
  const codex = options.codex ?? createCodex({ workspace, bin: options.bin, codexHome: options.codexHome, experimental: true });
  const token = randomBytes(32).toString('hex');
  const handler = createCodexHandler({ codex, token, allowedOrigins: origins });
  let login: ReturnType<Codex['account']['login']> | undefined;
  const server = createServer((req, res) => {
    const address = server.address();
    const actualPort = address && typeof address !== 'string' ? address.port : port;
    if (![ `127.0.0.1:${actualPort}`, `localhost:${actualPort}` ].includes(req.headers.host ?? '')) {
      res.writeHead(403); res.end('Host denied'); return;
    }
    if (options.browserLogin && req.url?.startsWith('/api/ai/auth/')) {
      const origin = req.headers.origin;
      if (!origin || !origins.includes(origin)) { res.writeHead(403); res.end('Origin denied'); return; }
      res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
      res.setHeader('Cache-Control', 'no-store');
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (req.headers['access-control-request-private-network'] === 'true') res.setHeader('Access-Control-Allow-Private-Network', 'true');
        res.writeHead(204); res.end(); return;
      }
      if (req.method !== 'POST' || !req.headers['content-type']?.startsWith('application/json')) { res.writeHead(405); res.end(); return; }
      req.resume();
      const send = (code: number, body: unknown) => { res.writeHead(code, {'Content-Type':'application/json'}); res.end(JSON.stringify(body)); };
      void (async () => {
        if (req.url === '/api/ai/auth/session') {
          const account = await codex.account.read();
          if (account.account?.type !== 'chatgpt') { send(200, {loggedIn:false}); return; }
          login = undefined;
          send(200, {loggedIn:true, token, baseUrl:`http://127.0.0.1:${actualPort}/api/ai`}); return;
        }
        if (req.url === '/api/ai/auth/login') {
          login ??= codex.account.login().catch(error => { login = undefined; throw error; });
          const result = await login;
          send(200, {authUrl:result.authUrl}); return;
        }
        if (req.url === '/api/ai/auth/cancel') {
          const pending = login; login = undefined;
          const result = await pending;
          if (result?.loginId) await codex.account.cancelLogin(result.loginId);
          send(200, {}); return;
        }
        send(404, {error:'Not found'});
      })().catch(error => send(500, {error:error instanceof Error ? error.message : 'Login failed'}));
      return;
    }
    void handler(req, res).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
    });
  } catch (error) { codex.close(); throw error; }
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing local address');
  let closed = false;
  return {
    baseUrl: `http://127.0.0.1:${address.port}/api/ai`, token, origins,
    close: async () => {
      if (closed) return; closed = true;
      codex.close(); server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}
