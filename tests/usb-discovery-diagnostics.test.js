'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const usb = require('../recorder/files/usb');

test('discovery reports a disappeared partition and finds the remapped source', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bv-usb-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const mount = fs.mkdirSync(path.join(root, 'volume'), {recursive: true});
  const reports = [];
  let device = '/dev/sdb1';
  const options = {
    mediaRoot: root, remount: false,
    readMounts: () => device + ' ' + mount + ' exfat rw 0 0',
    deviceIdentity: name => {
      if (name === '/dev/sdb1') throw Object.assign(Error('private detail'), {code: 'ENOENT'});
      return name;
    },
    linkSpeed: () => null, space: async () => ({free: 100}),
    report: row => reports.push(row)
  };
  assert.deepEqual(await usb.discover(options), []);
  assert.deepEqual(reports[0], {
    device: '/dev/sdb1', filesystem: 'exfat', writable: true,
    stage: 'verify', outcome: 'failed', code: 'ENOENT'
  });
  device = '/dev/sdc1';
  assert.equal((await usb.discover(options))[0].device, device);
  assert.equal(reports[1].outcome, 'ready');
});
