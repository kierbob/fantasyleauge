import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, relative, join, dirname } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const destination = resolve(root, 'github-upload', 'courtside');
const sources = [
  '.github', '.env.example', '.gitignore', '.gitattributes', '.nvmrc',
  'data', 'public', 'scripts', 'server', 'shared', 'src', 'tests',
  'index.html', 'package.json', 'package-lock.json', 'README.md',
  'UPLOAD-TO-GITHUB.md', 'tsconfig.json', 'vite.config.ts',
];
const files = [];
function visit(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    if (['node_modules','dist','.runtime','.git','artifacts','github-upload','coverage'].includes(entry.name)) continue;
    if (entry.name !== '.env.example' && (/^\.env(?:\.|$)/.test(entry.name) || /\.(?:pem|key|log|sqlite(?:-wal|-shm)?)$/i.test(entry.name))) continue;
    if (entry.isSymbolicLink()) throw Error(`Unexpected symbolic link: ${relative(root, full)}`);
    if (entry.isDirectory()) visit(full);
    else files.push(relative(root, full).replaceAll('\\', '/'));
  }
}
for (const source of sources) {
  const full = resolve(root, source);
  if (!existsSync(full)) throw Error(`Missing required source: ${source}`);
  if (readdirSync(root, { withFileTypes:true }).find(e => e.name === source)?.isDirectory()) visit(full);
  else files.push(source);
}
// Reject extra files from a previous manually modified upload folder instead of
// accidentally bundling a local save or credential added there later.
if (existsSync(destination)) {
  const check = path => {
    for (const entry of readdirSync(path, { withFileTypes:true })) {
      const full=join(path,entry.name);
      if(entry.isSymbolicLink()) throw Error('Unexpected link in upload folder');
      if(entry.isDirectory())check(full);
      else if(!files.includes(relative(destination,full).replaceAll('\\','/')))throw Error(`Unexpected file in upload folder: ${relative(destination,full)}`);
    }
  };
  check(destination);
}
mkdirSync(destination, { recursive:true });
for (const file of files) {
  mkdirSync(dirname(resolve(destination,file)),{recursive:true});
  cpSync(resolve(root,file),resolve(destination,file));
}
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
for (const file of files) if(digest(resolve(root,file))!==digest(resolve(destination,file))) throw Error(`Copy verification failed: ${file}`);
const manifest = { folder:'courtside', files:files.sort(), fileCount:files.length, datasetSha256:digest(resolve(destination,'data/nbastats.json')), excluded:['node_modules','dist','.runtime','.git','artifacts','local environment files and credentials'] };
writeFileSync(resolve(root,'github-upload','contents.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(`GitHub upload folder ready: ${destination}\n${files.length} files copied and verified. Local saves, dependencies, screenshots and secrets are excluded.`);
