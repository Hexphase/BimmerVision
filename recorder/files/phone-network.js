'use strict';
var cp=require('child_process'),util=require('util'),os=require('os'),net=require('net');

function NetworkGate(options){
  var o=options||{};
  this.interface=o.interface;
  this.local=o.local===true;
  this.tag=this.local?'bimmervision-local-transfer':'bimmervision-transfer';
  this.interfaces=o.interfaces||os.networkInterfaces;
  this.run=o.run||function(args){
    return util.promisify(cp.execFile)('/usr/sbin/nft',args,{timeout:2000,maxBuffer:262144});
  };
}

NetworkGate.prototype.chains=async function(){
  var chains=[['ip','filter','input']];
  if(this.local){
    var tables=await this.run(['list','tables']);
    if(/^table inet mgu_uplink$/m.test(tables.stdout))chains.push(['inet','mgu_uplink','input']);
  }
  return chains;
};

NetworkGate.prototype.close=async function(){
  var chains=await this.chains();
  for(var chain of chains){
    var result=await this.run(['-a','list','chain'].concat(chain));
    for(var line of result.stdout.split('\n')){
      if(line.indexOf('comment "'+this.tag+'"')<0)continue;
      var match=/# handle ([0-9]+)\s*$/.exec(line);
      if(!match)continue;
      try{await this.run(['delete','rule'].concat(chain,['handle',match[1]]));}
      catch(e){if(!/No such file or directory/.test(String(e.stderr||e.message)))throw e;}
    }
  }
};

NetworkGate.prototype.subnet=function(host){
  var address=(this.interfaces()[this.interface]||[]).find(function(a){return a.address===host;});
  if(!address||net.isIP(address.netmask)!==4)throw Error('Local Wi-Fi subnet unavailable');
  var mask=address.netmask.split('.').map(Number),bits=mask.map(function(n){return ('00000000'+n.toString(2)).slice(-8);}).join('');
  if(!/^1+0*$/.test(bits))throw Error('Invalid local Wi-Fi subnet');
  return host.split('.').map(function(n,i){return Number(n)&mask[i];}).join('.')+'/'+bits.replace(/0/g,'').length;
};

NetworkGate.prototype.open=async function(host,ports){
  if(!/^[A-Za-z0-9_.:-]{1,32}$/.test(this.interface||'')||net.isIP(host)!==4)throw Error('Phone Wi-Fi interface/address unavailable');
  if(!ports.every(function(p){return Number.isInteger(p)&&p>=1&&p<=65535;}))throw Error('Invalid phone port');
  var filter=['iifname','"'+this.interface+'"'];
  if(this.local)filter=filter.concat(['ip','saddr',this.subnet(host)]);
  filter=filter.concat(['ip','daddr',host,'tcp','dport']);
  await this.close();
  try{
    var chains=await this.chains();
    for(var chain of chains){
      for(var port of ports){
        await this.run(['insert','rule'].concat(chain,filter,[String(port),'counter','accept','comment','"'+this.tag+'"']));
      }
    }
  }catch(e){await this.close();throw e;}
};
module.exports={NetworkGate:NetworkGate};
