import { execFileSync } from 'node:child_process';
import { posix } from 'node:path';
import { parseDatabaseSql } from './database-sql.js';

// Inspect the Git index, so ignored local reports cannot hide missing repo files.
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
const files = git('ls-files', '-z').split('\0').filter(Boolean);
const tracked = new Set(files);
const errors = [];
for (const path of files) {
  if (/\.md$/i.test(path) && path !== 'README.md') errors.push(`Secondary documentation: ${path}`);
  if (/^(docs|artifacts|output)\//.test(path) || /\.(docx?|pptx?|pdf|xlsx?|zip|7z|rar|dump|backup|pem|key|ppk)$/i.test(path)) {
    errors.push(`Local report, backup or private key: ${path}`);
  }
  if (/(^|\/)\.env(?:\.|$)/.test(path) && path !== '.env.example') errors.push(`Environment file: ${path}`);
  if (/\.sql$/i.test(path) && path !== 'supabase/database.sql' && !/^supabase\/migrations\//.test(path)) errors.push(`Untracked SQL export belongs outside Git: ${path}`);
  if (/\.(png|jpe?g|webp|gif|svg)$/i.test(path) && !/^(public\/images\/|src\/assets\/campaigns\/|public\/favicon\.svg$)/.test(path)) {
    errors.push(`Image outside runtime asset directories: ${path}`);
  }
}

const sql = git('show', ':supabase/database.sql');
const steps = parseDatabaseSql(sql);
const historical = steps.filter(step => Number(step.name.slice(0, 3)) <= 57);
const migrations = files.filter(path => /^supabase\/migrations\/.*\.sql$/.test(path));
if (historical.length !== 57 || migrations.length !== 57) errors.push('Keep all 57 original SQL migrations.');
const normalize = value => value.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trimEnd() + '\n';
for (const step of historical) {
  const path = `supabase/migrations/${step.name}.sql`;
  if (!tracked.has(path)) errors.push(`Missing original migration: ${path}`);
  else if (normalize(git('show', `:${path}`)) !== normalize(step.sql)) errors.push(`SQL archive differs from consolidated step: ${path}`);
}

const readme = git('show', ':README.md');
const anchors = new Set([...readme.matchAll(/<a id="([^"]+)"><\/a>/g)].map(match => match[1]));
for (const [, target] of readme.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) {
  if (/^[a-z][a-z\d+.-]*:/i.test(target)) continue;
  const [path, fragment] = target.split('#');
  const normalized = posix.normalize(decodeURIComponent(path || 'README.md'));
  if (!tracked.has(normalized) && !files.some(file => file.startsWith(normalized.replace(/\/$/, '') + '/'))) {
    errors.push(`README link not in repository: ${target}`);
  }
  if (normalized === 'README.md' && fragment && !anchors.has(fragment)) errors.push(`README anchor missing: ${fragment}`);
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else console.log(`Repository OK: README links, runtime images, consolidated SQL and 57 preserved migrations (${files.length} tracked files).`);
