"""Exercise actual auth functions without importing its DB-initializing module."""
import ast
import asyncio
import copy
import secrets
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi import HTTPException
from web3 import Web3
from wallet_challenges import challenge_message, validate_challenge
from credential_profile import credential_payload
from test_account_lifecycle import database


def function(name, namespace):
    tree=ast.parse((Path(__file__).parents[1]/'auth_server.py').read_text())
    node=next(n for n in tree.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)) and n.name==name)
    node.decorator_list=[]
    module=ast.Module(body=[ast.ImportFrom(module='__future__',names=[ast.alias(name='annotations')],level=0),node],type_ignores=[])
    exec(compile(ast.fix_missing_locations(module),'auth_server.py','exec'),namespace)
    return namespace[name]


@pytest.mark.parametrize('source,target',[('withdraw','login'),('login','withdraw'),('pairing','login'),('login','pairing')])
def test_signed_proof_cannot_cross_action(source,target):
    signer=Account.create();now=int(time.time())
    message=challenge_message(source,signer.address,'one-use','test',now,now+180,signer.address)
    proof=SimpleNamespace(wallet_address=signer.address,message=message,nonce='one-use',signature=signer.sign_message(encode_defunct(text=message)).signature.hex())
    connection=MagicMock()
    consume=function('_consume_login_challenge',{'time':time,'validate_challenge':validate_challenge,'EXPECTED_DOMAIN':'test','HTTPException':HTTPException,'Account':Account,'encode_defunct':encode_defunct,'get_db_connection':connection})
    with pytest.raises(HTTPException) as error:consume(proof,purpose=target,account=signer.address if target=='withdraw' else None)
    assert error.value.status_code==401
    connection.assert_not_called()


def test_withdrawal_proof_binds_primary_account():
    now=int(time.time());wallet=Account.create().address
    proof=SimpleNamespace(wallet_address=wallet,nonce='once',message=challenge_message('withdraw',wallet,'once','test',now,now+180,wallet))
    with pytest.raises(HTTPException):validate_challenge(proof,'withdraw','test',now,Account.create().address)


def test_recovery_completion_invalidates_old_grants_without_changing_nft_account():
    owner=Account.create().address;mobile=Account.create().address;now=time.time()
    pairing={'pairing_id':'grant','ci_hash':'identity','email':'test@pukyong.ac.kr','parent_wallet_address':owner,'expires_at':now+180,'used_at':None}
    connection,_,cur=database([{'ci_hash':'identity'},pairing,{'expires_at':datetime.fromtimestamp(now+600,timezone.utc).isoformat(),'revoked_wallet':None},None,{'pairing_id':'grant'},{'request_id':'recovery'}])
    signing=MagicMock(return_value='credential')
    ns={'time':time,'datetime':datetime,'timedelta':timedelta,'timezone':timezone,'secrets':secrets,'HTTPException':HTTPException,
        'MOBILE_CREDENTIAL_TTL':3600,'LOGIN_SESSION_TTL':300,'OID4VCI_ISSUER_BASE_URL':'https://issuer.test','OID4VCI_ISSUER_KEY_ID':'issuer',
        '_public_key_from_holder_jwk':lambda jwk:SimpleNamespace(to_checksum_address=lambda:mobile),
        '_consume_login_challenge':MagicMock(),'get_db_connection':connection,'_token_hash':lambda value:value,
        'expiry_timestamp':lambda value:datetime.fromisoformat(value).timestamp(),'build_credential_payload':credential_payload,
        '_sign_es256k_jwt':signing,'_record_login_audit':MagicMock()}
    request=SimpleNamespace(holder_jwk={'kty':'EC','crv':'secp256k1','x':'x','y':'y'},wallet_address=mobile,pairing_token='token',device_name='test')
    result=asyncio.run(function('complete_mobile_pairing',ns)(request))
    assert result['account_wallet_address']==owner
    assert result['credential_expires_at']<=int(now+600)
    queries=[call.args[0] for call in cur.execute.call_args_list]
    assert next(i for i,q in enumerate(queries) if 'FROM issued_vcs' in q and 'FOR UPDATE' in q)<next(i for i,q in enumerate(queries) if 'FROM mobile_pairing_sessions' in q and 'FOR UPDATE' in q)
    assert any('UPDATE account_recovery_requests' in q for q in queries)
    assert any('UPDATE mobile_pairing_sessions SET used_at' in q for q in queries)
    assert any('UPDATE mobile_credentials SET revoked_at' in q for q in queries)
    assert not any('UPDATE issued_vcs' in q or 'booking_items' in q for q in queries)
    payload=signing.call_args.args[1]
    assert payload['vc']['credentialSubject']['account']==f'did:pknu:{owner}'
    assert payload['vc']['credentialStatus']['type']=='TicketProCredentialStatus'


def test_mobile_did_resolves_even_with_revoked_credential():
    address=Account.create().address
    connection,_,cur=database([None,{'issued_at':'2026-01-01T00:00:00Z','expires_at':'2027-01-01T00:00:00Z'}])
    import re
    ns={'ADDRESS':re.compile(r'^0x[a-fA-F0-9]{40}$'),'Web3':Web3,'ISSUER_ADDRESS':Account.create().address,
        'HTTPException':HTTPException,'get_db_connection':connection,'_build_did_document':lambda address:{'id':'did:pknu:'+address}}
    result=asyncio.run(function('resolve_did',ns)(address.lower()))
    assert result['didDocument']['id']=='did:pknu:'+address
    assert result['didDocumentMetadata']['deactivated'] is False
    assert any('mobile_credentials' in call.args[0] for call in cur.execute.call_args_list)
