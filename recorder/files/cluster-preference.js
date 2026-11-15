"use strict";
var fs = require('fs'), path = require('path'), crypto = require('crypto');
function location(owner) { return '/var/opt/bimmervision-recorder/preferences/' + owner; }
function defaults() { return { enabled: false, navigation: 'blinkers', blinkersOnly: false }; }
function directory(dir, owner) {
  var st = fs.lstatSync(dir);
  if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== owner || (st.mode & 511) !== 448)
    throw Error('Unsafe cluster preference directory');
}
function validate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid cluster preference');
  Object.keys(value).forEach(function (key) {
    if ((key === 'enabled' || key === 'blinkersOnly') ? typeof value[key] !== 'boolean' : key === 'navigation' ? ['always', 'blinkers', 'off'].indexOf(value[key]) < 0 : true)
      throw Error('Invalid cluster preference');
  });
}
function read(dir, owner) {
  try { directory(dir, owner); } catch (e) { if (e.code === 'ENOENT') return defaults(); throw e; }
  var fd = null;
  try {
    fd = fs.openSync(path.join(dir, 'cluster-preference.json'), fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    var st = fs.fstatSync(fd);
    if (!st.isFile() || st.uid !== owner || (st.mode & 511) !== 384 || st.size > 1024) throw Error('Unsafe cluster preference file');
    var value = JSON.parse(fs.readFileSync(fd, 'utf8'));
    validate(value);
    return { enabled: value.enabled === undefined ? false : value.enabled, navigation: value.navigation === undefined ? 'blinkers' : value.navigation, blinkersOnly: value.blinkersOnly === true };
  } catch (e) {
    if (e.code === 'ENOENT') return defaults();
    throw Error('Cluster preference unavailable: ' + e.message);
  } finally { if (fd !== null) fs.closeSync(fd); }
}
function write(dir, owner, patch) {
  validate(patch);
  directory(dir, owner);
  var value = read(dir, owner);
  Object.keys(patch).forEach(function (key) { value[key] = patch[key]; });
  var file = path.join(dir, 'cluster-preference.json'), tmp = file + '.tmp-' + crypto.randomBytes(8).toString('hex'), fd = null;
  try {
    fd = fs.openSync(tmp, 'wx', 384);
    fs.writeFileSync(fd, JSON.stringify(value) + '\n');
    if (process.getuid() !== owner) fs.fchownSync(fd, owner, owner);
    fs.fsyncSync(fd); fs.closeSync(fd); fd = null;
    directory(dir, owner);
    fs.renameSync(tmp, file);
    fd = fs.openSync(dir, 'r');
    try { fs.fsyncSync(fd); } catch (e) { if (e.code !== 'EINVAL' && e.code !== 'ENOTSUP') throw e; }
  } finally {
    if (fd !== null) fs.closeSync(fd);
    try { fs.unlinkSync(tmp); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return value;
}
module.exports = { location: location, read: read, write: write };
