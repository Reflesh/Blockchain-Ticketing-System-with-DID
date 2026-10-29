import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from account_lifecycle import install_account_lifecycle
from auth_routes import install_gateway_routes

ACCOUNT = '0x' + '11' * 20
MOBILE = '0x' + '22' * 20


def client_for(row, active=True):
    db = MagicMock()
    db.__enter__.return_value = db
    cursor = db.cursor.return_value.__enter__.return_value
    cursor.fetchone.return_value = row
    connection = MagicMock(return_value=db)
    app = FastAPI()
    install_account_lifecycle(app, {
        'get_db_connection': connection,
        '_extract_bearer_token': lambda request: request.headers.get('authorization', ''),
        'inspect_session': lambda *args: {'active': active, 'wallet_address': ACCOUNT, 'signer_wallet_address': MOBILE},
    })
    return TestClient(app), connection, cursor


def test_original_dates_are_preserved_and_mobile_signer_is_not_used(monkeypatch):
    class FixedDate(datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 10, 29, tzinfo=timezone.utc)
    monkeypatch.setattr('account_lifecycle.datetime', FixedDate)
    issued = datetime(2026, 10, 6, 12, 0, tzinfo=timezone.utc)
    expiry = issued + timedelta(days=365)
    client, _, cursor = client_for({'issued_at': issued.isoformat(), 'expires_at': expiry.isoformat(), 'revoked_at': None})
    response = client.get('/api/account/credential?wallet_address=' + MOBILE, headers={'Authorization': 'Bearer valid'})
    assert response.status_code == 200
    assert response.headers['cache-control'] == 'no-store'
    body = response.json()['data']
    assert body['wallet_address'] == ACCOUNT
    assert body['issued_at'] == '2026-10-06T12:00:00Z'
    assert body['expires_at'] == '2027-10-06T12:00:00Z'
    assert body['status'] == 'active'
    query, params = cursor.execute.call_args.args
    assert params == (ACCOUNT,) and 'FROM issued_vcs' in query
    assert set(body) == {'wallet_address', 'credential_type', 'issued_at', 'expires_at', 'status'}


@pytest.mark.parametrize('header,active', [('', True), ('Bearer expired', False)])
def test_login_required(header, active):
    client, connection, _ = client_for(None, active)
    assert client.get('/api/account/credential', headers={'Authorization': header}).status_code == 401
    connection.assert_not_called()


@pytest.mark.parametrize('expiry,revoked,expected', [
    ('2020-01-01T00:00:00Z', None, 'expired'),
    ('2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z', 'revoked'),
    ('invalid', None, 'unknown'),
])
def test_inactive_states_are_not_displayed_as_valid(expiry, revoked, expected):
    client, _, _ = client_for({'issued_at': '2019-01-01T00:00:00Z', 'expires_at': expiry, 'revoked_at': revoked})
    assert client.get('/api/account/credential', headers={'Authorization': 'Bearer valid'}).json()['data']['status'] == expected


def test_missing_credential_does_not_invent_dates():
    client, _, _ = client_for(None)
    body = client.get('/api/account/credential', headers={'Authorization': 'Bearer valid'}).json()['data']
    assert body['status'] == 'not_issued' and body['issued_at'] is None and body['expires_at'] is None


def test_gateway_forwards_bearer_and_disables_cache():
    gateway = MagicMock()
    gateway.call_bytes.return_value = SimpleNamespace(body=json.dumps({'data': {'status': 'active'}}).encode(), status=200, content_type='application/json', retry_after='')
    app = FastAPI()
    install_gateway_routes(app, gateway)
    response = TestClient(app).get('/api/account/credential', headers={'Authorization': 'Bearer valid'})
    assert response.status_code == 200 and response.headers['cache-control'] == 'no-store'
    assert gateway.call_bytes.call_args.args == ('GET', '/api/account/credential', None, '', 'Bearer valid')
