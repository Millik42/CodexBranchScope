import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gitRunner } from '../src/git.mjs';
import { serveGraph } from '../src/server.mjs';
import { createSession } from '../src/session.mjs';
import { fetchFixture, git, init, longFixture, octopusFixture, shallowFixture } from './fixtures.mjs';

async function temp(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'branchscope-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return realpath(root);
}

function assertEdges(rows) {
  const index = new Map(rows.map((row, i) => [row.id, i]));
  assert.equal(index.size, rows.length);
  for (const [i, row] of rows.entries()) {
    assert.deepEqual(row.graph.edges.map(edge => edge.id), row.boundary ? [] : row.parents);
    for (const edge of row.graph.edges) {
      const parentIndex = index.get(edge.id);
      assert.ok(parentIndex > i);
      for (const bridge of rows.slice(i + 1, parentIndex)) {
        assert.ok(bridge.graph.crossing.some(track => track.lane === edge.lane && track.color === edge.color));
      }
      const graph = rows[parentIndex].graph;
      assert.ok(graph.incoming);
      assert.equal(graph.lane, edge.lane);
      assert.equal(graph.color, edge.color);
    }
  }
}

test('AC-01 and AC-06 · Octopus edges, nested Unicode path and full commit details', async t => {
  const fixture = await octopusFixture(await temp(t));
  const session = createSession(fixture.nested);
  const page = await session.first();
  assert.equal(page.project.root, fixture.cwd);
  assert.deepEqual(page.rows.map(row => row.id), (await git(fixture.cwd, 'log', '--topo-order', '--format=%H', '--branches')).split('\n'));
  const merge = page.rows.find(row => row.id === fixture.merge);
  assert.deepEqual(merge.parents, [fixture.main, fixture.a, fixture.b]);
  assertEdges(page.rows);
  const details = await session.details(page.snapshot, fixture.a);
  assert.equal(details.id, fixture.a);
  assert.equal(details.author, 'Тестовый Автор');
  assert.match(details.authoredAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(details.message, 'Первая строка\n\nВторая строка\nТретья строка <example>\n');
  assert.deepEqual(details.parents, [{ id: fixture.base, available: true }]);
});

test('AC-02 and AC-03 · Accurate shared ref labels, selected fetch, and snapshot preservation', async t => {
  const fixture = await fetchFixture(await temp(t));
  const session = createSession(fixture.cwd);
  const before = await session.first();
  assert.deepEqual(before.project.remotes, ['mirror', 'origin']);
  assert.deepEqual(before.rows.find(row => row.id === fixture.initial).labels.map(ref => [ref.remote, ref.name]),
    [['mirror', 'mirror/main'], ['origin', 'origin/main']]);
  assert.equal(before.rows.find(row => row.id === fixture.local).labels[0].ref, 'refs/heads/main');
  const pending = session.fetch(before.snapshot, 'origin');
  await assert.rejects(session.fetch(before.snapshot, 'mirror'), { code: 'fetch_busy' });
  const after = await pending;
  assert.notEqual(after.snapshot, before.snapshot);
  assert.throws(() => session.page(before.snapshot, 0), { code: 'stale_snapshot' });
  assert.equal(session.jump(after.snapshot, 'refs/remotes/origin/main').id, fixture.advanced);
  assert.equal(session.jump(after.snapshot, 'refs/remotes/mirror/main').id, fixture.initial);
  assert.equal(session.jump(after.snapshot, 'refs/heads/main').id, fixture.local);
  await git(fixture.cwd, 'config', 'remotes.origin', 'mirror');
  await assert.rejects(session.fetch(after.snapshot, 'origin'), { code: 'remote_group_conflict' });
  assert.deepEqual(await session.first(), after);
  await git(fixture.cwd, 'config', '--unset', 'remotes.origin');
  await git(fixture.cwd, 'remote', 'set-url', 'origin', path.join(fixture.cwd, 'missing secret-like-path'));
  await assert.rejects(session.fetch(after.snapshot, 'origin'), error => {
    assert.equal(error.code, 'fetch_failed');
    assert.match(error.message, /Fetch from origin failed/);
    assert.doesNotMatch(error.message, /secret-like-path/);
    return true;
  });
  assert.deepEqual(await session.first(), after);
});

test('Custom fetch refspecs determine the remote group and branch name', async t => {
  const fixture = await fetchFixture(await temp(t));
  await git(fixture.cwd, 'config', '--add', 'remote.origin.fetch', '+refs/heads/main:refs/remotes/cache/renamed');
  const session = createSession(fixture.cwd);
  const before = await session.first();
  const after = await session.fetch(before.snapshot, 'origin');
  const ref = after.project.refs.find(item => item.ref === 'refs/remotes/cache/renamed');
  assert.deepEqual(ref, {
    ref: 'refs/remotes/cache/renamed', id: fixture.advanced, kind: 'remote',
    name: 'cache/renamed', remote: 'origin', shortName: 'main',
  });
  assert.equal(session.jump(after.snapshot, ref.ref).id, fixture.advanced);
});

test('AC-04 · Attached and detached linked worktrees keep their own HEAD', async t => {
  const fixture = await octopusFixture(await temp(t));
  const [local, attached, detached] = await Promise.all([fixture.cwd, fixture.attached, fixture.detached]
    .map(cwd => createSession(cwd).first()));
  for (const [page, directory, head, branch] of [
    [local, fixture.cwd, fixture.merge, 'main'],
    [attached, fixture.attached, fixture.b, 'topic-b'],
    [detached, fixture.detached, fixture.a, null],
  ]) {
    assert.equal(page.project.repository, local.project.repository);
    assert.equal(page.project.root, directory);
    assert.equal(page.project.head, head);
    assert.equal(page.project.branch, branch);
    assert.deepEqual(page.rows.filter(row => row.head).map(row => row.id), [head]);
    assert.deepEqual(new Set(page.rows.map(row => row.id)), new Set(local.rows.map(row => row.id)));
  }
  await git(fixture.detached, 'commit', '--allow-empty', '-m', 'Detached only');
  const newDetached = await createSession(fixture.detached).first();
  assert.equal(newDetached.total, local.total + 1);
});

test('AC-05 · A jump beyond 200 rows continues the same lanes', async t => {
  const fixture = await longFixture(await temp(t));
  const session = createSession(fixture.cwd);
  const first = await session.first();
  assert.equal(first.rows.length, 200);
  const tail = session.page(first.snapshot, first.next);
  assert.equal(tail.next, null);
  const found = session.jump(first.snapshot, 'refs/heads/old-tip');
  assert.deepEqual(found, { available: true, row: 205, id: fixture.base });
  assert.equal(tail.rows[found.row - tail.cursor].id, fixture.base);
  assertEdges([...first.rows, ...tail.rows]);
  assert.deepEqual(session.page(first.snapshot, 0).rows, first.rows);
  assert.equal((await session.refresh()).rows.length, 200);
});

test('AC-07 · Shallow boundary and actionable empty, non-Git and missing Git states', async t => {
  const root = await temp(t);
  const { shallow, base, tip } = await shallowFixture(root);
  const session = createSession(shallow);
  const page = await session.first();
  assert.ok(page.project.shallow);
  assert.equal(page.total, 1);
  assert.ok(page.rows[0].boundary);
  assert.deepEqual(page.rows[0].graph.edges, []);
  assert.deepEqual((await session.details(page.snapshot, tip)).parents, [{ id: base, available: false }]);
  assert.deepEqual(session.jump(page.snapshot, base), { available: false });
  const empty = await init(root, 'empty');
  assert.equal((await createSession(empty).first()).total, 0);
  const nonGit = path.join(root, 'non-git');
  await mkdir(nonGit);
  const originalCeiling = process.env.GIT_CEILING_DIRECTORIES;
  process.env.GIT_CEILING_DIRECTORIES = root;
  try {
    await assert.rejects(createSession(nonGit).first(), { code: 'not_git' });
  } finally {
    if (originalCeiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
    else process.env.GIT_CEILING_DIRECTORIES = originalCeiling;
  }
  await assert.rejects(createSession(root, gitRunner(path.join(root, 'missing-git'))).first(), { code: 'git_missing' });
});

test('Loopback API scopes Git requests to a token and rejects stale cursors', async t => {
  const cwd = await init(await temp(t));
  const { url, server } = await serveGraph(cwd);
  t.after(async () => { const closed = once(server, 'close'); server.close(); await closed; });
  const base = new URL(url);
  const headers = { Authorization: 'Bearer ' + base.hash.slice(1) };
  const request = (route, options) => fetch(new URL(route, base), options);
  assert.equal((await request('/')).status, 200);
  assert.equal((await request('/api/first')).status, 401);
  assert.equal((await request('/api/first', { headers: { ...headers, Origin: 'https://example.invalid' } })).status, 403);
  const first = await (await request('/api/first', { headers })).json();
  assert.equal(first.project.root, cwd);
  assert.equal((await request('/api/refresh', { method: 'POST', headers })).status, 200);
  assert.equal((await request('/api/page?snapshot=' + first.snapshot + '&cursor=0', { headers })).status, 409);
});

test('Panel probe stdio reports the checkout from main and linked worktrees', async t => {
  const root = await temp(t);
  const fixture = await octopusFixture(root);
  const script = fileURLToPath(new URL('../integration/panel-probe/server.mjs', import.meta.url));
  const checkouts = [fixture.cwd, fixture.attached, fixture.detached];

  for (const cwd of checkouts) {
    const child = spawn(process.execPath, [script], {
      cwd,
      env: { ...process.env, GIT_CEILING_DIRECTORIES: root },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const closed = once(child, 'close');
    let diagnostic = '';
    child.stderr.setEncoding('utf8').on('data', chunk => { diagnostic += chunk; });
    const lines = createInterface({ input: child.stdout });
    const responses = lines[Symbol.asyncIterator]();
    let id = 0;
    t.after(async () => {
      child.stdin.destroy();
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await closed;
      lines.close();
    });
    const request = async (method, params = {}) => {
      const requestId = ++id;
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) + '\n');
      const { value, done } = await responses.next();
      assert.equal(done, false, `Panel probe exited before answering ${method}: ${diagnostic}`);
      const response = JSON.parse(value);
      assert.equal(response.id, requestId);
      assert.equal(response.error, undefined);
      return response.result;
    };

    const initialized = await request('initialize', { protocolVersion: '2026-01-26' });
    assert.deepEqual(initialized.serverInfo, { name: 'branchscope-panel-probe', version: '0.1.0' });
    const { tools } = await request('tools/list');
    const probe = tools.find(tool => tool.name === 'branchscope_checkout_probe');
    assert.ok(probe);
    assert.deepEqual(probe._meta.ui.visibility, ['model', 'app']);
    assert.deepEqual(probe._meta['openai/ui'].entrypoints, [{ type: 'thread' }]);

    const uri = probe._meta.ui.resourceUri;
    const { contents } = await request('resources/read', { uri });
    assert.equal(contents[0].uri, uri);
    assert.equal(contents[0].mimeType, 'text/html;profile=mcp-app');
    assert.match(contents[0].text, /<button[^>]*>Read local checkout<\/button>/);

    const result = await request('tools/call', { name: probe.name, arguments: {} });
    assert.equal(result._meta.directory, path.normalize(path.resolve(cwd)));
    assert.equal(path.normalize(result._meta.checkout), cwd);
    child.stdin.end();
    const [code] = await closed;
    assert.equal(code, 0, diagnostic);
    lines.close();
  }
});
