import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Background daemon that polls claude-mem for new observations
 * and runs ingest automatically.
 * 
 * Features:
 * - Configurable polling interval (default 10 min)
 * - Lockfile prevents concurrent ingests
 * - Graceful shutdown on SIGINT/SIGTERM
 * - Logs activity to .memwiki/daemon.log
 */

export async function daemon(opts: { interval?: string }): Promise<void> {
  const cwd = process.cwd();
  const metaDir = path.join(cwd, '.memwiki');
  const statePath = path.join(metaDir, 'state.json');
  const lockPath = path.join(metaDir, '.lock');
  const logPath = path.join(metaDir, 'daemon.log');

  if (!fs.existsSync(metaDir)) {
    console.error('Error: memwiki not initialized. Run "memwiki install" first.');
    process.exit(1);
  }

  const intervalMs = parseInt(opts.interval || '600000'); // default 10 min
  if (intervalMs < 30000) {
    console.error('Error: interval must be at least 30000ms (30 seconds)');
    process.exit(1);
  }

  function log(msg: string): void {
    const ts = new Date().toISOString();
    const line = `[${ts}] ${msg}\n`;
    fs.appendFileSync(logPath, line, 'utf-8');
    console.log(line.trim());
  }

  // Check for existing daemon (before writing our PID)
  const pidPath = path.join(metaDir, 'daemon.pid');
  if (fs.existsSync(pidPath)) {
    try {
      const { pid } = JSON.parse(fs.readFileSync(pidPath, 'utf-8'));
      process.kill(pid, 0); // throws if not running
      console.error(`Error: daemon already running (PID ${pid})`);
      process.exit(1);
    } catch {
      // Stale PID file, remove it
      fs.unlinkSync(pidPath);
    }
  }

  // Write PID file
  fs.writeFileSync(pidPath, JSON.stringify({ pid: process.pid, startedAt: Date.now() }), 'utf-8');

  log(`Daemon started (PID ${process.pid}, interval ${intervalMs}ms)`);

  // Graceful shutdown
  let running = true;
  const shutdown = (signal: string) => {
    log(`Received ${signal}, shutting down...`);
    running = false;
    try { fs.unlinkSync(pidPath); } catch {}
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Main loop
  while (running) {
    try {
      // Check lock (ingest may be running from a hook)
      if (fs.existsSync(lockPath)) {
        log('Lock file exists, skipping this cycle');
      } else {
        // Import and run ingest
        const { ingest } = await import('./ingest.js');
        // ingest writes to stdout, capture it
        const origLog = console.log;
        let output = '';
        console.log = (...args: any[]) => { output += args.join(' ') + '\n'; };
        
        try {
          await ingest({ verbose: false });
          if (output.trim()) log(output.trim());
        } catch (err: any) {
          log(`Ingest error: ${err.message}`);
        } finally {
          console.log = origLog;
        }
      }
    } catch (err: any) {
      log(`Cycle error: ${err.message}`);
    }

    // Sleep for interval, checking running flag every second
    const sleepEnd = Date.now() + intervalMs;
    while (running && Date.now() < sleepEnd) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  log('Daemon stopped');
  try { fs.unlinkSync(pidPath); } catch {}
}
