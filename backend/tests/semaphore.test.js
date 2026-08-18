const test = require('node:test');
const assert = require('node:assert/strict');

const { createSemaphore } = require('../utils/semaphore');

test('shared semaphore limits concurrency and releases slots after failures', async () => {
    const semaphore = createSemaphore(3);
    let active = 0;
    let maxActive = 0;

    const jobs = Array.from({ length: 12 }, (_, index) => semaphore.run(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        if (index === 4) throw new Error('expected test failure');
        return index;
    }));

    const results = await Promise.allSettled(jobs);
    assert.equal(maxActive, 3);
    assert.equal(results.filter((item) => item.status === 'rejected').length, 1);
    assert.equal(await semaphore.run(async () => 42), 42);
});
