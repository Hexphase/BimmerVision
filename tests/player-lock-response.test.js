'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {SourceManager}=require('../recorder/files/mobile-web/source-manager');
test('car player rejects an unsaved lock instead of reporting it protected',async()=>{const m=new SourceManager();m.setSource({kind:'car',fetch:async()=>new Response('{"error":"Recording is active or transferring"}',{status:409})});await assert.rejects(m.fetch('/api/v1/recordings/id/lock',{method:'POST'}),/active or transferring/);});
