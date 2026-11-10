import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { databaseSql, databaseSteps, databaseStep, databaseSqlAfter, parseDatabaseSql } from '../scripts/database-sql.js';

test('one SQL source contains ordered database steps and produces only unapplied changes', () => {
  assert.equal(databaseSteps[0].name, '001_store');
  assert.ok(databaseSteps.some(step => step.name === '057_seller_name_approval'));
  assert.equal(databaseSqlAfter('000'), databaseSql);
  assert.deepEqual(parseDatabaseSql(databaseSql.replace(/\n/g, '\r\n')), databaseSteps);
  assert.equal(databaseStep('057_seller_name_approval.sql'), databaseStep('057_seller_name_approval'));
  assert.match(databaseSqlAfter('056'), /create table public\.seller_name_requests/);
  assert.doesNotMatch(databaseSqlAfter('056'), /create table public\.profiles/);
  const latest = String(databaseSteps.length).padStart(3, '0');
  assert.equal(databaseSqlAfter(latest), `-- No pending database steps after ${latest}.\n`);
});

test('invalid revisions, damaged sections and unsupported CLI arguments fail without printing SQL', () => {
  for (const revision of ['', '1', '-01', '999', '001;drop table profiles']) assert.throws(() => databaseSqlAfter(revision));
  assert.throws(() => databaseStep('missing'));
  for (const source of [
    databaseSql.replace('STEP 001_store END', 'STEP 001_wrong END'),
    databaseSql.replace('STEP 002_reconciliation BEGIN', 'STEP 001_duplicate BEGIN'),
    databaseSql + '\nDROP TABLE public.profiles;\n',
  ]) assert.throws(() => parseDatabaseSql(source));
  for (const args of [['--after', '999'], ['--after', ''], ['--unknown']]) {
    assert.throws(() => execFileSync(process.execPath, ['scripts/database-sql.js', ...args], { stdio: ['ignore', 'pipe', 'pipe'] }),
      error => error.status === 1 && error.stdout.length === 0);
  }
});
