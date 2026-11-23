import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { windowsExecutable } from './windows-executable.mjs';

const marketplace = 'branchscope-local';
const plugin = 'branchscope';
const files = [
  'src/git.mjs', 'src/layout.mjs', 'src/session.mjs', 'src/mcp-panel.mjs', 'src/windows-executable.mjs',
  'web/index.html', 'web/style.css', 'web/app.js', 'web/mcp-panel.js',
];

function codex(...args) {
  const executable = windowsExecutable('codex');
  if (!executable) throw new Error('Add the Codex CLI to PATH, then rerun the installer.');
  const result = spawnSync(executable, args, { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`codex ${args.slice(0, 3).join(' ')} failed.`);
}

async function writeJson(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2) + '\n');
}

try {
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) {
    throw new Error('This installer requires Codex Desktop on Windows.');
  }
  const root = path.join(process.env.LOCALAPPDATA, 'BranchScope', 'marketplace');
  const folder = path.join(root, 'plugins', plugin);

  for (const file of files) {
    const destination = path.join(folder, file);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(new URL('../' + file, import.meta.url), destination);
  }

  await writeJson(path.join(folder, '.codex-plugin', 'plugin.json'), {
    name: plugin,
    version: '0.1.0',
    description: 'View local Git history and worktree branches in Codex.',
    mcpServers: './.mcp.json',
    interface: { displayName: 'BranchScope', shortDescription: 'Local Git history and branches' },
  });
  await writeJson(path.join(folder, '.mcp.json'), {
    mcpServers: {
      branchscope: { command: process.execPath, args: [path.join(folder, 'src', 'mcp-panel.mjs')] },
    },
  });
  await writeJson(path.join(root, '.agents', 'plugins', 'marketplace.json'), {
    name: marketplace,
    interface: { displayName: 'BranchScope Local' },
    plugins: [{
      name: plugin,
      source: { source: 'local', path: './plugins/branchscope' },
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
      category: 'Productivity',
    }],
  });

  codex('plugin', 'marketplace', 'add', root);
  codex('plugin', 'add', `${plugin}@${marketplace}`);
  codex('features', 'enable', 'enable_mcp_apps');
} catch (error) {
  console.error('BranchScope installation failed:', error.message);
  process.exitCode = 1;
}
