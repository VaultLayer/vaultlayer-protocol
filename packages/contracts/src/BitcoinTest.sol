// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./BitcoinHelper.sol";

contract BitcoinTest {
    using BitcoinHelper for bytes;

    function testExtractBitcoinAddress(bytes memory script)
        public
        pure
        returns (uint32, bytes20)
    {
        return BitcoinHelper.extractBitcoinAddress(script);
    }
}