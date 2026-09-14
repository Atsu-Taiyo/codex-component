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

test('browser login is opt-in, origin-bound, and only pairs authenticated users', async t => {
  let loggedIn=false, starts=0;
  const codex={close(){},account:{read:async()=>({account:loggedIn?{type:'chatgpt'}:null}),login:async()=>{starts++;return{authUrl:'https://auth.openai.com/test',loginId:'login1'};},cancelLogin:async()=>{}}};
  const bridge=await startLocalBridge({origins:['https://trusted.example'],port:0,workspace:process.cwd(),codex,browserLogin:true});
  t.after(()=>bridge.close());
  const post=(route,origin='https://trusted.example')=>fetch(bridge.baseUrl+'/auth/'+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});
  assert.equal((await post('session','https://evil.example')).status,403);
  assert.equal((await post('session','')).status,403);
  assert.equal((await fetch(bridge.baseUrl+'/auth/session',{headers:{Origin:'https://trusted.example'}})).status,405);
  assert.deepEqual(await (await post('session')).json(),{loggedIn:false});
  assert.equal((await (await post('login')).json()).authUrl,'https://auth.openai.com/test');
  await post('login');assert.equal(starts,1);
  loggedIn=true;
  const session=await (await post('session')).json();assert.equal(session.loggedIn,true);assert.equal(session.token,bridge.token);
  assert.equal(session.baseUrl,bridge.baseUrl);
});
