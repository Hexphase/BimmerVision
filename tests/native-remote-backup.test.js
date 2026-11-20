"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { EventEmitter } = require("node:events");
const { RemoteBackupUI } = require("../idrive/src/remote-backup-ui");
const description = require("../idrive/rhmiData/uiDescriptions/ID7/uiDescription.json");
const definitions = Object.values(description.containers).flatMap((x) =>
  Object.values(x.components || {}),
);
function harness(backup) {
  const values = {},
    enabled = {},
    visible = {},
    events = {},
    commands = [],
    opened = [];
  const rhmi = {
    getByName: (n) => {
      if (!events[n]) {
        const definition =
          definitions.find((x) => x.name === n) ||
          Object.values(description.containers).find((x) => x.name === n);
        assert.ok(definition, "Missing native resource " + n);
        const e = new EventEmitter();
        e.getId = () => n;
        e.setValue = async (row, key, value) => {
          if (typeof row === "string") values[n + "." + row] = key;
          else values[n + "." + key] = value;
        };
        e.setRowCount = async (n) => {};
        e.setProperty = async (k, v) => {
          if (k === "Enabled") enabled[n] = !!v;
          if (k === "Visible") visible[n] = !!v;
        };
        e.setEnabled = async (v) => (enabled[n] = v);
        e.setVisible = async (v) => (visible[n] = v);
        e.setRowSelected = async (row, v) => (values[n + ".selected"] = v);
        e.setProgress = async (v) => (values[n + ".Progress"] = v);
        e.updateResources = async () => {};
        if (definition.type !== "checkBox") delete e.setRowSelected;
        if (definition.type !== "progressBar") delete e.setProgress;
        events[n] = e;
      }
      return events[n];
    },
    openState: async (name) => opened.push(name),
  };
  const owner = {
    component: (n) => rhmi.getByName(n),
    listen: (e, k, fn) => e.on(k, fn),
    desk: () => ({ backup }),
    update: (p) => commands.push(p.backupCommand),
    publishQr: async (url) => {
      values.qr = url;
      return true;
    },
    render: async () => {},
    visible: true,
    rhmi,
    message: "",
  };
  const ui = new RemoteBackupUI(owner);
  ui.initialize();
  return { ui, values, enabled, visible, events, commands, opened };
}
test("unconfigured backup allows setup and Back while settings remain disabled", async () => {
  const b = {
      configured: false,
      wifi: { eligible: false },
      drives: [],
      completed: [],
    },
    h = harness(b);
  await h.ui.open();
  assert.equal(h.visible.BACKUP_SETUP, true);
  assert.equal(h.enabled.BACKUP_AUTO, false);
  assert.equal(h.enabled.BACKUP_PAUSE, false);
  assert.equal(h.enabled.BACKUP_BACK, true);
  await h.ui.change("auto", true);
  assert.equal(h.commands.length, 0);
  await h.ui.setup();
  assert.equal(h.opened[h.opened.length - 1], "REMOTE_BACKUP_SETUP");
  await h.ui.begin();
  assert.equal(h.commands.length, 0);
  assert.match(h.values["BACKUP_ACCOUNT_STATUS.Text"], /Wi-Fi/);
});
test("checkbox dependencies, QR code, progress and completed log use native control values", async () => {
  const b = {
      configured: true,
      account: "Tester",
      autoUpload: false,
      pauseRecording: true,
      wifi: { eligible: true },
      state: "Uploading",
      drives: [
        {
          id: "a",
          startedAt: "2026-11-16T12:00:00Z",
          progress: 0.65,
          verifiedClips: 13,
          totalClips: 20,
          state: "Uploading",
        },
      ],
      completed: [
        {
          id: "old",
          startedAt: "2026-11-15T12:00:00Z",
          completedAt: "2026-11-15T13:00:00Z",
        },
      ],
      setup: {
        verificationUrl: "https://www.google.com/device",
        userCode: "ABC-123",
        expiresAt: Date.now() + 60000,
      },
    },
    h = harness(b);
  await h.ui.open();
  assert.equal(h.enabled.BACKUP_AUTO, true);
  assert.equal(h.enabled.BACKUP_PAUSE, false);
  assert.equal(h.values["BACKUP_PROGRESS_0.Progress"], 0.65);
  await h.ui.change("pause", false);
  assert.equal(h.commands.length, 0);
  await h.ui.change("auto", true);
  assert.equal(h.commands[0].autoUpload, true);
  b.autoUpload = true;
  await h.ui.render();
  assert.equal(h.enabled.BACKUP_PAUSE, true);
  await h.ui.setup();
  assert.match(h.values["BACKUP_ACCOUNT_STATUS.Text"], /ABC-123/);
  assert.equal(h.values.qr, "https://www.google.com/device");
  assert.match(h.values["BACKUP_HISTORY.ItemText"], /Nov|11\/15/);
});
test("hidden or disabled Google account actions cannot begin, cancel or disconnect sign-in", async () => {
  const b = {
      configured: true,
      wifi: { eligible: true },
      drives: [],
      completed: [],
      setup: {
        verificationUrl: "https://www.google.com/device",
        userCode: "ABC",
      },
    },
    h = harness(b);
  await h.ui.open();
  await h.ui.begin();
  assert.equal(h.commands.length, 0);
  await h.ui.setup();
  await h.ui.begin();
  assert.equal(h.commands.length, 0);
  h.ui.active = false;
  h.events.BACKUP_DISCONNECT.emit("action");
  await new Promise((r) => setImmediate(r));
  assert.equal(h.commands.length, 0);
});
test("locked-drive backup filter can be configured before automatic uploads begin", async () => {
  const b = {
      configured: false,
      autoUpload: false,
      wifi: { eligible: true },
      drives: [],
      completed: [],
    },
    h = harness(b);
  await h.ui.open();
  assert.equal(h.enabled.BACKUP_LOCKED, false);
  await h.ui.change("locked", true);
  assert.equal(h.commands.length, 0);
  b.configured = true;
  await h.ui.render();
  assert.equal(h.enabled.BACKUP_LOCKED, true);
  await h.ui.change("locked", true);
  assert.equal(h.commands[0].onlyLockedDrives, true);
  b.autoUpload = true;
  await h.ui.render();
  assert.equal(h.enabled.BACKUP_LOCKED, true);
  await h.ui.change("locked", true);
  assert.equal(h.commands[0].onlyLockedDrives, true);
});
test('failed backup navigation restores the main screen so recording status keeps repainting',async()=>{
 const h=harness({configured:false,wifi:{eligible:true},drives:[],completed:[]});let painted=0;h.ui.owner.page='home';h.ui.owner.render=async()=>{painted++;};h.ui.owner.rhmi.openState=async name=>{if(name==='REMOTE_BACKUP')throw Error('INVALID_COMPONENTID');h.opened.push(name);};
 await assert.rejects(h.ui.open(),/INVALID_COMPONENTID/);assert.equal(h.ui.active,false);assert.equal(h.ui.owner.visible,true);assert.equal(h.ui.owner.page,'home');assert.equal(h.opened.at(-1),'HOME');assert.equal(painted,1);
});
test('reopening a backup state repaints values after SDK resource initialization resets them',async()=>{
 const h=harness({configured:false,wifi:{eligible:true},drives:[],completed:[]});await h.ui.open();h.ui.owner.component('REMOTE_BACKUP').updateResources=async()=>{h.values['BACKUP_AUTO.Text']='native default';};await h.ui.open();assert.equal(h.values['BACKUP_AUTO.Text'],'Auto Upload on Wi-Fi');
});
test("Google setup clears the requesting message when a code arrives and shows connection live",async()=>{
 const b={configured:false,wifi:{eligible:true},drives:[],completed:[]},h=harness(b);
 await h.ui.setup();await h.ui.begin();assert.match(h.values["BACKUP_ACCOUNT_STATUS.Text"],/Requesting/);
 b.setup={userCode:"CODE",verificationUrl:"https://www.google.com/device"};await h.ui.render();
 assert.doesNotMatch(h.values["BACKUP_ACCOUNT_STATUS.Text"],/Requesting/);
 b.setup=null;b.configured=true;b.account="driver@example.invalid";await h.ui.render();
 assert.match(h.values["BACKUP_ACCOUNT_STATUS.Text"],/Connected: driver@example.invalid/);
 assert.doesNotMatch(h.values["BACKUP_ACCOUNT_STATUS.Text"],/Requesting|Enter this code/);
 assert.equal(h.visible.BACKUP_QR,false);
});
test("plain upload queue shows percentages beside status with no queue dropdown",async()=>{
 const b={configured:true,wifi:{eligible:true},drives:[{id:"a",startedAt:"2026-11-17T12:00:00Z",progress:.65,verifiedClips:2,totalClips:10,state:"Uploading"}],completed:[]},h=harness(b);await h.ui.open();
 assert.equal(definitions.some(d=>d.name==="BACKUP_DRIVES"),false);assert.match(h.values["BACKUP_DRIVE_0.Text"],/Uploading 65%/);
 assert.match(h.values["BACKUP_SLEEP_NOTICE.Text"],/5–15/);assert.match(h.values["BACKUP_SLEEP_NOTICE.Text"],/timing varies/);assert.match(h.values["BACKUP_SLEEP_NOTICE.Text"],/resume/);
 assert.equal(h.visible.BACKUP_NEXT_DRIVES,false);assert.equal(h.visible.BACKUP_PREVIOUS_DRIVES,false);
});
test("remaining estimates over 60 minutes use hours and zero-padded minutes",async()=>{
 const b={configured:true,wifi:{eligible:true},drives:[],completed:[]},h=harness(b);await h.ui.open();
 for(const [seconds,text] of [[3540,"59 min"],[3600,"60 min"],[3660,"1 hour and 01 minute"],[7500,"2 hours and 05 minutes"]]){b.etaSeconds=seconds;await h.ui.render();assert.ok(h.values["BACKUP_STATUS.Text"].includes("About "+text));}
});
test("plain queue page buttons keep drives beyond the first five accessible",async()=>{
 const b={configured:true,wifi:{eligible:true},drives:Array.from({length:6},(_,i)=>({id:String(i),startedAt:"2026-11-17T12:00:00Z",progress:i/10,verifiedClips:0,totalClips:1,state:"Queued"})),completed:[]},h=harness(b);await h.ui.open();assert.equal(h.visible.BACKUP_NEXT_DRIVES,true);
 await h.ui.pageDrives(1);assert.match(h.values["BACKUP_DRIVE_0.Text"],/Queued 50%/);assert.equal(h.visible.BACKUP_NEXT_DRIVES,false);assert.equal(h.visible.BACKUP_PREVIOUS_DRIVES,true);assert.equal(h.visible.BACKUP_DRIVE_1,false);
 await h.ui.pageDrives(-1);assert.match(h.values["BACKUP_DRIVE_0.Text"],/Queued 0%/);
});

test('stationary-only uploads have an independent native checkbox and command',async()=>{
 const b={configured:true,autoUpload:false,pauseRecording:false,doNotBackupWhileDriving:false,drives:[],completed:[],wifi:{eligible:true}},h=harness(b);
 await h.ui.open();assert.equal(h.enabled.BACKUP_STATIONARY,true);assert.equal(h.values['BACKUP_STATIONARY.selected'],false);
 await h.ui.change('stationary',true);assert.equal(h.commands[0].doNotBackupWhileDriving,true);assert.equal(h.commands[0].pauseRecording,undefined);
 b.doNotBackupWhileDriving=true;await h.ui.render();assert.equal(h.values['BACKUP_STATIONARY.selected'],true);assert.match(h.values['BACKUP_STATIONARY_HINT.Text'],/physically stopped/);assert.doesNotMatch(h.values['BACKUP_STATIONARY_HINT.Text'],/10 mph/);
});

test('each checkbox has its own explanation and recording performance guidance stays under pause',async()=>{
 const h=harness({configured:true,autoUpload:true,pauseRecording:false,doNotBackupWhileDriving:false,drives:[],completed:[],wifi:{eligible:true}});await h.ui.open();
 assert.match(h.values['BACKUP_AUTO_HINT.Text'],/Wi-Fi/);assert.match(h.values['BACKUP_PAUSE_HINT.Text'],/significantly slow/);assert.match(h.values['BACKUP_PAUSE_HINT.Text'],/stationary/);assert.match(h.values['BACKUP_PAUSE_HINT.Text'],/moving/);assert.match(h.values['BACKUP_LOCKED_HINT.Text'],/horn/);assert.match(h.values['BACKUP_STATIONARY_HINT.Text'],/any speed/);assert.equal(h.values['BACKUP_HINT.Text'],undefined);
});
