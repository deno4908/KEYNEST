import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const databaseSql = readFileSync(new URL('../supabase/database.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

export function parseDatabaseSql(sql) {
  sql = sql.replace(/\r\n/g, '\n');
  const pattern = /^-- KEYNEST STEP (\d{3}_[a-z0-9_]+) BEGIN\n([\s\S]*?)^-- KEYNEST STEP \1 END(?:\n|$)/gm;
  const steps = [...sql.matchAll(pattern)].map(([, name, source]) => ({ name, sql: source }));
  if (!steps.length || steps.some((step, i) => Number(step.name.slice(0, 3)) !== i + 1)) {
    throw new Error('Database steps must be unique, contiguous and ordered from 001.');
  }
  if (sql.replace(pattern, '').replace(/^--[^\n]*(?:\n|$)/gm, '').trim()) {
    throw new Error('All SQL must belong to a complete KEYNEST STEP block.');
  }
  return steps;
}

export const databaseSteps = parseDatabaseSql(databaseSql);

// Regression tests exercise historical operations from the consolidated source.
// The original migration files remain preserved as a separate historical archive.
export function databaseStep(name) {
  const step = databaseSteps.find(step => step.name === name.replace(/\.sql$/, ''));
  if (!step) throw new Error(`Unknown database step: ${name}`);
  return step.sql;
}

export function databaseSqlAfter(revision) {
  if (!/^\d{3}$/.test(revision)) throw new Error('Use a three-digit applied revision, for example 032.');
  const index = Number(revision);
  if (index > databaseSteps.length) throw new Error(`Unknown applied revision: ${revision}`);
  if (index === 0) return databaseSql;
  const pending = databaseSteps.slice(index);
  return pending.length
    ? pending.map(step => `-- KEYNEST STEP ${step.name}\n${step.sql}`).join('\n')
    : `-- No pending database steps after ${revision}.\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    if (args.length === 2 && args[0] === '--after') process.stdout.write(databaseSqlAfter(args[1]));
    else if (args.length === 1 && args[0] === '--list') console.log(databaseSteps.map(step => step.name).join('\n'));
    else if (!args.length || (args.length === 1 && args[0] === '--help')) {
      console.log('node scripts/database-sql.js --list\nnode scripts/database-sql.js --after 032 > output/database-pending.sql\nOnly prints SQL. Never connects to a database. Use 000 for a fresh installation.');
    } else throw new Error('Unknown arguments. Use --help.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
