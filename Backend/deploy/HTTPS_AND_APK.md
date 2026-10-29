# Free HTTPS and standalone Android demos

Live origin: `https://ticketpro.duckdns.org`. The Let's Encrypt gateway was
activated on 2026-10-27. Public web, API, issuer metadata and JWKS use this origin.
Phone downloads: `https://ticketpro.duckdns.org/downloads/` (user APK v3, admin APK v2).

Deployment paths are supplied explicitly; no developer PC path is required. The
current demo checkout was renamed to `1029` on 2026-10-29. Existing backup folders
remain unchanged and are not part of the Git checkout.
Existing AWS EC2/storage/network charges remain; this plan adds no paid cloud
service, purchased domain, app-store registration or EAS subscription.

## Owner preparation

1. Sign in at https://www.duckdns.org and register an available subdomain.
2. Set its IPv4 address to your main EC2 instance public IPv4. Send the hostname to the deployer;
   never send the DuckDNS account password or update token.
3. On the main EC2 instance's security group, add inbound TCP 80 and TCP 443
   from `0.0.0.0/0`. Keep SSH and existing demo ports until migration is verified.
4. If a stale IPv6/AAAA record exists, remove or correct it before issuance.
   A stopped/restarted EC2 instance can receive a different public IPv4; update
   DuckDNS if that happens. No additional Elastic IP is required for this demo.

## HTTPS deployment

From the local build machine, the coordinated activation command is:

```
python3 Backend/deploy/activate_https.py --domain HOSTNAME --main-host SSH_USER@MAIN_HOST --auth-host AUTH_USER@AUTH_HOST --main-root /path/to/checkout --auth-root /path/to/auth --service-user APP_USER --main-key /path/to/main.pem --auth-key /path/to/auth.pem
```

Run it after the preparation files are on the server and the owner has completed
DNS and security-group changes. It first checks trusted public TLS, then changes
auth public URLs and verifies metadata. On failure it restores auth settings
when changed and stops the new gateway, leaving the original HTTP demo available.

Caddy is installed at `/usr/local/bin/caddy`. The prepared systemd service is
`ticketpro-https.service`; it stays inactive until DNS and ports are ready.

1. As admin, run `python3 Backend/deploy/prepare_https.py --domain HOSTNAME`
   from the remote checkout root. It resolves IPv4 (optionally checks `--expected-ip`), builds the web UI and validates
   `Backend/deploy/Caddyfile.ready`, but does not activate it.
2. Publish `Frontend/dist` to `/var/www/ticketpro/site` and install the ready
   Caddyfile as `/etc/caddy/Caddyfile`. Serve only built public files, never the
   project directory, `.env`, signing keys or backup folders.
3. Start Caddy and verify a browser-trusted certificate over port 443. Its ACME
   challenge needs public 80/443 reachability. Certificates renew automatically.
4. On the auth host, change `OID4VCI_ISSUER_BASE_URL`, `AUTH_PUBLIC_BASE_URL`
   and `SERVER_BASE_URL` in `.env.auth.runtime` to `https://HOSTNAME`; include
   that web origin in `ALLOWED_ORIGINS`. Restart auth using its existing venv.
   Keep internal Main -> Auth routing and service keys intact.
5. Check issuer metadata, JWKS, login, credential restore, pairing, QR, account
   recovery and payment return URLs using the new address. A fresh login restores
   a credential using the new issuer URL without changing the original NFT wallet.
   Previously issued in-flight offers/proofs may need to be recreated.
6. Verify payment-provider allowed domains/redirect settings for the new origin.
   A trusted HTTPS certificate alone does not configure the payment provider.
7. Enable Caddy at boot after successful checks. Restrict direct API/dev-server
   access only after all clients have switched. No contract redeployment or DB
   reset is needed.

## Free local APK builds

Use a Linux/WSL build machine, not the small EC2 instance. Install JDK and Linux
Android SDK, setting `JAVA_HOME` and `ANDROID_HOME`, or use the user-local tools
under `~/.local/share/ticketpro-android` prepared for this project.

```
python3 Mobile/build/build_apk.py user --public-url https://ticketpro.duckdns.org --version-code 3 --native-jobs 2
python3 Mobile/build/build_apk.py admin --public-url https://ticketpro.duckdns.org --version-code 2
```

The default ABIs cover arm64 phones and x86_64 emulators. For the current HTTP
demo only, pass `--public-url http://YOUR_DEVELOPMENT_HOST:8000 --http-demo`. The generated
network security policy permits HTTP only for that exact API host. HTTPS builds
deny cleartext traffic. This exception does not encrypt HTTP.

Output goes to ignored `artifacts/ticketpro-ROLE-vVERSION.apk`, with SHA-256 and
build metadata in adjacent JSON files. Each APK contains its JavaScript bundle;
it does not need Expo Go, Metro, an ngrok tunnel or a running build computer.
The AWS services and phone internet connection still need to be available.
HTTP demonstration filenames include `-http-demo` before the version. These are
fallback builds; after HTTPS migration, rebuild using the final HTTPS origin.

To retain built APKs on the main host without publishing private files:

```
python3 Backend/deploy/upload_apks.py --main-host SSH_USER@MAIN_HOST --project-root /path/to/checkout --service-user APP_USER --main-key /path/to/main.pem --public-url https://ticketpro.duckdns.org --publish artifacts/ticketpro-user-v3.apk artifacts/ticketpro-admin-v2.apk
```

They are stored in the configured remote checkout under `artifacts/`. After HTTPS APKs are ready, copy
only those public binaries to `/var/www/ticketpro/downloads` for phone downloads.

Signing material is generated outside Git at `~/.local/share/ticketpro-signing`
with private permissions. Keep this directory private and retain it to install
updates over the existing apps. Never publish it in `/downloads`. Changing the
server URL or native permissions requires a new APK build.

Install on the phone by opening its APK and granting the install permission for
the file source, or use `adb install -r FILE.apk` on a connected test device.
Approve the camera permission on first QR use. The two packages are
`com.ticketpro.demo.user` and `com.ticketpro.demo.admin` and can coexist.
Existing Expo Go local wallet storage does not automatically migrate to these
separate apps; log in/import or pair the user app once after installation.

## Verification

Check the APK's package, launcher, camera permission, bundled JS and signature.
On a real phone, test login, secure persistence after app restart, ticket QR,
admin camera scanning, duplicate rejection and pairing deep links. Also test
offline/server-unavailable feedback. Camera and device keystore behavior need
a physical-device acceptance test even after a successful build.

The coordinated SSH deployment helpers target Linux/systemd hosts and require SSH
known_hosts entries and the documented sudo permissions. `--main-python` and
`--auth-python` select relative venv executables. `--main-host-key-alias` (activation)
or `--host-key-alias` (upload) is optional for hosts already known under an alias.
The Caddy template uses the standard `/var/www/ticketpro` public directory and API
port 8000; edit the template for a different Linux web root or upstream port.
For a different origin, also update the public download page and QR/link assets.
