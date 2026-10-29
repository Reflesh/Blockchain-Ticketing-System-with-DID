"""Delegated mobile wallets request transfers; NFT owners approve with EIP-712."""
import json
import secrets
from datetime import datetime, timedelta, timezone
from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field


def init_mobile_transfers(cursor):
    cursor.execute("""CREATE TABLE IF NOT EXISTS mobile_transfer_requests (
        request_id TEXT PRIMARY KEY, account_wallet TEXT NOT NULL,
        signer_wallet TEXT NOT NULL, booking_item_id BIGINT NOT NULL REFERENCES booking_items(id) ON DELETE CASCADE,
        recipient_wallet TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),expires_at TIMESTAMPTZ NOT NULL,
        transaction_hash TEXT, error_message TEXT)""")
    cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS mobile_transfer_active_item ON mobile_transfer_requests(booking_item_id) WHERE status IN ('pending','processing')")


class TransferIntent(BaseModel):
    booking_item_id: int = Field(gt=0)
    companion_username: str = Field(min_length=1, max_length=100)


class TransferApproval(BaseModel):
    signature: str = Field(min_length=2,max_length=200)
    nonce: int = Field(ge=0)
    deadline: int = Field(gt=0)


def install_mobile_transfers(app, connection, identity_dependency, api):
    @app.post('/api/mobile-transfers')
    async def create_intent(body: TransferIntent, identity=Depends(identity_dependency)):
        account=identity.account_wallet_address
        request=api.TransferChallengeRequest(wallet_address=account,booking_item_id=body.booking_item_id,companion_username=body.companion_username)
        _,_,recipient,_=await api.load_transfer_context(request)
        identifier=secrets.token_urlsafe(24)
        with connection() as db:
            with db.cursor() as cur:
                cur.execute('SELECT id FROM booking_items WHERE id=%s FOR UPDATE',(body.booking_item_id,))
                cur.execute("UPDATE mobile_transfer_requests SET status='expired' WHERE booking_item_id=%s AND status='pending' AND expires_at<=NOW()",(body.booking_item_id,))
                cur.execute("SELECT request_id FROM mobile_transfer_requests WHERE booking_item_id=%s AND status IN ('pending','processing')",(body.booking_item_id,))
                if cur.fetchone():raise HTTPException(409,'이미 승인 대기 또는 처리 중인 양도 요청이 있습니다.')
                cur.execute("""INSERT INTO mobile_transfer_requests
                    (request_id,account_wallet,signer_wallet,booking_item_id,recipient_wallet,expires_at)
                    VALUES (%s,%s,%s,%s,%s,%s)""",(identifier,account,identity.signer_wallet_address,body.booking_item_id,recipient,datetime.now(timezone.utc)+timedelta(minutes=10)))
        return {'status':'pending','data':{'request_id':identifier},'message':'웹 마이페이지에서 NFT 소유 지갑으로 승인해주세요.'}

    @app.get('/api/mobile-transfers')
    async def list_intents(identity=Depends(identity_dependency)):
        with connection() as db:
            with db.cursor() as cur:
                cur.execute("UPDATE mobile_transfer_requests SET status='expired' WHERE LOWER(account_wallet)=LOWER(%s) AND status='pending' AND expires_at<=NOW()",(identity.account_wallet_address,))
                cur.execute("""SELECT m.*,bi.token_id,bi.seat_code,bi.owner_wallet_address
                    FROM mobile_transfer_requests m JOIN booking_items bi ON bi.id=m.booking_item_id
                    WHERE LOWER(m.account_wallet)=LOWER(%s) ORDER BY m.created_at DESC LIMIT 30""",(identity.account_wallet_address,))
                rows=cur.fetchall()
                for row in rows:
                    if row['status']=='processing' and row['owner_wallet_address'].lower()==row['recipient_wallet'].lower():
                        row['status']='confirmed'
                        cur.execute("UPDATE mobile_transfer_requests SET status='confirmed' WHERE request_id=%s",(row['request_id'],))
        return {'data':rows}

    @app.post('/api/mobile-transfers/{request_id}/cancel')
    async def cancel(request_id: str, identity=Depends(identity_dependency)):
        with connection() as db:
            result=db.execute("UPDATE mobile_transfer_requests SET status='cancelled' WHERE request_id=%s AND LOWER(account_wallet)=LOWER(%s) AND status='pending' RETURNING request_id",(request_id,identity.account_wallet_address)).fetchone()
            if not result:raise HTTPException(409,'취소할 승인 대기 요청이 없습니다.')
        return {'status':'success'}

    @app.post('/api/mobile-transfers/{request_id}/approve')
    async def approve(request_id: str, body: TransferApproval, identity=Depends(identity_dependency)):
        if identity.signer_wallet_address.lower()!=identity.account_wallet_address.lower():
            raise HTTPException(403,'NFT 소유 지갑으로 로그인한 웹에서 승인해주세요.')
        with connection() as db:
            with db.cursor() as cur:
                cur.execute('SELECT * FROM mobile_transfer_requests WHERE request_id=%s AND LOWER(account_wallet)=LOWER(%s) FOR UPDATE',(request_id,identity.account_wallet_address))
                row=cur.fetchone()
                if not row or row['status']!='pending' or row['expires_at']<=datetime.now(timezone.utc):
                    raise HTTPException(409,'승인 가능한 요청이 없거나 만료되었습니다.')
                cur.execute("UPDATE mobile_transfer_requests SET status='processing' WHERE request_id=%s",(request_id,))
        submitted=False
        try:
            request=api.TransferRequest(wallet_address=identity.account_wallet_address,booking_item_id=row['booking_item_id'],companion_username=row['recipient_wallet'],signature=body.signature,nonce=body.nonce,deadline=body.deadline)
            response=await api.transfer_ticket_api(request,session_wallet=identity.account_wallet_address)
            data=json.loads(response.body) if hasattr(response,'body') else response
            submitted=True
            with connection() as db:
                db.execute('UPDATE mobile_transfer_requests SET status=%s,transaction_hash=%s WHERE request_id=%s',('confirmed' if data.get('status')=='success' else 'processing',data.get('transaction_hash'),request_id))
            return response
        except HTTPException as error:
            # 503 may mean a transaction was submitted. Never invite a blind retry.
            with connection() as db:
                db.execute('UPDATE mobile_transfer_requests SET status=%s,error_message=%s WHERE request_id=%s',('processing' if submitted or error.status_code==503 else 'failed',str(error.detail),request_id))
            raise
