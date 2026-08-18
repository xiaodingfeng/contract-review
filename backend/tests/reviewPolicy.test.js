const test = require('node:test');
const assert = require('node:assert/strict');

const { isEnabled, isKnowledgeBaseOnlyMode } = require('../services/reviewPolicy');

test('boolean policy parser accepts explicit enabled values', () => {
    assert.equal(isEnabled('true'), true);
    assert.equal(isEnabled('1'), true);
    assert.equal(isEnabled('yes'), true);
    assert.equal(isEnabled('false'), false);
    assert.equal(isEnabled(undefined, true), true);
});

test('knowledge-base-only mode follows REVIEW_KB_ONLY_MODE', () => {
    const previous = process.env.REVIEW_KB_ONLY_MODE;
    process.env.REVIEW_KB_ONLY_MODE = 'true';
    assert.equal(isKnowledgeBaseOnlyMode(), true);
    process.env.REVIEW_KB_ONLY_MODE = 'false';
    assert.equal(isKnowledgeBaseOnlyMode(), false);
    if (previous === undefined) delete process.env.REVIEW_KB_ONLY_MODE;
    else process.env.REVIEW_KB_ONLY_MODE = previous;
});
