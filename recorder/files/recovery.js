'use strict';
var fs=require('fs'),NAME='bimmervision-service',SECTIONS=['WhitelistExitSuccess','Whitelist'];
function sections(text){var out={},current='';String(text).split(/\r?\n/).forEach(function(line){var m=line.trim().match(/^\[([^\]]+)\]$/);if(m){current=m[1];if(out[current])throw Error('Duplicate recovery section: '+current);out[current]=[];}else if(current)out[current].push(line.trim());});return out;}
function registered(text){var s=sections(text);return SECTIONS.every(function(k){return s[k]&&s[k].indexOf(NAME)>=0;});}
function register(text){var s=sections(text);SECTIONS.forEach(function(k){if(!s[k])throw Error('Missing recovery section: '+k);});var current='',out=[];function finish(){if(SECTIONS.indexOf(current)>=0&&s[current].indexOf(NAME)<0)out.push(NAME);}String(text).split('\n').forEach(function(line){var m=line.trim().match(/^\[([^\]]+)\]$/);if(m){finish();current=m[1];}out.push(line);});finish();return out.join('\n');}
module.exports={register:register,registered:registered};
if(require.main===module){var file='/etc/recmgr-restartlist.conf';if(fs.existsSync(file)&&!registered(fs.readFileSync(file,'utf8'))){process.stderr.write('BimmerVision is not registered with MGU recovery. Register it in both recovery allowlists and reboot before starting or stopping the service.\n');process.exit(1);}}
