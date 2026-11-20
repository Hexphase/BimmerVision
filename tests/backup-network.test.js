"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { NetworkGate } = require("../recorder/files/backup-network");
test("backup requires a station connection and rejects other Wi-Fi services", async () => {
  let raw = {
    wireless: true,
    interface: "wlan0",
    address: "192.168.1.4",
    ssid: "Home",
    connected: true,
  };
  const gate = new NetworkGate({ probe: async () => raw, serviceId: "Home" });
  assert.equal((await gate.snapshot()).eligible, true);
  raw = { ...raw, ssid: "Phone" };
  assert.equal((await gate.snapshot()).eligible, false);
  raw = { ...raw, ssid: "Home", wireless: false };
  assert.equal((await gate.snapshot()).eligible, false);
  raw = { ...raw, wireless: true, interface: "wlan_bridge" };
  assert.equal((await gate.snapshot()).eligible, false);
  raw = { ...raw, interface: "wlan0", address: "169.254.1.2" };
  assert.equal((await gate.snapshot()).eligible, false);
});
test("network observer invalidates an in-flight connection when Wi-Fi drops", async () => {
  let raw = {
    wireless: true,
    interface: "wlan0",
    address: "192.168.1.4",
    ssid: "Home",
    connected: true,
  };
  const gate = new NetworkGate({ probe: async () => raw });
  await gate.snapshot();
  let invalidated = 0;
  const stop = gate.subscribe(() => invalidated++);
  raw = { ...raw, connected: false };
  await gate.snapshot();
  assert.equal(invalidated, 1);
  stop();
  gate.close();
});
test("BMW D-Bus Wi-Fi probe verifies station mode, live BSS SSID and wlan0 address", async () => {
  const probe = require("../recorder/files/backup-network").probeDbus,
    calls = [];
  const answers = [
    'o "/fi/w1/wpa_supplicant1/Interfaces/1"',
    's "completed"',
    'o "/fi/w1/wpa_supplicant1/Interfaces/1/BSSs/2"',
    's "infrastructure"',
    "ay 4 72 111 109 101",
  ];
  const raw = await probe({
    run: async (file, args) => {
      calls.push([file, args]);
      return { stdout: answers.shift() };
    },
    interfaces: () => ({
      wlan0: [{ family: "IPv4", address: "192.168.1.6", internal: false }],
      socnet0: [{ family: "IPv4", address: "169.254.10.20" }],
    }),
  });
  assert.equal(raw.connected, true);
  assert.equal(raw.ssid, "Home");
  assert.equal(raw.interface, "wlan0");
  assert.equal(raw.address, "192.168.1.6");
  assert.equal(calls.length, 5);
  assert.ok(
    calls.every((c) => c[0] === "/usr/bin/busctl" && c[1][0] === "--system"),
  );
});
test("D-Bus probe rejects disconnected, non-station and malformed SSID responses", async () => {
  const probe = require("../recorder/files/backup-network").probeDbus;
  for (const mode of ["disconnected", "ap", "bad-bytes"]) {
    const answers = [
      'o "/fi/w1/wpa_supplicant1/Interfaces/1"',
      mode === "disconnected" ? 's "disconnected"' : 's "completed"',
      'o "/fi/w1/wpa_supplicant1/Interfaces/1/BSSs/2"',
      mode === "ap" ? 's "ad-hoc"' : 's "infrastructure"',
      "ay 2 65 999",
    ];
    const gate = new NetworkGate({
      probe: () =>
        probe({
          run: async () => ({ stdout: answers.shift() }),
          interfaces: () => ({
            wlan0: [{ family: "IPv4", address: "192.168.1.6" }],
          }),
        }),
    });
    assert.equal((await gate.snapshot()).eligible, false, mode);
  }
});
