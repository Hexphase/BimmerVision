'use strict';
function DriveActions(){this.initialized=false;this.seen=null;this.deleting=false;this.phase=null;this.result=null;}
DriveActions.prototype.run=async function(command,context){
 var id=command&&command.id;
 if(!this.initialized){this.initialized=true;this.seen=id||null;return;}
 if(!id||id===this.seen)return;this.seen=id;
 if(!/^[a-f0-9]{32}$/.test(id)||command.confirmed!==true)return;
 if(!context.volume||command.volume!==context.volume||!command.volumeToken||command.volumeToken!==context.volumeToken){this.result={id:id,error:'The connected drive changed. Nothing deleted.'};return;}
 this.deleting=true;this.phase='finishing';this.result=null;
 try{await context.pause();await context.closeTransfer();await context.finish();this.phase='deleting';var result=await context.remove();this.result=Object.assign({id:id},result);}
 catch(e){this.result={id:id,error:String(e.message||e)};}
 finally{this.deleting=false;this.phase=null;}
};
module.exports={DriveActions:DriveActions};
