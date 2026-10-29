"""Prepare the static site and a validated Caddy config on the main EC2 host."""
import argparse
import json
import os
import re
import shutil
import socket
import subprocess
from pathlib import Path


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--domain',required=True)
    parser.add_argument('--expected-ip',help='Optional expected public IPv4; verify DNS against this address')
    args=parser.parse_args()
    domain=args.domain.lower().rstrip('.')
    if not re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?',domain) or '.' not in domain:parser.error('Provide only the DNS hostname')
    addresses={item[4][0] for item in socket.getaddrinfo(domain,None,family=socket.AF_INET)}
    if args.expected_ip and args.expected_ip not in addresses:raise SystemExit('DNS does not point to the expected public IPv4')
    root=Path(__file__).resolve().parents[2]
    frontend=root/'Frontend'
    env=os.environ.copy()
    env.update(VITE_TICKET_API_URL=f'https://{domain}/api',VITE_AUTH_API_URL=f'https://{domain}/api',VITE_AUTH_VIA_BACKEND='true')
    # The caller runs this as admin; publishing into /var/www is a separate root step.
    subprocess.run(['npm','run','build'],cwd=frontend,env=env,check=True)
    config=Path(__file__).with_name('Caddyfile.template').read_text().replace('PUBLIC_HOST',domain)
    target=Path(__file__).with_name('Caddyfile.ready')
    target.write_text(config)
    subprocess.run(['/usr/local/bin/caddy','validate','--config',str(target),'--adapter','caddyfile'],check=True)
    print(json.dumps({'domain':domain,'static_site':str(frontend/'dist'),'caddy_config':str(target),'activated':False}),flush=True)


if __name__=='__main__':main()
