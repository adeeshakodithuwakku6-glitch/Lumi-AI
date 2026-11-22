import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getFirstStreamChunkWithRetry,
  getGeminiErrorInfo,
  getGeminiUserMessage
} from '../gemini-errors.js';

test('recognizes Gemini high-demand errors wrapped as JSON text', () => {
  const error = {
    message: JSON.stringify({
      error: {
        message: JSON.stringify({
          error: {
            code: 503,
            message: 'This model is currently experiencing high demand.',
            status: 'UNAVAILABLE'
          }
        })
      }
    })
  };

  const info = getGeminiErrorInfo(error);
  assert.equal(info.status, 503);
  assert.equal(info.kind, 'unavailable');
  assert.equal(info.code, 'UNAVAILABLE');
  assert.equal(info.retryable, true);
  assert.match(getGeminiUserMessage(info.kind, 'gemini-3.8-flash'), /high demand/i);
});

test('classifies fetch failures as retryable network errors', () => {
  const info = getGeminiErrorInfo(new TypeError('fetch failed'));
  assert.equal(info.kind, 'network');
  assert.equal(info.code, 'NETWORK_ERROR');
  assert.equal(info.retryable, true);
});

test('retries one high-demand failure before returning the stream', async () => {
  let calls = 0;
  const ai = {
    models: {
      generateContentStream: async () => {
        calls += 1;
        if (calls === 1) throw { status: 503, message: 'high demand' };
        return (async function* () { yield { text: 'ready' }; }());
      }
    }
  };

  const { iterator, firstChunk } = await getFirstStreamChunkWithRetry(ai, {});
  assert.equal(firstChunk.value.text, 'ready');
  assert.equal((await iterator.next()).done, true);
  assert.equal(calls, 2);
});

test('does not retry a non-transient access error', async () => {
  let calls = 0;
  const ai = {
    models: {
      generateContentStream: async () => {
        calls += 1;
        throw { status: 403, message: 'permission denied' };
      }
    }
  };

  await assert.rejects(getFirstStreamChunkWithRetry(ai, {}));
  assert.equal(calls, 1);
});

test('does not retry rate-limit or access errors', () => {
  assert.equal(getGeminiErrorInfo({ status: 429, message: 'quota exceeded' }).kind, 'rate_limit');
  assert.equal(getGeminiErrorInfo({ status: 429, message: 'quota exceeded' }).retryable, false);
  assert.equal(getGeminiErrorInfo({ status: 403, message: 'permission denied' }).kind, 'access');
});

test('keeps unavailable model errors distinct from service outages', () => {
  const info = getGeminiErrorInfo({ status: 404, message: 'Model not found' });
  assert.equal(info.kind, 'model');
  assert.equal(info.retryable, false);
});
