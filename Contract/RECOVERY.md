# Wallet recovery contract

`TicketPro.sol` supports tickets minted by this contract. It does not import or
move NFTs from an older deployment. Deploying this contract does not change the
old contract or recover its tickets. Existing tickets require a separately
reviewed migration plan before changing the production contract address.

## Server workflow

1. Verify the university identity again and verify control of the destination
   wallet. Operator authorization alone does not prove the user's identity.
2. Use a new destination wallet that has never bought, received, or participated
   in recovery in this contract. Call `configureWalletRecovery(from, to)` once.
3. Call `recoverTicket(previousOwner, to, tokenId)` for each ticket still held by
   any previous wallet in that identity's recovery chain.
4. Confirm receipts and update DB ownership and login bindings. Recovery must not
   set `is_transferred` or reset it. Keep pending operations resumable after a
   timeout; inspect chain state before retrying confirmed operations.

Configuration retires the previous wallet immediately, even while some tickets
await recovery. The active wallet can still buy or transfer other tickets.
Repeated recovery must start from the current active wallet and use another new
destination. Tickets left in older wallets can be recovered to the newest wallet.

Purchase counts belong to a stable on-chain identity and are shared by all its
recovery wallets. This preserves the existing limit of four purchases per event;
it is not a limit on tickets received by companion transfer. `originalBuyer`
continues to record the original mint address, not the current identity wallet.

Each recovered ticket increments its transfer nonce, invalidating previous
signatures, and preserves its one-time companion-transfer flag. Ordinary transfer
and recovery both emit ERC721 `Transfer`; recovery also emits `TicketRecovered`.
The backend must distinguish recovery from ordinary companion transfer.

## Deployment and verification

Compile with Solidity 0.8.24 and OpenZeppelin 5.0.2. Regenerate backend/frontend
ABIs and implement the recovery API before enabling this workflow. No production
deployment or migration is performed by editing the source file.

With `solc@0.8.24`, `@openzeppelin/contracts@5.0.2`, `ethers@6` and `ganache`
available to Node.js, run `node Contract/tests/recovery.cjs` from the project root.
The tests use an in-memory chain and do not submit transactions to Polygon.
