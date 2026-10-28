import test from 'node:test';
import assert from 'node:assert/strict';
import { AUDIO_STORAGE_KEY, createSpotAudio } from '../public/audio.js';

function createDocumentStub() {
  return { addEventListener() {}, removeEventListener() {} };
}

test('오디오 설정은 음소거 상태와 BGM 장면을 저장하고 복원한다', () => {
  const values = new Map([[AUDIO_STORAGE_KEY, 'true']]);
  const storage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
  };
  const audio = createSpotAudio({ windowRef: {}, documentRef: createDocumentStub(), storage });

  assert.equal(audio.isSupported(), false);
  assert.equal(audio.isMuted(), true);
  assert.equal(audio.getScene(), 'library');
  assert.equal(audio.setScene('play'), 'play');
  assert.equal(audio.play('found'), true);
  assert.equal(audio.play('unknown'), false);
  assert.equal(audio.toggleMuted(), false);
  assert.equal(values.get(AUDIO_STORAGE_KEY), 'false');
});
