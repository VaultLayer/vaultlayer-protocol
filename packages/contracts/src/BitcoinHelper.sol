// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

library BitcoinHelper {

    /// @notice                      Calculates the required transaction Id from the transaction details
    /// @dev                         Calculates the hash of transaction details two consecutive times
    /// @param _tx                   The Bitcoin transaction
    /// @return                      Transaction Id of the transaction (in LE form)
    function calculateTxId(bytes memory _tx) internal pure returns (bytes32) {
        bytes32 inputHash1 = sha256(_tx);
        bytes32 inputHash2 = sha256(abi.encodePacked(inputHash1));
        return inputHash2;
    }

    uint256 constant P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F;

    /**
     * @dev Compresses a public key using secp256k1 format (prefix + x coordinate)
     * @param x - The x coordinate of the public key
     * @param y - The y coordinate of the public key
     * @return The compressed Bitcoin public key
     */
    function compressPubKey(bytes32 x, bytes32 y) internal pure returns (bytes memory) {
        uint8 prefix = (uint256(y) % 2 == 0) ? 0x02 : 0x03;
        return abi.encodePacked(prefix, x);
    }

    function convertEthToBtcPubKeyHash(bytes memory ethPubKey) public pure returns (bytes20) {
        // Split the Ethereum public key into x and y coordinates
        bytes32 x;
        bytes32 y;
        assembly {
            x := mload(add(ethPubKey, 0x20))
            y := mload(add(ethPubKey, 0x40))
        }

        // Convert Ethereum public key to compressed Bitcoin public key
        bytes compressedPubKey = compressPubKey(x, y);
        // Hash the provided uncompressed public key using SHA-256, then RIPEMD-160
        return ripemd160(abi.encodePacked(sha256(compressedPubKey)));
    }

    function recoverEthereumSigner(bytes32 messageHash, bytes memory signature) public pure returns (address) {
        require(signature.length == 65, "Invalid signature length");

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }

        // Ensure v is in the correct range for Ethereum (27 or 28)
        if (v < 27) {
            v += 27;
        }

        require(v == 27 || v == 28, "Invalid recovery byte");

        return ecrecover(messageHash, v, r, s);
    }


    // Derive Ethereum address from public key (keccak256 hash of public key, last 20 bytes)
    function deriveAddress(bytes memory ethPubKey) public pure returns (address addr) {
        bytes32 pubKeyHash = keccak256(ethPubKey);
        return address(uint160(uint256(pubKeyHash)));
    }

    function verifyEthPubKeySignature(
        bytes memory signature,
        bytes memory signature,
        bytes memory ethPubKey
    ) public pure returns (bool) {
        require(ethPubKey.length == 64, "Invalid Ethereum public key length");
        address derivedAddress = deriveAddress(ethPubKey);
        
        // Recover the signer address from the signature
        bytes32 messageHash = keccak256(abi.encodePacked(message));
        address recoveredAddress = recoverEthereumSigner(messageHash, signature);

        // Ensure the recovered address matches the derived one
        return recoveredAddress == derivedAddress;
    }

    function extractBitcoinAddress(bytes memory script) internal pure returns (uint32, bytes20) {
        require(script.length >= 25, "Invalid script length"); // Ensure minimum length

        uint32 timelock;
        bytes20 pubKeyHash;

        // --- STEP 1: Extract Timelock ---
        uint256 t;
        assembly {
            let loc := add(script, 0x21) // Timelock at offset 0x21
            t := mload(loc)             // Read 32 bytes
        }
        timelock = uint32(reverseUint256(t) & 0xFFFFFFFF); // Reverse bytes and mask

        // --- STEP 2: Extract Public Key Hash ---
        assembly {
            let loc := add(script, 0x2A) // Correct offset (directly at hash start)
            let temp := mload(loc)       // Load 32 bytes

            // Manually mask and truncate to 20 bytes
            pubKeyHash := and(temp, 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF000000000000000000000000)
        }
        
        // Return extracted values
        return (timelock, pubKeyHash);
    }

    // Reverse uint256 for endianness conversion
    function reverseUint256(uint256 input) internal pure returns (uint256) {
        uint256 output = 0;
        for (uint8 i = 0; i < 32; i++) {
            output = (output << 8) | (input & 0xFF); // Shift and extract last byte
            input >>= 8;                            // Shift input right
        }
        return output;
    }

    function verifyPubKey(
        bytes20 btcPubKeyHash,
        bytes memory compressedPubKey
    ) public pure returns (bool) {
        // Hash the provided uncompressed public key using SHA-256, then RIPEMD-160
        bytes20 calculatedPubKeyHash = ripemd160(abi.encodePacked(sha256(compressedPubKey)));

        return calculatedPubKeyHash == btcPubKeyHash;
    }

}

