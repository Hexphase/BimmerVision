"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { group } = require("../recorder/files/backup-drives");
test("backup groups clips across sessions within five minutes and orders oldest drive first", () => {
  const clip = (id, at, session) => ({
    id,
    sessionId: session,
    sequence: 1,
    startedAt: at,
    durationSeconds: 60,
    bytes: 8,
    complete: true,
    startMonotonicUs: 0,
    endMonotonicUs: 60000000,
  });
  const result = group([
    clip("c", "2026-11-16T13:00:00Z", "c"),
    clip("b", "2026-11-16T12:05:00Z", "b"),
    clip("a", "2026-11-16T12:00:00Z", "a"),
  ]);
  assert.deepEqual(
    result.map((x) => x.clips.map((c) => c.id)),
    [["a", "b"], ["c"]],
  );
  assert.equal(result[0].bytes, 16);
});
test("backup does not merge clips with unknown cross-session clocks or reversed sequences", () => {
  const base = {
    complete: true,
    bytes: 10,
    durationSeconds: 60,
    startMonotonicUs: 0,
    endMonotonicUs: 60000000,
  };
  assert.equal(
    group([
      { ...base, id: "a", sessionId: "a", sequence: 1 },
      { ...base, id: "b", sessionId: "b", sequence: 1 },
    ]).length,
    2,
  );
});
