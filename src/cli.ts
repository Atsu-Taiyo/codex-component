#!/usr/bin/env node
import { startLocalBridge } from './local.js';
const help = `codex-component connect --origin https://YOUR-SITE [options]

Run this on each user's own PC. With --browser-login, sign in from the Site.
Use --browser-login to sign in from the trusted Site without copying a token.

Options:
  --origin URL       Trusted Site URL (required, repeatable; no wildcard)
  --browser-login    Enable in-page ChatGPT login for the trusted origins
  --port NUMBER      Local port (default: 8787)
  --workspace PATH   Working directory (default: ~/.codex-component/workspace)
  --codex-bin PATH   Codex executable path
  --codex-home PATH  Optional separate Codex home; requires its own login
  --help             Show help

The bridge listens only on 127.0.0.1. Ctrl+C revokes the temporary token.
No OpenAI API key is required for Codex's ChatGPT-authenticated capabilities.
`;
async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('--help')) { console.log(help); return; }
  if (args.shift() !== 'connect') throw new Error('Expected connect. Run with --help.');
  const options: Parameters<typeof startLocalBridge>[0] = { origins: [] };
  while (args.length) {
    const flag = args.shift();
    if (flag === "--browser-login") { options.browserLogin = true; continue; }
    const value = args.shift();
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    switch (flag) {
      case '--origin': options.origins.push(value); break;
      case '--port': options.port = Number(value); break;
      case '--workspace': options.workspace = value; break;
      case '--codex-bin': options.bin = value; break;
      case '--codex-home': options.codexHome = value; break;
      default: throw new Error(`Unknown option: ${flag}`);
    }
  }
  const bridge = await startLocalBridge(options);
  if (options.browserLogin) console.log(`Local Codex bridge ready\nSite: ${bridge.origins.join(', ')}\nConnection URL: ${bridge.baseUrl}\nSign in using the Site UI. Keep this terminal open.`);
  else console.log(`Local Codex bridge ready\nSite: ${bridge.origins.join(', ')}\nConnection URL: ${bridge.baseUrl}\nConnection token: ${bridge.token}\nKeep this terminal open. Paste the token only into the trusted Site above.`);
  const stop = () => { void bridge.close().catch(error => { console.error(error.message); process.exitCode = 1; }); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
void main().catch(error => { console.error(error.message); process.exitCode = 1; });
