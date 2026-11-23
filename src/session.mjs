import { randomUUID } from 'node:crypto';
import { fetchRemote, gitRunner, GraphError, readDetails, readHistory, resolveCheckout } from './git.mjs';
import { layoutCommits } from './layout.mjs';

const pageSize = 200;

export function createSession(directory, run = gitRunner()) {
  let root;
  let snapshot;
  let mutations = Promise.resolve();
  let fetching = false;

  async function rebuild() {
    root ??= await resolveCheckout(run, directory);
    const { commits, ...project } = await readHistory(run, root);
    const index = new Map(commits.map((commit, row) => [commit.id, row]));
    const refs = new Map();
    for (const ref of project.refs) {
      refs.set(ref.ref, ref.id);
      const row = index.get(ref.id);
      if (row !== undefined) (commits[row].labels ??= []).push(ref);
    }
    const lanes = layoutCommits(commits, index);
    if (index.has(project.head)) commits[index.get(project.head)].head = true;
    snapshot = { id: randomUUID(), commits, index, refs, project, lanes };
    return { ...page(snapshot, 0), project };
  }

  function current(id) {
    if (!snapshot || snapshot.id !== id) {
      throw new GraphError('stale_snapshot', 'The graph changed. Refresh to load the current history.', 409);
    }
    return snapshot;
  }

  function page(view, cursor) {
    if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > view.commits.length || cursor % pageSize !== 0) {
      throw new GraphError('invalid_cursor', 'This graph page is unavailable.');
    }
    const rows = view.commits.slice(cursor, cursor + pageSize);
    return {
      snapshot: view.id, rows, cursor,
      next: cursor + rows.length < view.commits.length ? cursor + rows.length : null,
      total: view.commits.length, lanes: view.lanes,
    };
  }

  function serialize(operation) {
    const result = mutations.then(operation);
    mutations = result.catch(() => {});
    return result;
  }

  return {
    first: () => serialize(() => snapshot ? { ...page(snapshot, 0), project: snapshot.project } : rebuild()),
    page: (id, cursor) => page(current(id), cursor),
    jump(id, target) {
      const view = current(id);
      const oid = view.refs.get(target) ?? target;
      const row = view.index.get(oid);
      return row === undefined ? { available: false } : { available: true, id: oid, row };
    },
    async details(id, oid) {
      const view = current(id);
      const row = view.index.get(oid);
      if (row === undefined) throw new GraphError('commit_unavailable', 'That commit is outside this history.', 404);
      const commit = view.commits[row];
      const details = await readDetails(run, root, commit.id);
      return {
        ...details, id: commit.id, subject: commit.subject,
        parents: commit.parents.map(parent => ({ id: parent, available: view.index.has(parent) })),
      };
    },
    refresh: () => serialize(rebuild),
    async fetch(id, remote) {
      if (fetching) throw new GraphError('fetch_busy', 'A fetch is already running.', 409);
      fetching = true;
      try {
        return await serialize(async () => {
          const view = current(id);
          const allowed = view.project.remotes.find(name => name === remote);
          if (!allowed || !await remoteStillConfigured(run, root, allowed)) {
            throw new GraphError('unknown_remote', 'Choose a configured remote. Refresh the graph if the remote list changed.');
          }
          await fetchRemote(run, root, allowed);
          return rebuild();
        });
      } finally {
        fetching = false;
      }
    },
  };
}

async function remoteStillConfigured(run, root, remote) {
  const result = await run(root, ['remote']);
  return result.code === 0 && result.stdout.split(/\r?\n/).includes(remote);
}
