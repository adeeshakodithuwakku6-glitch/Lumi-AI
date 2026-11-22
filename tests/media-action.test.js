import test from 'node:test';
import assert from 'node:assert/strict';
import { getMediaAction } from '../media-action.js';

test('extracts an English song title for a media action', () => {
  assert.deepEqual(getMediaAction('Play Shape of You'), {
    type: 'PLAY_MEDIA',
    query: 'Shape of You'
  });
});

test('uses a Sinhala music search for a generic Sinhala request', () => {
  assert.deepEqual(getMediaAction('සින්දුවක් play කරන්න'), {
    type: 'PLAY_MEDIA',
    query: 'සිංහල ගීත'
  });
});

test('recognizes clear Singlish media requests', () => {
  assert.deepEqual(getMediaAction('sindu ekak play karanna'), {
    type: 'PLAY_MEDIA',
    query: 'songs'
  });
});

test('does not turn unrelated requests into media actions', () => {
  assert.equal(getMediaAction('How do I play audio in JavaScript?'), null);
});

test('supports opening the general media search', () => {
  assert.deepEqual(getMediaAction('Open media'), {
    type: 'PLAY_MEDIA',
    query: 'songs'
  });
});
