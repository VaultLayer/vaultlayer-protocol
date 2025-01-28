// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "./BitcoinHelper.sol"; 

contract MockBitcoinStake {
    struct BtcTx {
        uint64 amount;
        uint32 outputIndex;
        uint256 blockTimestamp;
        uint32 lockTime;
        uint32 usedHeight;
    }

    struct Receipt {
        address candidate;
        address delegator;
        uint256 round;
    }

    mapping(bytes32 => BtcTx) public btcTxMap;
    mapping(bytes32 => Receipt) public receiptMap;

    function addBtcTx(bytes calldata btcTx, uint64 amount, uint32 outputIndex, uint32 lockTime, uint32 usedHeight) external {
        bytes32 txId = BitcoinHelper.calculateTxId(btcTx);
        btcTxMap[txId] = BtcTx(amount, outputIndex, block.timestamp, lockTime, usedHeight);
    }

    function addReceipt(bytes calldata btcTx, address delegator, uint256 round) external {
        bytes32 txId = BitcoinHelper.calculateTxId(btcTx);
        receiptMap[txId] = Receipt(address(this), delegator, round);
    }
}
