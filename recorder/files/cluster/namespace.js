'use strict';
var fs=require('fs');
// The native helper has this fixed private-state path. Create the mountpoint
// ourselves; installation of an unrelated application must not supply it.
function ensureTarget(target){var created=false;try{fs.mkdirSync(target,448);created=true;}catch(e){if(e.code!=='EEXIST')throw e;}var st=fs.lstatSync(target);if(st.isSymbolicLink()||!st.isDirectory())throw Error('Cluster mount target must be a plain directory');return created;}
module.exports={ensureTarget:ensureTarget};
