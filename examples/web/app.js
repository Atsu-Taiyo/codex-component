import { createCodexBrowser, startVoice } from '/sdk/browser.js';
const $ = id => document.getElementById(id);
const fragment = new URLSearchParams(location.hash.slice(1));
if (fragment.has('token')) { sessionStorage.setItem('codex-component-token', fragment.get('token')); history.replaceState(null, '', location.pathname); }
let client, models = [], threadId, controller, voiceSession, audioUrl;
const fail = error => { $('error').textContent = error.message ?? String(error); };
async function connect() {
  const token = sessionStorage.getItem('codex-component-token');
  if (!token) { $('tokenBox').hidden = false; $('status').textContent = 'ターミナルのURLから接続'; return; }
  client = createCodexBrowser({ token });
  try {
    const [status, list] = await Promise.all([client.status(), client.models.list()]); models = list;
    $('model').replaceChildren(new Option('Codexの既定値', ''), ...models.map(m => new Option(m.displayName, m.model)));
    $('status').textContent = status.loggedIn ? '● Connected to Codex' : 'codex login を実行してください';
    $('tokenBox').hidden = true; updateEfforts();
  } catch(error) { fail(error); $('tokenBox').hidden = false; $('status').textContent = '接続できませんでした'; }
}
function updateEfforts() {
  const model = models.find(m => m.model === $('model').value) ?? models.find(m => m.isDefault);
  $('effort').replaceChildren(new Option('既定値', ''), ...(model?.supportedReasoningEfforts ?? []).map(e => new Option(e.reasoningEffort, e.reasoningEffort)));
}
$('model').onchange = updateEfforts;
$('connect').onclick = () => { sessionStorage.setItem('codex-component-token', $('token').value); void connect(); };
const dataUrl = file => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
function busy(value) { for(const id of ['send','generate','reset','voice','transcribe','speak']) $(id).disabled = value; $('stop').disabled = !value; }
async function run(mode) {
  if (!client || controller || !$('prompt').value.trim()) return;
  controller = new AbortController(); busy(true); $('error').textContent = ''; $('output').textContent = ''; $('images').replaceChildren();
  try {
    const file = $('imageFile').files[0];
    const input = { prompt: $('prompt').value, threadId, model: $('model').value || undefined, effort: $('effort').value || undefined, images: file ? [await dataUrl(file)] : undefined };
    const result = await (mode === 'image' ? client.images.generate : client.chat)(input, { signal: controller.signal, onEvent: event => {
      if(event.type === 'thread') threadId = event.threadId;
      if(event.type === 'delta') $('output').textContent += event.text;
      if(event.type === 'activity') $('activity').textContent = event.item?.type ?? '';
      if(event.type === 'image') { const img = document.createElement('img'); img.src = event.image.dataUrl; img.alt = 'AI生成画像'; $('images').append(img); }
    } });
    $('output').textContent = result.text;
  } catch(error) { if (!controller.signal.aborted) fail(error); }
  finally { controller = null; busy(false); $('activity').textContent = ''; }
}
$('form').onsubmit = event => { event.preventDefault(); void run('chat'); };
$('generate').onclick = () => void run('image');
$('stop').onclick = () => controller?.abort();
$('reset').onclick = () => { threadId = undefined; $('output').textContent = ''; $('images').replaceChildren(); };
$('transcribe').onclick = async () => { try { const file = $('audioFile').files[0]; if (!file) throw Error('音声ファイルを選択してください'); $('prompt').value = (await client.media.transcribe({ file, filename: file.name })).text; } catch(e) { fail(e); } };
$('speak').onclick = async () => { try { if(!$('output').textContent) throw Error('先に回答を生成してください'); const blob = await client.media.speech({ text: $('output').textContent }); if(audioUrl) URL.revokeObjectURL(audioUrl); audioUrl = URL.createObjectURL(blob); $('audio').src = audioUrl; await $('audio').play(); } catch(e) { fail(e); } };
$('voice').onclick = async () => {
  try {
    if(voiceSession) { await voiceSession.stop(); voiceSession = null; $('voice').textContent = '音声会話（実験的）'; return; }
    threadId ??= await client.threads.create();
    voiceSession = await startVoice(client, { threadId, audioElement: $('audio'), onEvent: e => { if(e.type === 'connection-state') $('activity').textContent = e.state; } });
    $('voice').textContent = '音声会話を終了';
  } catch(e) { fail(e); }
};
window.addEventListener('pagehide', () => { controller?.abort(); void voiceSession?.stop().catch(() => {}); if(audioUrl) URL.revokeObjectURL(audioUrl); });
void connect();
