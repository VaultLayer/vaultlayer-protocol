// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

contract MockCoreAgent {
    mapping(address => uint256) public stakedAmounts;
    mapping(address => uint256) public delegatedAmounts;

    // Mock function to simulate staking CORE
    function delegateCoin(address validator, uint256 amount) external payable {
        require(msg.value == amount, "Incorrect ETH sent");
        stakedAmounts[validator] += amount;
        delegatedAmounts[msg.sender] += amount;
    }

    // Mock function to simulate unstaking CORE
    function undelegateCoin(address validator, uint256 amount) external payable {
        require(stakedAmounts[validator] >= amount, "Not enough staked CORE");
        stakedAmounts[validator] -= amount;
        delegatedAmounts[msg.sender] -= amount;

        payable(msg.sender).transfer(amount); // Return funds
    }

    // Get the amount delegated by a user
    function getDelegatedAmount(address user) external view returns (uint256) {
        return delegatedAmounts[user];
    }

    // Get the total amount staked in a validator
    function getStakedAmount(address validator) external view returns (uint256) {
        return stakedAmounts[validator];
    }
}
