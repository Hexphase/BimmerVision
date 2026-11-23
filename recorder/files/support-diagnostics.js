'use strict';
var LIMIT = 24;

function SupportDiagnostics(options) {
  this.now = options.nowMs || Date.now;
  this.monotonic = options.monotonicMs || this.now;
  this.journal = options.journal || function (row) {
    if (!process.stderr.writableNeedDrain) process.stderr.write('BV_SUPPORT ' + JSON.stringify(row) + '\n');
  };
  this.export = options.export;
  this.pending = [];
  this.signatures = {};
  this.pairWindow = -Infinity;
  this.pairCount = 0;
}

SupportDiagnostics.prototype.change = function (event, data) {
  var signature = JSON.stringify(data);
  if (signature === this.signatures[event]) return;
  this.signatures[event] = signature;
  this.record(event, data);
};

SupportDiagnostics.prototype.record = function (event, data) {
  try {
    var elapsed = this.monotonic();
    if (event === 'phone-pair') {
      if (elapsed - this.pairWindow >= 1000) {
        this.pairWindow = elapsed;
        this.pairCount = 0;
      }
      if (this.pairCount++ >= 8) return;
    }
    var row = {
      event: event,
      data: Object.assign({}, data, {observedAt: this.now(), monotonicMs: elapsed})
    };
    try { this.journal(row); } catch (ignore) {}
    if (this.pending.length >= LIMIT) this.pending.shift();
    this.pending.push(row);
    this.flush();
  } catch (ignore) {}
};

SupportDiagnostics.prototype.flush = function () {
  try {
    while (this.pending.length) {
      var row = this.pending[0];
      if (!this.export(row.event, row.data)) return;
      this.pending.shift();
    }
  } catch (ignore) {}
};

module.exports = {SupportDiagnostics: SupportDiagnostics};
