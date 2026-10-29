"""Ticket-aware withdrawal: preserve ledger data and refuse unused entitlements."""
import asyncio
import json
from fastapi import Depends, HTTPException, Request
try:
    from .account_guard import serialize_accounts
except ImportError:
    from account_guard import serialize_accounts


def install_account_main(app, connection, identity_dependency, gateway):
    async def accounts(arguments):return [arguments['account']]
    @app.post('/api/account/withdraw', summary='본인 서명으로 회원탈퇴')
    @serialize_accounts(connection, accounts)
    async def withdraw(request: Request, account=Depends(identity_dependency)):
        payload=await request.json()
        with connection() as db:
            with db.cursor() as cur:
                cur.execute('SELECT id FROM users WHERE LOWER(wallet_address)=LOWER(%s) FOR UPDATE',(account,))
                user=cur.fetchone()
                if not user:raise HTTPException(404,'계정을 찾을 수 없습니다.')
                cur.execute("SELECT 1 FROM booking_items WHERE LOWER(owner_wallet_address)=LOWER(%s) AND ticket_status NOT IN ('used','failed') LIMIT 1",(account,))
                if cur.fetchone():raise HTTPException(409,'미사용 또는 발급 중인 티켓이 있습니다. 사용·양도 후 탈퇴해주세요.')
                cur.execute("SELECT 1 FROM checkout_orders WHERE LOWER(buyer_wallet_address)=LOWER(%s) AND status IN ('pending_payment','processing','paid') LIMIT 1",(account,))
                if cur.fetchone():raise HTTPException(409,'진행 중인 결제가 있습니다. 결제 상태를 확인한 후 탈퇴해주세요.')
                cur.execute("SELECT 1 FROM blockchain_transactions WHERE (LOWER(buyer_wallet_address)=LOWER(%s) OR LOWER(recipient_wallet_address)=LOWER(%s)) AND tx_status='pending' LIMIT 1",(account,account))
                if cur.fetchone():raise HTTPException(409,'처리 중인 블록체인 거래가 있습니다. 완료 후 탈퇴해주세요.')
                try:
                    result=await asyncio.to_thread(gateway.call_bytes,'POST','/api/account/withdraw',
                        json.dumps(payload).encode(),'application/json',request.headers.get('authorization',''))
                except Exception:
                    raise HTTPException(503,'인증 서버에서 탈퇴를 완료하지 못했습니다. 잠시 후 다시 시도해주세요.') from None
                body=json.loads(result.body)
                if result.status!=200:raise HTTPException(result.status,body.get('detail','탈퇴 처리에 실패했습니다.'))
                cur.execute("UPDATE users SET status='withdrawn',password_hash=NULL,private_key_encrypted=NULL WHERE id=%s",(user['id'],))
                cur.execute('DELETE FROM wishlist WHERE LOWER(wallet_address)=LOWER(%s)',(account,))
            db.commit()
        return body
