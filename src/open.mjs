import path from 'node:path';
import { serveGraph } from './server.mjs';

const directory = path.resolve(process.argv[2] ?? process.cwd());
try {
  const { url, server } = await serveGraph(directory);
  console.log('Open BranchScope in the Codex browser:');
  console.log(url);
  console.log('Press Ctrl+C to close this session.');
  server.once('close', () => console.log('BranchScope session closed.'));
} catch (error) {
  console.error('BranchScope could not start:', error.message);
  process.exitCode = 1;
}
