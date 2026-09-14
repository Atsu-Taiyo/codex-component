import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../unity/com.atsutaiyo.codex-component/Runtime/Plugins/WebGL/Codex.jslib', import.meta.url), 'utf8');
function setup(fetch) {
  const messages = [], library = {};
  const context = vm.createContext({ URL, AbortController, TextDecoder, fetch, LibraryManager:{library}, mergeInto:Object.assign, UTF8ToString:x=>x, SendMessage:(target,method,json)=>messages.push({target,...JSON.parse(json)}) });
  vm.runInContext(source, context); context.CodexTransport = library.$CodexTransport;
  return { library, messages, run:library.$CodexTransport.run };
}
test('Unity plugin handles fragmented UTF8 NDJSON and completion', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({type:'delta',text:'こんにちは'})+'\n'+JSON.stringify({type:'completed',result:{text:'猫'}}));
  const { run,messages } = setup(async()=>new Response(new ReadableStream({start(c){for (const b of bytes)c.enqueue(new Uint8Array([b]));c.close();}})));
  await run('relay',1,'http://127.0.0.1:8787/api/ai','token','/chat','{}');
  assert.equal(JSON.parse(messages[0].json).text,'こんにちは');
  assert.equal(JSON.parse(messages.at(-1).json).text,'猫');
});
test('Unity rejects incomplete streams and HTTP 200 error events', async () => {
  for (const body of ['{"type":"delta","text":"x"}\n','{"type":"error","error":"denied"}\n']) {
    const {run,messages}=setup(async()=>new Response(body));
    await run('r',1,'http://localhost:8787/api/ai','t','/chat','{}');
    assert.equal(messages.at(-1).kind,'error');
  }
});
test('Unity blocks remote token destinations and redirects', async () => {
  let calls=0;
  const {run,messages}=setup(async(url,options)=>{calls++;assert.equal(options.redirect,'error');return new Response('[]');});
  await run('r',1,'https://example.com/api/ai','t','/models','');
  assert.equal(calls,0);assert.equal(messages[0].kind,'error');
  await run('r',2,'http://localhost:8787/api/ai','t','/models','');assert.equal(calls,1);
});
test('Unity cancel isolates clients and suppresses late callbacks', async () => {
  const {run,library,messages}=setup((url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')))));
  const a=run('a',1,'http://localhost:8787/api/ai','t','/chat','{}');
  const b=run('b',1,'http://localhost:8787/api/ai','t','/chat','{}');
  library.Codex_Cancel('a',1);await a;
  assert.ok(library.$CodexTransport.active['b:1']);
  library.Codex_Cancel('b',1);await b;assert.equal(messages.length,0);
});
