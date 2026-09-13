import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createCodex } from '../dist/index.js';
import { startLocalBridge, siteOrigin } from '../dist/local.js';

test('trusted origins require HTTPS except loopback; no credential-bearing URLs', () => {
  assert.equal(siteOrigin('https://example.com/app'), 'https://example.com');
  assert.equal(siteOrigin('http://localhost:5173'), 'http://localhost:5173');
  for(const url of ['*','http://example.com','https://user:pass@example.com','file:///tmp/app']) assert.throws(() => siteOrigin(url));
});
test('local bridge requires exact origin, token and loopback Host; legacy PNA supported', async t => {
  const ai = createCodex({ bin: process.execPath, args: [fileURLToPath(new URL('./fixtures/app-server.mjs', import.meta.url))] });
  const bridge = await startLocalBridge({ origins: ['https://trusted.example'], port: 0, workspace: process.cwd(), codex: ai });
  t.after(() => bridge.close());
  const preflight = await fetch(bridge.baseUrl + '/status', { method:'OPTIONS', headers:{Origin:'https://trusted.example','Access-Control-Request-Private-Network':'true'} });
  assert.equal(preflight.headers.get('access-control-allow-private-network'), 'true');
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://trusted.example');
  assert.equal((await fetch(bridge.baseUrl+'/status', {headers:{Origin:'https://trusted.example'}})).status,401);
  assert.equal((await fetch(bridge.baseUrl+'/status', {headers:{Origin:'https://evil.example',Authorization:`Bearer ${bridge.token}`}})).status,403);
  assert.equal((await fetch(bridge.baseUrl+'/status', {headers:{Origin:'https://trusted.example',Authorization:`Bearer ${bridge.token}`}})).status,200);
  const badHost = await new Promise((resolve,reject) => { const req=request(bridge.baseUrl+'/status',{headers:{host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end(); });
  assert.equal(badHost,403);
  await bridge.close(); await bridge.close();
});
test('browser local helper rejects remote token destinations before any request', async () => {
  const {createLocalCodexBrowser} = await import('../dist/browser.js');
  for(const baseUrl of ['https://evil.example/api/ai','http://localhost.evil.example','http://127.0.0.1/?token=x']) {
    assert.throws(() => createLocalCodexBrowser({baseUrl,token:'local-secret'}),e=>e.code==='INVALID_INPUT');
  }
  assert.ok(createLocalCodexBrowser({token:'local-secret'}));
});
