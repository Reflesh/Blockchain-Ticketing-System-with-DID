"""Account recovery preserves the NFT account; it only replaces a mobile signer."""
import hashlib
import hmac
import logging
import secrets
import time
from datetime import datetime, timezone
from fastapi import BackgroundTasks, Body, HTTPException, Request, Response
from pydantic import BaseModel, Field
try:
    from .credential_profile import credential_payload
except ImportError:
    from credential_profile import credential_payload


def init_account_lifecycle(cursor):
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS account_recovery_requests (
            request_id TEXT PRIMARY KEY, email TEXT NOT NULL,
            code_hash TEXT NOT NULL, issued_at DOUBLE PRECISION NOT NULL,
            expires_at DOUBLE PRECISION NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
            used_at DOUBLE PRECISION
        )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS account_recovery_email_idx ON account_recovery_requests(email, issued_at)")


def recovery_code_hash(request_id, code, secret):
    return hmac.new(secret.encode(), f"{request_id}:{code}".encode(), hashlib.sha256).hexdigest()


class RecoveryEmail(BaseModel):
    email: str = Field(min_length=3, max_length=254)


class RecoveryCode(BaseModel):
    request_id: str = Field(min_length=16, max_length=128)
    code: str = Field(pattern=r"^\d{6}$")


def install_account_lifecycle(app, g):
    connection = g['get_db_connection']

    def session(request):
        token = g['_extract_bearer_token'](request)
        result = g['inspect_session'](connection, token, time.time()) if token else {}
        if not result.get('active'):
            raise HTTPException(401, '로그인이 필요하거나 세션이 만료되었습니다.')
        return result

    @app.get('/api/account/credential', summary='본인 원본 학생 인증서 정보')
    def credential_summary(request: Request, response: Response):
        identity = session(request)
        account = identity['wallet_address']
        with connection() as db:
            with db.cursor() as cur:
                cur.execute('''SELECT credential.issued_at, credential.expires_at, revoked.revoked_at
                    FROM issued_vcs credential LEFT JOIN revoked_vcs revoked
                    ON LOWER(revoked.wallet_address)=LOWER(credential.wallet_address)
                    WHERE LOWER(credential.wallet_address)=LOWER(%s)''', (account,))
                credential = cur.fetchone()

        def normalize(value):
            try:
                date = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace('Z', '+00:00'))
                if date.tzinfo is None:
                    date = date.replace(tzinfo=timezone.utc)
                return date.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')
            except (TypeError, ValueError, OverflowError):
                return None

        issued_at = normalize(credential['issued_at']) if credential else None
        expires_at = normalize(credential['expires_at']) if credential else None
        if not credential:
            status = 'not_issued'
        elif credential['revoked_at'] is not None:
            status = 'revoked'
        elif not expires_at:
            status = 'unknown'
        elif datetime.fromisoformat(expires_at.replace('Z', '+00:00')) <= datetime.now(timezone.utc):
            status = 'expired'
        else:
            status = 'active'
        response.headers['Cache-Control'] = 'no-store'
        return {'data': {'wallet_address': account, 'credential_type': 'PukyongStudentCredential',
                         'issued_at': issued_at, 'expires_at': expires_at, 'status': status}}

    @app.post('/api/account/recovery/request')
    async def request_recovery(body: RecoveryEmail, background_tasks: BackgroundTasks):
        email = body.email.strip().lower()
        if not email.endswith('@pukyong.ac.kr') or any(c.isspace() for c in email):
            raise HTTPException(400, '부경대학교 이메일 주소를 입력해주세요.')
        now = time.time()
        request_id, code = secrets.token_urlsafe(24), f'{secrets.randbelow(1000000):06d}'
        with connection() as db:
            with db.cursor() as cur:
                # Serialize cooldown checks across workers without leaking account existence.
                cur.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))', ('account-recovery:'+email,))
                cur.execute('SELECT issued_at FROM account_recovery_requests WHERE email=%s ORDER BY issued_at DESC LIMIT 1', (email,))
                previous = cur.fetchone()
                if previous and now - previous['issued_at'] < 60:
                    raise HTTPException(429, '인증번호는 60초 후 다시 요청해주세요.')
                cur.execute("""SELECT v.wallet_address, v.expires_at, r.wallet_address AS revoked
                    FROM issued_vcs v LEFT JOIN revoked_vcs r
                    ON LOWER(r.wallet_address)=LOWER(v.wallet_address) WHERE LOWER(v.email)=%s FOR UPDATE OF v""", (email,))
                account = cur.fetchone()
                eligible = bool(account and not account['revoked'] and (g['expiry_timestamp'](account['expires_at']) or 0) > now)
                cur.execute('UPDATE account_recovery_requests SET used_at=%s WHERE email=%s AND used_at IS NULL', (now,email))
                cur.execute("""INSERT INTO account_recovery_requests
                    (request_id,email,code_hash,issued_at,expires_at)
                    VALUES (%s,%s,%s,%s,%s)""", (request_id,email,recovery_code_hash(request_id,code,g['CI_SALT']),now,now+180))
            db.commit()
        def deliver_code():
            try:
                g['_send_oid4vci_tx_code'](email, code, 'recovery')
            except Exception:
                with connection() as db:
                    db.execute('UPDATE account_recovery_requests SET used_at=%s WHERE request_id=%s AND used_at IS NULL',(time.time(),request_id))
                logging.getLogger('ticketpro.auth').warning('계정 복구 인증 메일 발송 실패')
        if eligible:
            # Return the request identifier before SMTP, avoiding gateway timeouts.
            background_tasks.add_task(deliver_code)
        return {'request_id':request_id,'expires_in':180,'message':'복구 가능한 계정이면 인증번호가 발송됩니다.'}

    @app.post('/api/account/recovery/verify')
    async def verify_recovery(body: RecoveryCode):
        now=time.time(); failure=None
        with connection() as db:
            with db.cursor() as cur:
                # Read the email, then lock parent -> grant consistently with pairing/withdrawal.
                cur.execute('SELECT email FROM account_recovery_requests WHERE request_id=%s',(body.request_id,))
                hint=cur.fetchone()
                if not hint:raise HTTPException(400,'인증 요청을 찾을 수 없습니다.')
                cur.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))',('account-recovery:'+hint['email'],))
                cur.execute('SELECT ci_hash FROM issued_vcs WHERE LOWER(email)=%s FOR UPDATE',(hint['email'],))
                cur.execute('SELECT * FROM account_recovery_requests WHERE request_id=%s FOR UPDATE',(body.request_id,))
                row=cur.fetchone()
                if not row or row['used_at'] is not None or row['expires_at']<=now or row['attempts']>=5:
                    failure='인증 요청이 만료되었거나 사용되었습니다. 새 번호를 요청해주세요.'
                elif not hmac.compare_digest(row['code_hash'],recovery_code_hash(body.request_id,body.code,g['CI_SALT'])):
                    cur.execute('UPDATE account_recovery_requests SET attempts=attempts+1 WHERE request_id=%s',(body.request_id,))
                    failure='인증번호가 올바르지 않습니다. 5회 실패하면 새 번호가 필요합니다.'
                else:
                    cur.execute("""SELECT v.*,r.wallet_address AS revoked FROM issued_vcs v
                        LEFT JOIN revoked_vcs r ON LOWER(r.wallet_address)=LOWER(v.wallet_address)
                        WHERE LOWER(v.email)=%s FOR UPDATE OF v""",(row['email'],))
                    account=cur.fetchone()
                    if not account or account['revoked'] or (g['expiry_timestamp'](account['expires_at']) or 0)<=now:
                        failure='유효한 계정을 복구할 수 없습니다.'
                    else:
                        token=secrets.token_urlsafe(40); pairing_id=secrets.token_urlsafe(18)
                        cur.execute('UPDATE mobile_pairing_sessions SET used_at=%s WHERE ci_hash=%s AND used_at IS NULL',(now,account['ci_hash']))
                        cur.execute('UPDATE account_recovery_requests SET used_at=%s WHERE request_id=%s',(now,body.request_id))
                        cur.execute("""INSERT INTO mobile_pairing_sessions
                            (pairing_id,token_hash,ci_hash,email,parent_wallet_address,created_at,expires_at)
                            VALUES (%s,%s,%s,%s,%s,%s,%s)""",(pairing_id,g['_token_hash'](token),account['ci_hash'],account['email'],account['wallet_address'],now,now+180))
                        # Issue the grant first; old devices are revoked only after replacement succeeds.
                        cur.execute("UPDATE account_recovery_requests SET code_hash=%s WHERE request_id=%s",('grant:'+pairing_id,body.request_id))
            db.commit()
        if failure:raise HTTPException(400,failure)
        uri=f'ticketprouserapp://mobile-pairing?token={token}'
        return {'pairing_uri':uri,'qr_png_base64':g['_pairing_qr_base64'](uri),'expires_in':180}

    @app.post('/api/account/credential')
    async def restore_credential(request: Request, body: dict = Body(...)):
        identity=session(request)
        jwk=body.get('holder_jwk',{})
        pub=g['_public_key_from_holder_jwk'](jwk)
        signer=identity['signer_wallet_address']; account=identity['wallet_address']
        if pub.to_checksum_address().lower()!=signer.lower():
            raise HTTPException(403,'로그인 지갑과 공개키가 일치하지 않습니다.')
        with connection() as db:
            with db.cursor() as cur:
                if signer.lower()!=account.lower():
                    cur.execute('SELECT credential_id,issued_at,expires_at FROM mobile_credentials WHERE LOWER(wallet_address)=LOWER(%s) AND LOWER(parent_wallet_address)=LOWER(%s) AND revoked_at IS NULL',(signer,account))
                    row=cur.fetchone()
                    if not row:raise HTTPException(403,'모바일 연결이 해제되었습니다.')
                    configuration='TicketProMobileCredential'
                else:
                    cur.execute('SELECT issued_at,expires_at FROM issued_vcs WHERE LOWER(wallet_address)=LOWER(%s)',(account,))
                    row=cur.fetchone()
                    if not row:raise HTTPException(403,'유효한 학생 인증서가 없습니다.')
                    configuration='PukyongStudentCredential'
                expiry=g['expiry_timestamp'](row['expires_at'])
                if not expiry or expiry<=time.time():raise HTTPException(403,'학생 인증서가 만료되었습니다.')
                payload=credential_payload(g['OID4VCI_ISSUER_BASE_URL'],signer,jwk,configuration,
                    row.get('credential_id') or 'urn:uuid:'+secrets.token_hex(16),
                    g['expiry_timestamp'](row['issued_at']),expiry,account)
                credential=g['_sign_es256k_jwt']({'alg':'ES256K','typ':'JWT','kid':g['OID4VCI_ISSUER_KEY_ID']},payload)
        return {'credential':credential,'issuer':g['OID4VCI_ISSUER_BASE_URL'],
                'jwks_uri':g['OID4VCI_ISSUER_BASE_URL']+'/.well-known/jwks.json',
                'credential_configuration_id':configuration,'account_wallet_address':account}

    @app.post('/api/account/withdraw/challenge')
    async def withdraw_challenge(request: Request):
        identity=session(request)
        return g['_create_wallet_challenge']('withdraw', identity['signer_wallet_address'], identity['wallet_address'])

    @app.post('/api/account/withdraw')
    async def withdraw(request: Request, body: dict=Body(...)):
        if not g['AUTH_SERVICE_SETTINGS'].accepts(request.headers.get('x-service-key')):
            raise HTTPException(403,'메인 서버를 통해 회원탈퇴를 요청해주세요.')
        identity=session(request)
        try:proof=g['LoginVerifyRequest'](**body)
        except Exception:raise HTTPException(422,'탈퇴 서명 요청 형식이 올바르지 않습니다.') from None
        if not isinstance(proof.wallet_address, str) or proof.wallet_address.lower()!=identity['signer_wallet_address'].lower():
            raise HTTPException(403,'회원탈퇴 서명을 확인해주세요.')
        g['_consume_login_challenge'](proof, purpose='withdraw', account=identity['wallet_address'])
        now=time.time();stamp=datetime.now(timezone.utc).isoformat();account=identity['wallet_address']
        with connection() as db:
            with db.cursor() as cur:
                cur.execute('SELECT ci_hash FROM issued_vcs WHERE LOWER(wallet_address)=LOWER(%s) FOR UPDATE',(account,))
                credential=cur.fetchone()
                if not credential:raise HTTPException(404,'탈퇴할 계정이 없습니다.')
                session(request)
                cur.execute("INSERT INTO revoked_vcs(wallet_address,revoked_at,reason) VALUES (%s,%s,'회원탈퇴') ON CONFLICT(wallet_address) DO UPDATE SET revoked_at=EXCLUDED.revoked_at,reason=EXCLUDED.reason",(account,stamp))
                cur.execute("UPDATE mobile_credentials SET revoked_at=%s,revoked_reason='회원탈퇴' WHERE ci_hash=%s AND revoked_at IS NULL",(stamp,credential['ci_hash']))
                cur.execute("UPDATE mobile_pairing_sessions SET used_at=%s WHERE ci_hash=%s AND used_at IS NULL",(now,credential['ci_hash']))
                cur.execute('UPDATE account_recovery_requests SET used_at=%s WHERE LOWER(email) IN (SELECT LOWER(email) FROM issued_vcs WHERE ci_hash=%s) AND used_at IS NULL',(now,credential['ci_hash']))
                cur.execute("UPDATE oid4vci_access_tokens SET used_at=%s WHERE ci_hash=%s AND used_at IS NULL",(now,credential['ci_hash']))
                cur.execute("UPDATE oid4vci_credential_offers SET used_at=%s WHERE ci_hash=%s AND used_at IS NULL",(now,credential['ci_hash']))
                cur.execute('UPDATE user_login_sessions SET revoked_at=%s WHERE (LOWER(wallet_address)=LOWER(%s) OR LOWER(subject_wallet_address)=LOWER(%s)) AND revoked_at IS NULL',(now,account,account))
        return {'status':'success','message':'회원탈퇴가 완료되었습니다. 예매·검표 이력과 블록체인 기록은 보존됩니다.'}
