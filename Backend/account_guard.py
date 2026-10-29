"""Cross-worker account serialization shared by sales, transfers and withdrawal."""
import asyncio
from contextlib import asynccontextmanager
from functools import wraps
from inspect import signature
from fastapi import HTTPException


@asynccontextmanager
async def account_guard(connection, wallets):
    ordered=sorted({wallet.lower() for wallet in wallets if wallet})
    def acquire():
        db=connection()
        try:
            db.autocommit=True
            with db.cursor() as cur:
                cur.execute("SET lock_timeout = '15s'")
                for wallet in ordered:
                    cur.execute('SELECT pg_advisory_lock(hashtextextended(%s,0))',('ticketpro-account:'+wallet,))
                    cur.execute('SELECT status FROM users WHERE LOWER(wallet_address)=%s',(wallet,))
                    row=cur.fetchone()
                    if not row or row['status']!='active':raise HTTPException(403,'활성 계정만 거래하거나 탈퇴할 수 있습니다.')
            return db
        except BaseException as error:
            db.close()
            if getattr(error,'sqlstate',None)=='55P03':raise HTTPException(409,'계정에서 다른 거래가 진행 중입니다. 완료 후 다시 시도해주세요.') from None
            raise
    pending=asyncio.create_task(asyncio.to_thread(acquire))
    try:
        db=await asyncio.shield(pending)
    except asyncio.CancelledError:
        # The worker may still acquire a lock after its caller disconnects.
        def cleanup(task):
            if not task.cancelled() and task.exception() is None:task.result().close()
        pending.add_done_callback(cleanup)
        raise
    try:
        yield
    finally:
        await asyncio.to_thread(db.close)


def serialize_accounts(connection, resolve):
    def decorate(function):
        @wraps(function)
        async def wrapped(*args,**kwargs):
            bound=signature(function).bind(*args,**kwargs)
            wallets=await resolve(bound.arguments)
            async with account_guard(connection,wallets):
                return await function(*args,**kwargs)
        return wrapped
    return decorate
