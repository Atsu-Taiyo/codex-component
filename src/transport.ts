import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import { CodexError, type Notification, type ServerRequest } from './types.js';

export interface TransportOptions {
  /** Absolute executable path if Codex is not on PATH. Never interpreted by a shell. */
  bin?: string;
  args?: string[];
  cwd?: string;
  codexHome?: string;
  experimental?: boolean;
  requestTimeoutMs?: number;
  onStderr?: (text: string) => void;
  /** Host-only escape hatch. Default denies approval and rejects unknown requests. */
  onServerRequest?: (request: ServerRequest) => Promise<unknown>;
}

export class AppServerTransport {
  private child?: ChildProcessWithoutNullStreams;
  private starting?: Promise<void>;
  private closed = false;
  private sequence = 0;
  private events = new EventEmitter();
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  constructor(readonly options: TransportOptions = {}) { this.events.setMaxListeners(100); }

  onNotification(listener: (event: Notification) => void): () => void {
    this.events.on('notification', listener); return () => this.events.off('notification', listener);
  }
  onClose(listener: (error: Error) => void): () => void {
    this.events.on('closed', listener); return () => this.events.off('closed', listener);
  }
  async start(): Promise<void> {
    if (this.closed) throw new CodexError('Client is closed. Create a new client.', 'CLOSED');
    this.starting ??= this.launch();
    return this.starting;
  }
  private async launch() {
    const child = this.child = spawn(this.options.bin ?? 'codex', this.options.args ?? ['app-server', '--listen', 'stdio://'], {
      cwd: this.options.cwd, shell: false,
      env: { ...process.env, ...(this.options.codexHome ? { CODEX_HOME: this.options.codexHome } : {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.once('error', error => this.fail(new CodexError(`Cannot launch Codex: ${error.message}`, 'SPAWN_FAILED')));
    child.once('exit', (code, signal) => this.fail(new CodexError(`Codex exited (${code ?? signal})`, 'PROCESS_EXIT')));
    child.stdin.on('error', error => this.fail(error));
    child.stderr.on('data', data => { try { this.options.onStderr?.(String(data)); } catch { /* diagnostic callbacks must not break I/O */ } });
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      try { this.receive(JSON.parse(line)); }
      catch (error) { this.fail(new CodexError(`Invalid app-server message: ${String(error)}`, 'PROTOCOL_ERROR')); }
    });
    child.once('close', () => lines.close());
    try {
      await this.sendRequest('initialize', { clientInfo: { name: 'codex_component', title: 'Codex Component', version: '0.1.1' }, capabilities: { experimentalApi: this.options.experimental ?? false } });
      this.write({ method: 'initialized', params: {} });
    } catch (error) { this.close(); throw error; }
  }
  async request<T = any>(method: string, params: unknown = {}): Promise<T> {
    await this.start(); return this.sendRequest(method, params);
  }
  private sendRequest<T>(method: string, params: unknown): Promise<T> {
    if (this.closed) return Promise.reject(new CodexError('Client is closed', 'CLOSED'));
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new CodexError(`Timed out: ${method}`, 'RPC_TIMEOUT')); }, this.options.requestTimeoutMs ?? 30_000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  private write(message: unknown) {
    if (!this.child || this.closed) throw new CodexError('Transport is not available', 'CLOSED');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }
  private receive(message: any) {
    if (message.method && message.id !== undefined) { void this.reply(message); return; }
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer); this.pending.delete(message.id);
      if (message.error) pending.reject(new CodexError(message.error.message, message.error.code));
      else pending.resolve(message.result);
    } else if (typeof message.method === 'string') {
      // Subscriber exceptions cannot corrupt framing or interrupt other subscriptions.
      for (const listener of this.events.listeners('notification')) {
        try { listener({ method: message.method, params: message.params ?? {} }); } catch { /* caller owns callback errors */ }
      }
    }
  }
  private async reply(message: ServerRequest) {
    let response: unknown;
    try {
      let result: unknown;
      if (this.options.onServerRequest) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          result = await Promise.race([
            this.options.onServerRequest(message),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Host request handler timed out')), this.options.requestTimeoutMs ?? 30_000); }),
          ]);
        } finally { clearTimeout(timer); }
      } else if (['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(message.method)) result = { decision: 'decline' };
      else if (message.method === 'item/permissions/requestApproval') result = { permissions: {}, scope: 'turn' };
      else if (message.method === 'item/tool/requestUserInput') result = { answers: {} };
      else if (message.method === 'mcpServer/elicitation/request') result = { action: 'decline' };
      else throw new CodexError(`No host handler for ${message.method}`, -32601);
      response = { id: message.id, result };
    } catch (error) { response = { id: message.id, error: { code: error instanceof CodexError && typeof error.code === 'number' ? error.code : -32603, message: error instanceof Error ? error.message : String(error) } }; }
    if (!this.closed) this.write(response);
  }
  private fail(error: Error) {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear();
    for (const listener of this.events.listeners('closed')) { try { listener(error); } catch { /* cleanup all subscribers */ } }
    const child = this.child;
    if (child && child.exitCode === null) {
      child.kill();
      const timer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 1500);
      timer.unref(); child.once('exit', () => clearTimeout(timer));
    }
  }
  close() { this.fail(new CodexError('Client closed', 'CLOSED')); }
}
