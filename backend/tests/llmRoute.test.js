const assert = require('node:assert/strict');
const test = require('node:test');

const {
  extractRoutedModel,
  formatLlmLabel,
} = require('../dist/services/resumeAgent/llmRoute');

test('formatLlmLabel shows alias → routed model when they differ', () => {
  assert.equal(
    formatLlmLabel({
      gateway: 'OmniRoute',
      requested: 'ResumeMaker',
      routed: 'agy/claude-sonnet-4-6',
    }),
    'OmniRoute (ResumeMaker → agy/claude-sonnet-4-6)'
  );
  assert.equal(
    formatLlmLabel({ gateway: 'Ollama', requested: 'qwen3.5:latest' }),
    'Ollama (qwen3.5:latest)'
  );
});

test('extractRoutedModel prefers upstream/choice model over the combo alias', () => {
  assert.equal(extractRoutedModel({ model: 'agy/claude-sonnet-4-6' }), 'agy/claude-sonnet-4-6');
  assert.equal(
    extractRoutedModel({
      model: 'ResumeMaker',
      metadata: { upstream_model: 'agy/claude-sonnet-4-6' },
    }),
    'agy/claude-sonnet-4-6'
  );
  assert.equal(
    extractRoutedModel({
      model: 'ResumeMaker',
      metadata: { model: 'antigravity/claude-sonnet-4-6' },
    }),
    'antigravity/claude-sonnet-4-6'
  );
  assert.equal(
    extractRoutedModel({
      model: 'ResumeMaker',
      choices: [{ model: 'agy/claude-opus-4-6-thinking', delta: { content: 'x' } }],
    }),
    'agy/claude-opus-4-6-thinking'
  );
});
