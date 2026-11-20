'use strict';
// Read-only publication audit. Reports locations and one-way fingerprints, never values.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib'),cp=require('node:child_process');
const MAX_FILE=64*1024*1024,MAX_EXPANDED=128*1024*1024;
const SYNTHETIC_DEVICE=['GOCSPX','exampleDeviceIdentityForTestsOnly'].join('-'),DNS=['1','1','1','1'].join('.'),MULTICAST=['224','0','0','0'].join('.');
const fixture=p=>/(^|\/)(tests?|fixtures?)(\/|\.)/.test(p);
const hash=s=>crypto.createHash('sha256').update(s).digest('hex').slice(0,12);
function validVIN(s){const values={A:1,B:2,C:3,D:4,E:5,F:6,G:7,H:8,J:1,K:2,L:3,M:4,N:5,P:7,R:9,S:2,T:3,U:4,V:5,W:6,X:7,Y:8,Z:9},weights=[8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2];const n=[...s].reduce((sum,c,i)=>sum+(values[c]??Number(c))*weights[i],0)%11;return s[8]===(n===10?'X':String(n));}
function auditBuffer(name,buffer,{depth=0,expectedDeviceIdentity=null}={}){
 const out=[],seen=new Set();
 const original=name.split('!').at(-1);
 let approvedIdentity=false;
 if(expectedDeviceIdentity&&name.includes('!')&&original==='files/google-device-client.json'){try{const value=JSON.parse(buffer.toString('utf8'));approvedIdentity=Object.keys(value).sort().join(',')==='client_id,client_secret'&&value.client_id===expectedDeviceIdentity.client_id&&value.client_secret===expectedDeviceIdentity.client_secret;}catch{}}
 function add(kind,value,at=0,severity='blocker'){const fingerprint=hash(value),line=1+buffer.subarray(0,at).toString('utf8').split('\n').length-1,key=kind+':'+line+':'+fingerprint;if(seen.has(key))return;seen.add(key);out.push({path:name,line,kind,severity,fingerprint});}
 if(approvedIdentity){add('approved-device-oauth-identity',buffer,0,'review');return out;}
 if(buffer.length>MAX_FILE){add('oversized-audit-input',name);return out;}
 if(depth>4){add('archive-recursion-limit',name);return out;}
 if(/\.(?:bvr|m4v|mp4|mov|jsonl|pcap|pcapng)$/i.test(name))add('recording-or-capture-file',name);
 if(/(?:^|\/)(?:hardware\.json|google-drive-client\.json|google-device-client\.json|state\.json|state\.bak|key\.pem|cert\.pem)$/i.test(name))add('private-runtime-file',name);
 if(buffer[0]===31&&buffer[1]===139){try{return out.concat(auditBuffer(name+'!gzip',zlib.gunzipSync(buffer,{maxOutputLength:MAX_EXPANDED}),{depth:depth+1,expectedDeviceIdentity}));}catch{add('unreadable-or-oversized-gzip',name);return out;}}
 if(buffer.length>=512&&buffer.subarray(257,262).toString()==='ustar'){
  let at=0,total=0;
  while(at+512<=buffer.length&&!buffer.subarray(at,at+512).every(b=>b===0)){
   const h=buffer.subarray(at,at+512),part=h.subarray(0,100).toString().replace(/\0.*$/s,''),prefix=h.subarray(345,500).toString().replace(/\0.*$/s,''),entry=prefix?prefix+'/'+part:part,size=parseInt(h.subarray(124,136).toString().replace(/\0.*$/s,'').trim()||'0',8),type=h[156];
   if(!entry||entry.startsWith('/')||entry.split('/').includes('..')||!Number.isSafeInteger(size)||size<0||at+512+size>buffer.length){add('invalid-tar-entry',name);break;}
   total+=size;if(total>MAX_EXPANDED){add('expanded-archive-limit',name);break;}
   if(type===48||type===0)out.push(...auditBuffer(name+'!'+entry,buffer.subarray(at+512,at+512+size),{depth:depth+1,expectedDeviceIdentity}));else if(![53].includes(type))add('unsupported-tar-entry',entry);
   at+=512+Math.ceil(size/512)*512;
  }
  return out;
 }
 // Also inspect ASCII payloads embedded in binaries (for example image metadata).
 // Rasterized text/QR imagery still requires visual or barcode review.
 const text=buffer.toString('utf8');let m;
 const patterns=[['google-client-secret',/GOCSPX-[A-Za-z0-9_-]{12,}/g],['oauth-refresh-token',/1\/\/[A-Za-z0-9_-]{25,}/g],['google-access-token',/ya29\.[A-Za-z0-9._-]{25,}/g],['github-token',/(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/g],['private-key',/-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/=\r\n-]{64,}-----END (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g]];
 for(const [kind,re] of patterns)while((m=re.exec(text))){const synthetic=kind==='google-client-secret'&&/(?:^|\/)tests\/google-device-provisioning\.test\.js$/.test(original)&&m[0]===SYNTHETIC_DEVICE;add(synthetic?'synthetic-device-oauth-fixture':kind,m[0],m.index,synthetic?'review':'blocker');}
 const credentials=/(?:["']?(?:access_token|refresh_token|client_secret|accessToken|refreshToken|clientSecret|bearer|csrf|password)["']?)\s*[:=]\s*["']([^"'\r\n]{16,4096})["']/g;
 while((m=credentials.exec(text))){if((m[1]===SYNTHETIC_DEVICE||hash(m[1])==='1ba8ed1e956b'&&/(?:^|\/)tests\/google-device-provisioning\.test\.js$/.test(original)||/^(?:FAKE|TEST|EXAMPLE|PLACEHOLDER)/i.test(m[1])||/^(?:candidate-refresh|expired-candidate)$/.test(m[1])&&/(?:^|\/)tests\/google-drive\.test\.js$/.test(original))&&fixture(original))add('synthetic-credential-fixture',m[1],m.index,'review');else add('credential-field-payload',m[1],m.index);}
 const vins=/(?<![A-Za-z0-9])[A-HJ-NPR-Z0-9]{13}[0-9]{4}(?![A-Za-z0-9])/g;while((m=vins.exec(text)))if(/[A-HJ-NPR-Z]/.test(m[0])&&validVIN(m[0]))add('vehicle-identification-number',m[0],m.index);
 const emails=/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
 while((m=emails.exec(text))){const value=m[0],domain=value.split('@')[1].toLowerCase();if(/@\d+\.\d+\.\d+\.tgz$/.test(value)||/(^|\.)(example\.(com|org|net)|invalid|test)$/.test(domain))continue;const publicContact=['b745bde917ea','68de8dca0982'].includes(hash(value))&&(/(?:^|\/)(privacy|terms)\.html$/.test(original)&&hash(value)==='b745bde917ea'||/(?:^|\/)vendor\/spark-md5-LICENSE$/.test(original)&&hash(value)==='68de8dca0982');add(publicContact?'required-public-contact-or-attribution':'email-address',value,m.index,publicContact?'review':'blocker');}
 const ips=/(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g;
 while((m=ips.exec(text))){const v=m[0],a=v.split('.').map(Number);if(a.some(x=>x>255))continue;if(a[0]===127||v==='0.0.0.0'||v==='255.255.255.255'||a[0]===192&&a[1]===0&&a[2]===2||a[0]===198&&a[1]===51&&a[2]===100||a[0]===203&&a[1]===0&&a[2]===113)continue;
  if(v===DNS&&/(?:^|\/)privacy\.html$/.test(original))continue;
  if(v===DNS&&/(?:^|\/)backup-http\.js$/.test(original))continue;
  // The receiver embeds this multicast network mask, not a car-specific endpoint.
  if(v===MULTICAST&&/(?:^|\/)perception-receiver$/.test(original))continue;
  add(fixture(original)?'fixture-ip-address':'network-address',v,m.index,fixture(original)?'review':'blocker');
 }
 // Personal workspace paths are not needed by a public artifact.
 const homes=/(?:\/Users\/[A-Za-z0-9._-]+|\/home\/[A-Za-z0-9._-]+)/g;while((m=homes.exec(text)))if(!/\/(?:user|example|test|runner|node|root)$/.test(m[0]))add('personal-home-path',m[0],m.index);
 return out;
}
function auditFiles(root,files,{expectedDeviceClientFile}={}){let expectedDeviceIdentity=null;if(expectedDeviceClientFile){const stat=fs.lstatSync(expectedDeviceClientFile);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16384||(stat.mode&0o077)!==0)throw Error('Expected device identity must be a private regular file.');expectedDeviceIdentity=JSON.parse(fs.readFileSync(expectedDeviceClientFile,'utf8'));if(Object.keys(expectedDeviceIdentity).sort().join(',')!=='client_id,client_secret'||typeof expectedDeviceIdentity.client_id!=='string'||typeof expectedDeviceIdentity.client_secret!=='string')throw Error('Expected device identity must contain only client_id and client_secret.');}const findings=[];let scanned=0;for(const rel of files){const file=path.resolve(root,rel);if(!fs.existsSync(file))continue;const st=fs.lstatSync(file);if(st.isSymbolicLink()){findings.push({path:rel,kind:'symlink-input',severity:'blocker',fingerprint:hash(rel)});continue;}if(!st.isFile())continue;scanned++;if(st.size>MAX_FILE)findings.push({path:rel,kind:'oversized-audit-input',severity:'blocker',fingerprint:hash(rel)});else findings.push(...auditBuffer(rel,fs.readFileSync(file),{expectedDeviceIdentity}));}return {scanned,findings,blockers:findings.filter(f=>f.severity==='blocker').length};}
function auditTracked(root=process.cwd(),archives=[],options={}){const files=cp.execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);const source=auditFiles(root,files),assets=auditFiles(root,[...new Set(archives)].filter(file=>!files.includes(file)),options);return {scanned:source.scanned+assets.scanned,findings:source.findings.concat(assets.findings),blockers:source.blockers+assets.blockers};}
module.exports={auditBuffer,auditFiles,auditTracked,validVIN};
if(require.main===module){try{const args=process.argv.slice(2),root=process.cwd(),options={};const at=args.indexOf('--expected-device-client-file');if(at!==-1){if(!args[at+1])throw Error('Supply expected device identity path.');options.expectedDeviceClientFile=args[at+1];args.splice(at,2);}const archives=args.length?args:fs.readdirSync(root).filter(n=>n.endsWith('.tgz'));const result=auditTracked(root,archives,options);process.stdout.write(JSON.stringify(result,null,2)+'\n');process.exitCode=result.blockers?1:0;}catch(error){process.stderr.write('Public release audit failed: '+error.message+'\n');process.exitCode=1;}}
