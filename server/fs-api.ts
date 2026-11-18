/*
 * Dev-server file API for App Mapper: lets the app, run in a browser under `npm run dev`,
 * browse folders and read/write a project's files — what the Electron main process does for
 * the desktop app. (The browser keeps auto-recovery data itself, in localStorage.)
 *
 * Mounted at /__fs. Every request must carry `X-App-Mapper: 1`: a custom header can't be sent
 * cross-origin without a CORS preflight, which this API never answers, so other sites can't
 * use it. Only Markdown and .json files can be read or written.
 *
 *   GET /__fs/info                 → { home, cwd, user, platform }
 *   GET /__fs/list?path=/abs       → { dirs: string[], files: string[] }   sub-folders (not hidden), project files
 *   POST /__fs/mkdir?path=/abs     → creates one folder (its parent must exist; it must not)
 *   GET /__fs/scan?root=/abs       → { files: string[], dirs: string[] }   relative, '/'-separated
 *   GET /__fs/read?path=/abs       → the text, or 404
 *   PUT /__fs/write?path=/abs      → writes the request body (the folder must exist)
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { isProjectFile, listProjects, readText, scan } from '../electron/scan';

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(text);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function absolute(p: string | null): string {
  if (!p || !path.isAbsolute(p)) throw Object.assign(new Error('An absolute path is required'), { status: 400 });
  return path.resolve(p);
}

function projectFile(p: string | null): string {
  const abs = absolute(p);
  if (!isProjectFile(abs)) throw Object.assign(new Error('Only Markdown and .json files can be read or written'), { status: 403 });
  return abs;
}

export function fsApi(): Plugin {
  return {
    name: 'app-mapper-fs-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__fs', async (req: IncomingMessage, res: ServerResponse) => {
        try {
          if (req.headers['x-app-mapper'] !== '1') return send(res, 403, 'Forbidden');
          const url = new URL(req.url ?? '/', 'http://localhost');
          const q = url.searchParams;
          switch (`${req.method} ${url.pathname}`) {
            case 'GET /info':
              return send(res, 200, { home: os.homedir(), cwd: process.cwd(), user: os.userInfo().username, platform: process.platform });
            case 'GET /list':
              return send(res, 200, await listProjects(absolute(q.get('path'))));
            case 'POST /mkdir':
              await fs.mkdir(absolute(q.get('path')));
              return send(res, 200, { ok: true });
            case 'GET /scan':
              return send(res, 200, await scan(absolute(q.get('root'))));
            case 'GET /read': {
              const text = await readText(projectFile(q.get('path')));
              return text === null ? send(res, 404, 'Not found') : send(res, 200, text);
            }
            case 'PUT /write': {
              await fs.writeFile(projectFile(q.get('path')), await readBody(req), 'utf8');
              return send(res, 200, { ok: true });
            }
            default:
              return send(res, 404, 'Not found');
          }
        } catch (err) {
          const e = err as Error & { status?: number };
          send(res, e.status ?? 500, e.message);
        }
      });
    },
  };
}
