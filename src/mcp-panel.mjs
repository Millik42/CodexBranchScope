import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { GraphError } from './git.mjs';
import { createSession } from './session.mjs';

const version = '0.1.0';
const protocolVersions = new Set(['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']);
const resource = { uri: 'ui://branchscope/graph.html', name: 'BranchScope', mimeType: 'text/html;profile=mcp-app' };
const launchTool = {
  name: 'branchscope',
  title: 'BranchScope',
  description: 'Open the interactive Git history graph for a local checkout in Codex.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, openWorldHint: false },
  _meta: {
    ui: { resourceUri: resource.uri, visibility: ['model', 'app'] },
    'openai/ui': { entrypoints: [{ type: 'thread' }], preferredModelDisplayMode: 'inline' },
  },
};

const routes = {
  first: { fields: [], run: session => session.first() },
  page: { fields: ['snapshot', 'cursor'], run: (session, args) => session.page(args.snapshot, args.cursor) },
  jump: { fields: ['snapshot', 'target'], run: (session, args) => session.jump(args.snapshot, args.target) },
  details: { fields: ['snapshot', 'id'], run: (session, args) => session.details(args.snapshot, args.id) },
  refresh: { fields: [], run: session => session.refresh() },
  fetch: { fields: ['snapshot', 'remote'], run: (session, args) => session.fetch(args.snapshot, args.remote) },
};
const string = { type: 'string', minLength: 1 };
const graphTool = {
  name: 'branchscope_graph',
  description: 'Serve the BranchScope panel’s graph controls and fetch the remote selected in the panel.',
  inputSchema: {
    type: 'object',
    properties: {
      route: { type: 'string', enum: Object.keys(routes) },
      session: { ...string, description: 'The opaque binding returned by the first page.' },
      directory: { ...string, description: 'An explicitly selected absolute local checkout path for a new binding.' },
      snapshot: string,
      cursor: { type: 'integer', minimum: 0 },
      target: string,
      id: string,
      remote: string,
    },
    required: ['route'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  _meta: { ui: { visibility: ['app'] } },
};

const sessions = new Map();
const maxSessions = 16;

function localDirectory(directory) {
  const driveAbsolute = /^[A-Za-z]:[\\/]/;
  const networkPath = /^[\\/]{2}/;
  if (directory.includes('\0') || networkPath.test(directory) || !path.isAbsolute(directory) ||
      (process.platform === 'win32' && !driveAbsolute.test(directory))) {
    throw new GraphError('invalid_directory', 'Enter an absolute path to a local Git checkout.');
  }
  return path.normalize(directory);
}

function bindSession(directory) {
  if (sessions.size >= maxSessions) {
    const idle = [...sessions].find(([, binding]) => binding.active === 0);
    if (!idle) throw new GraphError('sessions_busy', 'BranchScope is busy. Try opening the checkout again shortly.');
    sessions.delete(idle[0]);
  }
  return { graph: createSession(directory), active: 0 };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateGraphCall(args) {
  const invalid = () => new GraphError('invalid_request', 'Invalid BranchScope graph request.');
  if (!isObject(args) || !Object.hasOwn(routes, args.route)) throw invalid();
  const route = routes[args.route];
  const fields = ['route', 'session', ...route.fields];
  if (args.route === 'first' && args.session === undefined) fields.push('directory');
  for (const key of Object.keys(args)) {
    const value = args[key];
    if (!fields.includes(key) || (key === 'cursor'
      ? !Number.isSafeInteger(value) || value < 0
      : typeof value !== 'string' || value.length === 0)) throw invalid();
  }
  if (route.fields.some(key => !Object.hasOwn(args, key))) throw invalid();
  return route;
}

async function graphCall(args) {
  try {
    const route = validateGraphCall(args);
    const opening = args.route === 'first' && args.session === undefined;
    const id = opening ? randomUUID() : args.session;
    const binding = opening ? bindSession(localDirectory(args.directory ?? process.cwd())) : sessions.get(id);
    if (!binding) {
      throw new GraphError('session_unavailable', 'This BranchScope session has ended. Reopen the checkout to continue.');
    }
    // Move the binding to the end so the oldest idle view is retired first.
    sessions.delete(id);
    sessions.set(id, binding);
    binding.active++;
    try {
      const data = await route.run(binding.graph, args);
      return { content: [], _meta: { data: args.route === 'first' ? { ...data, session: id } : data } };
    } catch (error) {
      if (opening) sessions.delete(id);
      throw error;
    } finally {
      binding.active--;
    }
  } catch (error) {
    const failure = error instanceof GraphError ? { code: error.code, message: error.message } : {
      code: 'checkout_unavailable',
      message: 'BranchScope could not read the checkout. Check the project folder and run git status in the project terminal.',
    };
    return { isError: true, content: [], _meta: { error: failure } };
  }
}

async function readPanel() {
  const [html, css, bridge, app] = await Promise.all(['index.html', 'style.css', 'mcp-panel.js', 'app.js']
    .map(file => readFile(new URL('../web/' + file, import.meta.url), 'utf8')));
  const script = source => '<script type="module">\n' + source.replace(/<\/script/gi, '<\\/script') + '\n</script>';
  return html
    .replace('<link rel="stylesheet" href="/style.css">', () => '<style>\n' + css + '\n</style>')
    .replace('<script type="module" src="/app.js"></script>', () => script(bridge) + '\n' + script(app));
}

const handlers = {
  initialize: ({ protocolVersion }) => ({
    protocolVersion: protocolVersions.has(protocolVersion) ? protocolVersion : '2025-11-25',
    serverInfo: { name: 'branchscope', version },
    capabilities: { tools: {}, resources: {} },
  }),
  ping: () => ({}),
  'tools/list': () => ({ tools: [launchTool, graphTool] }),
  'resources/list': () => ({ resources: [resource] }),
  'resources/templates/list': () => ({ resourceTemplates: [] }),
  'resources/read': async ({ uri }) => {
    if (uri !== resource.uri) throw new RpcError(-32002, 'Resource not found');
    return {
      contents: [{
        uri,
        mimeType: resource.mimeType,
        text: await readPanel(),
        _meta: { 'openai/ui': { availableDisplayModes: ['inline', 'fullscreen'], preferredDisplayMode: 'inline' } },
      }],
    };
  },
  'tools/call': ({ name, arguments: args = {} }) => {
    if (name === graphTool.name) return graphCall(args);
    if (name !== launchTool.name) throw new RpcError(-32602, 'Unknown tool');
    if (!isObject(args) || Object.keys(args).length) throw new RpcError(-32602, 'Invalid tool arguments');
    return { content: [{ type: 'text', text: 'BranchScope opens an interactive Git graph in Codex.' }] };
  },
};

class RpcError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function reply(id, body) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, ...body }) + '\n');
}

async function dispatch(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return reply(null, { error: { code: -32700, message: 'Parse error' } });
  }
  if (!isObject(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return reply(null, { error: { code: -32600, message: 'Invalid request' } });
  }
  if (!Object.hasOwn(message, 'id')) return;
  const { id, method, params } = message;
  try {
    if (!Object.hasOwn(handlers, method)) throw new RpcError(-32601, 'Method not found');
    if (params !== undefined && !isObject(params)) throw new RpcError(-32602, 'Invalid parameters');
    reply(id, { result: await handlers[method](params ?? {}) });
  } catch (error) {
    const failure = error instanceof RpcError ? { code: error.code, message: error.message } :
      { code: -32603, message: 'BranchScope could not complete the operation' };
    reply(id, { error: failure });
  }
}

const pending = new Set();
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  const request = dispatch(line);
  pending.add(request);
  void request.finally(() => pending.delete(request));
}
await Promise.all(pending);
