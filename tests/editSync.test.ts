import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditSync } from '../src/studio/editSync.ts';

/* A clock the test drives by hand, so "wait for quiet" is exact and instant. */
function fakeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    setTimer(fn: () => void, ms: number) {
      const id = ++seq;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer(id: unknown) {
      timers.delete(id as number);
    },
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at <= now) {
          timers.delete(id);
          t.fn();
        }
      }
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test('a burst of saves renders once, after things go quiet', async () => {
  const clock = fakeClock();
  const renders: string[] = [];
  const sync = createEditSync({
    render: async (p, f) => { renders.push(`${p}/${f}`); },
    reload: async () => {},
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  }, 1000);

  sync.schedule('p', 'a.jpg');
  clock.advance(400);
  sync.schedule('p', 'a.jpg');
  clock.advance(400);
  sync.schedule('p', 'a.jpg');
  assert.equal(renders.length, 0, 'nothing renders while the photographer is still editing');
  assert.equal(sync.statusOf('p', 'a.jpg')?.state, 'waiting');

  clock.advance(1000);
  await sync.whenIdle();
  assert.deepEqual(renders, ['p/a.jpg'], 'exactly one render for the whole burst');
  assert.equal(sync.statusOf('p', 'a.jpg'), undefined, 'up to date once written');
});

test('an edit made DURING a render is rendered again afterwards', async () => {
  const clock = fakeClock();
  let release: () => void = () => {};
  const renders: number[] = [];
  let version = 1;
  const sync = createEditSync({
    render: async () => {
      renders.push(version);
      if (renders.length === 1) await new Promise<void>((r) => { release = r; });
    },
    reload: async () => {},
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  }, 100);

  sync.schedule('p', 'a.jpg');
  clock.advance(100);
  await tick();
  assert.equal(sync.statusOf('p', 'a.jpg')?.state, 'rendering');

  version = 2; // the recipe changes while the old one is rendering
  sync.schedule('p', 'a.jpg');
  clock.advance(100);
  release();
  await sync.whenIdle();
  assert.deepEqual(renders, [1, 2], 'the newer recipe is not lost behind the older render');
});

test('renders run one at a time, and the folder is re-read once when done', async () => {
  const clock = fakeClock();
  let inFlight = 0;
  let maxInFlight = 0;
  const reloads: string[] = [];
  const sync = createEditSync({
    render: async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await tick();
      inFlight -= 1;
    },
    reload: async (p) => { reloads.push(p); },
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  }, 50);

  for (const f of ['a.jpg', 'b.jpg', 'c.jpg']) sync.schedule('p', f);
  clock.advance(50);
  await sync.whenIdle();
  assert.equal(maxInFlight, 1, 'never two renders at once on a single-worker engine');
  assert.deepEqual(reloads, ['p'], 'one re-read per project, not one per photograph');
});

test('a failed render is reported, not swallowed', async () => {
  const clock = fakeClock();
  const reported: string[] = [];
  const sync = createEditSync({
    render: async () => { throw new Error('engine down'); },
    reload: async () => {},
    onError: (p, f, e) => { reported.push(`${f}: ${(e as Error).message}`); },
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  }, 10);

  sync.schedule('p', 'a.jpg');
  clock.advance(10);
  await sync.whenIdle();
  assert.deepEqual(sync.statusOf('p', 'a.jpg'), { state: 'error', error: 'engine down' });
  assert.deepEqual(reported, ['a.jpg: engine down']);
});

test('a frame that failed recovers on the next edit', async () => {
  const clock = fakeClock();
  let fail = true;
  const sync = createEditSync({
    render: async () => { if (fail) throw new Error('x'); },
    reload: async () => {},
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  }, 10);

  sync.schedule('p', 'a.jpg');
  clock.advance(10);
  await sync.whenIdle();
  assert.equal(sync.statusOf('p', 'a.jpg')?.state, 'error');

  fail = false;
  sync.schedule('p', 'a.jpg');
  assert.equal(sync.statusOf('p', 'a.jpg')?.state, 'waiting');
  clock.advance(10);
  await sync.whenIdle();
  assert.equal(sync.statusOf('p', 'a.jpg'), undefined);
});
