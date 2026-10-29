"""Store verified APKs in a configured checkout without publishing signing keys."""
import argparse
import base64
import hashlib
import json
import re
import subprocess
import uuid
import zipfile
from pathlib import Path


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--main-key',required=True)
    parser.add_argument('--main-host',required=True,help='SSH user@hostname; requires sudo')
    parser.add_argument('--project-root',required=True,help='Absolute remote checkout directory')
    parser.add_argument('--service-user',default='admin')
    parser.add_argument('--host-key-alias',help='Optional existing SSH known_hosts alias')
    parser.add_argument('--public-url',required=True,help='HTTPS service origin embedded in the APKs')
    parser.add_argument('--publish',action='store_true',help='Publish both HTTPS APKs and their phone download page')
    parser.add_argument('apk',nargs='+',type=Path)
    args=parser.parse_args()
    files=[]
    published_roles=set()
    for path in args.apk:
        if not re.fullmatch(r'ticketpro-[a-z0-9-]+\.apk',path.name) or not path.is_file():parser.error('Only built TicketPro APK files are accepted')
        with zipfile.ZipFile(path) as archive:
            if 'assets/index.android.bundle' not in archive.namelist():raise SystemExit('APK does not contain its application bundle')
            if args.publish:
                artifact=re.fullmatch(r'ticketpro-(user|admin)-v([1-9][0-9]*)\.apk',path.name)
                if not artifact:parser.error('Publish versioned HTTPS user/admin APK files')
                entries=[name for name in archive.namelist() if name.endswith('app.config')]
                config=json.loads(archive.read(entries[0]))
                if not args.public_url.startswith('https://') or config['extra']['ticketproApiUrl']!=args.public_url.rstrip('/')+'/api':raise SystemExit('APK origin must match the configured HTTPS service')
                if config['android']['package']!='com.ticketpro.demo.'+artifact[1] or config['android']['versionCode']!=int(artifact[2]):raise SystemExit('APK filename does not match its package/version')
                if artifact[1] in published_roles:parser.error('Publish one APK per role')
                published_roles.add(artifact[1])
        files.append({'name':path.name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
    if args.publish and published_roles!={'user','admin'}:parser.error('Publish both HTTPS user/admin APKs together')
    identifier=uuid.uuid4().hex
    staging='/tmp/ticketpro-apk-upload-'+identifier
    options=['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','-i',args.main_key]
    if args.host_key_alias:options+=['-o','HostKeyAlias='+args.host_key_alias]
    host=args.main_host
    subprocess.run(['ssh',*options,host,'mkdir -m 700 '+staging],check=True)
    for path in args.apk:subprocess.run(['scp',*options,str(path),host+':'+staging+'/'+path.name],check=True)
    page=(Path(__file__).resolve().parents[2]/'Mobile/build/downloads.html').read_text() if args.publish else None
    if page and any(item['name'] not in page for item in files):parser.error('Download page must link to the APK versions being published')
    payload=base64.b64encode(json.dumps({'staging':staging,'files':files,'page':page,'project_root':args.project_root,'service_user':args.service_user}).encode()).decode()
    source=r'''
import os,json,base64,hashlib,pwd,shutil
from pathlib import Path
d=json.loads(base64.b64decode(PAYLOAD));stage=Path(d['staging']);root=Path(d['project_root'])
if not root.is_absolute() or not root.is_dir() or root.is_symlink():raise RuntimeError('Invalid remote project directory')
target=root/'artifacts'
target.mkdir(exist_ok=True);owner=pwd.getpwnam(d['service_user']);os.chown(target,owner.pw_uid,owner.pw_gid)
for item in d['files']:
 if Path(item['name']).name!=item['name']:raise RuntimeError('Invalid artifact name')
 incoming=stage/item['name']
 if hashlib.sha256(incoming.read_bytes()).hexdigest()!=item['sha256']:raise RuntimeError('Upload checksum mismatch')
 output=target/item['name'];os.replace(incoming,output);output.chmod(0o644);os.chown(output,owner.pw_uid,owner.pw_gid)
 if d['page'] is not None:
  public=Path('/var/www/ticketpro/downloads');public.mkdir(parents=True,exist_ok=True)
  shutil.copy2(output,public/output.name);(public/output.name).chmod(0o644)
 print(json.dumps({'stored':str(output),'sha256_verified':True,'publicly_published':d['page'] is not None}),flush=True)
if d['page'] is not None:
 page=Path('/var/www/ticketpro/downloads/index.html');page.write_text(d['page']);page.chmod(0o644)
stage.rmdir()
'''.replace('PAYLOAD',repr(payload))
    subprocess.run(['ssh',*options,host,'sudo -n python3 -'],input=source,text=True,check=True)


if __name__=='__main__':main()
