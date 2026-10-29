"""Activate the prepared free HTTPS gateway after the owner configures DNS/ports.

Run locally with SSH keys; no keys or service secrets are copied into the project.
"""
import argparse
import base64
import json
import re
import shlex
import subprocess
import time
import urllib.request


MAIN_PREPARE=r'''
import json,os,subprocess,shutil,pwd
from pathlib import Path
d=DATA;root=Path(d['main_root']);domain=d['domain']
result=subprocess.run(['sudo','-n','-u',d['service_user'],str(root/d['main_python']),'Backend/deploy/prepare_https.py','--domain',domain],cwd=root,capture_output=True,text=True,timeout=150)
if result.returncode:raise RuntimeError(result.stderr[-1500:])
public=Path('/var/www/ticketpro');public.mkdir(parents=True,exist_ok=True)
site=public/'site';shutil.copytree(root/'Frontend/dist',site,dirs_exist_ok=True)
for base,dirs,files in os.walk(site):
 Path(base).chmod(0o755)
 for name in files:(Path(base)/name).chmod(0o644)
config=Path('/etc/caddy/Caddyfile')
if config.exists() and config.read_text()!=(root/'Backend/deploy/Caddyfile.ready').read_text():raise RuntimeError('Caddy already has a different configuration; inspect before replacing')
shutil.copy2(root/'Backend/deploy/Caddyfile.ready',config);config.chmod(0o644)
subprocess.run(['systemctl','start','ticketpro-https'],check=True)
print(json.dumps({'gateway':'started','domain':domain}),flush=True)
'''

AUTH_CHANGE=r'''
import json,os,time,subprocess,signal,re,shutil,pwd
from pathlib import Path
from dotenv import dotenv_values,set_key
d=DATA;root=Path(d['auth_root']);envfile=root/'.env.auth.runtime';state=root/'.ticketpro-https-state'/d['domain']
if d['phase']=='activate':
 state.mkdir(parents=True,mode=0o700,exist_ok=True);state.chmod(0o700)
 if not (state/'auth.runtime.previous').exists():shutil.copy2(envfile,state/'auth.runtime.previous');(state/'auth.runtime.previous').chmod(0o600)
 origin='https://'+d['domain']
 for key in ['OID4VCI_ISSUER_BASE_URL','AUTH_PUBLIC_BASE_URL','SERVER_BASE_URL']:set_key(str(envfile),key,origin)
 settings=dict(dotenv_values(root/'.env'));settings.update(dotenv_values(envfile))
 origins=[item.strip() for item in settings.get('ALLOWED_ORIGINS','').split(',') if item.strip()]
 if origin not in origins:origins.append(origin)
 set_key(str(envfile),'ALLOWED_ORIGINS',','.join(origins))
else:shutil.copy2(state/'auth.runtime.previous',envfile)
def listeners():
 result=[]
 for line in subprocess.check_output(['ss','-lntp'],text=True).splitlines():
  if re.search(r':8001\s',line):result.extend(int(p) for p in re.findall(r'pid=(\d+)',line))
 return set(result)
for pid in listeners():
 if Path(os.readlink('/proc/'+str(pid)+'/cwd'))!=root:raise RuntimeError('Unexpected auth process')
 os.kill(pid,signal.SIGTERM)
for _ in range(40):
 if not listeners():break
 time.sleep(.25)
else:raise RuntimeError('Auth did not stop')
with (root/'auth_8001.log').open('ab') as out:
 subprocess.Popen([str(root/d['auth_python']),'run_server.py','auth'],cwd=root,stdin=subprocess.DEVNULL,stdout=out,stderr=out,start_new_session=True)
from urllib.request import Request,urlopen
settings=dict(dotenv_values(root/'.env'));settings.update(dotenv_values(envfile))
for _ in range(40):
 try:
  with urlopen(Request('http://127.0.0.1:8001/health/live',headers={'X-Service-Key':settings['AUTH_SERVICE_KEY']}),timeout=2) as response:
   if response.status==200:break
 except Exception:pass
 time.sleep(.5)
else:raise RuntimeError('Auth readiness failed')
print(json.dumps({'auth':d['phase'],'ready':True}),flush=True)
'''


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--domain',required=True)
    parser.add_argument('--main-key',required=True)
    parser.add_argument('--auth-key',required=True)
    parser.add_argument('--main-host',required=True,help='SSH user@hostname for the main host (requires sudo)')
    parser.add_argument('--auth-host',required=True,help='SSH user@hostname for the auth host')
    parser.add_argument('--main-root',required=True,help='Absolute remote project directory')
    parser.add_argument('--auth-root',required=True,help='Absolute remote directory containing auth run_server.py')
    parser.add_argument('--service-user',default='admin',help='Main host application user')
    parser.add_argument('--main-python',default='Backend/venv/bin/python',help='Python path relative to main-root')
    parser.add_argument('--auth-python',default='venv/bin/python',help='Python path relative to auth-root')
    parser.add_argument('--main-host-key-alias',help='Optional existing SSH known_hosts alias')
    args=parser.parse_args()
    domain=args.domain.lower().rstrip('.')
    if not re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?',domain) or '.' not in domain:parser.error('Use only a hostname')
    def remote(role,source,phase='activate'):
        auth=role=='auth'
        encoded=base64.b64encode(json.dumps({**vars(args),'domain':domain,'phase':phase}).encode()).decode()
        source=source.replace('DATA',"__import__('json').loads(__import__('base64').b64decode("+repr(encoded)+"))")
        command=['ssh','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','-i',args.auth_key if auth else args.main_key]
        if not auth and args.main_host_key_alias:command+=['-o','HostKeyAlias='+args.main_host_key_alias]
        python=__import__('posixpath').join(args.auth_root,args.auth_python)
        command+=[args.auth_host if auth else args.main_host,shlex.quote(python)+' -' if auth else 'sudo -n python3 -']
        result=subprocess.run(command,input=source,text=True,capture_output=True,timeout=210)
        if result.returncode:raise RuntimeError(role+': '+result.stderr[-1800:])
        print(result.stdout.strip().splitlines()[-1],flush=True)
    changed_auth=False
    gateway_started=False
    try:
        remote('main',MAIN_PREPARE)
        gateway_started=True
        origin='https://'+domain
        # Check a publicly trusted certificate, not an insecure/private TLS context.
        for _ in range(45):
            try:
                with urllib.request.urlopen(origin+'/',timeout=4) as response:
                    if response.status==200:break
            except Exception:time.sleep(1)
        else:raise RuntimeError('Trusted HTTPS is unreachable; verify DNS and EC2 TCP 80/443 rules')
        changed_auth=True
        remote('auth',AUTH_CHANGE)
        for path in ['/api/events','/.well-known/jwks.json','/.well-known/openid-credential-issuer','/.well-known/oauth-authorization-server']:
            with urllib.request.urlopen(origin+path,timeout=15) as response:body=json.load(response)
            if path.endswith('openid-credential-issuer') and body.get('credential_issuer')!=origin:raise RuntimeError('Wrong public issuer URL')
            if path.endswith('oauth-authorization-server') and body.get('issuer')!=origin:raise RuntimeError('Wrong public authorization URL')
        remote('main',"import subprocess,json\nsubprocess.run(['systemctl','enable','ticketpro-https'],check=True)\nprint(json.dumps({'https':'PASS','url':'https://'+DATA['domain']}))")
    except Exception:
        if changed_auth:
            try:remote('auth',AUTH_CHANGE,'rollback')
            except Exception as error:print('Auth rollback requires inspection: '+str(error),flush=True)
        if gateway_started:remote('main',"import subprocess,json\nsubprocess.run(['systemctl','stop','ticketpro-https'],check=True)\nprint(json.dumps({'https':'stopped; original HTTP service retained'}))")
        raise


if __name__=='__main__':main()
