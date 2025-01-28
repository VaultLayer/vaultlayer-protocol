// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/**
 * @title MockNFT
 * @dev A simple ERC721 contract for testing purposes.
 */
contract MockNFT is ERC721 {
    uint256 private _tokenIds;

    constructor() ERC721("MockNFT", "MNFT") {}

    /**
     * @notice Mint a new token to the caller.
     * @return The newly minted token ID.
     */
    function mint() external returns (uint256) {
        _tokenIds++;
        _mint(msg.sender, _tokenIds);
        return _tokenIds;
    }
}
