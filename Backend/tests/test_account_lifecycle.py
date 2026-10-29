import hashlib
import time
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI, HTTPException
from wallet_challenges import challenge_message, validate_challenge
from fastapi.testclient import TestClient
from eth_account import Account
from eth_keys import keys
from account_lifecycle import install_account_lifecycle, recovery_code_hash
from account_main import install_account_main
from mobile_transfers import install_mobile_transfers, TransferIntent, TransferApproval


OWNER = Account.create().address
SIGNER = Account.create().address
RECIPIENT = Account.create().address


def database(rows):
    cursor = MagicMock()
    cursor.__enter__.return_value = cursor
    queued=iter(rows)
    def fetchone():
        if cursor.execute.call_args and 'SELECT status FROM users' in cursor.execute.call_args.args[0]:return {'status':'active'}
        if cursor.execute.call_args and 'SELECT email FROM account_recovery_requests' in cursor.execute.call_args.args[0]:return {'email':'student@pukyong.ac.kr'}
        return next(queued)
    cursor.fetchone.side_effect = fetchone
    db = MagicMock()
    db.__enter__.return_value = db
    db.cursor.return_value = cursor
    return MagicMock(return_value=db), db, cursor


def lifecycle(rows, active=True, mobile=False):
    connection, db, cursor = database(rows)
    signer = SIGNER if mobile else OWNER
    g = {'get_db_connection': connection, 'CI_SALT': 'test-only-secret',
         'inspect_session': MagicMock(return_value={'active':active,'wallet_address':OWNER,'signer_wallet_address':signer}),
         '_extract_bearer_token': lambda r: r.headers.get('authorization',''),
         '_token_hash': lambda t: hashlib.sha256(t.encode()).hexdigest(),
         'expiry_timestamp': lambda text: datetime.fromisoformat(text).timestamp(),
         '_send_oid4vci_tx_code': MagicMock(), '_pairing_qr_base64': lambda uri:'test-qr',
         'OID4VCI_ISSUER_BASE_URL': 'https://issuer.example',
         'OID4VCI_ISSUER_KEY_ID':'issuer-key', '_sign_es256k_jwt': MagicMock(return_value='signed.jwt.credential'),
         '_public_key_from_holder_jwk': MagicMock(),
         '_consume_login_challenge': MagicMock(side_effect=lambda proof,purpose,account:validate_challenge(proof,purpose,'test-domain',time.time(),account)),
         'AUTH_SERVICE_SETTINGS': SimpleNamespace(accepts=lambda s:s=='trusted-main'),
         'LoginVerifyRequest': lambda **kw:SimpleNamespace(**kw)}
    app=FastAPI();install_account_lifecycle(app,g)
    return TestClient(app,headers={'Authorization':'Bearer test-session'}),g,db,cursor


def account():
    return {'wallet_address':OWNER,'ci_hash':'identity','email':'student@pukyong.ac.kr','revoked':None,'expires_at':(datetime.now(timezone.utc)+timedelta(days=30)).isoformat()}


def test_recovery_requires_university_email():
    client,g,_,_=lifecycle([])
    assert client.post('/api/account/recovery/request',json={'email':'attacker@example.com'}).status_code==400
    g['get_db_connection'].assert_not_called()


@pytest.mark.parametrize('exists',[True,False])
def test_recovery_request_does_not_disclose_account_existence(exists):
    client,g,_,cur=lifecycle([None,account() if exists else None])
    result=client.post('/api/account/recovery/request',json={'email':'student@pukyong.ac.kr'})
    assert result.status_code==200
    assert set(result.json())=={'request_id','expires_in','message'}
    assert g['_send_oid4vci_tx_code'].call_count==int(exists)
    if exists:
        code=g['_send_oid4vci_tx_code'].call_args.args[1]
        insert=next(call for call in cur.execute.call_args_list if 'INSERT INTO account_recovery_requests' in call.args[0])
        assert insert.args[1][2]==recovery_code_hash(result.json()['request_id'],code,g['CI_SALT'])
        assert code not in insert.args[1]


def test_recovery_cooldown_is_enforced():
    client,g,_,_=lifecycle([{'issued_at':time.time()}])
    assert client.post('/api/account/recovery/request',json={'email':'student@pukyong.ac.kr'}).status_code==429
    g['_send_oid4vci_tx_code'].assert_not_called()


def test_mail_failure_invalidates_the_code_without_exposing_account_existence():
    client,g,db,_=lifecycle([None,account()])
    g['_send_oid4vci_tx_code'].side_effect=RuntimeError('SMTP unavailable')
    assert client.post('/api/account/recovery/request',json={'email':'student@pukyong.ac.kr'}).status_code==200
    assert 'used_at' in db.execute.call_args.args[0]


def request_row(**updates):
    row={'request_id':'r'*32,'email':'student@pukyong.ac.kr','used_at':None,'expires_at':time.time()+180,'attempts':0,'code_hash':recovery_code_hash('r'*32,'123456','test-only-secret')}
    return {**row,**updates}


def test_wrong_recovery_code_commits_attempt_count():
    client,_,db,cur=lifecycle([request_row()])
    assert client.post('/api/account/recovery/verify',json={'request_id':'r'*32,'code':'000000'}).status_code==400
    assert any('attempts=attempts+1' in c.args[0] for c in cur.execute.call_args_list)
    db.commit.assert_called_once()


@pytest.mark.parametrize('updates',[{'used_at':1},{'expires_at':0},{'attempts':5}])
def test_recovery_replay_expiry_and_attempt_limit(updates):
    client,_,_,cur=lifecycle([request_row(**updates)])
    assert client.post('/api/account/recovery/verify',json={'request_id':'r'*32,'code':'123456'}).status_code==400
    assert not any('INSERT INTO mobile_pairing_sessions' in c.args[0] for c in cur.execute.call_args_list)


def test_email_recovery_grant_preserves_nft_account():
    client,_,_,cur=lifecycle([request_row(),account()])
    response=client.post('/api/account/recovery/verify',json={'request_id':'r'*32,'code':'123456'})
    assert response.status_code==200
    assert response.json()['pairing_uri'].startswith('ticketprouserapp://mobile-pairing?token=')
    insert=next(c for c in cur.execute.call_args_list if 'INSERT INTO mobile_pairing_sessions' in c.args[0])
    assert insert.args[1][4]==OWNER
    assert not any('UPDATE issued_vcs' in c.args[0] or 'UPDATE booking_items' in c.args[0] for c in cur.execute.call_args_list)


def test_credential_restore_requires_active_session():
    client,_,_,_=lifecycle([],active=False)
    assert client.post('/api/account/credential',json={'holder_jwk':{}}).status_code==401


def test_credential_restore_rejects_different_holder_key():
    client,g,_,_=lifecycle([])
    g['_public_key_from_holder_jwk'].return_value=SimpleNamespace(to_checksum_address=lambda:RECIPIENT)
    assert client.post('/api/account/credential',json={'holder_jwk':{}}).status_code==403


def test_mobile_credential_can_be_restored_without_a_local_copy():
    client,g,_,_=lifecycle([{'credential_id':'urn:test:mobile','issued_at':datetime.now(timezone.utc).isoformat(),'expires_at':account()['expires_at']}],mobile=True)
    g['_public_key_from_holder_jwk'].return_value=SimpleNamespace(to_checksum_address=lambda:SIGNER)
    response=client.post('/api/account/credential',json={'holder_jwk':{'kty':'EC','crv':'secp256k1','x':'test','y':'test'}})
    assert response.status_code==200
    assert response.json()['credential']=='signed.jwt.credential'
    assert g['_sign_es256k_jwt'].call_args.args[1]['vc']['credentialSubject']['account']==f'did:pknu:{OWNER}'
    assert response.json()['credential_configuration_id']=='TicketProMobileCredential'


def test_primary_wallet_can_restore_a_bound_student_credential():
    client,g,_,_=lifecycle([{'issued_at':datetime.now(timezone.utc).isoformat(),'expires_at':account()['expires_at']}])
    g['_public_key_from_holder_jwk'].return_value=SimpleNamespace(to_checksum_address=lambda:OWNER)
    jwk={'kty':'EC','crv':'secp256k1','x':'test','y':'test'}
    response=client.post('/api/account/credential',json={'holder_jwk':jwk})
    assert response.status_code==200
    payload=g['_sign_es256k_jwt'].call_args.args[1]
    assert payload['sub']==f'did:pknu:{OWNER}' and payload['cnf']['jwk']==jwk


def test_missing_bearer_does_not_restore_a_credential():
    client,g,_,_=lifecycle([])
    client.headers.pop('Authorization')
    assert client.post('/api/account/credential',json={'holder_jwk':{}}).status_code==401
    g['_public_key_from_holder_jwk'].assert_not_called()


def test_auth_withdrawal_cannot_bypass_main_ticket_checks():
    client,g,_,_=lifecycle([])
    result=client.post('/api/account/withdraw',json={})
    assert result.status_code==403
    g['_consume_login_challenge'].assert_not_called()


def test_withdrawal_requires_an_action_specific_signature():
    client,g,_,_=lifecycle([])
    result=client.post('/api/account/withdraw',headers={'X-Service-Key':'trusted-main'},json={'wallet_address':OWNER,'message':'ordinary login'})
    assert result.status_code==401
    g['_consume_login_challenge'].assert_called_once()


def test_withdrawal_revokes_all_authentication_paths_without_deleting_ledger():
    client,g,_,cur=lifecycle([{'ci_hash':'identity'}])
    now=int(time.time())
    response=client.post('/api/account/withdraw',headers={'X-Service-Key':'trusted-main'},json={'wallet_address':OWNER,'message':challenge_message('withdraw',OWNER,'nonce','test-domain',now,now+180,OWNER),'nonce':'nonce','signature':'signed'})
    assert response.status_code==200
    statements=' '.join(c.args[0] for c in cur.execute.call_args_list)
    for table in ['revoked_vcs','mobile_credentials','user_login_sessions','mobile_pairing_sessions','oid4vci_access_tokens','oid4vci_credential_offers']:
        assert table in statements
    assert 'DELETE FROM' not in statements


@pytest.mark.parametrize('rows',[[{'id':1},{'exists':1}],[{'id':1},None,{'exists':1}],[{'id':1},None,None,{'exists':1}]])
def test_main_refuses_withdrawal_with_entitlements_or_pending_work(rows):
    connection,_,_=database(rows);gateway=MagicMock();app=FastAPI()
    install_account_main(app,connection,lambda:OWNER,gateway)
    assert TestClient(app).post('/api/account/withdraw',json={}).status_code==409
    gateway.call_bytes.assert_not_called()


def test_main_deactivates_account_only_after_auth_success():
    connection,db,cur=database([{'id':1},None,None,None]);gateway=MagicMock()
    gateway.call_bytes.return_value=SimpleNamespace(status=200,body=b'{"status":"success"}')
    app=FastAPI();install_account_main(app,connection,lambda:OWNER,gateway)
    assert TestClient(app).post('/api/account/withdraw',json={}).status_code==200
    assert any("status='withdrawn'" in c.args[0] for c in cur.execute.call_args_list)
    db.commit.assert_called_once()


def test_failed_auth_withdrawal_does_not_deactivate_main_account():
    connection,db,cur=database([{'id':1},None,None,None]);gateway=MagicMock()
    gateway.call_bytes.return_value=SimpleNamespace(status=403,body=b'{"detail":"invalid proof"}')
    app=FastAPI();install_account_main(app,connection,lambda:OWNER,gateway)
    assert TestClient(app).post('/api/account/withdraw',json={}).status_code==403
    assert not any("status='withdrawn'" in c.args[0] for c in cur.execute.call_args_list)
    db.commit.assert_not_called()


def test_revoked_signer_cannot_use_an_unexpired_qr():
    import json
    from eth_account.messages import encode_defunct
    from fastapi import HTTPException
    from ticket_qr import create_ticket_qr_payload,install_ticket_qr_routes
    signer=Account.create()
    identity=SimpleNamespace(account_wallet_address=OWNER,signer_wallet_address=signer.address)
    challenge=create_ticket_qr_payload(identity,42)
    row={**challenge,'db_now':datetime.now(timezone.utc),'consumed_at':None,'checked_in_at':None,'ticket_status':'minted'}
    connection,db,_=database([row])
    validator=AsyncMock(side_effect=HTTPException(403,'credential revoked'))
    chain=MagicMock();app=FastAPI()
    install_ticket_qr_routes(app,connection,lambda:identity,lambda:{'id':1},lambda *a,**kw:None,SimpleNamespace(eth=SimpleNamespace(account=Account)),chain,credential_validator=validator)
    signature=signer.sign_message(encode_defunct(text=challenge['signing_message'])).signature.hex()
    if not signature.startswith('0x'):signature='0x'+signature
    response=TestClient(app).post('/api/admin/ticket-checkins/verify',json={'qr_data':json.dumps({'payload':challenge['payload'],'signature':signature})})
    assert response.status_code==403
    validator.assert_awaited_once()
    chain.functions.ownerOf.assert_not_called()
    db.commit.assert_not_called()


def transfer_client(rows, primary=False):
    connection,db,cur=database(rows)
    identity=SimpleNamespace(account_wallet_address=OWNER,signer_wallet_address=OWNER if primary else SIGNER)
    api=SimpleNamespace(TransferChallengeRequest=lambda **kw:SimpleNamespace(**kw),TransferRequest=lambda **kw:SimpleNamespace(**kw),
        load_transfer_context=AsyncMock(return_value=({},OWNER,RECIPIENT,1)),transfer_ticket_api=AsyncMock(return_value={'status':'success','transaction_hash':'0xabc'}))
    app=FastAPI();install_mobile_transfers(app,connection,lambda:identity,api)
    return TestClient(app),api,cur


def test_delegated_mobile_can_request_but_cannot_approve_transfer():
    client,api,_=transfer_client([None])
    assert client.post('/api/mobile-transfers',json={'booking_item_id':1,'companion_username':'recipient'}).status_code==200
    result=client.post('/api/mobile-transfers/request/approve',json={'signature':'0x'+'01'*65,'nonce':0,'deadline':int(time.time())+300})
    assert result.status_code==403
    api.transfer_ticket_api.assert_not_called()


def test_owner_approval_uses_stored_recipient_not_client_input():
    row={'booking_item_id':1,'status':'pending','expires_at':datetime.now(timezone.utc)+timedelta(minutes=1),'recipient_wallet':RECIPIENT}
    client,api,_=transfer_client([row],primary=True)
    result=client.post('/api/mobile-transfers/request/approve',json={'signature':'0x'+'01'*65,'nonce':0,'deadline':int(time.time())+300})
    assert result.status_code==200
    assert api.transfer_ticket_api.call_args.args[0].companion_username==RECIPIENT


def test_pending_transfer_blocks_duplicate_request():
    client,api,_=transfer_client([{'request_id':'existing'}])
    assert client.post('/api/mobile-transfers',json={'booking_item_id':1,'companion_username':'recipient'}).status_code==409
    api.transfer_ticket_api.assert_not_called()
