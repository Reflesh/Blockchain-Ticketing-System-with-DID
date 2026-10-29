// Run: node tests/session-regression.cjs (uses the app's existing dependencies).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { ethers } = require('ethers');

function load(name, stubs, globals = {}) {
  const filename = path.join(__dirname, '../lib', name + '.ts');
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  const context = { module, exports: module.exports, require: n => n in stubs ? stubs[n] : require(n), console, Uint8Array, Headers, Response, AbortController, setTimeout, clearTimeout, __DEV__: true, ...globals };
  vm.runInNewContext(source, context, { filename });
  return module.exports;
}

async function main() {
  const signer = ethers.Wallet.createRandom();
  const data = new Map();
  const secureStore = { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'this-device', isAvailableAsync: async () => true, setItemAsync: async (k, v) => data.set(k, v), getItemAsync: async k => data.get(k) ?? null, deleteItemAsync: async k => data.delete(k) };
  let credentials = [];
  const secure = load('secureSession', { 'expo-secure-store': secureStore, '@/lib/oid4vci': { loadCredentials: async () => credentials } });
  await assert.rejects(() => secure.saveSecureSession(signer, 'token', signer.address), /학생 인증서/);
  credentials = [{ credentialConfigurationId: 'PukyongStudentCredential', subject: `did:pknu:${signer.address}`, expiresAt: Math.floor(Date.now() / 1000) + 3600 }];
  assert.equal(await secure.saveSecureSession(signer, 'token', signer.address), true);
  credentials = [];
  assert.equal((await secure.loadSecureSession()).wallet.address, signer.address, 'Missing local VC must not erase recoverable secure session');
  assert.equal(data.size, 1);
  credentials = [{ credentialConfigurationId: 'TicketProMobileCredential', subject: `did:pknu:${signer.address}`, expiresAt: Math.floor(Date.now() / 1000) + 3600 }];
  assert.equal(await secure.saveSecureSession(signer, 'mobile-token', signer.address), true);
  credentials[0].expiresAt = 0;
  await assert.rejects(() => secure.saveSecureSession(signer, 'token', signer.address), /학생 인증서/);
  secureStore.setItemAsync = async () => { throw new Error('Secure storage full'); };
  credentials[0].expiresAt = Math.floor(Date.now() / 1000) + 3600;
  await assert.rejects(() => secure.saveSecureSession(signer, 'token', signer.address), /Secure storage full/);

  const calls = [];
  let currentToken = 'old';
  let renews = 0;
  const transport = load('sessionTransport', {}, { fetch: async (url, init) => {
    const token = init.headers.get('Authorization'); calls.push(token);
    return new Response('{}', { status: token === 'Bearer old' ? 401 : 200 });
  } });
  const dispose = transport.installSessionTransport({ token: () => currentToken, renew: async () => { renews++; currentToken = 'new'; return currentToken; } });
  assert.equal((await transport.authenticatedFetch('https://ticket.example/profile', { headers: { Authorization: 'Bearer old' } })).status, 200);
  assert.deepEqual(calls, ['Bearer old', 'Bearer new']);
  assert.equal(renews, 1);
  calls.length = 0;
  assert.equal((await transport.authenticatedFetch('https://ticket.example/profile', { headers: { Authorization: 'Bearer stale-component-token' } })).status, 200);
  assert.deepEqual(calls, ['Bearer new']);
  dispose();
  let logoutToken='old'; let logoutCalls=0;
  const loggedOut=load('sessionTransport',{}, {fetch:async()=>{logoutCalls++;return new Response('{}',{status:401});}});
  loggedOut.installSessionTransport({token:()=>logoutToken,renew:async()=>{logoutToken=null;return 'stale-renewal';}});
  await assert.rejects(()=>loggedOut.authenticatedFetch('https://ticket.example/profile',{headers:{Authorization:'Bearer old'}}),/로그인 상태/);
  assert.equal(logoutCalls,1,'Logout during renewal must never replay the request');
  await assert.rejects(()=>loggedOut.authenticatedFetch('https://ticket.example/profile',{headers:{Authorization:'Bearer old'}}),/로그인/);
  assert.equal(logoutCalls,1,'Logout must block stale components before sending their bearer token');
  let wrongRetry = 0;
  const unavailable = load('sessionTransport', {}, { fetch: async () => new Response('{}', { status: 503 }) });
  unavailable.installSessionTransport({ token: () => 'token', renew: async () => { wrongRetry++; return 'token'; } });
  assert.equal((await unavailable.authenticatedFetch('https://ticket.example/profile', { headers: { Authorization: 'Bearer token' } })).status, 503);
  assert.equal(wrongRetry, 0, 'Network/server failures must not trigger reauthentication');
  const local = new Map();
  let failWalletCommit = false;
  const storage = { getItem: async k => local.get(k) ?? null, setItem: async (k, v) => {
    if (failWalletCommit && k.includes('encrypted-wallet')) throw new Error('Storage unavailable');
    local.set(k, v);
  }, removeItem: async k => local.delete(k), multiRemove: async list => list.forEach(k => local.delete(k)) };
  const oid = load('oid4vci', { '@/constants/api': {AUTH_API_URL:'https://ticket.example/api'}, '@react-native-async-storage/async-storage': { default: storage }, '@/lib/requestTimeout': { fetchWithTimeout: async () => { throw new Error('Unexpected network call'); } } });
  const next = ethers.Wallet.createRandom();
  await oid.saveLocalWalletPassword(signer, 'old-password');
  const originalEncrypted = [...local.values()][0];
  await oid.prepareReplacementWallet(next, 'new-password');
  assert.ok([...local.values()].includes(originalEncrypted), 'Recovery must preserve the old encrypted key before completion');
  assert.equal((await oid.unlockLocalEncryptedWallet('new-password')).address, next.address);
  assert.equal((await oid.unlockLocalEncryptedWallet('old-password')).address, signer.address);
  failWalletCommit = true;
  await assert.rejects(() => oid.finalizeReplacementWallet(next), /Storage unavailable/);
  assert.equal((await oid.unlockLocalEncryptedWallet('new-password')).address, next.address, 'Replacement remains recoverable after a failed local commit');
  failWalletCommit = false;
  await oid.finalizeReplacementWallet(next);
  assert.equal(local.size, 1);
  assert.equal((await oid.unlockLocalEncryptedWallet('new-password')).address, next.address);
  local.set('ticketpro.oid4vci.credentials.v1', '{broken');
  await assert.rejects(() => oid.loadCredentials(), /인증서/);
  const issuer=ethers.Wallet.createRandom();
  const issuerKey=ethers.SigningKey.computePublicKey(issuer.privateKey,false).slice(4);
  const jwk={kty:'EC',crv:'secp256k1',alg:'ES256K',kid:'issuer',x:Buffer.from(issuerKey.slice(0,64),'hex').toString('base64url'),y:Buffer.from(issuerKey.slice(64),'hex').toString('base64url')};
  let credentialStatus='active';
  const verifier=load('oid4vci',{'@react-native-async-storage/async-storage':{default:storage},'@/constants/api':{AUTH_API_URL:'https://ticket.example/api'},'@/lib/requestTimeout':{fetchWithTimeout:async url=>new Response(JSON.stringify(url.includes('jwks')?{keys:[jwk]}:{status:credentialStatus}))}});
  const now=Math.floor(Date.now()/1000), subject=`did:pknu:${signer.address}`, account=next.address;
  const payload={iss:'https://issuer.example',sub:subject,iat:now,nbf:now,exp:now+3600,jti:'urn:uuid:test',cnf:{jwk:verifier.walletPublicJwk(signer)},vc:{'@context':['https://www.w3.org/2018/credentials/v1'],id:'urn:uuid:test',type:['VerifiableCredential','TicketProMobileCredential'],issuer:'https://issuer.example',issuanceDate:new Date(now*1000).toISOString(),expirationDate:new Date((now+3600)*1000).toISOString(),credentialSubject:{id:subject,account:`did:pknu:${account}`,authorization:'mobile_login'},credentialStatus:{type:'TicketProCredentialStatus',id:`https://issuer.example/api/status/${signer.address}`}}};
  function sign(value){const input=[{alg:'ES256K',typ:'JWT',kid:'issuer'},value].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');const signature=new ethers.SigningKey(issuer.privateKey).sign(ethers.sha256(ethers.toUtf8Bytes(input)));return input+'.'+Buffer.from(ethers.getBytes(ethers.concat([signature.r,signature.s]))).toString('base64url');}
  const verify=value=>verifier.verifyAndStoreCredential(sign(value),'https://issuer.example',signer,'https://issuer.example/jwks','TicketProMobileCredential',account);
  assert.equal((await verify(payload)).subject,subject,'Valid issuer signature and account-bound VC must restore');
  for(const mutate of [v=>delete v.exp,v=>delete v.vc['@context'],v=>v.sub=`did:pknu:${account}`,v=>v.vc.credentialSubject.account=subject,v=>v.nbf=now+500,v=>v.vc.type=['VerifiableCredential']]){const altered=structuredClone(payload);mutate(altered);await assert.rejects(()=>verify(altered));}
  credentialStatus='revoked';await assert.rejects(()=>verify(payload),/폐기/);
  await assert.rejects(()=>verifier.verifyAndStoreCredential(sign(payload)+'.extra','https://issuer.example',signer,'https://issuer.example/jwks','TicketProMobileCredential',account),/형식/);
  console.log('PASS: primary/mobile credential persistence, missing-VC session preservation, expiry, storage failure, 401 renewal, stale-token handling, durable wallet replacement and malformed-credential detection');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
