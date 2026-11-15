// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Hexphase
'use strict';
// Candidate preview worker. The capture owner sends recording packets first;
// this process cannot change recording preferences or open a camera service.
var Controller=require('./controller').Controller,Input=require('./input').Input;
var Output=require('./rgba-output').Output,DecoderSession=require('./decoder-session').DecoderSession,Watch=require('./progress-watch').Watch;
function run(options){
 var o=options||{},current=null,closing=false,frames=0,lastStatus=null,finish=null,lastResync=0;
 function send(value){if(process.connected)try{process.send(value,function(){});}catch(ignore){}}
 function status(state,error){var row={type:'status',state:state,view:controller.intent,error:error||null,frames:frames};if(JSON.stringify(row)!==lastStatus){lastStatus=JSON.stringify(row);send(row);}}
 function active(s){return !!s&&!closing&&!s.closed&&current===s&&s.o.generation===controller.generation;}
 function fail(error){if(closing)return;console.error('BimmerVision decoder: '+String(error&&error.stack||error));status('error',String(error&&error.message||error));shutdown(1);}
 function resync(){if(current)current.discontinuity();input.resync();if(Date.now()-lastResync>1000){lastResync=Date.now();send({type:'resync'});}}
 async function start(view,generation,onFrame){
  input.resetTransport();var s=new DecoderSession({renderer:output,binary:o.binary,view:view,generation:generation,onError:fail,onDiagnostic:function(text){console.error(text);},onFrame:function(){if(!active(s))return;frames++;s.watch.frame(Date.now());if(s.shown)onFrame();}});s.watch=new Watch();s.shown=output.shown;current=s;
  try{await s.start();s.watch.reset(Date.now());s.watch.target(s.shown,Date.now());if(s.child&&s.child.pid)send({type:'native',pid:s.child.pid});return s;}catch(error){await stop(s);throw error;}
 }
 async function stop(s){if(!s)return;if(current===s)current=null;await s.stop();send({type:'native',pid:null});}
 var input=new Input(function(unit){if(active(current))try{current.push(unit);}catch(error){fail(error);}},resync);
 var output=new Output(o.createClient,{error:fail,target:function(shown){controller.suspend();if(current&&!current.closed){current.shown=shown;current.watch.target(shown,Date.now());}status('waiting');}});
 var controller=new Controller({start:start,stop:stop,release:function(){output.close();},opacity:function(value){output.opacity(value);},status:status,error:fail});
 var timer=setInterval(function(){if(active(current)){var error=current.watch.error(Date.now());if(error)fail(Error(error));else status(current.shown&&controller.ready?'showing':'waiting');}},1000);
 function shutdown(code){if(finish)return finish;closing=true;clearInterval(timer);process.stdin.pause();finish=controller.close().then(function(){if(current)return stop(current);}).then(function(){if(!code)status('hidden');if(process.connected)process.disconnect();process.exit(code||0);},function(error){output.close();console.error('BimmerVision preview cleanup: '+String(error&&error.message||error));process.exit(1);});return finish;}
 process.stdin.on('data',function(data){if(closing||!current)return;try{var t=process.hrtime();input.push(data,t[0]*1000000+t[1]/1000);}catch(error){fail(error);}});
 process.stdin.on('error',fail);process.stdin.on('end',function(){shutdown(0);});
 process.on('message',function(message){if(closing||!message)return;if(message.type==='view')controller.view(message.view);else if(message.type==='resync')resync();else if(message.type==='parameters')try{input.parameters(message.streams);}catch(error){fail(error);}else if(message.type==='stop')shutdown(0);});
 process.on('disconnect',function(){shutdown(0);});process.on('SIGTERM',function(){shutdown(0);});process.on('SIGINT',function(){shutdown(0);});process.on('uncaughtException',fail);process.on('unhandledRejection',fail);status('hidden');
}
module.exports={run:run};if(require.main===module)run();
