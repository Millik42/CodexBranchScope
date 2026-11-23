const host = window.parent;
const pending = new Map();
let nextId = 1;
let connection;
let session;
let resizeObserver;
document.documentElement.dataset.displayMode = 'inline';

function send(message) {
  host.postMessage({ jsonrpc: '2.0', ...message }, '*');
}

function applyHostContext(context) {
  if (context?.displayMode) document.documentElement.dataset.displayMode = context.displayMode;
}

function call(method, params, timeout) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('The panel host did not respond. Try again.'));
    }, timeout);
    pending.set(id, { resolve, reject, timer });
    send({ id, method, params });
  });
}

window.addEventListener('message', event => {
  const message = event.data;
  if (event.source !== host || message?.jsonrpc !== '2.0') return;
  const { id, method, params, result, error } = message;
  if (method === 'ui/notifications/host-context-changed') {
    applyHostContext(params);
    return;
  }
  if (method === 'ping' || method === 'ui/resource-teardown') {
    if (method === 'ui/resource-teardown') resizeObserver?.disconnect();
    send({ id, result: {} });
    return;
  }
  const request = pending.get(id);
  if (method || !request) return;
  pending.delete(id);
  clearTimeout(request.timer);
  if (error) request.reject(new Error(error.message));
  else request.resolve(result);
});

function connect() {
  connection ??= call('ui/initialize', {
    protocolVersion: '2026-01-26',
    appInfo: { name: 'BranchScope', version: '0.1.0' },
    appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] },
  }, 15000).then(result => {
    applyHostContext(result?.hostContext);
    send({ method: 'ui/notifications/initialized', params: {} });
    resizeObserver = new ResizeObserver(() => {
      const { offsetWidth: width, offsetHeight: height } = document.body;
      send({ method: 'ui/notifications/size-changed', params: { width, height } });
    });
    resizeObserver.observe(document.body);
  }).catch(error => {
    connection = undefined;
    throw error;
  });
  return connection;
}

globalThis.branchScopePanel = {
  async request(route, query = {}) {
    await connect();
    const args = { ...query, route };
    if (session && !(route === 'first' && query.directory)) args.session = session;
    const result = await call('tools/call', { name: 'branchscope_graph', arguments: args }, 120000);
    const { data, error } = result?._meta ?? {};
    if (error || result?.isError) {
      const failure = new Error(error?.message ?? 'The Git operation failed.');
      failure.code = error?.code;
      throw failure;
    }
    if (!data) throw new Error('The panel host did not return Git data.');
    if (route === 'first') session = data.session;
    return data;
  },
};
