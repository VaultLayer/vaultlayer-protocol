// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockERC20
 * @dev A simple mock ERC-20 token for testing purposes.
 */
contract MockERC20 is ERC20 {
    /**
     * @dev Constructor to initialize the mock token with a name, symbol, and initial supply.
     * @param name Name of the token.
     * @param symbol Symbol of the token.
     * @param initialSupply Initial supply of tokens, in smallest units (e.g., wei).
     */
    constructor(
        string memory name,
        string memory symbol,
        uint256 initialSupply
    ) ERC20(name, symbol) {
        // Mint initial supply to the deployer
        _mint(msg.sender, initialSupply);
    }

    /**
     * @dev Allows anyone to mint additional tokens. Only for testing purposes.
     * @param account Address to receive the minted tokens.
     * @param amount Amount of tokens to mint.
     */
    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }

    /**
     * @dev Allows anyone to burn tokens from their own balance. Only for testing purposes.
     * @param amount Amount of tokens to burn.
     */
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}
