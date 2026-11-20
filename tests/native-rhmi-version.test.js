"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  cp = require("node:child_process");
test("packaging refuses stale native RHMI version before writing any release artifacts", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bv-rhmi-version-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const file of [
    "scripts/build-release.js",
    "package.json",
    "idrive/src/recording-preference.js",
    "recorder/files/recording-preference.js",
    "recorder/files/version.json",
    "idrive/rhmiData/application.json",
  ]) {
    const target = path.join(dir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(__dirname, "..", file), target);
  }
  const file = path.join(dir, "idrive/rhmiData/application.json"),
    data = JSON.parse(fs.readFileSync(file));
  data.application.version = "0.0.0";
  fs.writeFileSync(file, JSON.stringify(data));
  const r = cp.spawnSync(process.execPath, ["scripts/build-release.js"], {
    cwd: dir,
    encoding: "utf8",
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Native RHMI version differs from release/);
  assert.equal(
    fs.readdirSync(dir).some((n) => n.endsWith(".tgz")),
    false,
  );
});
