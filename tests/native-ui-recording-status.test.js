'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {UI}=require('../idrive/src/native-ui');
function screen(desk,continuous){
 const labels={},intent={continuous};
 const ui=new UI({recording:{read:()=>desk,intent:()=>intent,update:patch=>Object.assign(intent,patch)},rhmi:{getByName:name=>({setValue:async(row,column,value)=>{labels[name]=value;}})},nowMs:()=>0});
 ui.visible=true;
 return {ui,labels,intent};
}
const drive={name:'USB',used:1024,free:2048,total:3072};
test('Pause immediately stops claiming live capture while the old segment finishes',async()=>{
 const desk={state:'Recording',activeId:'segment',writeInProgress:true,drive,recordingCount:4};
 const s=screen(desk,true);await s.ui.render();assert.match(s.labels.HOME_TITLE,/REC/);
 await s.ui.press('HOME_ALL');
 assert.equal(s.intent.continuous,false);assert.equal(s.labels.HOME_ALL,'Enable recording');
 assert.match(s.labels.HOME_STATUS,/^Saving last video · 4 recordings\n/);assert.doesNotMatch(s.labels.HOME_TITLE,/REC/);
 assert.match(s.labels.HOME_STATUS,/Do not disconnect - Saving last video/);
 desk.state='Stopped';desk.activeId=null;desk.writeInProgress=false;desk.safeToRemove=true;
 await s.ui.render();assert.match(s.labels.HOME_STATUS,/^Stopped · 4 recordings\n/);assert.match(s.labels.HOME_STATUS,/Safe to Remove/);
});
test('re-enabling during finalization keeps saving visible until capture actually resumes',async()=>{
 const desk={state:'Recording',activeId:'segment',finalizing:true,writeInProgress:true,drive};
 const s=screen(desk,true);await s.ui.render();
 assert.match(s.labels.HOME_STATUS,/^Saving last video\n/);assert.doesNotMatch(s.labels.HOME_TITLE,/REC/);
 desk.finalizing=false;desk.state='Saving last video';await s.ui.render();
 assert.match(s.labels.HOME_STATUS,/^Saving last video\n/);assert.doesNotMatch(s.labels.HOME_TITLE,/REC/);
 desk.state='Recording';await s.ui.render();assert.match(s.labels.HOME_STATUS,/^Recording\n/);assert.match(s.labels.HOME_TITLE,/REC/);
});
test('Pause reports an outstanding write without an active segment and keeps USB faults visible',async()=>{
 const desk={state:'Stopped',activeId:null,writeInProgress:true,drive};
 const s=screen(desk,false);await s.ui.render();assert.match(s.labels.HOME_STATUS,/^Saving last video\n/);
 desk.error='USB write failed';await s.ui.render();assert.match(s.labels.HOME_STATUS,/^USB write failed\n/);assert.doesNotMatch(s.labels.HOME_TITLE,/REC/);
});
test('diagnostic USB writes keep stopped recording status and describe USB activity truthfully',async()=>{
 const desk={state:'Stopped',activeId:null,finalizing:false,writeInProgress:true,safeToRemove:false,drive};
 const s=screen(desk,false);await s.ui.render();
 assert.match(s.labels.HOME_STATUS,/^Stopped\n/);assert.match(s.labels.HOME_STATUS,/Do not disconnect - Writing to USB/);assert.doesNotMatch(s.labels.HOME_STATUS,/Saving last video/);
 s.ui.page='usb';await s.ui.render();assert.match(s.labels.HOME_STATUS,/Do not disconnect - Writing to USB/);assert.doesNotMatch(s.labels.HOME_STATUS,/Saving last video/);
 desk.writeInProgress=false;desk.safeToRemove=true;await s.ui.render();assert.match(s.labels.HOME_STATUS,/Safe to Remove/);
});
