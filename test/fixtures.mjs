import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gitRunner } from '../src/git.mjs';

const runGit = gitRunner();

export async function git(cwd, ...args) {
  const result = await runGit(cwd, args);
  assert.equal(result.code, 0, result.stderr);
  return result.stdout.replace(/\r?\n$/, '');
}

export async function init(root, name = 'checkout') {
  const cwd = path.join(root, name);
  await mkdir(cwd, { recursive: true });
  await git(cwd, 'init', '-b', 'main');
  await git(cwd, 'config', 'user.name', 'Тестовый Автор');
  await git(cwd, 'config', 'user.email', 'author@example.invalid');
  return cwd;
}

export async function commit(cwd, ...messages) {
  await git(cwd, 'commit', '--allow-empty', ...messages.flatMap(message => ['-m', message]));
  return git(cwd, 'rev-parse', 'HEAD');
}

export async function octopusFixture(root) {
  const cwd = await init(root, 'Проект с пробелами');
  const base = await commit(cwd, 'Initial');
  const main = await commit(cwd, 'Work on main');
  await git(cwd, 'switch', '-c', 'topic-a', base);
  const a = await commit(cwd, 'Первая строка', 'Вторая строка\nТретья строка <example>');
  await git(cwd, 'switch', '-c', 'topic-b', base);
  const b = await commit(cwd, 'Work on topic-b');
  const tree = await git(cwd, 'rev-parse', 'HEAD^{tree}');
  // commit-tree gives this fixture three ordered parents on every Git version.
  const merge = await git(cwd, 'commit-tree', tree, '-p', main, '-p', a, '-p', b, '-m', 'Octopus merge');
  await git(cwd, 'update-ref', 'refs/heads/main', merge);
  await git(cwd, 'switch', 'main');
  const detached = path.join(root, 'Detached worktree');
  await git(cwd, 'worktree', 'add', '--detach', detached, a);
  const attached = path.join(root, 'Attached worktree');
  await git(cwd, 'worktree', 'add', attached, 'topic-b');
  const nested = path.join(cwd, 'Вложенная папка');
  await mkdir(nested);
  return { cwd, base, main, a, b, merge, attached, detached, nested };
}

export async function fetchFixture(root) {
  const cwd = await init(root);
  const initial = await commit(cwd, 'Initial');
  const origin = path.join(root, 'origin.git');
  const mirror = path.join(root, 'mirror.git');
  await git(root, 'init', '--bare', '-b', 'main', origin);
  await git(root, 'init', '--bare', '-b', 'main', mirror);
  for (const [name, target] of [['origin', origin], ['mirror', mirror]]) {
    await git(cwd, 'remote', 'add', name, target);
    await git(cwd, 'push', name, 'main');
    await git(cwd, 'remote', 'set-head', name, 'main');
  }
  const writer = path.join(root, 'remote writer');
  await git(root, 'clone', origin, writer);
  await git(writer, 'config', 'user.name', 'Fixture');
  await git(writer, 'config', 'user.email', 'fixture@example.invalid');
  const local = await commit(cwd, 'Local ahead');
  const advanced = await commit(writer, 'Advance origin');
  await git(writer, 'push', 'origin', 'main');
  return { cwd, origin, mirror, initial, local, advanced };
}

export async function longFixture(root) {
  const cwd = await init(root);
  const base = await commit(cwd, 'Old branch tip');
  const tree = await git(cwd, 'rev-parse', 'HEAD^{tree}');
  await git(cwd, 'branch', 'old-tip');
  let parent = base;
  for (let index = 1; index <= 205; index++) {
    parent = await git(cwd, 'commit-tree', tree, '-p', parent, '-m', 'Commit ' + index);
  }
  await git(cwd, 'update-ref', 'refs/heads/main', parent);
  return { cwd, base };
}

export async function shallowFixture(root) {
  const cwd = await init(root, 'source');
  const base = await commit(cwd, 'Root');
  const tip = await commit(cwd, 'Tip');
  const shallow = path.join(root, 'shallow');
  await git(root, 'clone', '--depth=1', pathToFileURL(cwd).href, shallow);
  return { shallow, base, tip };
}
