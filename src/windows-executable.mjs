import { statSync } from 'node:fs';
import path from 'node:path';

export function windowsExecutable(name) {
  const filename = name.endsWith('.exe') ? name : name + '.exe';
  for (const entry of (process.env.PATH ?? '').split(path.delimiter)) {
    const directory = entry.trim().replace(/^"(.*)"$/, '$1');
    if (!/^[A-Za-z]:[\\/]/.test(directory) && !/^\\\\[^\\]/.test(directory)) continue;
    const candidate = path.join(directory, filename);
    try {
      if (statSync(candidate, { throwIfNoEntry: false })?.isFile()) return candidate;
    } catch (error) {
      if (!['EACCES', 'EPERM', 'ENOTDIR'].includes(error.code)) throw error;
    }
  }
  return null;
}
