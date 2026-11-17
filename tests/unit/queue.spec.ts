import { expect, test } from '@playwright/test';
import { config } from '../../src/lib/config';
import { enqueue, registerWorker } from '../../src/lib/queue';

test('disabled queue uses the registered inline handler', async () => {
  test.skip(config.queue, 'The inline fallback is used only when queueing is disabled.');

  const name = `inline-test-${Date.now()}`;
  const payload = { value: 'preserved' };
  let handled: typeof payload | undefined;
  registerWorker(name, async (jobPayload) => {
    handled = jobPayload;
  });

  await enqueue(name, payload);

  expect(handled).toEqual(payload);
});
