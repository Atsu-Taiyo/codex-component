import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../unity/com.atsutaiyo.codex-component/Runtime/Plugins/WebGL/Codex.jslib',import.meta.url),'utf8');
function setup({mic,connectError,playError}={}) {
 const library={},events=[],requests=[],tracks=[{stopped:false,stop(){this.stopped=true;}}],stream={getTracks:()=>tracks};
 const audio={setAttribute(){},play:()=>playError?Promise.reject(Error('blocked')):Promise.resolve(),pause(){},remove(){this.removed=true;}};
 const peers=[];
 class Peer {constructor(){peers.push(this);}addTrack(){}createDataChannel(){return this.channel={};}async createOffer(){return {sdp:'audio-offer'};}async setLocalDescription(){}async setRemoteDescription(answer){this.answer=answer;}close(){this.closed=true;}}
 const ctx=vm.createContext({URL,AbortController,TextDecoder,setTimeout,clearTimeout,RTCPeerConnection:Peer,MediaStream:class{},navigator:{mediaDevices:{getUserMedia:mic||(()=>Promise.resolve(stream))}},document:{createElement:()=>audio,body:{appendChild(){}}},fetch:async(url,opts)=>{requests.push({url,body:JSON.parse(opts.body)});if(url.endsWith('/voice/connect')&&connectError)return new Response('failed',{status:400});return Response.json(url.endsWith('/threads')?{threadId:'t1'}:url.endsWith('/voice/connect')?{sdp:'answer'}:{});},LibraryManager:{library},mergeInto:Object.assign,UTF8ToString:x=>x,SendMessage:(target,method,json)=>events.push({target,method,value:JSON.parse(json)})});
 vm.runInContext(source,ctx);ctx.CodexTransport=library.$CodexTransport;
 return {library,events,requests,tracks,stream,peers,audio,start:()=>library.$CodexTransport.run('r',1,'http://localhost:8787/api/ai','token','/unity/voice/start','{}'),stop:()=>library.$CodexTransport.stopVoice('r')};
}
test('Unity voice negotiates audio, forwards events, and stops mic/playback/remote',async()=>{
 const s=setup();await s.start();assert.equal(s.peers[0].answer.sdp,'answer');
 s.peers[0].channel.onmessage({data:'{"type":"transcript","text":"こんにちは"}'});
 assert.ok(s.events.some(e=>e.value.text==='こんにちは'));
 await s.stop();assert.ok(s.tracks[0].stopped);assert.ok(s.peers[0].closed);assert.ok(s.audio.removed);
 assert.ok(s.requests.some(r=>r.url.endsWith('/voice/stop')));
});
test('Unity voice rejects denied microphone and allows retry',async()=>{
 const s=setup({mic:()=>Promise.reject(Error('permission denied'))});await s.start();
 assert.equal(s.events.at(-1).value.kind,'error');assert.equal(s.requests.length,0);assert.equal(s.library.$CodexTransport.voices.r,undefined);
});
test('Unity voice cleans up failed SDP negotiation',async()=>{
 const s=setup({connectError:true});await s.start();assert.ok(s.tracks[0].stopped);assert.ok(s.peers[0].closed);assert.equal(s.events.at(-1).value.kind,'error');
});
test('Unity voice stop during permission prompt stops late tracks without starting RTC',async()=>{
 let resolve;const s=setup({mic:()=>new Promise(r=>resolve=r)});const start=s.start();await s.stop();resolve(s.stream);await start;
 assert.ok(s.tracks[0].stopped);assert.equal(s.peers.length,0);assert.equal(s.requests.length,0);
});
test('Unity voice reports blocked autoplay and failed connection releases mic',async()=>{
 const s=setup({playError:true});await s.start();s.peers[0].ontrack({streams:[s.stream]});await Promise.resolve();
 assert.ok(s.events.some(e=>e.value.type==='playback-blocked'));
 s.peers[0].connectionState='failed';s.peers[0].onconnectionstatechange();await Promise.resolve();assert.ok(s.tracks[0].stopped);
});
test('Unity voice rejects overlapping starts without stopping original session',async()=>{
 const s=setup();await s.start();await s.library.$CodexTransport.run('r',2,'http://localhost:8787/api/ai','token','/unity/voice/start','{}');
 assert.equal(s.events.at(-1).value.kind,'error');assert.equal(s.tracks[0].stopped,false);await s.stop();
});
