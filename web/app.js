const byId = id => document.getElementById(id);
const viewport = byId('viewport');
const rowsElement = byId('rows');
const rowHeight = 44;
const overscan = 8;
const colors = ['#67dbb1', '#7fb5ff', '#ffc078', '#c3a6ff', '#f58daa', '#e1df77', '#72d8e9', '#f2a38b'];
const svgNamespace = 'http://www.w3.org/2000/svg';
const rendered = new Map();
const fragment = location.hash.slice(1);
if (fragment) {
  sessionStorage.setItem('branchscope-token', fragment);
  history.replaceState(null, '', '/');
}
const token = sessionStorage.getItem('branchscope-token');

let graph;
let pageRequest;
let selected;
let navigation = 0;
let detailRequest = 0;
let busy = false;
let pageFailed = false;

function element(tag, content, className) {
  const node = document.createElement(tag);
  if (content !== undefined) node.textContent = content;
  if (className) node.className = className;
  if (tag === 'button') node.type = 'button';
  return node;
}

async function api(route, query = {}, method = 'GET') {
  const response = await fetch('/api/' + route + '?' + new URLSearchParams(query), {
    method, headers: { Authorization: 'Bearer ' + token },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message);
  return result;
}

function notice(message = '') {
  byId('notice').textContent = message;
  byId('notice').hidden = !message;
}

function updateControls() {
  byId('refresh').disabled = busy;
  byId('remote').disabled = busy || !graph?.project.remotes.length;
  byId('fetch').disabled = busy || !byId('remote').value;
  byId('older').hidden = graph?.next == null;
  byId('older').disabled = Boolean(pageRequest);
}

function label(text, kind) {
  return element('span', text, 'ref ' + kind);
}

function renderProject(project) {
  byId('repository').textContent = project.repository;
  byId('path').textContent = project.root;
  byId('branch').textContent = !project.head && project.branch
    ? 'Unborn ' + project.branch : project.branch ?? 'Detached HEAD';
  byId('branch').hidden = !project.head && !project.branch;
  const remote = byId('remote');
  const previous = remote.value;
  remote.replaceChildren(new Option('Select remote', ''), ...project.remotes.map(name => new Option(name, name)));
  if (project.remotes.includes(previous)) remote.value = previous;
  const refs = byId('refs');
  refs.replaceChildren();
  const groups = new Map();
  for (const ref of project.refs) {
    const key = ref.kind === 'local' ? 'Local' : ref.remote ? 'Remote · ' + ref.remote : 'Remote · Other refs';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ref);
  }
  if (!groups.size) refs.append(element('p', 'No branches recorded.', 'muted'));
  for (const [name, items] of groups) {
    refs.append(element('h3', name));
    for (const ref of items) {
      const caption = ref.shortName ?? ref.name;
      const button = element('button', caption, 'branch-link');
      button.title = ref.ref;
      if (ref.kind === 'local' && ref.name === project.branch) button.setAttribute('aria-current', 'true');
      button.addEventListener('click', () => jump(ref.ref));
      refs.append(button);
    }
  }
  if (project.remotes.length || project.refs.some(ref => ref.kind === 'remote')) {
    refs.append(element('p', 'Remote branches reflect what local Git last recorded.', 'muted'));
  }
}

function svgNode(name, properties) {
  const node = document.createElementNS(svgNamespace, name);
  for (const [key, value] of Object.entries(properties)) node.setAttribute(key, value);
  return node;
}

function drawGraph(row) {
  const width = Math.max(46, 24 + graph.lanes * 13);
  const mid = rowHeight / 2;
  const svg = svgNode('svg', { width, height: rowHeight, 'aria-hidden': 'true' });
  const x = lane => 14 + 13 * lane;
  const color = index => colors[index % colors.length];
  const center = x(row.graph.lane);
  function edge(d, trackColor, dashed = false) {
    const path = svgNode('path', { d, fill: 'none', stroke: color(trackColor), 'stroke-width': 1.65 });
    if (dashed) path.setAttribute('stroke-dasharray', '2 3');
    svg.append(path);
  }
  for (const track of row.graph.crossing) edge(`M ${x(track.lane)} 0 V ${rowHeight}`, track.color);
  if (row.graph.incoming) edge(`M ${center} 0 V ${mid}`, row.graph.color);
  for (const track of row.graph.edges) {
    const end = x(track.lane);
    const d = end === center ? `M ${center} ${mid} V ${rowHeight}`
      : `M ${center} ${mid} C ${center} ${mid + 8}, ${end} ${mid + 8}, ${end} ${mid + 16} V ${rowHeight}`;
    edge(d, track.color);
  }
  if (row.boundary) edge(`M ${center} ${mid} V ${mid + 14}`, row.graph.color, true);
  if (row.head) svg.append(svgNode('circle', {
    cx: center, cy: mid, r: 8, fill: 'none', stroke: '#eafaf5', 'stroke-width': 1.25,
  }));
  svg.append(svgNode('circle', { cx: center, cy: mid, r: row.parents.length > 1 ? 5 : 4, fill: color(row.graph.color) }));
  return svg;
}

function commitButton(row, index) {
  const button = element('button', undefined, 'commit');
  button.style.top = index * rowHeight + 'px';
  button.title = row.subject || '(No subject)';
  button.setAttribute('aria-pressed', String(selected === row.id));
  const labels = element('span', undefined, 'labels');
  if (row.head) labels.append(label('HEAD', 'head'));
  if (row.boundary) labels.append(label('Shallow boundary', 'boundary'));
  for (const ref of row.labels ?? []) {
    labels.append(label((ref.kind === 'local' ? 'Local · ' : 'Remote · ') + ref.name, ref.kind));
  }
  button.append(drawGraph(row), element('span', row.subject || '(No subject)', 'subject'), labels,
    element('span', row.id.slice(0, 8), 'oid'));
  button.addEventListener('click', () => {
    navigation++;
    selectCommit(row.id);
  });
  return button;
}

function renderRows() {
  if (!graph) return;
  rowsElement.style.height = graph.rows.length * rowHeight + 'px';
  byId('count').textContent = `${graph.rows.length.toLocaleString()} / ${graph.total.toLocaleString()}`;
  const first = Math.max(0, Math.floor(viewport.scrollTop / rowHeight) - overscan);
  const end = Math.min(graph.rows.length, Math.ceil((viewport.scrollTop + viewport.clientHeight) / rowHeight) + overscan);
  for (const [index, button] of rendered) {
    if (index >= first && index < end) continue;
    button.remove();
    rendered.delete(index);
  }
  let before = null;
  for (let index = end - 1; index >= first; index--) {
    let button = rendered.get(index);
    if (!button) {
      button = commitButton(graph.rows[index], index);
      rowsElement.insertBefore(button, before);
      rendered.set(index, button);
    }
    button.setAttribute('aria-pressed', String(selected === graph.rows[index].id));
    before = button;
  }
}

function installGraph(result) {
  graph = result;
  pageRequest = undefined;
  pageFailed = false;
  detailRequest++;
  rendered.clear();
  rowsElement.replaceChildren();
  viewport.scrollTop = 0;
  viewport.scrollLeft = 0;
  byId('status').textContent = '';
  byId('placeholder').hidden = Boolean(graph.total);
  byId('placeholder').textContent = 'This repository has no commits. Create a commit in Git, then refresh the graph.';
  renderProject(graph.project);
  renderRows();
  updateControls();
}

function loadPage() {
  if (pageRequest) return pageRequest;
  const view = graph;
  if (!view || view.next === null) return Promise.resolve(false);
  const cursor = view.next;
  byId('status').textContent = 'Loading older commits…';
  pageRequest = api('page', { snapshot: view.snapshot, cursor }).then(page => {
    if (graph !== view) return false;
    if (page.snapshot !== view.snapshot || page.cursor !== cursor) throw new Error('The graph page changed. Refresh the graph.');
    view.rows.push(...page.rows);
    view.next = page.next;
    pageFailed = false;
    byId('status').textContent = '';
    renderRows();
    return true;
  }).catch(error => {
    if (graph === view) {
      pageFailed = true;
      byId('status').textContent = error.message;
    }
    return false;
  }).finally(() => {
    if (graph === view) {
      pageRequest = undefined;
      updateControls();
    }
  });
  updateControls();
  return pageRequest;
}

function scrollRows() {
  renderRows();
  if (graph && !pageFailed && viewport.scrollTop + viewport.clientHeight >= graph.rows.length * rowHeight - rowHeight * 8) {
    void loadPage();
  }
}

async function jump(target, { focus = true, missing = true } = {}) {
  const view = graph;
  if (!view) return;
  const request = ++navigation;
  const current = () => graph === view && request === navigation;
  try {
    const found = await api('jump', { snapshot: view.snapshot, target });
    if (!current()) return;
    if (!found.available) {
      if (missing) notice('That commit is outside the recorded history.');
      else selectCommit(null);
      return;
    }
    while (current() && found.row >= view.rows.length) {
      if (!await loadPage()) return;
    }
    if (!current()) return;
    viewport.scrollTop = Math.max(0, found.row * rowHeight - Math.floor(viewport.clientHeight / 2) + rowHeight / 2);
    renderRows();
    if (focus) rendered.get(found.row)?.focus({ preventScroll: true });
    await selectCommit(found.id);
  } catch (error) {
    if (current()) notice(error.message);
  }
}

function showDetails(commit) {
  const panel = byId('details');
  const copy = element('button', 'Copy object ID');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(commit.id);
      copy.textContent = 'Copied';
    } catch {
      const range = document.createRange();
      range.selectNodeContents(objectId);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      copy.textContent = 'Press Ctrl+C to copy';
    }
  });
  const list = element('dl');
  const objectId = element('code', commit.id);
  for (const [key, value] of [
    ['Author', `${commit.author} <${commit.email}>`],
    ['Authored', commit.authoredAt],
    ['Object ID', objectId],
  ]) {
    const description = element('dd');
    description.append(value);
    list.append(element('dt', key), description);
  }
  panel.replaceChildren(element('h3', commit.subject || '(No subject)', 'subject-title'), list, copy,
    element('h3', 'Message'), element('pre', commit.message), element('h3', 'Parents'));
  if (!commit.parents.length) panel.append(element('p', 'Root commit', 'muted'));
  for (const parent of commit.parents) {
    const button = element('button', parent.id.slice(0, 12) + (parent.available ? '' : ' · outside history'), 'parent-link');
    button.disabled = !parent.available;
    button.title = parent.id;
    button.addEventListener('click', () => jump(parent.id));
    panel.append(button);
  }
}

async function selectCommit(id) {
  const view = graph;
  const request = ++detailRequest;
  selected = id;
  renderRows();
  const panel = byId('details');
  panel.replaceChildren(element('p', id ? 'Reading commit…' : 'Select a commit to see its details.', 'muted'));
  if (!id) return;
  try {
    const commit = await api('details', { snapshot: view.snapshot, id });
    if (request === detailRequest && view === graph) showDetails(commit);
  } catch (error) {
    if (request === detailRequest && view === graph) panel.replaceChildren(element('p', error.message));
  }
}

async function update(route, query = {}) {
  if (busy) return;
  busy = true;
  notice();
  updateControls();
  byId('refresh').textContent = route === 'refresh' ? 'Refreshing…' : 'Refresh graph';
  byId('fetch').textContent = route === 'fetch' ? 'Fetching…' : 'Fetch';
  try {
    const result = await api(route, query, route === 'first' ? 'GET' : 'POST');
    const keep = selected;
    installGraph(result);
    if (keep) await jump(keep, { focus: false, missing: false });
  } catch (error) {
    notice(error.message);
    if (!graph) byId('placeholder').textContent = 'Git history unavailable.';
  } finally {
    busy = false;
    byId('refresh').textContent = 'Refresh graph';
    byId('fetch').textContent = 'Fetch';
    updateControls();
  }
}

viewport.addEventListener('scroll', scrollRows, { passive: true });
new ResizeObserver(scrollRows).observe(viewport);
byId('older').addEventListener('click', loadPage);
byId('remote').addEventListener('change', updateControls);
byId('refresh').addEventListener('click', () => update('refresh'));
byId('fetch').addEventListener('click', () => update('fetch', {
  snapshot: graph.snapshot, remote: byId('remote').value,
}));
void update('first');
