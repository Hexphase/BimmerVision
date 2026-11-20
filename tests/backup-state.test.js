"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { State } = require("../recorder/files/backup-state");
test("durable backup state survives interrupted temp writes and rejects unsafe secrets", async (t) => {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "bv-state-")),
  );
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const s = new State(dir);
  await s.save({ version: 1, account: { refreshToken: "secret" }, queue: [] });
  fs.writeFileSync(path.join(dir, "state.new"), "broken");
  assert.equal((await new State(dir).load()).account.refreshToken, "secret");
  assert.equal(fs.statSync(path.join(dir, "state.json")).mode & 511, 384);
  fs.chmodSync(path.join(dir, "state.json"), 0o644);
  await assert.rejects(s.load(), /Unsafe/);
});
test("corrupt current state uses the last durable generation rather than pretending backup complete", async (t) => {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "bv-state-")),
  );
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const s = new State(dir);
  await s.save({ version: 1, queue: [{ id: "pending" }] });
  await s.save({ version: 1, queue: [] });
  fs.writeFileSync(path.join(dir, "state.json"), "{");
  assert.equal((await s.load()).queue[0].id, "pending");
  await s.save({ version: 1, queue: [{ id: "recovered-and-saved" }] });
  assert.equal((await s.load()).queue[0].id, "recovered-and-saved");
});
test("disconnect and account replacement do not retain the old refresh token in recovery state", async (t) => {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "bv-state-")),
  );
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const s = new State(dir);
  await s.save({
    version: 1,
    account: { generation: "old", refreshToken: "old-secret" },
    queue: [],
  });
  await s.save({ version: 1, account: null, queue: [] });
  assert.ok(
    !fs
      .readFileSync(path.join(dir, "state.bak"), "utf8")
      .includes("old-secret"),
  );
});
test("disconnect sanitizes recovered credentials when the primary state is missing", async (t) => {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "bv-state-")),
  );
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const s = new State(dir),
    value = {
      version: 1,
      account: { generation: "old", refreshToken: "old-secret" },
      queue: [],
    };
  await s.save(value);
  await s.save(value);
  fs.unlinkSync(path.join(dir, "state.json"));
  assert.equal((await s.load()).account.generation, "old");
  await s.save({ version: 1, account: null, queue: [] });
  assert.ok(
    !fs
      .readFileSync(path.join(dir, "state.bak"), "utf8")
      .includes("old-secret"),
  );
});
