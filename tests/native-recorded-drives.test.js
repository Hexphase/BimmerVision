"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { EventEmitter } = require("node:events");
const description = require("../idrive/rhmiData/uiDescriptions/ID7/uiDescription.json");
test("native recorded drive menu lists newest first and emits USB-bound whole-drive locks", async () => {
  const RecordedDrivesUI =
      require("../idrive/src/recorded-drives-ui").RecordedDrivesUI,
    events = {},
    values = {},
    enabled = {},
    commands = [],
    opened = [];
  const view = {
    volumeToken: "usb",
    drives: [
      {
        id: "newest",
        membership: "new",
        startedAt: "2026-11-17T12:00:00Z",
        totalClips: 4,
        locked: false,
        lockedClips: 0,
      },
      {
        id: "older",
        membership: "old",
        startedAt: "2026-11-16T12:00:00Z",
        totalClips: 3,
        locked: true,
        lockedClips: 3,
      },
    ],
    page: 0,
    pageCount: 1,
    total: 2,
    busy: false,
  };
  const owner = {
    visible: true,
    displayTimeZone: "America/Chicago",
    closed: false,
    page: "usb",
    desk: () => ({
      drive: { mount: "/usb" },
      volumeToken: "usb",
      recordedDrives: view,
    }),
    component: (n) => {
      if (!events[n]) {
        const d = Object.values(description.containers)
          .flatMap((c) => [c, ...Object.values(c.components || {})])
          .find((c) => c.name === n);
        assert.ok(d, "Missing SDK resource " + n);
        const e = new EventEmitter();
        e.setValue = async (r, k, v) => (values[n + "." + r] = v);
        e.setEnabled = async (v) => (enabled[n] = v);
        e.setVisible = async () => {};
        e.setRowCount = async () => {};
        e.setRowSelected = async (r, v) => (values[n + ".checked"] = v);
        e.updateResources = async () => {};
        events[n] = e;
      }
      return events[n];
    },
    listen: (e, k, f) => e.on(k, f),
    update: (p) => {
      commands.push(p.driveCommand);
      view.commandId = p.driveCommand.id;
    },
    rhmi: { openState: async (n) => opened.push(n) },
    render: async () => {},
  };
  const ui = new RecordedDrivesUI(owner);
  ui.initialize();
  await ui.open();
  assert.equal(opened[0], "RECORDED_DRIVES");
  assert.equal(commands[0].action, "list");
  assert.match(values["DRIVES_LIST.0"], /Nov 17|11\/17/);
  assert.match(values["DRIVES_LIST.0"], /6:00 AM/);
  assert.equal(values["DRIVES_LOCK.checked"], false);
  await ui.lock(true);
  assert.equal(commands[1].driveId, "newest");
  assert.equal(commands[1].membership, "new");
  assert.equal(commands[1].volumeToken, "usb");
  assert.equal(commands[1].locked, true);
  events.DRIVES_LIST.emit("action", { row: 1 });
  await new Promise((r) => setImmediate(r));
  assert.equal(values["DRIVES_LOCK.checked"], true);
  await ui.lock(false);
  assert.equal(commands[2].driveId, "older");
  ui.active = false;
  events.DRIVES_LOCK.emit("change", { selected: false });
  await new Promise((r) => setImmediate(r));
  assert.equal(commands.length, 3);
  ui.active = true;
  owner.desk = () => ({
    volumeToken: "replacement",
    drive: { mount: "/usb" },
    recordedDrives: view,
  });
  await ui.render();
  assert.equal(enabled.DRIVES_LOCK, false);
  assert.equal(commands[commands.length - 1].action, "list");
  assert.equal(commands[commands.length - 1].volumeToken, "replacement");
  const count = commands.length;
  view.commandId = "service-restarted";
  ui.pendingSince = Date.now() - 15000;
  await ui.render();
  assert.equal(commands.length, count + 1);
  assert.equal(commands[commands.length - 1].action, "list");
});
test("recorded drive browsing stays stable while idle and refreshes when recordings change", async () => {
  const { RecordedDrivesUI } = require("../idrive/src/recorded-drives-ui");
  const desk = {drive:{mount:"/usb"},volumeToken:"usb",recordingCount:5,lockedRecordingCount:0,
    recordedDrives:{volumeToken:"usb",drives:[],page:0,pageCount:1,total:0,busy:false}};
  const commands=[], labels={};
  const owner={visible:true,closed:false,desk:()=>desk,component:name=>({
    setValue:async(row,key,value)=>{labels[name]=value;},setRowCount:async()=>{},
    setEnabled:async()=>{},setVisible:async()=>{},updateResources:async()=>{}}),
    rhmi:{openState:async()=>{}},update:patch=>{commands.push(patch.driveCommand);desk.recordedDrives.commandId=patch.driveCommand.id;}};
  const ui=new RecordedDrivesUI(owner), realNow=Date.now;let now=realNow();
  Date.now=()=>now;
  try {
    await ui.open();
    for(let n=0;n<30;n++){now+=1000;await ui.render();}
    assert.equal(commands.length,1,"idle browsing must not repeatedly rescan USB");
    assert.doesNotMatch(labels.DRIVES_STATUS,/Updating/);
    desk.recordingCount++;
    await ui.render();assert.equal(commands.length,2);
    await ui.render();assert.equal(commands.length,2);
    desk.lockedRecordingCount++;
    await ui.render();assert.equal(commands.length,3);
  } finally {Date.now=realNow;}
});
