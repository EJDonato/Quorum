import assert from "node:assert/strict";
import test from "node:test";
import { canonicalSerialize } from "../../src/domain/canonical.js";
import { canonicalDigest } from "../../src/infrastructure/artifacts/digests.js";

await test("canonical vectors preserve Unicode and arrays and sort object keys recursively", () => {
  for (const [value, expected] of [
    [{ b: 1, a: "é" }, '{"a":"é","b":1}'],
    [[3, { z: null, a: true }, "日本語"], '[3,{"a":true,"z":null},"日本語"]'],
    [-0, "0"],
  ])
    assert.deepEqual(canonicalSerialize(value), { ok: true, value: expected });
  assert.deepEqual(
    canonicalDigest({ b: 1, a: 2 }),
    canonicalDigest({ a: 2, b: 1 }),
  );
  assert.deepEqual(canonicalDigest({}), {
    ok: true,
    value:
      "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
  });
});

await test("non-JSON values, cycles, sparse arrays, accessors, and extended objects fail", () => {
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  let accessed = false;
  const accessor = Object.defineProperty({}, "a", {
    enumerable: true,
    get() {
      accessed = true;
      return 1;
    },
  });
  const arrayAccessor = Object.defineProperty([0], "0", {
    get() {
      accessed = true;
      return 1;
    },
  });
  for (const value of [
    NaN,
    Infinity,
    undefined,
    1n,
    new Date(),
    cycle,
    new Array<unknown>(2),
    { a: undefined },
    accessor,
    arrayAccessor,
    { [Symbol("a")]: 1 },
  ]) {
    assert.equal(canonicalSerialize(value).ok, false);
  }
  assert.equal(accessed, false);
});

await test("array order and Unicode normalization are part of identity", () => {
  assert.notDeepEqual(canonicalDigest([1, 2]), canonicalDigest([2, 1]));
  assert.notDeepEqual(canonicalDigest("é"), canonicalDigest("e\u0301"));
});
