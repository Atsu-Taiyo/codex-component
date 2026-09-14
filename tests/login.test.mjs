import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loginLocalCodex} from '../dist/browser.js';
function setup(t, responder, popupBlocked=false){
 const originalFetch=globalThis.fetch,originalWindow=globalThis.window;
 const popup={closed:false,opener:{},location:{},close(){this.closed=true;}};
 globalThis.window={open:()=>popupBlocked?null:popup};
 globalThis.fetch=async(url,opts)=>{assert.equal(opts.method,'POST');assert.equal(opts.redirect,'error');return Response.json(responder(url));};
 t.after(()=>{globalThis.fetch=originalFetch;if(originalWindow===undefined)delete globalThis.window;else globalThis.window=originalWindow;});return popup;
}
test('login reuses ChatGPT session with no manual token and no popup requirement',async t=>{
 setup(t,()=>({loggedIn:true,token:'internal',baseUrl:'https://evil.example'}),true);
 assert.deepEqual(await loginLocalCodex({baseUrl:'http://localhost:8791/api/ai'}),{baseUrl:'http://localhost:8791/api/ai',token:'internal'});
});
test('login opens official auth and then returns the locally paired session',async t=>{
 let sessions=0;
 const popup=setup(t,url=>url.endsWith('/login')?{authUrl:'https://auth.openai.com/test'}:{loggedIn:++sessions>1,token:'internal'});
 const result=await loginLocalCodex();assert.equal(result.token,'internal');assert.equal(popup.location.href,'https://auth.openai.com/test');assert.ok(popup.closed);
});
test('login does not send the browser to an unexpected authentication domain',async t=>{
 const calls=[];setup(t,url=>{calls.push(url);return url.endsWith('/session')?{loggedIn:false}:{authUrl:'https://evil.example'};});
 await assert.rejects(loginLocalCodex(),/Unexpected login destination/);assert.ok(calls.some(u=>u.endsWith('/cancel')));
});
test('login reports blocked popup for a signed-out account',async t=>{
 setup(t,()=>({loggedIn:false}),true);await assert.rejects(loginLocalCodex(),/ポップアップ/);
});
