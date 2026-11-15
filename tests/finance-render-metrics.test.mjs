import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeRenderInteraction, percentile, compareRenderBaseline } from '../scripts/qa-render-metrics.mjs';

test('P0: percentile uses nearest-rank without mutating samples', () => {
  const samples=[31,10,20,40,15];
  assert.equal(percentile(samples,50),20);
  assert.equal(percentile(samples,95),40);
  assert.deepEqual(samples,[31,10,20,40,15]);
  assert.equal(percentile([],95),0);
});

test('P0: per-interaction profiler captures React durations and IPC deltas', () => {
  const before={render:{commits:2,totalMs:10,maxMs:6,events:[{durationMs:4},{durationMs:6}]},ipc:{listEntries:1,summary:1,listAccounts:1}};
  const after={render:{commits:5,totalMs:46,maxMs:18,events:[{durationMs:4},{durationMs:6},{durationMs:8},{durationMs:18},{durationMs:10}]},ipc:{listEntries:2,summary:2,listAccounts:1}};
  const report=summarizeRenderInteraction('salvar-lancamento',before,after,85);
  assert.equal(report.interaction,'salvar-lancamento');
  assert.equal(report.commits,3);
  assert.equal(report.totalReactMs,36);
  assert.equal(report.p50CommitMs,10);
  assert.equal(report.p95CommitMs,18);
  assert.equal(report.maxCommitMs,18);
  assert.equal(report.elapsedMs,85);
  assert.deepEqual(report.ipc,{listEntries:1,summary:1});
});

test('P0: zero updates and unmounted components never produce negative counters', () => {
  const result=summarizeRenderInteraction('navegar-para-outra-tela',
    {render:{commits:12,totalMs:100,events:[{durationMs:12}]},ipc:{listEntries:4}},
    {render:{commits:0,totalMs:0,events:[]},ipc:{listEntries:0}},3);
  assert.equal(result.commits,0);
  assert.equal(result.totalReactMs,0);
  assert.deepEqual(result.ipc,{});
});

test('P0: baseline comparison reports changes rather than inventing budgets', () => {
  const baseline={commits:10,totalReactMs:100};
  assert.deepEqual(compareRenderBaseline({commits:8,totalReactMs:80},baseline),{commitsDelta:-2,totalReactMsDelta:-20});
});
