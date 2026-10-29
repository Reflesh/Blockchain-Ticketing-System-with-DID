from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI, Header, HTTPException
from fastapi.testclient import TestClient
from event_community import install_event_community


ACCOUNT = '0x' + '11' * 20


@pytest.fixture
def community():
    db = MagicMock()
    db.__enter__.return_value = db
    cursor = db.cursor.return_value.__enter__.return_value
    app = FastAPI()

    def authenticate(authorization: str = Header(default='')):
        if authorization != 'Bearer valid':
            raise HTTPException(401, 'Login required')
        return ACCOUNT

    install_event_community(app, lambda: db, authenticate)
    return TestClient(app), cursor, db


def post_row(id=1):
    return {'id': id, 'author_wallet': ACCOUNT, 'content': '공연이 기대됩니다.', 'created_at': datetime.now(timezone.utc)}


def test_public_read_and_counts(community):
    client, cursor, _ = community
    cursor.fetchone.side_effect = [{'id': 1}, {'review': 0, 'qna': 2}]
    cursor.fetchall.return_value = []
    response = client.get('/api/events/1/community')
    assert response.status_code == 200
    assert response.json() == {'data': [], 'counts': {'review': 0, 'qna': 2}, 'next_offset': None}


def test_anonymous_cannot_write(community):
    client, cursor, db = community
    assert client.post('/api/events/1/community', json={'kind': 'review', 'content': 'test'}).status_code == 401
    cursor.execute.assert_not_called()
    db.commit.assert_not_called()


def test_author_comes_from_session_and_content_is_parameterized(community):
    client, cursor, db = community
    cursor.fetchone.side_effect = [{'id': 1}, post_row()]
    text = "  <script>alert('test')</script>  "
    response = client.post('/api/events/1/community', json={'kind': 'review', 'content': text}, headers={'Authorization': 'Bearer valid'})
    assert response.status_code == 201
    assert response.json()['data']['author'] == ACCOUNT
    query, params = cursor.execute.call_args.args
    assert '<script>' not in query
    assert params == (1, 'review', ACCOUNT, text.strip())
    db.commit.assert_called_once()


@pytest.mark.parametrize('body', [
    {'kind': 'review', 'content': '  '}, {'kind': 'reply', 'content': 'test'},
    {'kind': 'qna', 'content': 'a' * 2001}, {'kind': 'qna', 'content': '\0'},
    {'kind': 'review', 'content': 'test', 'author_wallet': 'forged'},
])
def test_invalid_posts_are_rejected(community, body):
    client, cursor, _ = community
    assert client.post('/api/events/1/community', json=body, headers={'Authorization': 'Bearer valid'}).status_code == 422
    cursor.execute.assert_not_called()


def test_replies_cannot_target_another_event_or_review(community):
    client, cursor, db = community
    cursor.fetchone.return_value = None
    response = client.post('/api/events/2/community/7/replies', json={'content': 'test'}, headers={'Authorization': 'Bearer valid'})
    assert response.status_code == 404
    query, params = cursor.execute.call_args.args
    assert "kind='qna'" in query and params == (7, 2)
    db.commit.assert_not_called()


def test_qna_reply_preview_and_pagination(community):
    client, cursor, _ = community
    cursor.fetchone.side_effect = [{'id': 1}, {'review': 0, 'qna': 2}]
    reply = {**post_row(10), 'parent_id': 1, 'reply_count': 5}
    cursor.fetchall.side_effect = [[post_row()], [reply]]
    response = client.get('/api/events/1/community?kind=qna&limit=1')
    assert response.status_code == 200
    body = response.json()
    assert body['next_offset'] == 1
    assert body['data'][0]['reply_count'] == 5
    assert body['data'][0]['replies'][0]['id'] == 10


@pytest.mark.parametrize('query', ['limit=10000', 'offset=-1', 'kind=reply'])
def test_invalid_pagination(community, query):
    client, cursor, _ = community
    assert client.get('/api/events/1/community?' + query).status_code == 422
    cursor.execute.assert_not_called()
