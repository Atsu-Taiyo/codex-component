import {createServer} from 'node:http';
import {readFile, readdir, stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {startLocalBridge} from '../../dist/local.js';
const here=fileURLToPath(new URL('.',import.meta.url));
const build=resolve(here,'Build/Web');
const port=Number(process.env.TREASURE_PORT||8792), companionPort=Number(process.env.TREASURE_COMPANION_PORT||8791);
const origin=`http://127.0.0.1:${port}`;
let bridge;
await stat(resolve(build,'Build')).catch(()=>{throw Error('Unity Web build is missing. Follow examples/treasure-unity/README.md first.');});
if(!process.argv.includes('--practice'))bridge=await startLocalBridge({origins:[origin],port:companionPort});
const types={'.html':'text/html; charset=utf-8','.js':'application/javascript','.wasm':'application/wasm','.json':'application/json','.png':'image/png'};
const server=createServer(async(req,res)=>{
 try{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
  const path=decodeURIComponent(new URL(req.url,origin).pathname);
  let body,type;
  if(path==='/bootstrap.json'){
   const files=await readdir(resolve(build,'Build'));
   const pick=suffix=>{const name=files.find(f=>f.endsWith(suffix));if(!name)throw Error('Missing '+suffix);return '/Build/'+name;};
   body=Buffer.from(JSON.stringify({loader:pick('.loader.js'),data:pick('.data'),framework:pick('.framework.js'),wasm:pick('.wasm')}));type='application/json';
  }else{
   const file=path==='/'?resolve(here,'web/index.html'):resolve(build,'.'+path);
   if(path!=='/'&&!file.startsWith(build+sep)){res.writeHead(403);res.end();return;}
   body=await readFile(file);type=types[extname(file)]||'application/octet-stream';
  }
  res.writeHead(200,{'Content-Type':type,'Content-Length':body.length,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.end(req.method==='HEAD'?undefined:body);
 }catch{res.writeHead(404);res.end('Not found');}
});
server.on('error',async error=>{console.error(error.message);await bridge?.close();process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>{
 console.log(`ことばの宝箱: ${origin}`);
 const url=bridge?`${origin}/#token=${encodeURIComponent(bridge.token)}&baseUrl=${encodeURIComponent(bridge.baseUrl)}`:origin;
 if(process.argv.includes('--open'))spawn(process.platform==='darwin'?'open':process.platform==='win32'?'explorer':'xdg-open',[url],{stdio:'ignore'}).on('error',()=>console.log('Open the game URL manually.'));
 if(bridge)console.log(`Local pairing token (paste into the game): ${bridge.token}`);
});
async function stop(){server.close();await bridge?.close();process.exit(0);}
process.once('SIGINT',stop);process.once('SIGTERM',stop);
