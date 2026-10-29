// Run with Node.js and solc@0.8.24, @openzeppelin/contracts@5.0.2,
// ethers@6 and ganache installed (or available via NODE_PATH).
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const solc = require('solc');
const ganache = require('ganache');
const { BrowserProvider, ContractFactory, Wallet } = require('ethers');

async function main() {
  assert.match(solc.version(), /^0\.8\.24\+/);
  assert.equal(require('@openzeppelin/contracts/package.json').version, '5.0.2');
  const input = {
    language: 'Solidity',
    sources: { 'TicketPro.sol': { content: fs.readFileSync(path.join(__dirname, '../TicketPro.sol'), 'utf8') } },
    settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: (name) => {
    try { return { contents: fs.readFileSync(require.resolve(name.replace('@openzeppelin/contracts@5.0.2/', '@openzeppelin/contracts/')), 'utf8') }; }
    catch (error) { return { error: error.message }; }
  } }));
  assert.deepEqual((output.errors || []).filter(e => e.severity === 'error'), []);
  const compiled = output.contracts['TicketPro.sol'].TicketPro;
  const rpc = ganache.provider({ logging: { quiet: true }, chain: { chainId: 137 } });
  try {
    const provider = new BrowserProvider(rpc, undefined, { cacheTimeout: -1 });
    provider.pollingInterval = 10;
    const signers = await Promise.all(Array.from({ length: 7 }, (_, i) => provider.getSigner(i)));
    const addresses = await Promise.all(signers.map(s => s.getAddress()));
    const [owner, operator, buyer, recipient, replacement, replacement2, outsider] = signers;
    const contract = await new ContractFactory(compiled.abi, compiled.evm.bytecode.object, owner).deploy(addresses[0], addresses[1]);
    await contract.waitForDeployment();
    const op = contract.connect(operator);
    const send = async promise => (await promise).wait();
    const rejects = async action => {
      let failed = false;
      try { const tx = await action(); if (tx.wait) await tx.wait(); } catch { failed = true; }
      assert.ok(failed, 'Expected transaction to revert');
    };
    await rejects(() => contract.connect(outsider).configureWalletRecovery(addresses[2], addresses[4]));
    await send(op.buyTicketsFor(addresses[2], 7, 4));
    await rejects(() => op.buyTicketsFor(addresses[2], 7, 1));
    await rejects(() => contract.connect(buyer).transferFrom(addresses[2], addresses[3], 1));
    const domain = { name: 'PolygonConcertTicket', version: '1', chainId: 137, verifyingContract: await contract.getAddress() };
    const types = { TransferTicket: [
      { name: 'from', type: 'address' }, { name: 'to', type: 'address' },
      { name: 'tokenId', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
    ] };
    const deadline = (await provider.getBlock('latest')).timestamp + 300;
    async function signature(index, tokenId, to, nonce) {
      const wallet = new Wallet(rpc.getInitialAccounts()[addresses[index].toLowerCase()].secretKey);
      return wallet.signTypedData(domain, types, { from: addresses[index], to, tokenId, nonce, deadline });
    }
    const oldSignature = await signature(2, 1, addresses[3], 0);
    await rejects(() => op.transferTicket(addresses[2], addresses[2], 1, deadline, oldSignature));
    await rejects(() => op.recoverTicket(addresses[2], addresses[4], 1));
    await send(op.configureWalletRecovery(addresses[2], addresses[4]));
    await rejects(() => op.transferTicket(addresses[2], addresses[3], 1, deadline, oldSignature));
    await send(op.recoverTicket(addresses[2], addresses[4], 1));
    assert.equal(await contract.ownerOf(1), addresses[4]);
    assert.equal(await contract.hasBeenTransferred(1), false);
    assert.equal(await contract.transferNonces(1), 1n);
    assert.equal(await contract.originalBuyer(1), addresses[2]);
    assert.equal(await contract.ticketEvent(1), 7n);
    assert.equal(await contract.eventPurchaseCount(7, addresses[4]), 4n);
    await rejects(() => op.buyTicketsFor(addresses[4], 7, 1));
    await rejects(() => op.buyTicketsFor(addresses[2], 8, 1));
    await rejects(() => op.transferTicket(addresses[4], addresses[3], 1, deadline, oldSignature));
    await send(op.transferTicket(addresses[4], addresses[3], 1, deadline, await signature(4, 1, addresses[3], 1)));
    assert.equal(await contract.hasBeenTransferred(1), true);
    await send(op.configureWalletRecovery(addresses[3], addresses[6]));
    await send(op.recoverTicket(addresses[3], addresses[6], 1));
    assert.equal(await contract.hasBeenTransferred(1), true);
    await rejects(async () => op.transferTicket(addresses[6], addresses[5], 1, deadline, await signature(6, 1, addresses[5], 3)));
    await send(op.configureWalletRecovery(addresses[4], addresses[5]));
    await send(op.recoverTicket(addresses[2], addresses[5], 2));
    assert.equal(await contract.ownerOf(2), addresses[5]);
    assert.equal(await contract.eventPurchaseCount(7, addresses[5]), 4n);
    await rejects(() => op.configureWalletRecovery(addresses[5], addresses[2]));
    console.log('PASS: Solidity 0.8.24 / OZ 5.0.2 compilation, recovery, repeated recovery, signed transfer, nonce invalidation, purchase limits, authorization and retired-wallet checks');
  } finally { await rpc.disconnect(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
