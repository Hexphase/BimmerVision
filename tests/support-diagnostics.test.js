'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {SupportDiagnostics} = require('../recorder/files/support-diagnostics');

test('pre-mount failures survive in the journal and replay once with their original time', () => {
  const journal = [], usb = [];
  const trace = new SupportDiagnostics({
    nowMs: () => 123,
    journal: row => journal.push(row),
    export: (event, data) => { usb.push({event, data}); return false; }
  });
  trace.change('usb-discovery', {outcome: 'missing'});
  trace.change('usb-discovery', {outcome: 'missing'});
  assert.equal(journal.length, 1);
  trace.export = (event, data) => { usb.push({event, data}); return true; };
  trace.flush();
  trace.flush();
  assert.deepEqual(usb.at(-1), {
    event: 'usb-discovery', data: {outcome: 'missing', observedAt: 123, monotonicMs: 123}
  });
  assert.equal(usb.length, 2);
});
