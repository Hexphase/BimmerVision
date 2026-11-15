'use strict';
function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
function exited(child){return child.exitCode!==null||child.signalCode!==null;}
function signal(child,name){try{if(child.pid)process.kill(-child.pid,name);}catch(e){if(e.code!=='ESRCH')throw e;}try{if(!exited(child))child.kill(name);}catch(e){if(e.code!=='ESRCH')throw e;}}
// Native launches in its own process group. Tear the group down even if the
// namespace launcher exited first; it must not strand a decoder grandchild.
async function endChild(child){if(!child)return;try{if(child.stdin)child.stdin.end();}catch(ignore){}signal(child,'SIGTERM');for(var i=0;i<15&&!exited(child);i++)await wait(50);signal(child,'SIGKILL');for(i=0;i<20&&!exited(child);i++)await wait(25);if(!exited(child))throw Error('Cluster decoder did not exit after SIGKILL');}
module.exports={endChild:endChild};
