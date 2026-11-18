// `npm run app` (App Mapper) or `npm run md` (MD Editor, with --md): the Vite dev server
// (live reload) with the Electron app showing it.
import { spawn } from 'node:child_process';
import electron from 'electron';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const md = args.includes('--md');
const entry = md ? 'dist-electron/md-main.js' : '.';

const server = await createServer();
await server.listen();
const url = server.resolvedUrls?.local[0];
if (!url) throw new Error('The dev server has no local address.');

const child = spawn(electron, [entry, ...args.filter((a) => a !== '--md')], { stdio: 'inherit', env: { ...process.env, VITE_DEV_SERVER_URL: url } });
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
