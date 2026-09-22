import { spawn } from 'node:child_process';

// A pipe ties the model's lifetime to Echo even if Echo is killed before its shutdown handler runs.
const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Missing private tutor port');
let stopping = false;
let ready = false;
let logTail = '';
const child = spawn(process.env.ECHO_OLLAMA_BIN ?? '/usr/local/bin/ollama', ['serve'], {
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, OLLAMA_HOST: `127.0.0.1:${port}`, OLLAMA_CONTEXT_LENGTH: '4096',
    OLLAMA_NUM_PARALLEL: '1', OLLAMA_MAX_LOADED_MODELS: '1', OLLAMA_KEEP_ALIVE: '0',
    OLLAMA_NO_CLOUD: '1', OLLAMA_NOPRUNE: '1' },
});
function killGroup(signal: NodeJS.Signals) {
  if (!child.pid) return;
  try { process.kill(-child.pid, signal); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}
function stop() {
  if (stopping) return;
  stopping = true;
  killGroup('SIGTERM');
  // The group belongs solely to this request, including Ollama's model runner.
  setTimeout(() => killGroup('SIGKILL'), 1000).unref();
}
child.once('spawn', () => process.stdout.write(`${JSON.stringify({ ownedPid: child.pid })}\n`));
child.stdout.on('data', data => process.stderr.write(data));
child.stderr.on('data', data => {
  process.stderr.write(data);
  logTail = (logTail + String(data)).slice(-4096);
  if (!ready && logTail.includes(`Listening on 127.0.0.1:${port}`)) {
    ready = true;
    process.stdout.write('{"ready":true}\n');
  }
});
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
child.once('close', code => {
  killGroup('SIGKILL');
  process.exit(stopping ? 0 : (code || 1));
});
process.stdin.resume();
process.stdin.once('end', stop);
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
