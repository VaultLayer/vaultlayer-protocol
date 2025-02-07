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

    function convertEthToBtcPubKeyHash(bytes memory ethPubKey) public pure returns (bytes20) {
        require(ethPubKey.length == 65, "Invalid public key length"); // Ensure uncompressed key: 0x04 + 64 bytes

        bytes32 x;
        bytes32 y;

        assembly {
            x := mload(add(ethPubKey, 33))  // Load 32 bytes after the first byte (0x04)
            y := mload(add(ethPubKey, 65))  // Load next 32 bytes for Y coordinate
        }

        // Determine if Y is even or odd by checking the least significant byte
        uint8 lastByteOfY = uint8(ethPubKey[64]);
        uint8 prefix = (lastByteOfY % 2 == 0) ? 0x02 : 0x03;

        // Prepare compressed key: prefix + X coordinate
        bytes memory compressedKey = new bytes(33);
        compressedKey[0] = bytes1(prefix);

        // Copy X coordinate
        for (uint256 i = 0; i < 32; i++) {
            compressedKey[i + 1] = ethPubKey[i + 1]; 
        }

        return compressBtcPubKey(compressedKey);
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
        require(ethPubKey.length == 65, "Invalid public key length"); // Uncompressed public key: 0x04 + 64 bytes

        // Skip the first byte (0x04), hash the remaining 64 bytes
        bytes memory pubKeyWithoutPrefix = new bytes(64);
        for (uint256 i = 0; i < 64; i++) {
            pubKeyWithoutPrefix[i] = ethPubKey[i + 1];
        }

        // Perform keccak256 hashing
        bytes32 ethPubKeyHash = keccak256(pubKeyWithoutPrefix);

        // Take the last 20 bytes of the hash to form the address
        return address(uint160(uint256(ethPubKeyHash)));
    }


    function verifyEthPubKeySignature(
        string memory message,
        bytes memory signature,
        bytes memory ethPubKey,
        address recipient
    ) public pure returns (bool) {
        require(ethPubKey.length == 65, "Invalid Ethereum public key length");
        require(signature.length == 65, "Invalid signature length");
        
        address derivedAddress = deriveAddress(ethPubKey);

        // Concatenate message with recipient address
        //string memory fullMessage = string(abi.encodePacked(message, toString(recipient)));
        string memory fullMessage = string(abi.encodePacked(message, toAsciiString(recipient)));
        

        // Hash the message with Ethereum's message prefix
        bytes32 messageHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n", uintToStr(bytes(fullMessage).length), fullMessage)
        );
        
        // Recover the signer address from the signature
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

    function uintToStr(uint256 _i) internal pure returns (string memory str) {
        if (_i == 0) {
            return "0";
        }
        uint256 j = _i;
        uint256 length;
        while (j != 0) {
            length++;
            j /= 10;
        }
        bytes memory bstr = new bytes(length);
        uint256 k = length;
        j = _i;
        while (j != 0) {
            bstr[--k] = bytes1(uint8(48 + j % 10));
            j /= 10;
        }
        str = string(bstr);
    }

    function toAsciiString(address x) internal pure returns (string memory) {
        bytes memory s = new bytes(42);
        s[0] = "0";
        s[1] = "x";
        for (uint256 i = 0; i < 20; i++) {
            bytes1 b = bytes1(uint8(uint256(uint160(x)) / (2**(8 * (19 - i)))));
            s[2 + i * 2] = char(uint8(b) / 16);
            s[3 + i * 2] = char(uint8(b) % 16);
        }
        return string(s);
    }

    function char(uint8 b) internal pure returns (bytes1 c) {
        if (b < 10) return bytes1(b + 0x30);
        else return bytes1(b + 0x57);
    }


    // Hash the provided uncompressed public key using SHA-256, then RIPEMD-160
    function compressBtcPubKey(
        bytes memory compressedPubKey
    ) public pure returns (bytes20) {    
        bytes32 sha256Hash = sha256(compressedPubKey);
        return ripemd160(abi.encodePacked(sha256Hash));
    }

    function toString(address _address) internal pure returns (string memory) {
        bytes32 value = bytes32(uint256(uint160(_address)));
        bytes memory alphabet = "0123456789abcdef";
        bytes memory buffer = new bytes(42);

        buffer[0] = '0';
        buffer[1] = 'x';

        for (uint256 i = 0; i < 20; i++) {
            buffer[2 + i * 2] = alphabet[uint8(value[i + 12] >> 4)];
            buffer[3 + i * 2] = alphabet[uint8(value[i + 12] & 0x0f)];
        }

        return string(buffer);
    }

    function bytesContains(bytes memory haystack, bytes memory needle) internal pure returns (bool) {
        if (needle.length > haystack.length) {
            return false;
        }
        // loop through haystack and check if needle is found
        for (uint256 i = 0; i <= haystack.length - needle.length; i++) {
            bool found = true;
            for (uint256 j = 0; j < needle.length; j++) {
                if (haystack[i + j] != needle[j]) {
                    found = false;
                    break;
                }
            }
            if (found) {
                return true;
            }
        }
        return false;
    }

}

