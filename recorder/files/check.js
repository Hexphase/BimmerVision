'use strict';
var setup=require('./setup'),path=require('path');
try{setup.platform();var p=setup.json(path.join(__dirname,'RECEIVER-PROVENANCE.json'));if(setup.digest(path.join(__dirname,'receiver'))!==p.sha256)throw Error('Camera receiver checksum mismatch');console.log('BimmerVision recorder files and head-unit platform verified.');}catch(e){console.error(e.message);process.exitCode=1;}
