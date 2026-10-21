import { spawn } from 'node:child_process';
const children = [spawn(process.execPath, ['--env-file-if-exists=.env', '--disable-warning=ExperimentalWarning', 'server/index.ts'], { stdio: 'inherit' }), spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' })];
function stop() { for (const c of children) c.kill(); }
process.on('SIGINT', () => { stop(); process.exit(); });
process.on('SIGTERM', () => { stop(); process.exit(); });
for (const child of children) child.on('exit', code => { stop(); process.exit(code ?? 0); });
