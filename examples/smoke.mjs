import { createCodex } from '../dist/index.js';
const ai = createCodex({ bin: process.env.CODEX_BIN, experimental: true });
try {
  const models = await ai.models.list();
  console.log('Models:', models.map(m => m.model));
  const account = await ai.account.read();
  console.log('Authenticated:', !!account.account);
  console.log('Voices:', await ai.voice.list());
  if (process.env.CODEX_LIVE_CHAT === '1') {
    const result = await ai.chat({ prompt: 'Reply with only CODEX_COMPONENT_OK. Do not use any tools.', model: models.find(m => m.isDefault)?.model });
    console.log('Chat:', result.text);
    if (!result.text.includes('CODEX_COMPONENT_OK')) throw new Error('Unexpected smoke response');
  }
} finally { ai.close(); }
