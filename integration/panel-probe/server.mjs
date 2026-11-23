import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';

const uri = 'ui://branchscope/panel-probe.html';
const mimeType = 'text/html;profile=mcp-app';
const html = await readFile(new URL('./panel.html', import.meta.url), 'utf8');
const name = 'branchscope_checkout_probe';
const tool = {
  name,
  title: 'BranchScope Panel Probe',
  description: 'Check the local MCP process checkout and open the BranchScope compatibility panel.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, openWorldHint: false },
  _meta: {
    ui: { resourceUri: uri, visibility: ['model', 'app'] },
    'openai/ui': { entrypoints: [{ type: 'thread' }] },
  },
};

const handlers = {
  initialize: ({ protocolVersion }) => ({
    protocolVersion,
    serverInfo: { name: 'branchscope-panel-probe', version: '0.1.0' },
    capabilities: { tools: {}, resources: {} },
  }),
  ping: () => ({}),
  'tools/list': () => ({ tools: [tool] }),
  'resources/list': () => ({ resources: [{ uri, name: 'BranchScope Panel Probe', mimeType }] }),
  'resources/read': params => params.uri === uri
    ? { contents: [{ uri, mimeType, text: html }] } : undefined,
  'tools/call': params => {
    if (params.name !== name) return undefined;
    const git = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', windowsHide: true });
    return {
      content: [{ type: 'text', text: 'BranchScope probe reached the local MCP process.' }],
      _meta: { directory: process.cwd(), checkout: git.status === 0 ? git.stdout.trimEnd() : null },
    };
  },
};

for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON' } }) + '\n');
    continue;
  }
  if (!message || typeof message !== 'object' || !Object.hasOwn(message, 'id')) continue;
  const { id, method, params } = message;
  const handler = Object.hasOwn(handlers, method) ? handlers[method] : undefined;
  const result = handler?.(params ?? {});
  const body = result === undefined ? { error: { code: -32601, message: 'Operation unavailable' } } : { result };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, ...body }) + '\n');
}
