import test from 'node:test';
import assert from 'node:assert/strict';
import mod from '../electron/planning-ipc.cjs';

const { registerPlanningIpcHandlers } = mod;

test('planning IPC registers narrow finance permissions and OCR adapter', async () => {
  const handlers = new Map();
  const calls = [];
  const ipcMain = { handle: (name, fn) => handlers.set(name, fn) };
  const auth = { require: (token, permission) => { calls.push([token, permission]); return {id:'u1',role:'FINANCE'}; } };
  const planning = new Proxy({}, { get: (_target, key) => (...args) => ({ key:String(key), args }) });
  const attachmentOcr = { extract: async (id, actor) => ({id,actor}) };
  registerPlanningIpcHandlers({ ipcMain, auth, planning, attachmentOcr });
  assert.ok(handlers.has('planning:projection'));
  assert.ok(handlers.has('planning:attachments:ocr'));
  await handlers.get('planning:projection')({}, 'token', {months:6});
  assert.deepEqual(calls.at(-1), ['token','finance.view']);
  const result = await handlers.get('planning:attachments:ocr')({}, 'token', 'a1');
  assert.equal(result.id, 'a1');
  assert.deepEqual(calls.at(-1), ['token','finance.manage']);
});
