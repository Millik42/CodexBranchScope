import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export class GraphError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// Ignore inherited repository overrides so every invocation stays in the selected checkout.
const repositoryVariables = new Set([
  'GIT_DIR', 'GIT_COMMON_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_NAMESPACE',
  'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_SHALLOW_FILE',
  'GIT_GRAFT_FILE', 'GIT_QUARANTINE_PATH', 'GIT_PREFIX', 'GIT_INTERNAL_SUPER_PREFIX',
]);

export function gitRunner(executable = 'git') {
  return (cwd, args, input) => new Promise((resolve, reject) => {
    const env = Object.fromEntries(Object.entries(process.env)
      .filter(([key]) => !repositoryVariables.has(key.toUpperCase())));
    Object.assign(env, {
      LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1', GIT_NO_REPLACE_OBJECTS: '1',
    });
    const child = spawn(executable, ['--no-pager', ...args], {
      cwd, env, windowsHide: true, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => {
      stderr += chunk.slice(0, Math.max(0, 32768 - stderr.length));
    });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
    if (input !== undefined) {
      child.stdin.on('error', error => {
        if (error.code !== 'EPIPE') reject(error);
      });
      child.stdin.end(input);
    }
  });
}

function requireOutput(result) {
  if (result.code !== 0) {
    throw new GraphError('git_failed', 'Git could not read this checkout. Check repository access and run git status in the project terminal.', 422);
  }
  return result.stdout;
}

const line = value => value.replace(/\r?\n$/, '');
const lines = value => line(value).split(/\r?\n/).filter(Boolean);
const parentIds = value => value ? value.split(' ') : [];

function wildcardValue(pattern, ref) {
  const star = pattern.indexOf('*');
  if (star < 0) return pattern === ref ? '' : null;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  return ref.startsWith(prefix) && ref.endsWith(suffix) && ref.length >= prefix.length + suffix.length
    ? ref.slice(prefix.length, ref.length - suffix.length) : null;
}

function trackingRules(result, remotes) {
  const rules = new Map(remotes.map(remote => [remote, { include: [], exclude: [] }]));
  if (result.code === 1) return rules;
  for (const record of requireOutput(result).split('\0').filter(Boolean)) {
    const separator = record.indexOf('\n');
    if (separator < 0) continue;
    const remote = record.slice('remote.'.length, separator - '.fetch'.length);
    const rule = rules.get(remote);
    if (!rule) continue;
    const spec = record.slice(separator + 1);
    if (spec.startsWith('^')) {
      rule.exclude.push(spec.slice(1));
      continue;
    }
    const [source, destination] = spec.replace(/^\+/, '').split(':');
    if (destination?.startsWith('refs/remotes/')) rule.include.push({ source, destination });
  }
  return rules;
}

function trackingBranch(ref, name, rules, prefixes) {
  const owners = [];
  for (const [remote, { include, exclude }] of rules) {
    for (const { source, destination } of include) {
      const wildcard = wildcardValue(destination, ref);
      if (wildcard === null) continue;
      const upstream = source.replace('*', () => wildcard);
      if (exclude.some(pattern => wildcardValue(pattern, upstream) !== null)) continue;
      owners.push({ remote, shortName: upstream.replace(/^refs\/heads\//, '') || name });
      break;
    }
  }
  if (owners.length === 1) return owners[0];
  if (owners.length > 1) return { remote: null, shortName: name };
  const remote = prefixes.find(candidate => name.startsWith(candidate + '/')) ?? null;
  return { remote, shortName: remote ? name.slice(remote.length + 1) : name };
}

export async function resolveCheckout(run, directory) {
  const info = await stat(directory).catch(error => {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  });
  if (!info?.isDirectory()) {
    throw new GraphError('project_missing', 'The project folder is unavailable. Reopen the checkout in Codex and launch BranchScope again.', 404);
  }
  let result;
  try {
    result = await run(directory, ['rev-parse', '--show-toplevel']);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new GraphError('git_missing', 'Git could not start. Install Git for Windows, add it to PATH, and restart Codex.', 503);
    }
    throw error;
  }
  if (/not a git repository|must be run in a work tree/.test(result.stderr)) {
    throw new GraphError('not_git', 'Open a Git checkout or linked worktree in Codex, then launch BranchScope again.', 422);
  }
  return path.normalize(line(requireOutput(result)));
}

export async function readHistory(run, root) {
  const [shallowResult, commonResult, refsResult, remoteResult, refspecResult] = await Promise.all([
    run(root, ['rev-parse', '--is-shallow-repository']),
    run(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
    run(root, ['for-each-ref', '--include-root-refs', '--format=%(refname)%00%(objectname)%00%(symref)',
      'HEAD', 'refs/heads/', 'refs/remotes/']),
    run(root, ['remote']),
    run(root, ['config', '--null', '--get-regexp', '^remote\\..*\\.fetch$']),
  ]);
  const shallow = line(requireOutput(shallowResult)) === 'true';
  const common = path.normalize(line(requireOutput(commonResult)));
  const checkoutName = path.basename(root);
  const repository = path.basename(common) === '.git' ? path.basename(path.dirname(common)) : checkoutName;
  const remotes = lines(requireOutput(remoteResult));
  const remotePrefixes = [...remotes].sort((a, b) => b.length - a.length);
  const rules = trackingRules(refspecResult, remotes);
  const captured = new Map(lines(requireOutput(refsResult)).map(record => {
    const [ref, id, alias] = record.split('\0');
    return [ref, { id, alias }];
  }));
  const headRef = captured.get('HEAD');
  captured.delete('HEAD');
  let symbolic = headRef?.alias || null;
  if (!headRef) {
    // Git omits the unresolved HEAD of a repository with an unborn branch.
    const result = await run(root, ['symbolic-ref', '--quiet', 'HEAD']);
    if (result.code !== 1) symbolic = line(requireOutput(result));
  }
  const head = captured.get(symbolic)?.id || headRef?.id || null;
  const branch = symbolic?.replace(/^refs\/heads\//, '') ?? null;
  const refs = [];
  for (const [ref, { id, alias }] of captured) {
    if (alias && ref.startsWith('refs/remotes/')) continue;
    if (ref.startsWith('refs/heads/')) {
      refs.push({ ref, id, kind: 'local', name: ref.slice('refs/heads/'.length) });
    } else {
      const name = ref.slice('refs/remotes/'.length);
      refs.push({ ref, id, kind: 'remote', name, ...trackingBranch(ref, name, rules, remotePrefixes) });
    }
  }

  const tips = [...new Set([head, ...refs.map(ref => ref.id)].filter(Boolean))];
  const commits = [];
  if (tips.length) {
    const args = ['-c', 'i18n.logOutputEncoding=UTF-8', 'log', '--no-notes', '--no-show-signature',
      '--no-decorate', '--no-color', '--topo-order', '-z', '--format=%H%x00%P%x00%s'];
    // Passing tips on stdin avoids Windows' command-line length limit on repositories with many refs.
    const data = requireOutput(await run(root, [...args, '--stdin', '--'], tips.join('\n') + '\n')).split('\0');
    data.pop();
    for (let i = 0; i < data.length; i += 3) {
      commits.push({ id: data[i], parents: parentIds(data[i + 1]), subject: data[i + 2], boundary: false });
    }
  }
  if (shallow) {
    const shallowPath = line(requireOutput(await run(root, ['rev-parse', '--path-format=absolute', '--git-path', 'shallow'])));
    const boundaries = new Set(lines(await readFile(shallowPath, 'utf8')));
    for (const commit of commits) {
      if (!boundaries.has(commit.id)) continue;
      const raw = requireOutput(await run(root, ['cat-file', 'commit', commit.id]));
      commit.boundary = true;
      commit.parents = raw.split('\n\n', 1)[0].split('\n')
        .filter(header => header.startsWith('parent ')).map(header => header.slice(7));
    }
  }
  return { root, repository, head, branch, shallow, remotes, refs, commits };
}

export async function readDetails(run, root, id) {
  const output = requireOutput(await run(root, ['-c', 'i18n.logOutputEncoding=UTF-8', 'show',
    '--no-patch', '--no-notes', '--no-show-signature', '--no-color', '--no-decorate',
    '--format=format:%an%x00%ae%x00%aI%x00%B', id, '--']));
  const [author, email, authoredAt, message] = output.split('\0');
  return { author, email, authoredAt, message };
}

export async function fetchRemote(run, root, remote) {
  // Git resolves an identically named remote group before the individual remote.
  const groups = await run(root, ['config', '--null', '--get-regexp', '^remotes\\.']);
  const names = groups.code === 1 ? [] : requireOutput(groups).split('\0')
    .map(record => record.split('\n', 1)[0]);
  if (names.includes('remotes.' + remote)) {
    throw new GraphError('remote_group_conflict', `Git also uses ${remote} as a remote group. Rename that group in Git configuration, then retry the fetch.`, 422);
  }
  const result = await run(root, ['fetch', '--no-recurse-submodules', '--no-auto-maintenance', '--', remote]);
  if (result.code === 0) return;
  // Git and credential helpers may include sensitive URLs or arbitrary text in stderr.
  let remedy = 'Check the remote URL, access, and Git configuration in the project terminal, then retry.';
  if (/authentication failed|permission denied|could not read Username|publickey/i.test(result.stderr)) {
    remedy = 'Check your Git credentials and access to this remote, then retry.';
  } else if (/could not resolve|failed to connect|timed out|network is unreachable/i.test(result.stderr)) {
    remedy = 'Check the remote address, network connection, and VPN, then retry.';
  } else if (/couldn.t find remote ref/i.test(result.stderr)) {
    remedy = 'Check the remote fetch refspec and whether its branches still exist, then retry.';
  } else if (/does not appear to be a git repository|repository .*not found/i.test(result.stderr)) {
    remedy = 'Check that the remote repository exists and that Git can access it, then retry.';
  }
  throw new GraphError('fetch_failed', `Fetch from ${remote} failed. ${remedy}`, 422);
}
