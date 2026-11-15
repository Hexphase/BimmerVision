'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DiagnosticSession}=require('../recorder/files/diagnostic-session');
function fixture(t){const mount=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bv-log-gate-')));t.after(()=>fs.rmSync(mount,{recursive:true,force:true}));return {mount,dir:path.join(mount,'BimmerVision-Logs'),s:new DiagnosticSession(),guard:{check:async()=>{}}};}
function snapshot(dir){return fs.existsSync(dir)?Object.fromEntries(fs.readdirSync(dir).map(n=>[n,fs.readFileSync(path.join(dir,n)).toString('base64')])):{};}
test('paused recording never creates or appends USB diagnostics, including startup and shutdown',async t=>{
 const h=fixture(t);h.s.attach(h.mount,h.guard);h.s.observe({state:'Stopped',recordingEnabled:false});assert.equal(h.s.event('receiver-exit',{error:'test'}),false);await h.s.flush();await h.s.close();assert.equal(fs.existsSync(h.dir),false);
});
test('Pause discards queued diagnostic rows; existing logs survive and logging resumes only after Enable',async t=>{
 const h=fixture(t);h.s.attach(h.mount,h.guard);await h.s.setEnabled(true);h.s.observe({state:'Recording',recordingEnabled:true});await h.s.flush();const before=snapshot(h.dir);
 h.s.event('queued-before-pause',{reason:'not written yet'});await h.s.setEnabled(false);h.s.observe({state:'Stopped',recordingEnabled:false});assert.equal(h.s.event('disabled-event',{}),false);await h.s.flush();assert.deepEqual(snapshot(h.dir),before);
 await h.s.setEnabled(true);h.s.observe({state:'Recording',recordingEnabled:true});await h.s.flush();assert.notDeepEqual(snapshot(h.dir),before);await h.s.setEnabled(false);const after=snapshot(h.dir);await h.s.close();assert.deepEqual(snapshot(h.dir),after);
});
test('Pause cancels a pending scheduled log flush without blocking control',async t=>{
 const h=fixture(t);h.s.attach(h.mount,h.guard);await h.s.setEnabled(true);h.s.observe({state:'Recording',recordingEnabled:true});h.s.setEnabled(false);await new Promise(r=>setTimeout(r,30));await h.s.flush();assert.equal(fs.existsSync(h.dir),false);await h.s.close();
});
test('Pause during a pending USB guard prevents the deferred write from starting',async t=>{
 const h=fixture(t);let release,entered;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);t.after(()=>release());h.guard.check=async()=>{entered();await gate;};h.s.attach(h.mount,h.guard);h.s.setEnabled(true);h.s.observe({state:'Recording',recordingEnabled:true});await started;
 const stopping=h.s.setEnabled(false);assert.equal(h.s.enabled,false);release();await stopping;await h.s.close();assert.equal(fs.existsSync(h.dir),false);
});
