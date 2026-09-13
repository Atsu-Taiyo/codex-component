import readline from 'node:readline';
const lines = readline.createInterface({ input: process.stdin });
let initialized = false, acknowledged = false, nextThread = 0;
const active = new Map();
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
const event = (method, params) => send({ method, params });
lines.on('line', line => {
  const m = JSON.parse(line);
  const result = value => send({ id: m.id, result: value });
  if (m.method === 'initialize') { if (initialized) throw Error('double init'); initialized = true; result({}); return; }
  if (m.method === 'initialized') { acknowledged = true; return; }
  if (!m.method) {
    if(m.id === 700) {
      event('item/completed', { threadId: 'thread-1', turnId: 'turn-1', item: {id:'a',type:'agentMessage',text:m.result.decision} });
      event('turn/completed', { threadId:'thread-1', turn:{id:'turn-1',status:'completed'} });
    }
    return;
  }
  if (!acknowledged) throw Error('missing handshake');
  if (m.method === 'model/list') { result({ data: [{ id: m.params.cursor ? 'second' : 'first', model: 'fixture-model', supportedReasoningEfforts: [] }], nextCursor: m.params.cursor ? null : 'page2' }); return; }
  if (m.method === 'account/read') { result({ account: { type: 'chatgpt' } }); return; }
  if (m.method === 'thread/start') { result({ thread: { id: `thread-${++nextThread}` } }); return; }
  if (m.method === 'thread/resume') { result({}); return; }
  if (m.method === 'turn/interrupt') {
    clearTimeout(active.get(m.params.threadId));
    result({}); event('turn/completed', { threadId: m.params.threadId, turn: { id: 'turn-1', status: 'interrupted' } }); return;
  }
  if (m.method === 'thread/realtime/listVoices') { result({ voices: { v1: ['alloy'], v2: ['marin'], defaultV1: 'alloy', defaultV2: 'marin' } }); return; }
  if (m.method === 'thread/realtime/start') { event('thread/realtime/sdp', { threadId: m.params.threadId, sdp: 'answer-sdp' }); result({}); return; }
  if (m.method.startsWith('thread/realtime/')) { result({}); return; }
  if (m.method !== 'turn/start') { send({ id: m.id, error: { code: -32601, message: 'Unknown' } }); return; }
  const threadId = m.params.threadId, turnId = 'turn-1', prompt = m.params.input[0].text;
  const p = { threadId, turnId };
  if (prompt === 'crash') { process.exit(2); }
  if (prompt === 'nostart') return;
  // Early events intentionally arrive before the turn/start response.
  event('item/agentMessage/delta', { ...p, itemId: 'a', delta: 'こん' });
  event('item/agentMessage/delta', { ...p, threadId: 'other-thread', itemId: 'a', delta: 'LEAK' });
  event('item/agentMessage/delta', { ...p, turnId: 'old-turn', itemId: 'a', delta: 'OLD' });
  result({ turn: { id: turnId } });
  if(prompt === 'approval') { send({id:700,method:'item/commandExecution/requestApproval',params:p}); return; }
  const timer = setTimeout(() => {
    if (prompt === 'fail') { event('turn/completed', { threadId, turn: { id: turnId, status: 'failed', error: { message: 'fixture failure' } } }); return; }
    event('item/agentMessage/delta', { ...p, itemId: 'a', delta: 'にちは' });
    event('item/completed', { ...p, item: { id: 'a', type: 'agentMessage', text: 'こんにちは' } });
    if (prompt.includes('image generation') && !prompt.includes('noimage')) event('item/completed', { ...p, item: { type: 'imageGeneration', id: 'img', status: 'completed', result: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==', failure: null } });
    event('turn/completed', { threadId, turn: { id: turnId, status: 'completed' } });
  }, prompt === 'slow' ? 400 : 10);
  active.set(threadId, timer);
});
