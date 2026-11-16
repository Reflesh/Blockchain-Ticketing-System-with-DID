"""Service profiles derived from identities already verified by the issuer."""
import re

class ProfileRestrictedError(ValueError):
    pass

def sync_verified_user(cursor, wallet_address, verified_email):
    if not isinstance(wallet_address, str) or not re.fullmatch(r'0x[0-9a-fA-F]{40}', wallet_address):
        raise ValueError('Invalid verified wallet')
    cursor.execute("SELECT pg_advisory_xact_lock(hashtext('ticketpro.profile-sync'))")
    cursor.execute('SELECT wallet_address,username,status FROM users WHERE LOWER(wallet_address)=LOWER(%s) FOR UPDATE', (wallet_address,))
    existing = cursor.fetchone()
    if existing:
        if existing['status'] != 'active':
            raise ProfileRestrictedError('이용이 제한된 계정입니다. 관리자에게 문의해주세요.')
        wallet_address = existing['wallet_address']
    username = (existing or {}).get('username')
    if not username or not username.strip():
        email = verified_email.strip().lower() if isinstance(verified_email, str) else ''
        prefix = email.split('@', 1)[0] if '@' in email else ''
        base = prefix if prefix and len(prefix) <= 80 else 'ticketpro_' + wallet_address[2:6].lower() + wallet_address[-4:].lower()
        username = base
        suffix = 0
        while True:
            cursor.execute('SELECT 1 FROM users WHERE LOWER(wallet_address)<>LOWER(%s) AND (TRIM(username)=%s OR TRIM(real_name)=%s)', (wallet_address, username, username))
            if not cursor.fetchone():
                break
            suffix += 1
            username = f'{base}_{suffix}'
    cursor.execute("""INSERT INTO users(username,wallet_address,auth_provider,verification_status,status)
        VALUES(%s,%s,'did_keystore','verified','active')
        ON CONFLICT(wallet_address) DO UPDATE SET
          username=EXCLUDED.username,auth_provider=EXCLUDED.auth_provider,
          verification_status=EXCLUDED.verification_status
        RETURNING username,wallet_address,auth_provider,verification_status,status""", (username, wallet_address))
    return cursor.fetchone()
