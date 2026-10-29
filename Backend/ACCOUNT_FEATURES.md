# Account and mobile updates (2026-10-25)

## User flows

- **Forgot password:** the mobile login screen and certificate wallet link to
  `계정 및 보안`. Request a university email code, verify within three minutes,
  choose a new password and replace the mobile signer. Existing NFT account and
  tickets do not move. Successful replacement revokes previous mobile devices
  and sessions. Email codes have a 60-second request cooldown, five-attempt limit,
  keyed hash storage and one-time use. Never display production verification codes.
- **Change password:** an unlocked mobile wallet can be encrypted with a new
  local password. The web downloads a new encrypted keystore; previous exported
  files retain their original passwords. Forgotten original NFT-owner keys cannot
  be decrypted by this feature. Email recovery restores delegated mobile access,
  not the old private key or its ability to sign owner-only transfers.
- **Credential restore:** a verified login can download a holder-bound credential
  for its own signer. Issuer signature and holder key are checked before local
  storage. Loading failures are distinct from an empty certificate list.
- **Sessions:** secure storage preserves a recoverable session when a local VC is
  missing. The server is checked before restoring it. Authenticated mobile API
  calls renew on 401 and retry once; other failures do not trigger reauthentication.
  Logout/session generation changes cancel stale renewals. Web sessionStorage
  stores only the bearer token and public profile, never a private key. After a
  browser reload, owner signatures require unlocking the keystore again.
- **QR:** 20-second server TTL and refresh period. Countdown uses the response's
  server Date and is capped at 20 seconds; expired QR is hidden. Old challenges
  are invalidated on refresh. Verification also checks the signer's current VC,
  so revoked mobile credentials cannot use a still-unexpired QR.
- **Mobile transfers:** a mobile wallet holding the actual NFT key signs and
  transfers directly. A delegated signer submits a ten-minute intent. The web
  owner signs its EIP-712 challenge and approves; the existing one-transfer
  contract is used without modification. Recipient and ticket come from the
  stored intent, not the approval body. Processing transactions must not be
  blindly retried. The UI supports cancellation before processing.
- **Device history:** revoked device rows are retained and collapsed by default.
- **Withdrawal:** requires an action-specific wallet signature. The main server
  refuses unused/unissued entitlements and pending payment/chain operations.
  Auth revokes primary/mobile credentials, sessions and outstanding issuance/
  pairing grants. Main marks the user withdrawn, clears legacy password/key
  fields and wishlist. Ledger, payment, check-in and on-chain records remain.
  This is service withdrawal, not erasure of immutable blockchain history.

## Deployment

## Additional hardening

- Login, pairing and withdrawal proofs carry different server-stored purposes,
  account binding where applicable, domain and expiry. They cannot cross endpoints.
- Recovery consumes earlier pairing grants and, on completion, outstanding codes
  and grants plus old mobile credentials/sessions. Parent-account row locks order
  issuance, recovery and withdrawal. NFT ownership and ticket rows are preserved.
- Main serializes checkout, mint, transfer and withdrawal across workers with
  account advisory locks. Transfers lock both accounts in address order. Pending
  transfer recipients are recorded and prevent withdrawal even before confirmation.
- Primary and mobile restore use the same full VC 1.1 profile, without extending
  credential expiry. The app checks signature, holder, type, dates, account and
  current issuer status before saving. Mobile validity is capped by its parent.
- Both primary and mobile DIDs resolve; VC revocation is separate from DID
  deactivation. See `DID_METHOD.md` for the experimental method's limitations.
- Logout prevents renewal retries and stale authenticated component requests.

### Schema additions

Auth adds `login_nonces.purpose`; main adds
`blockchain_transactions.recipient_wallet_address`. Existing records remain.
Reload mobile and browser clients after deploying purpose-bound pairing proofs.

Deploy auth and main changes together before using the new mobile code.
`auth_server.init_db()` creates `account_recovery_requests`; main `init_db()`
creates `mobile_transfer_requests` and its active-request unique index. Existing
tables and records are not dropped. Auth withdrawal requires the main service key
and is deliberately not exposed as a generic pass-through route.

There are no new runtime packages. Existing SMTP configuration is used. Production
recovery requires a working university mailbox and valid unrevoked parent VC.
Keep `AUTH_SERVICE_KEY` consistent and never commit `.env` files.

Main and auth use separate transactions: a failure of main's DB commit after auth
revocation needs operator reconciliation; do not manually reactivate revoked
credentials to retry withdrawal. Back up configurations before deployment.

## Verification

```
PYTHONPATH=Backend python -m pytest Backend/tests/test_account_lifecycle.py Backend/tests/test_ticket_qr_security.py
cd Mobile/user-app
node tests/session-regression.cjs
npx tsc --noEmit
npm run lint
```

`Backend/tests/lifecycle_postgres_smoke.py` requires `TEST_DATABASE_URL`. It uses
temporary tables and rolls back all changes. It sends no email, modifies no real
account and submits no blockchain transaction. Physical camera scanning, real
email delivery and real transfers require an explicit user acceptance test.

## Event expectations and Q&A

The web event detail page has visible shortcuts below the event title and a
dedicated discussion panel below the booking overview. `event_community.py`
creates the `event_posts` table at backend startup. Public paginated reads expose
expectations, questions and user replies; writes require an existing user session
and derive the author from that session. Content is limited to 2,000 characters
and rendered as plain text. Replies must target a question in the same event.
No new private keys, service accounts or runtime dependencies are needed.

The mobile source uses the same API instead of the previous screen-local arrays.
Already published APKs retain the old behavior until the next combined APK
release. Existing temporary mobile posts cannot be migrated because they were
never stored on the server. This feature does not change ticket ownership,
payment, QR validation or account-recovery policies.

## Original credential information on the web

The web My Page shows a student credential card before mobile pairing. Its
authenticated `GET /api/account/credential` request is relayed to Auth and uses
the session's primary account, including for delegated mobile signers. The
response contains only the account address, credential type, original issue and
expiry dates, and status; it has `Cache-Control: no-store`. No JWT, email,
private key or identity hash is returned. Reads never reissue or extend a VC.
Dates are displayed with a four-digit year and local device time. A network
failure shows a retry option instead of guessing validity or reusing old dates.
