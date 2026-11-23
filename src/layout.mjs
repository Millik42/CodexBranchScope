export function layoutCommits(commits, index) {
  const lanes = [];
  const pending = new Map();
  let nextColor = 0;
  let width = 0;

  function assign(id, color, preferred = lanes.indexOf(null)) {
    const lane = preferred < 0 ? lanes.length : preferred;
    const track = { id, lane, color };
    lanes[lane] = track;
    pending.set(id, track);
    return track;
  }

  for (const commit of commits) {
    const existing = pending.get(commit.id);
    const current = existing ?? assign(commit.id, nextColor++);
    const crossing = lanes.filter(track => track && track !== current)
      .map(({ lane, color }) => ({ lane, color }));
    lanes[current.lane] = null;
    pending.delete(commit.id);

    const edges = [];
    if (!commit.boundary) {
      for (const [position, id] of commit.parents.entries()) {
        if (!index.has(id)) continue;
        const track = pending.get(id) ?? (position === 0
          ? assign(id, current.color, current.lane)
          : assign(id, nextColor++));
        edges.push({ id, lane: track.lane, color: track.color });
      }
    }
    commit.graph = { lane: current.lane, color: current.color, incoming: Boolean(existing), crossing, edges };
    width = Math.max(width, lanes.length);
    while (lanes.at(-1) === null) lanes.pop();
  }
  return width;
}
