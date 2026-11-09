import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const [pack] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {encoding: 'utf8'}));
const paths = pack.files.map(file => file.path);
for (const file of ['LICENSE', 'README.md', 'OVERVIEW.md', 'paseo-plugin.json', 'index.client.tsx', 'index.server.ts']) {
  if (!paths.includes(file)) throw new Error(`Missing package file: ${file}`);
}
for (const file of paths) {
  if (/node_modules|\.test\.|smoke\.ts$|(^|\/)(state|usage)\.json$|\.env|\.log$|\.tgz$/.test(file)) throw new Error(`Private or development file included: ${file}`);
  if (/\.(ts|tsx|md|json)$/.test(file) && /\/(?:home|Users)\/(?!example\/|user\/)[^/\s]+/.test(readFileSync(file, 'utf8'))) throw new Error(`Personal content in package: ${file}`);
}
const manifest = JSON.parse(readFileSync('paseo-plugin.json', 'utf8'));
for (const media of manifest.media ?? []) {
  const file = typeof media === 'string' ? media : media.path;
  if (file && !paths.includes(file.replace(/^\.\//, ''))) throw new Error(`Missing media: ${file}`);
}
console.log(`Package content check passed: ${paths.length} files; no local state, tests, or personal project defaults.`);
