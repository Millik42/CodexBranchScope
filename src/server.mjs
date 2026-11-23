import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { GraphError } from './git.mjs';
import { createSession } from './session.mjs';

const assets = new Map([
  ['/', ['index.html', 'text/html']],
  ['/app.js', ['app.js', 'text/javascript']],
  ['/style.css', ['style.css', 'text/css']],
]);
const idleMs = 20 * 60_000;

export async function serveGraph(directory, { session = createSession(directory), timeout = idleMs } = {}) {
  const files = new Map(await Promise.all([...assets].map(async ([route, [name, type]]) => [
    route, { type, data: await readFile(new URL('../web/' + name, import.meta.url)) },
  ])));
  const token = randomBytes(24).toString('base64url');
  let address;
  let timer;
  let active = 0;
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    const json = (status, data) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(data));
    };
    if (request.headers.host !== new URL(address).host || (request.headers.origin && request.headers.origin !== address)) {
      return json(403, { message: 'Open the BranchScope URL from your local project action.' });
    }
    if (!request.url.startsWith('/')) return json(400, { message: 'Invalid BranchScope request.' });
    const url = new URL(address + request.url);
    const file = files.get(url.pathname);
    if (file && request.method === 'GET') {
      response.writeHead(200, { 'Content-Type': file.type + '; charset=utf-8' });
      return response.end(file.data);
    }
    if (request.headers.authorization !== 'Bearer ' + token) {
      return json(401, { message: 'Open a new BranchScope session from your project action.' });
    }
    const snapshot = url.searchParams.get('snapshot');
    const cursor = url.searchParams.get('cursor');
    const routes = {
      'GET /api/first': () => session.first(),
      'GET /api/page': () => session.page(snapshot, cursor === null ? NaN : Number(cursor)),
      'GET /api/jump': () => session.jump(snapshot, url.searchParams.get('target')),
      'GET /api/details': () => session.details(snapshot, url.searchParams.get('id')),
      'POST /api/refresh': () => session.refresh(),
      'POST /api/fetch': () => session.fetch(snapshot, url.searchParams.get('remote')),
    };
    const route = routes[request.method + ' ' + url.pathname];
    if (!route) return json(404, { message: 'This BranchScope route is unavailable.' });
    active++;
    clearTimeout(timer);
    try {
      json(200, await route());
    } catch (error) {
      if (error instanceof GraphError) return json(error.status, { code: error.code, message: error.message });
      if (error.code === 'ENOENT') {
        return json(503, { code: 'checkout_unavailable', message: 'Git or the checkout could not be opened. Check the project folder and that Git is on PATH, then refresh.' });
      }
      json(500, { message: 'BranchScope could not read the checkout. Check the project directory and run git status in the project terminal.' });
    } finally {
      active--;
      if (!active) armTimeout();
    }
  });

  function armTimeout() {
    timer = setTimeout(() => server.close(), timeout);
    timer.unref();
  }

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  address = 'http://127.0.0.1:' + server.address().port;
  server.on('close', () => clearTimeout(timer));
  armTimeout();
  return { url: address + '/#' + token, server };
}
