#!/usr/bin/env python3
"""Restore the saved BimmerVision pair without changing recording intent."""
import argparse, hashlib, json, os, pathlib, shlex, shutil, subprocess, tempfile

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifacts',type=pathlib.Path,required=True)
    parser.add_argument('--profile',type=pathlib.Path,default=pathlib.Path.home()/'Documents/BimmerVision-private/cluster-preview.json')
    args=parser.parse_args(); metadata=json.loads((args.artifacts/'rollback.json').read_text())
    version=metadata.get('version','0.2.18')
    if version not in ['0.2.18','0.2.20','0.2.21','0.2.22']:raise ValueError('Unexpected rollback version')
    files=[]
    for item in metadata['artifacts']:
        name=item['name']
        if name not in ['bimmervision@'+version+'.tgz','bimmervision-recorder@'+version+'.tgz']:raise ValueError('Unexpected rollback artifact')
        file=args.artifacts/name
        if hashlib.sha256(file.read_bytes()).hexdigest()!=item['sha256']:raise ValueError('Rollback checksum mismatch: '+name)
        files.append(file)
    profile=json.loads(args.profile.read_text())
    source=subprocess.check_output(['ipconfig','getifaddr',profile['interface']],text=True).strip()
    with tempfile.TemporaryDirectory(prefix='bimmervision-rollback-') as temporary:
        key=pathlib.Path(temporary)/'key';shutil.copyfile(profile['identityFile'],key);key.chmod(0o600)
        ssh=['ssh','-T','-b',source,'-i',str(key),'-o','IdentitiesOnly=yes','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+profile['knownHostsFile'],'-o','ConnectTimeout=5','root@'+profile['host']]
        def run(command,data=None):return subprocess.run(ssh+[command],input=data,check=True)
        # Stop preview through the service's ordinary settings; preserve continuous.
        run('node -',(b"var r='/var/opt/bimmervision-recorder/current',a=require(r+'/setup').findApp({});try{var p=require(r+'/cluster-preference');var d=p.location(a.uid),s=p.read(d,a.uid);p.write(d,a.uid,{enabled:false});if(s.blinkersOnly!==undefined&&STRIP_NEW_FIELD)require(r+'/io').atomicJSON(d+'/cluster-preference.json',{enabled:false,navigation:s.navigation},{uid:a.uid,gid:a.uid}).catch(function(e){console.error(e.message);process.exitCode=1;});}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;}\n").replace(b'STRIP_NEW_FIELD',b'false' if version in ['0.2.21','0.2.22'] else b'true'))
        remote=[]
        for file in files:
            target='/tmp/'+file.name;run('umask 077; cat > '+shlex.quote(target),file.read_bytes());remote+=['--artifact',target]
        deploy='/var/opt/mgu-deploy/mgu-deploy.sh '
        options=' '.join(shlex.quote(x) for x in remote)
        run(deploy+'check '+options)
        run(deploy+'install '+options+' --yes')
        run('node -',b"var r='/var/opt/bimmervision-recorder/current',a=require(r+'/setup').findApp({}),p=require(r+'/recording-preference');console.log('Restored BimmerVision '+require(r+'/version.json').version+'; saved recording preference: '+p.read(p.location(a.uid),a.uid));\n")
        print('Rollback complete. Recording preference and USB recordings were kept.')
if __name__=='__main__':main()
