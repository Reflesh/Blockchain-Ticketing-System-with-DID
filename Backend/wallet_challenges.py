"""Domain-, account- and purpose-bound wallet proofs shared by auth routes."""
import json
from fastapi import HTTPException

ACTIONS = {'login': 'ticketpro_login', 'pairing': 'ticketpro_pairing', 'withdraw': 'ticketpro_withdraw'}


def challenge_message(purpose, wallet, nonce, domain, issued_at, expires_at, account=None):
    payload = {'action': ACTIONS[purpose], 'wallet_address': wallet, 'nonce': nonce,
               'domain': domain, 'issued_at': int(issued_at), 'expires_at': int(expires_at)}
    if account is not None:
        payload['account_wallet_address'] = account
    return json.dumps(payload, separators=(',', ':'), ensure_ascii=False)


def validate_challenge(request, purpose, domain, now, account=None):
    try:
        data = json.loads(request.message)
        if not isinstance(data, dict):raise ValueError
        if data['action'] != ACTIONS[purpose] or data['domain'] != domain or data['nonce'] != request.nonce:raise ValueError
        if not isinstance(data['wallet_address'],str) or data['wallet_address'].lower()!=request.wallet_address.lower():raise ValueError
        if type(data['issued_at']) is not int or type(data['expires_at']) is not int:raise ValueError
        if data['issued_at']>now+5 or now>=data['expires_at'] or not 0<data['expires_at']-data['issued_at']<=600:raise ValueError
        if account is not None:
            if not isinstance(data.get('account_wallet_address'),str) or data['account_wallet_address'].lower()!=account.lower():raise ValueError
    except (ValueError, TypeError, KeyError, AttributeError):
        raise HTTPException(401, '서명의 목적·계정·도메인 또는 유효시간이 일치하지 않습니다.') from None
