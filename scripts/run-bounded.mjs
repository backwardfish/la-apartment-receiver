import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function duration(value) {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m)?$/.exec(value);
  if (!match) throw new Error('Invalid timeout duration');
  const milliseconds = Number(match[1]) * ({ ms: 1, s: 1000, m: 60000 }[match[2] ?? 'ms']);
  if (milliseconds <= 0 || milliseconds > 3_600_000) throw new Error('Timeout must be between 1 ms and one hour');
  return milliseconds;
}
export function runBounded(command, args, timeoutMs, killAfterMs = 10000) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit', detached: process.platform !== 'win32' });
    let timedOut = false;
    let killTimer;
    const signalGroup = (signal) => {
      try {
        if (process.platform === 'win32') child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch (error) { if (error.code !== 'ESRCH') throw error; }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      signalGroup('SIGTERM');
      killTimer = setTimeout(() => signalGroup('SIGKILL'), killAfterMs);
    }, timeoutMs);
    const finish = (code) => { clearTimeout(timer); clearTimeout(killTimer); if (timedOut) signalGroup('SIGKILL'); resolve(timedOut ? 124 : code); };
    child.once('error', () => finish(127));
    child.once('close', (code) => finish(code ?? 1));
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [timeout, grace, command, ...args] = process.argv.slice(2);
  if (!command) throw new Error('Usage: run-bounded.mjs timeout grace command [args]');
  process.exitCode = await runBounded(command, args, duration(timeout), duration(grace));
}
