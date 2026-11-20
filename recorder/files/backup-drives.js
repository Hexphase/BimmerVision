"use strict";
function time(m) {
  var n = Date.parse(m.startedAt);
  return isFinite(n) ? n : null;
}
function gap(a, b) {
  if (a.sessionId === b.sessionId) {
    if (!(b.sequence > a.sequence)) return null;
    var n = (b.startMonotonicUs - a.endMonotonicUs) / 1000000;
    return isFinite(n) && n >= -2 && n <= 300 ? n : null;
  }
  var at = time(a),
    bt = time(b);
  if (at === null || bt === null) return null;
  var value = (bt - at) / 1000 - a.durationSeconds;
  return value >= -2 && value <= 300 ? value : null;
}
function group(manifests) {
  var sessions = new Map(),
    runs = [];
  manifests
    .filter(function (m) {
      return m.complete === true;
    })
    .forEach(function (m) {
      var key = m.sessionId || m.id;
      if (!sessions.has(key)) sessions.set(key, []);
      sessions.get(key).push(m);
    });
  sessions.forEach(function (clips) {
    clips.sort(function (a, b) {
      return (
        (a.startMonotonicUs || 0) - (b.startMonotonicUs || 0) ||
        (a.sequence || 0) - (b.sequence || 0) ||
        a.id.localeCompare(b.id)
      );
    });
    var run = [];
    clips.forEach(function (m) {
      if (run.length && gap(run[run.length - 1], m) === null) {
        runs.push(run);
        run = [];
      }
      run.push(m);
    });
    if (run.length) runs.push(run);
  });
  runs.sort(function (a, b) {
    return (
      (time(a[0]) || 0) - (time(b[0]) || 0) || a[0].id.localeCompare(b[0].id)
    );
  });
  var merged = [];
  runs.forEach(function (run) {
    var last = merged[merged.length - 1];
    if (last && gap(last[last.length - 1], run[0]) !== null)
      Array.prototype.push.apply(last, run);
    else merged.push(run.slice());
  });
  return merged.map(function (clips) {
    return {
      id: clips[0].id,
      startedAt: clips[0].startedAt || null,
      clips: clips,
      bytes: clips.reduce(function (n, m) {
        return n + (Number(m.bytes) || 0);
      }, 0),
    };
  });
}
module.exports = { group: group };
