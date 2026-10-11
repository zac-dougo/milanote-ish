import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SaveQueue } from '../src/save-queue.ts';

test('an empty flush does not prevent later edits being saved', async () => {
  const queue = new SaveQueue();
  await queue.flush();
  let saved = false;
  queue.enqueue('card', async () => { saved = true; });
  await queue.flush();
  assert.equal(saved, true);
  assert.equal(queue.pending, 0);
});

test('an edit arriving during a save is persisted after the old edit', async () => {
  const queue = new SaveQueue();
  const writes: string[] = [];
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  queue.enqueue('card', async () => { await gate; writes.push('old'); });
  const saving = queue.flush();
  queue.enqueue('card', async () => { writes.push('new'); });
  const quitting = queue.flush();
  finish();
  await Promise.all([saving, quitting]);
  assert.deepEqual(writes, ['old', 'new']);
  assert.equal(queue.pending, 0);
});

test('a failed save keeps the latest edit available for retry', async () => {
  const queue = new SaveQueue();
  let fail = true;
  let saved = false;
  queue.enqueue('card', async () => { if (fail) throw new Error('Disk unavailable'); saved = true; });
  await assert.rejects(queue.flush(), /Disk unavailable/);
  assert.equal(queue.pending, 1);
  fail = false;
  await queue.flush();
  assert.equal(saved, true);
  assert.equal(queue.pending, 0);
});

test('typing bursts coalesce without overwriting another card', async () => {
  const queue = new SaveQueue();
  const writes: string[] = [];
  queue.enqueue('a', async () => { writes.push('first draft'); });
  queue.enqueue('a', async () => { writes.push('finished draft'); });
  queue.enqueue('b', async () => { writes.push('other card'); });
  await queue.flush();
  assert.deepEqual(writes, ['finished draft', 'other card']);
});

test('a synchronously thrown error also permits a later retry', async () => {
  const queue = new SaveQueue();
  queue.enqueue('card', () => { throw new Error('Save failed before starting'); });
  await assert.rejects(queue.flush(), /before starting/);
  queue.enqueue('card', async () => {});
  await queue.flush();
  assert.equal(queue.pending, 0);
});
