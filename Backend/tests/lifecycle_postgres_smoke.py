"""Run in an isolated PostgreSQL transaction; every test table is TEMPORARY.

Requires TEST_DATABASE_URL. No email, chain transaction or production row is used.
"""
import asyncio
import ast
import hashlib
import os
from datetime import datetime,timedelta,timezone
from types import SimpleNamespace

import psycopg
from psycopg.rows import dict_row
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from account_lifecycle import init_account_lifecycle,install_account_lifecycle
from mobile_transfers import init_mobile_transfers,install_mobile_transfers
from account_main import install_account_main
from account_guard import account_guard
from credential_profile import credential_payload


def run():
    db=psycopg.connect(os.environ['TEST_DATABASE_URL'],row_factory=dict_row,connect_timeout=10)
    owner='0x'+'11'*20;signer='0x'+'22'*20;recipient='0x'+'33'*20
    try:
        db.execute("SET LOCAL statement_timeout='15s'")
        db.execute("CREATE TEMP TABLE issued_vcs(ci_hash TEXT,email TEXT,wallet_address TEXT,issued_at TEXT,expires_at TEXT)")
        db.execute("CREATE TEMP TABLE revoked_vcs(wallet_address TEXT PRIMARY KEY,revoked_at TEXT,reason TEXT)")
        db.execute("CREATE TEMP TABLE mobile_credentials(wallet_address TEXT PRIMARY KEY,ci_hash TEXT,revoked_at TEXT,revoked_reason TEXT,credential_jwt TEXT,email TEXT,parent_wallet_address TEXT,credential_id TEXT,device_name TEXT,issued_at TEXT,expires_at TEXT)")
        db.execute("CREATE TEMP TABLE mobile_pairing_sessions(pairing_id TEXT,token_hash TEXT,ci_hash TEXT,email TEXT,parent_wallet_address TEXT,created_at DOUBLE PRECISION,expires_at DOUBLE PRECISION,used_at DOUBLE PRECISION,mobile_wallet_address TEXT)")
        db.execute("CREATE TEMP TABLE user_login_sessions(wallet_address TEXT,subject_wallet_address TEXT,revoked_at DOUBLE PRECISION,token_hash TEXT,email TEXT,issued_at DOUBLE PRECISION,expires_at DOUBLE PRECISION)")
        db.execute("CREATE TEMP TABLE oid4vci_access_tokens(ci_hash TEXT,used_at DOUBLE PRECISION)")
        db.execute("CREATE TEMP TABLE oid4vci_credential_offers(ci_hash TEXT,used_at DOUBLE PRECISION)")
        db.execute("CREATE TEMP TABLE login_nonces(nonce TEXT,wallet_address TEXT,message TEXT,expires_at DOUBLE PRECISION)")
        db.execute("CREATE TEMP TABLE users(id BIGINT, wallet_address TEXT,status TEXT,password_hash TEXT,private_key_encrypted TEXT)")
        db.execute("CREATE TEMP TABLE booking_items(id BIGINT PRIMARY KEY,token_id BIGINT,seat_code TEXT,owner_wallet_address TEXT,ticket_status TEXT)")
        db.execute("CREATE TEMP TABLE checkout_orders(buyer_wallet_address TEXT,status TEXT)")
        db.execute("CREATE TEMP TABLE blockchain_transactions(buyer_wallet_address TEXT,tx_status TEXT,recipient_wallet_address TEXT)")
        db.execute("CREATE TEMP TABLE wishlist(wallet_address TEXT)")
        db.execute('SET LOCAL search_path=pg_temp')
        class Cursor:
            def execute(self,query,*args):
                return db.execute(query.replace('CREATE TABLE IF NOT EXISTS','CREATE TEMP TABLE IF NOT EXISTS'),*args)
        init_account_lifecycle(Cursor());init_mobile_transfers(Cursor())
        expiry=(datetime.now(timezone.utc)+timedelta(days=30)).isoformat()
        db.execute("INSERT INTO issued_vcs VALUES ('identity','student@pukyong.ac.kr',%s,%s,%s)",(owner,expiry,expiry))
        db.execute("INSERT INTO users VALUES(1,%s,'active','password','encrypted')",(owner,))
        db.execute("INSERT INTO booking_items VALUES(1,1,'A-1',%s,'minted')",(owner,))
        db.execute("INSERT INTO mobile_credentials(wallet_address,ci_hash,credential_jwt) VALUES(%s,'identity','jwt')",(signer,))
        db.execute('INSERT INTO user_login_sessions(wallet_address,subject_wallet_address) VALUES(%s,%s)',(signer,owner))
        db.execute("INSERT INTO oid4vci_access_tokens VALUES('identity',NULL)")
        db.execute("INSERT INTO oid4vci_credential_offers VALUES('identity',NULL)")
        class Connection:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def cursor(self):return db.cursor()
            def execute(self,*args):return db.execute(*args)
            def commit(self):pass
            def close(self):db.execute('SELECT pg_advisory_unlock_all()')
        codes=[]
        g={'get_db_connection':Connection,'CI_SALT':'temporary-test-secret',
           '_extract_bearer_token':lambda request:'test-token',
           'inspect_session':lambda *args:{'active':True,'wallet_address':owner,'signer_wallet_address':owner},
           '_send_oid4vci_tx_code':lambda email,code,*args:codes.append(code),
           '_token_hash':lambda value:hashlib.sha256(value.encode()).hexdigest(),
           'expiry_timestamp':lambda value:datetime.fromisoformat(value).timestamp(),
           '_pairing_qr_base64':lambda uri:'test',
           'AUTH_SERVICE_SETTINGS':SimpleNamespace(accepts=lambda key:key=='main-test'),
           'LoginVerifyRequest':lambda **kw:SimpleNamespace(**kw),'_consume_login_challenge':lambda request,**kwargs:None}
        app=FastAPI();install_account_lifecycle(app,g)
        routes={r.path:r.endpoint for r in app.routes if hasattr(r,'endpoint')}
        from account_lifecycle import RecoveryEmail,RecoveryCode
        tasks=BackgroundTasks()
        first=asyncio.run(routes['/api/account/recovery/request'](RecoveryEmail(email='student@pukyong.ac.kr'),tasks))
        asyncio.run(tasks())
        assert len(codes)==1
        try:asyncio.run(routes['/api/account/recovery/verify'](RecoveryCode(request_id=first['request_id'],code='999999' if codes[0]!='999999' else '000000')))
        except HTTPException as error:assert error.status_code==400
        assert db.execute('SELECT attempts FROM account_recovery_requests').fetchone()['attempts']==1
        grant=asyncio.run(routes['/api/account/recovery/verify'](RecoveryCode(request_id=first['request_id'],code=codes[0])))
        assert grant['pairing_uri'].startswith('ticketprouserapp://')
        assert db.execute('SELECT parent_wallet_address FROM mobile_pairing_sessions').fetchone()['parent_wallet_address']==owner
        try:asyncio.run(routes['/api/account/recovery/verify'](RecoveryCode(request_id=first['request_id'],code=codes[0])))
        except HTTPException as error:assert error.status_code==400
        else:raise AssertionError('Recovery code replay accepted')
        print('POSTGRES recovery code hashing, attempt persistence, one-time grant and NFT-account preservation: PASS',flush=True)
        # Run the real pairing completion function against the temporary schema.
        source=os.environ.get('TICKETPRO_AUTH_TEST_SOURCE')
        if source:
            import secrets,time
            from urllib.parse import parse_qs,urlsplit
            node=next(n for n in ast.parse(source).body if isinstance(n,ast.AsyncFunctionDef) and n.name=='complete_mobile_pairing')
            node.decorator_list=[]
            module=ast.fix_missing_locations(ast.Module(body=[ast.ImportFrom(module='__future__',names=[ast.alias(name='annotations')],level=0),node],type_ignores=[]))
            replacement='0x'+'44'*20
            ns={**g,'time':time,'datetime':datetime,'timedelta':timedelta,'timezone':timezone,'secrets':secrets,'HTTPException':HTTPException,
                'MOBILE_CREDENTIAL_TTL':3600,'LOGIN_SESSION_TTL':300,'OID4VCI_ISSUER_BASE_URL':'https://issuer.test','OID4VCI_ISSUER_KEY_ID':'issuer',
                '_public_key_from_holder_jwk':lambda jwk:SimpleNamespace(to_checksum_address=lambda:replacement),
                '_sign_es256k_jwt':lambda *args:'test-jwt','build_credential_payload':credential_payload,'_record_login_audit':lambda *a,**kw:None}
            exec(compile(module,'auth_server.py','exec'),ns)
            token=parse_qs(urlsplit(grant['pairing_uri']).query)['token'][0]
            proof=SimpleNamespace(wallet_address=replacement,holder_jwk={'kty':'EC','crv':'secp256k1','x':'x','y':'y'},device_name='temporary',pairing_token=token)
            result=asyncio.run(ns['complete_mobile_pairing'](proof))
            assert result['account_wallet_address']==owner
            assert db.execute('SELECT revoked_at FROM mobile_credentials WHERE wallet_address=%s',(signer,)).fetchone()['revoked_at'] is not None
            assert db.execute('SELECT revoked_at FROM mobile_credentials WHERE wallet_address=%s',(replacement,)).fetchone()['revoked_at'] is None
            assert db.execute('SELECT owner_wallet_address FROM booking_items').fetchone()['owner_wallet_address']==owner
            assert db.execute('SELECT count(*) AS n FROM mobile_pairing_sessions WHERE used_at IS NULL').fetchone()['n']==0
            print('POSTGRES real pairing completion, old-key revocation and unchanged NFT account: PASS',flush=True)
        async def verify_account_lock():
            async with account_guard(Connection,[owner]):
                with psycopg.connect(os.environ['TEST_DATABASE_URL'],autocommit=True) as other:
                    assert other.execute('SELECT pg_try_advisory_lock(hashtextextended(%s,0))',('ticketpro-account:'+owner.lower(),)).fetchone()[0] is False
        asyncio.run(verify_account_lock())
        print('POSTGRES account lock excludes independent database connections: PASS',flush=True)
        # A main-server withdrawal must refuse a minted ticket before calling auth.
        async def no_gateway(*args):raise AssertionError('Unexpected auth request')
        class Gateway:
            def call_bytes(self,*args):raise AssertionError('Unexpected auth request')
        main=FastAPI();install_account_main(main,Connection,lambda:owner,Gateway())
        handler=next(r.endpoint for r in main.routes if r.path=='/api/account/withdraw')
        async def receive():return {'type':'http.request','body':b'{}','more_body':False}
        request=Request({'type':'http','headers':[],'method':'POST','path':'/api/account/withdraw','query_string':b''},receive)
        try:asyncio.run(handler(request,account=owner))
        except HTTPException as error:assert error.status_code==409
        else:raise AssertionError('Withdrawal accepted unused ticket')
        db.execute("UPDATE booking_items SET ticket_status='used'")
        db.execute("INSERT INTO blockchain_transactions VALUES(%s,'pending',%s)",(recipient,owner))
        try:asyncio.run(handler(request,account=owner))
        except HTTPException as error:assert error.status_code==409
        else:raise AssertionError('Withdrawal accepted a pending incoming transfer')
        db.execute('DELETE FROM blockchain_transactions')
        request=Request({'type':'http','headers':[(b'x-service-key',b'main-test')],'method':'POST','path':'/api/account/withdraw','query_string':b''})
        asyncio.run(routes['/api/account/withdraw'](request,{'wallet_address':owner,'message':'TicketPro 회원탈퇴\n','nonce':'test','signature':'test'}))
        assert db.execute('SELECT count(*) AS n FROM user_login_sessions WHERE revoked_at IS NULL').fetchone()['n']==0
        assert db.execute('SELECT revoked_at FROM mobile_credentials').fetchone()['revoked_at'] is not None
        assert db.execute('SELECT count(*) AS n FROM booking_items').fetchone()['n']==1
        print('POSTGRES unused-ticket protection and auth revocation without ledger deletion: PASS',flush=True)
    finally:
        db.rollback();db.close()
        print('POSTGRES test transaction rolled back; no production rows modified',flush=True)


if __name__=='__main__':run()
