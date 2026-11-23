'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {NetworkGate}=require('../recorder/files/phone-network');
function fixture(local=true,fail=false){
 const calls=[],rules=new Map();let id=1;
 const run=async args=>{
  calls.push(args);
  if(args.join(' ')==='list tables')return {stdout:'table ip filter\ntable inet mgu_uplink\n'};
  if(args[0]==='-a')return {stdout:[...rules.values()].filter(r=>r.chain===args.slice(-3).join(' ')).map(r=>r.line).join('\n')};
  const chain=args.slice(2,5).join(' ');
  if(args[0]==='insert'){
   if(fail && chain==='inet mgu_uplink input')throw Error('uplink unavailable');
   rules.set(id,{chain,line:args.slice(5).join(' ')+' # handle '+id});id++;
  }else if(args[0]==='delete')rules.delete(Number(args[6]));
  return {stdout:''};
 };
 const gate=new NetworkGate({interface:local?'wlan0':'wlan_bridge',local,run,interfaces:()=>({wlan0:[{address:'192.168.1.6',netmask:'255.255.255.0'}]})});
 return {gate,rules,calls};
}
test('local Wi-Fi accepts only on-link clients and both viewer ports in both input chains, then removes its rules',async()=>{
 const {gate,rules}=fixture();await gate.open('192.168.1.6',[8765,8766]);
 assert.equal(rules.size,4);for(const r of rules.values())assert.match(r.line,/ip saddr 192\.168\.1\.0\/24 ip daddr 192\.168\.1\.6 tcp dport 876[56]/);
 await gate.close();assert.equal(rules.size,0);
});
test('partial local Wi-Fi setup rolls back while projection keeps its existing gate',async()=>{
 const f=fixture(true,true);await assert.rejects(f.gate.open('192.168.1.6',[8765,8766]));assert.equal(f.rules.size,0);
 const p=fixture(false);await p.gate.open('172.16.222.97',[8765,8766]);assert.equal(p.rules.size,2);
 assert.ok([...p.rules.values()].every(r=>r.chain==='ip filter input'));
});
