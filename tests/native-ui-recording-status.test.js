"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { UI } = require("../idrive/src/native-ui");
function screen(desk, continuous) {
  const labels = {},
    intent = { continuous };
  const ui = new UI({
    recording: {
      read: () => desk,
      intent: () => intent,
      update: (patch) => Object.assign(intent, patch),
    },
    rhmi: {
      openState: async () => {},
      getByName: (name) => ({
        setValue: async (row, column, value) => {
          labels[name] = value;
        },
      }),
    },
    nowMs: () => 0,
  });
  ui.visible = true;
  return { ui, labels, intent };
}
const drive = { name: "USB", used: 1024, free: 2048, total: 3072 };
test("home exposes Remote Backup and keeps remote-full warning separate from recorder status", async () => {
  const s = screen(
    {
      state: "Recording",
      activeId: "clip",
      drive,
      backup: { configured: true, autoUpload: true, storageFull: true },
    },
    true,
  );
  await s.ui.render();
  assert.equal(s.labels.HOME_REMOTE, "Remote Backup");
  assert.match(
    s.labels.HOME_BACKUP_WARNING,
    /REMOTE BACKUP PAUSED -  REMOTE STORAGE FULL/,
  );
  assert.match(s.labels.HOME_STATUS, /Recording/);
});
test("automatic backup pause is displayed as a deliberate pause rather than capture failure", async () => {
  const s = screen(
    {
      state: "Recording paused for remote backup",
      recordingPausedForBackup: true,
      activeId: null,
      drive,
    },
    true,
  );
  await s.ui.render();
  assert.match(s.labels.HOME_STATUS, /Recording paused for remote backup/);
  assert.doesNotMatch(s.labels.HOME_TITLE, /REC/);
});
test("hidden home actions cannot toggle capture while Remote Backup owns the native screen", async () => {
  const s = screen({ state: "Recording", drive }, true);
  s.ui.backupUI.active = true;
  await s.ui.press("HOME_ALL");
  assert.equal(s.intent.continuous, true);
});
test("Pause immediately stops claiming live capture while the old segment finishes", async () => {
  const desk = {
    state: "Recording",
    activeId: "segment",
    writeInProgress: true,
    drive,
    recordingCount: 4,
  };
  const s = screen(desk, true);
  await s.ui.render();
  assert.match(s.labels.HOME_TITLE, /REC/);
  await s.ui.press("HOME_ALL");
  assert.equal(s.intent.continuous, false);
  assert.equal(s.labels.HOME_ALL, "Enable recording");
  assert.match(s.labels.HOME_STATUS, /^Saving last video · 4 recordings\n/);
  assert.doesNotMatch(s.labels.HOME_TITLE, /REC/);
  assert.match(s.labels.HOME_STATUS, /Do not disconnect - Saving last video/);
  desk.state = "Stopped";
  desk.activeId = null;
  desk.writeInProgress = false;
  desk.safeToRemove = true;
  await s.ui.render();
  assert.match(s.labels.HOME_STATUS, /^Stopped · 4 recordings\n/);
  assert.match(s.labels.HOME_STATUS, /Safe to Remove/);
});
test("re-enabling during finalization keeps saving visible until capture actually resumes", async () => {
  const desk = {
    state: "Recording",
    activeId: "segment",
    finalizing: true,
    writeInProgress: true,
    drive,
  };
  const s = screen(desk, true);
  await s.ui.render();
  assert.match(s.labels.HOME_STATUS, /^Saving last video\n/);
  assert.doesNotMatch(s.labels.HOME_TITLE, /REC/);
  desk.finalizing = false;
  desk.state = "Saving last video";
  await s.ui.render();
  assert.match(s.labels.HOME_STATUS, /^Saving last video\n/);
  assert.doesNotMatch(s.labels.HOME_TITLE, /REC/);
  desk.state = "Recording";
  await s.ui.render();
  assert.match(s.labels.HOME_STATUS, /^Recording\n/);
  assert.match(s.labels.HOME_TITLE, /REC/);
});
test("Pause reports an outstanding write without an active segment and keeps USB faults visible", async () => {
  const desk = {
    state: "Stopped",
    activeId: null,
    writeInProgress: true,
    drive,
  };
  const s = screen(desk, false);
  await s.ui.render();
  assert.match(s.labels.HOME_STATUS, /^Saving last video\n/);
  desk.error = "USB write failed";
  await s.ui.render();
  assert.match(s.labels.HOME_STATUS, /^USB write failed\n/);
  assert.doesNotMatch(s.labels.HOME_TITLE, /REC/);
});
test("diagnostic USB writes keep stopped recording status and describe USB activity truthfully", async () => {
  const desk = {
    state: "Stopped",
    activeId: null,
    finalizing: false,
    writeInProgress: true,
    safeToRemove: false,
    drive,
  };
  const s = screen(desk, false);
  await s.ui.render();
  assert.match(s.labels.HOME_STATUS, /^Stopped\n/);
  assert.match(s.labels.HOME_STATUS, /Do not disconnect - Writing to USB/);
  assert.doesNotMatch(s.labels.HOME_STATUS, /Saving last video/);
  s.ui.page = "usb";
  await s.ui.render();
  assert.match(s.labels.USB_STATUS, /Do not disconnect - Writing to USB/);
  assert.doesNotMatch(s.labels.USB_STATUS, /Saving last video/);
  desk.writeInProgress = false;
  desk.safeToRemove = true;
  await s.ui.render();
  assert.match(s.labels.USB_STATUS, /Safe to Remove/);
});
test("periodic paint refreshes Remote Backup progress while its screen is active", async () => {
  const desk = {
      state: "Recording",
      drive,
      backup: {
        configured: true,
        state: "Uploading",
        drives: [],
        completed: [],
        wifi: { eligible: true },
      },
    },
    s = screen(desk, true);
  s.ui.backupUI.active = true;
  await s.ui.paint();
  assert.match(s.labels.BACKUP_STATUS, /Uploading/);
  desk.backup.state = "Up to date";
  await s.ui.paint();
  assert.match(s.labels.BACKUP_STATUS, /Up to date/);
});
test("USB storage opens Recorded Drives without Google setup and ignores hidden home actions", async () => {
  const desk = {
      state: "Recording",
      drive,
      drives: [drive],
      volumeToken: "usb",
      recordedDrives: {
        volumeToken: "usb",
        drives: [],
        page: 0,
        pageCount: 1,
        total: 0,
      },
    },
    s = screen(desk, true);
  let opened;
  s.ui.rhmi.openState = async (name) => (opened = name);
  s.ui.page = "usb";
  await s.ui.render();
  assert.equal(s.labels.USB_REMOTE, "Recorded Drives");
  await s.ui.press("HOME_REMOTE");
  assert.equal(opened, "RECORDED_DRIVES");
  assert.equal(s.intent.driveCommand.action, "list");
  assert.equal(s.intent.driveCommand.volumeToken, "usb");
  await s.ui.press("HOME_ALL");
  assert.equal(s.intent.continuous, true);
});
test("iDrive Back from a native submenu restores home actions and recording paint", async () => {
  const { EventEmitter } = require("node:events");
  for (const section of ["backupUI", "recordedDrivesUI"]) {
    const s = screen({state:"Recording",activeId:"clip",drive,drives:[drive]},true);
    const rhmi = new EventEmitter(), components = new Map();
    rhmi.getByName = name => {
      if (!components.has(name)) {
        const c = new EventEmitter();
        c.getId = () => ({HOME:1,REMOTE_BACKUP:200,REMOTE_BACKUP_SETUP:300,RECORDED_DRIVES:400}[name] || name);
        c.setValue = async (row,key,value) => {s.labels[name]=value;};
        components.set(name,c);
      }
      return components.get(name);
    };
    rhmi.mapEntryState = async () => {};
    rhmi.openState = async () => {};
    s.ui.rhmi = rhmi;
    await s.ui.initialize();
    s.ui[section].active = true;
    rhmi.emit("applicationStackChanged",{ROOT_APP:[1,section==="backupUI"?200:400]});
    assert.equal(s.ui[section].active,true);
    rhmi.emit("applicationStackChanged",{ROOT_APP:[1]});
    assert.equal(s.ui[section].active,false,"physical Back must release submenu ownership");
    await s.ui.press("HOME_REAR");
    assert.equal(s.ui.page,"usb");
    assert.match(s.labels.USB_STATUS,/USB storage/);
    await s.ui.back();
    await s.ui.paint();
    assert.match(s.labels.HOME_TITLE,/REC/);
  }
});
test("Connect Phone and About open native children and physical Back closes pairing", async () => {
  const {EventEmitter}=require("node:events"), s=screen({state:"Recording",activeId:"clip",drive,transfer:{on:true,url:"http://car/",code:"1234"}},true);
  const rhmi=new EventEmitter(),components=new Map(),opened=[];
  const ids={HOME:1,REMOTE_BACKUP:200,REMOTE_BACKUP_SETUP:300,RECORDED_DRIVES:400,CONNECT_PHONE:500,ABOUT:600};
  rhmi.getByName=name=>{
    if(!components.has(name)){
      const c=new EventEmitter();c.getId=()=>ids[name]||name;
      c.setValue=async(row,key,value)=>{s.labels[name]=value;};c.updateResources=async()=>{};
      components.set(name,c);
    }return components.get(name);
  };
  rhmi.mapEntryState=async()=>{};rhmi.openState=async name=>{opened.push(name);rhmi.emit("applicationStackChanged",{ROOT_APP:name==="HOME"?[1]:[1,ids[name]]});};
  s.ui.rhmi=rhmi;await s.ui.initialize();
  assert.equal(s.labels.HOME_RIGHT,"About");
  await s.ui.press("HOME_LEFT");
  assert.equal(opened.pop(),"CONNECT_PHONE");assert.equal(s.ui.page,"connect");
  components.get("HOME").emit("visible",{visible:false});
  assert.equal(s.ui.visible,true);assert.ok(s.ui.visit);assert.match(s.labels.PHONE_STATUS,/Connect Phone/);
  await s.ui.press("HOME_ALL");assert.equal(s.intent.continuous,true,"hidden home actions stay inactive");
  components.get("CONNECT_PHONE").emit("visible",{visible:false});
  rhmi.emit("applicationStackChanged",{ROOT_APP:[1]});
  assert.equal(s.ui.visible,true);
  assert.equal(s.ui.page,"home");assert.equal(s.ui.visit,null);assert.equal(s.intent.transfer.visible,false);
  await s.ui.paint();assert.equal(s.labels.HOME_RIGHT,"About");
  await s.ui.press("HOME_RIGHT");assert.equal(opened.pop(),"ABOUT");assert.match(s.labels.ABOUT_STATUS,/BimmerVision/);
  await s.ui.back();assert.equal(opened.pop(),"HOME");assert.equal(s.ui.page,"home");
});
test("USB storage and Recorded Drives form a native Back navigation chain", async () => {
  const {EventEmitter}=require("node:events"),desk={state:"Recording",activeId:"clip",drive,drives:[drive],volumeToken:"usb",recordedDrives:{volumeToken:"usb",drives:[],page:0,pageCount:1,total:0}},s=screen(desk,true);
  const rhmi=new EventEmitter(),components=new Map(),opened=[];
  const ids={HOME:1,USB_STORAGE:700,RECORDED_DRIVES:400};
  rhmi.getByName=name=>{if(!components.has(name)){const c=new EventEmitter();c.getId=()=>ids[name]||name;c.setValue=async(row,key,value)=>{s.labels[name]=value;};c.updateResources=async()=>{};components.set(name,c);}return components.get(name);};
  rhmi.mapEntryState=async()=>{};
  rhmi.openState=async name=>{opened.push(name);rhmi.emit("applicationStackChanged",{ROOT_APP:name==="HOME"?[1]:name==="RECORDED_DRIVES"?[1,700,400]:[1,700]});};
  s.ui.rhmi=rhmi;await s.ui.initialize();await s.ui.press("HOME_REAR");
  assert.equal(opened.pop(),"USB_STORAGE");assert.equal(s.ui.page,"usb");assert.equal(s.labels.USB_REMOTE,"Recorded Drives");
  await s.ui.press("HOME_ALL");assert.equal(s.intent.continuous,true,"hidden home actions remain blocked");
  components.get("USB_REMOTE").emit("action");await new Promise(r=>setImmediate(r));
  assert.equal(opened.pop(),"RECORDED_DRIVES");assert.equal(s.ui.recordedDrivesUI.active,true);
  rhmi.emit("applicationStackChanged",{ROOT_APP:[1,700]});
  assert.equal(s.ui.recordedDrivesUI.active,false);assert.equal(s.ui.page,"usb");assert.equal(s.ui.nativePage,"USB_STORAGE");
  await s.ui.paint();assert.match(s.labels.USB_STATUS,/USB storage/);
  components.get("USB_REMOTE").emit("action");await new Promise(r=>setImmediate(r));
  components.get("DRIVES_BACK").emit("action");await new Promise(r=>setImmediate(r));
  assert.equal(opened.pop(),"USB_STORAGE");assert.equal(s.ui.page,"usb");
  components.get("USB_AUTO").emit("action");await new Promise(r=>setImmediate(r));assert.equal(opened.pop(),"HOME");assert.equal(s.ui.page,"home");
});
test("physical Back from Google setup repaints the connected account on Remote Backup",async()=>{
 const {EventEmitter}=require("node:events"),backup={configured:false,state:"Waiting for Google sign-in",setup:{userCode:"TEST-CODE",verificationUrl:"https://www.google.com/device"},wifi:{eligible:true},drives:[],completed:[]};
 const s=screen({state:"Recording",drive,backup},true),rhmi=new EventEmitter(),components=new Map();
 const ids={HOME:1,REMOTE_BACKUP:200,REMOTE_BACKUP_SETUP:300,USB_STORAGE:700,RECORDED_DRIVES:400};
 rhmi.getByName=name=>{if(!components.has(name)){const c=new EventEmitter();c.getId=()=>ids[name]||name;c.updateResources=async()=>{};c.setValue=async(row,key,value)=>{s.labels[name]=value;};components.set(name,c);}return components.get(name);};
 rhmi.mapEntryState=async()=>{};rhmi.openState=async name=>rhmi.emit("applicationStackChanged",{ROOT_APP:name==="REMOTE_BACKUP_SETUP"?[1,200,300]:name==="REMOTE_BACKUP"?[1,200]:[1]});
 s.ui.rhmi=rhmi;await s.ui.initialize();await s.ui.press("HOME_REMOTE");await s.ui.backupUI.setup();
 backup.configured=true;backup.setup=null;backup.account="driver@example.invalid";backup.state="Google Drive connected";
 rhmi.emit("applicationStackChanged",{ROOT_APP:[1,200]});await s.ui.paint();
 assert.equal(s.ui.backupUI.page,"backup");assert.equal(s.ui.backupUI.active,true);
 assert.match(s.labels.BACKUP_ACCOUNT,/driver@example.invalid/);assert.equal(s.labels.BACKUP_STATUS,"Google Drive connected");
 assert.equal(s.ui.page,"home","native backup parent does not require reopening main menu");
});
