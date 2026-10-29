// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts@5.0.2/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts@5.0.2/access/Ownable.sol";
import {EIP712} from "@openzeppelin/contracts@5.0.2/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts@5.0.2/utils/cryptography/ECDSA.sol";

/// @notice Polygon ticket NFT with server-paid minting and one-time relayed transfer.
contract TicketPro is ERC721, Ownable, EIP712 {
    error InvalidAddress();
    error InvalidQuantity();
    error EventLimitExceeded();
    error NotOperator();
    error NotTokenOwner();
    error TransferAlreadyUsed();
    error SignatureExpired();
    error InvalidSignature();
    error DirectTransferDisabled();
    error RetiredWallet();
    error RecoveryNotConfigured();
    error RecoveryWalletAlreadyUsed();

    event OperatorUpdated(address indexed previousOperator, address indexed newOperator);
    event WalletRecoveryConfigured(address indexed previousWallet, address indexed currentWallet, address indexed purchaseIdentity);
    event TicketRecovered(uint256 indexed tokenId, address indexed previousWallet, address indexed currentWallet);

    uint256 public constant MAX_TICKETS_PER_EVENT = 4;
    bytes32 public constant TRANSFER_TYPEHASH = keccak256(
        "TransferTicket(address from,address to,uint256 tokenId,uint256 nonce,uint256 deadline)"
    );

    address public operator;
    uint256 private _nextTokenId = 1;
    bool private _relayedTransfer;

    mapping(uint256 => uint256) public ticketEvent;
    mapping(uint256 => address) public originalBuyer;
    mapping(uint256 => bool) public hasBeenTransferred;
    mapping(uint256 => uint256) public transferNonces;
    mapping(uint256 => mapping(address => uint256)) private _eventPurchaseCount;
    mapping(address => address) private _purchaseIdentity;
    mapping(address => address) public currentWallet;

    // All wallets belonging to one recovered identity share its purchase limit.
    function eventPurchaseCount(uint256 eventId, address buyer) public view returns (uint256) {
        address identity = _purchaseIdentity[buyer];
        return _eventPurchaseCount[eventId][identity == address(0) ? buyer : identity];
    }

    function _requireActiveWallet(address wallet) private returns (address identity) {
        if (wallet == address(0)) revert InvalidAddress();
        identity = _purchaseIdentity[wallet];
        if (identity == address(0)) {
            identity = wallet;
            _purchaseIdentity[wallet] = identity;
            currentWallet[identity] = wallet;
        }
        if (currentWallet[identity] != wallet) revert RetiredWallet();
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    constructor(address initialOwner, address initialOperator)
        ERC721("PolygonConcertTicket", "PCTX")
        Ownable(initialOwner)
        EIP712("PolygonConcertTicket", "1")
    {
        if (initialOwner == address(0) || initialOperator == address(0)) {
            revert InvalidAddress();
        }
        operator = initialOperator;
        emit OperatorUpdated(address(0), initialOperator);
    }

    function setOperator(address newOperator) external onlyOwner {
        if (newOperator == address(0)) revert InvalidAddress();
        address previousOperator = operator;
        operator = newOperator;
        emit OperatorUpdated(previousOperator, newOperator);
    }

    /// @notice Operator MUST verify the same university identity and control of
    /// the new wallet off-chain. Destination must be unused in this contract.
    /// This changes the active wallet; tickets are recovered separately.
    function configureWalletRecovery(address from, address to) external onlyOperator {
        if (from == address(0) || to == address(0) || from == to) revert InvalidAddress();
        address identity = _requireActiveWallet(from);
        if (_purchaseIdentity[to] != address(0)) revert RecoveryWalletAlreadyUsed();
        _purchaseIdentity[to] = identity;
        currentWallet[identity] = to;
        emit WalletRecoveryConfigured(from, to, identity);
    }

    /// @notice Recovery does not consume or reset the companion-transfer allowance.
    /// Old wallets in the same recovery chain may still hold unrecovered tickets.
    function recoverTicket(address from, address to, uint256 tokenId) external onlyOperator {
        if (from == address(0) || to == address(0) || from == to) revert InvalidAddress();
        address identity = _purchaseIdentity[from];
        if (identity == address(0) || _purchaseIdentity[to] != identity || currentWallet[identity] != to) {
            revert RecoveryNotConfigured();
        }
        if (ownerOf(tokenId) != from) revert NotTokenOwner();
        ++transferNonces[tokenId];
        _relayedTransfer = true;
        _transfer(from, to, tokenId);
        _relayedTransfer = false;
        emit TicketRecovered(tokenId, from, to);
    }

    function buyTicketsFor(address buyer, uint256 eventId, uint256 quantity)
        external
        onlyOperator
        returns (uint256[] memory tokenIds)
    {
        if (buyer == address(0)) revert InvalidAddress();
        if (quantity == 0 || quantity > MAX_TICKETS_PER_EVENT) revert InvalidQuantity();

        address identity = _requireActiveWallet(buyer);
        uint256 purchased = _eventPurchaseCount[eventId][identity];
        if (purchased + quantity > MAX_TICKETS_PER_EVENT) revert EventLimitExceeded();
        _eventPurchaseCount[eventId][identity] = purchased + quantity;

        tokenIds = new uint256[](quantity);
        for (uint256 i; i < quantity; ++i) {
            uint256 tokenId = _nextTokenId;
            ++_nextTokenId;
            ticketEvent[tokenId] = eventId;
            originalBuyer[tokenId] = buyer;
            tokenIds[i] = tokenId;
            _mint(buyer, tokenId);
        }
    }

    function transferTicket(
        address from,
        address to,
        uint256 tokenId,
        uint256 deadline,
        bytes calldata signature
    ) external onlyOperator {
        if (from == address(0) || to == address(0) || from == to) revert InvalidAddress();
        if (ownerOf(tokenId) != from) revert NotTokenOwner();
        _requireActiveWallet(from);
        _requireActiveWallet(to);
        if (hasBeenTransferred[tokenId]) revert TransferAlreadyUsed();
        if (block.timestamp > deadline) revert SignatureExpired();

        uint256 nonce = transferNonces[tokenId];
        bytes32 structHash = keccak256(
            abi.encode(TRANSFER_TYPEHASH, from, to, tokenId, nonce, deadline)
        );
        if (ECDSA.recover(_hashTypedDataV4(structHash), signature) != from) {
            revert InvalidSignature();
        }

        transferNonces[tokenId] = nonce + 1;
        hasBeenTransferred[tokenId] = true;
        _relayedTransfer = true;
        _transfer(from, to, tokenId);
        _relayedTransfer = false;
    }

    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address from)
    {
        from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0) && !_relayedTransfer) {
            revert DirectTransferDisabled();
        }
        return super._update(to, tokenId, auth);
    }
}
