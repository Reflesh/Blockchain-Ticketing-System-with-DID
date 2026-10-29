"""Shared, authenticated event discussions for the web and mobile clients."""
from typing import Literal

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator


def init_event_community(cursor):
    cursor.execute('''CREATE TABLE IF NOT EXISTS event_posts (
        id BIGSERIAL PRIMARY KEY,
        event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('review','qna','reply')),
        author_wallet TEXT NOT NULL,
        content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 2000),
        parent_id BIGINT REFERENCES event_posts(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK ((kind IN ('review','qna') AND parent_id IS NULL) OR
               (kind='reply' AND parent_id IS NOT NULL))
    )''')
    cursor.execute('CREATE INDEX IF NOT EXISTS event_posts_event_kind ON event_posts(event_id,kind,id DESC)')
    cursor.execute('CREATE INDEX IF NOT EXISTS event_posts_parent ON event_posts(parent_id,id)')


class PostContent(BaseModel):
    model_config = ConfigDict(extra='forbid')
    content: str = Field(min_length=1, max_length=2000)

    @field_validator('content')
    @classmethod
    def clean_content(cls, value):
        value = value.strip()
        if not value or '\0' in value:
            raise ValueError('내용을 입력해주세요. 사용할 수 없는 문자는 제외해주세요.')
        return value


class EventPost(PostContent):
    kind: Literal['review', 'qna']


def install_event_community(app, db_factory, require_user_session):
    def event_exists(cursor, event_id):
        cursor.execute('SELECT id FROM events WHERE id=%s', (event_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail='공연을 찾을 수 없습니다.')

    def question_exists(cursor, event_id, post_id):
        cursor.execute("SELECT id FROM event_posts WHERE id=%s AND event_id=%s AND kind='qna'", (post_id, event_id))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail='질문을 찾을 수 없습니다.')

    def serialize(row):
        return {
            'id': row['id'], 'author': row['author_wallet'], 'content': row['content'],
            'created_at': row['created_at'].isoformat(),
        }

    @app.get('/api/events/{event_id}/community')
    def list_posts(event_id: int, kind: Literal['review','qna'] = 'review', limit: int = Query(20, ge=1, le=50), offset: int = Query(0, ge=0)):
        with db_factory() as db:
            with db.cursor() as cursor:
                event_exists(cursor, event_id)
                cursor.execute("SELECT COUNT(*) FILTER (WHERE kind='review') AS review, COUNT(*) FILTER (WHERE kind='qna') AS qna FROM event_posts WHERE event_id=%s", (event_id,))
                counts = cursor.fetchone()
                cursor.execute('SELECT id,author_wallet,content,created_at FROM event_posts WHERE event_id=%s AND kind=%s ORDER BY id DESC LIMIT %s OFFSET %s', (event_id, kind, limit, offset))
                rows = cursor.fetchall()
                posts = [serialize(row) for row in rows]
                if kind == 'qna' and posts:
                    ids = [post['id'] for post in posts]
                    cursor.execute('''SELECT id,parent_id,author_wallet,content,created_at,reply_count FROM (
                        SELECT id,parent_id,author_wallet,content,created_at,
                               COUNT(*) OVER (PARTITION BY parent_id) AS reply_count,
                               ROW_NUMBER() OVER (PARTITION BY parent_id ORDER BY id) AS reply_position
                        FROM event_posts WHERE parent_id=ANY(%s) AND event_id=%s
                    ) replies WHERE reply_position<=3 ORDER BY id''', (ids, event_id))
                    replies = cursor.fetchall()
                    for post in posts:
                        matching = [row for row in replies if row['parent_id'] == post['id']]
                        post['replies'] = [serialize(row) for row in matching]
                        post['reply_count'] = matching[0]['reply_count'] if matching else 0
        return {'data': posts, 'counts': counts, 'next_offset': offset+len(posts) if offset+len(posts)<counts[kind] else None}

    @app.post('/api/events/{event_id}/community', status_code=201)
    def create_post(event_id: int, body: EventPost, account=Depends(require_user_session)):
        with db_factory() as db:
            with db.cursor() as cursor:
                event_exists(cursor, event_id)
                cursor.execute('INSERT INTO event_posts(event_id,kind,author_wallet,content) VALUES(%s,%s,%s,%s) RETURNING id,author_wallet,content,created_at', (event_id,body.kind,account,body.content))
                post = serialize(cursor.fetchone())
            db.commit()
        return {'data': post}

    @app.get('/api/events/{event_id}/community/{post_id}/replies')
    def list_replies(event_id: int, post_id: int, limit: int = Query(20, ge=1, le=50), offset: int = Query(0, ge=0)):
        with db_factory() as db:
            with db.cursor() as cursor:
                question_exists(cursor, event_id, post_id)
                cursor.execute('SELECT id,author_wallet,content,created_at FROM event_posts WHERE parent_id=%s AND event_id=%s ORDER BY id LIMIT %s OFFSET %s', (post_id,event_id,limit,offset))
                posts = [serialize(row) for row in cursor.fetchall()]
        return {'data': posts}

    @app.post('/api/events/{event_id}/community/{post_id}/replies', status_code=201)
    def create_reply(event_id: int, post_id: int, body: PostContent, account=Depends(require_user_session)):
        with db_factory() as db:
            with db.cursor() as cursor:
                question_exists(cursor, event_id, post_id)
                cursor.execute("INSERT INTO event_posts(event_id,kind,author_wallet,content,parent_id) VALUES(%s,'reply',%s,%s,%s) RETURNING id,author_wallet,content,created_at", (event_id,account,body.content,post_id))
                post = serialize(cursor.fetchone())
            db.commit()
        return {'data': post}
