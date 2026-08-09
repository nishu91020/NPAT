import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Counts oscillators, because that is what actually makes a noise.
 *
 * Asserting on a mute flag would pass whether or not the flag reached the sound
 * functions — which is exactly the bug: the flag existed, and the sounds played
 * anyway.
 */
let created = 0;

class FakeAudioContext {
  state = 'running';
  currentTime = 0;
  destination = {};
  resume() {
    return Promise.resolve();
  }
  createOscillator() {
    created++;
    return {
      type: '',
      frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
      connect() {},
      start() {},
      stop() {},
    };
  }
  createGain() {
    return {
      gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} },
      connect() {},
    };
  }
}

async function loadAudio() {
  vi.resetModules();
  created = 0;
  (globalThis as any).window = { AudioContext: FakeAudioContext };
  return import('./audio');
}

afterEach(() => {
  delete (globalThis as any).window;
});

describe('muting', () => {
  it('plays a click when not muted', async () => {
    const audio = await loadAudio();

    audio.playClickSound();

    expect(created).toBe(1);
  });

  it('plays no click when muted', async () => {
    const audio = await loadAudio();

    audio.setMuted(true);
    audio.playClickSound();

    expect(created).toBe(0);
  });

  it('silences every sound, not just the ones a component remembered to gate', async () => {
    const audio = await loadAudio();
    audio.setMuted(true);

    audio.playClickSound();
    audio.playTickSound();
    audio.playSuccessSound();
    audio.playFailureSound();

    expect(created).toBe(0);
  });

  it('plays again once unmuted', async () => {
    const audio = await loadAudio();

    audio.setMuted(true);
    audio.playClickSound();
    audio.setMuted(false);
    audio.playClickSound();

    expect(created).toBe(1);
  });

  it('starts unmuted, so sound works before anything sets it', async () => {
    const audio = await loadAudio();

    audio.playTickSound();

    expect(created).toBeGreaterThan(0);
  });
});
