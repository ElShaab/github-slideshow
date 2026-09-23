/**
 * What a caught render error tells the person holding the phone.
 *
 * The boundary used to log only under __DEV__, so a TestFlight build — the
 * only kind a tester or a reviewer runs — reduced every failure to "Something
 * went wrong." with nothing behind it. This is the part that decides what is
 * shown instead, and it runs at the worst possible moment, so it has to
 * survive whatever was thrown.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { describeError } from '../src/utils/describeError';

describe('describing what failed', () => {
  test('names the error and its message', () => {
    assert.equal(
      describeError(new TypeError('undefined is not a function')),
      'TypeError: undefined is not a function',
    );
  });

  test('an error with no message still identifies itself', () => {
    assert.equal(describeError(new RangeError()), 'RangeError');
  });

  test('a thrown string is kept, because some libraries throw those', () => {
    assert.equal(describeError('the store never answered'), 'the store never answered');
  });

  test('a long message is truncated rather than filling the screen', () => {
    const detail = describeError(new Error('x'.repeat(500)));
    assert.ok(detail !== null && detail.length <= 200, `got ${detail?.length}`);
    assert.match(detail as string, /…$/);
  });

  test('nothing useful yields nothing, rather than "undefined"', () => {
    for (const thrown of [null, undefined, '', '   ', 42, {}]) {
      assert.equal(describeError(thrown), null, JSON.stringify(thrown));
    }
  });

  test('a hostile thrown value cannot take the error screen down with it', () => {
    // Failing to describe an error is survivable. Throwing while describing it
    // means the boundary itself throws, and the app shows a blank screen.
    const hostile = new Error('x');
    Object.defineProperty(hostile, 'message', {
      get() {
        throw new Error('nope');
      },
    });
    assert.doesNotThrow(() => describeError(hostile));
    assert.equal(describeError(hostile), null);
  });

  test('a subclass reports its own name, which is what narrows the search', () => {
    class StoreUnavailable extends Error {
      name = 'StoreUnavailable';
    }
    assert.equal(
      describeError(new StoreUnavailable('no products')),
      'StoreUnavailable: no products',
    );
  });
});
