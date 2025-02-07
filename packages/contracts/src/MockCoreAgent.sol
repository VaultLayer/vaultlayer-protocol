// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

contract MockCoreAgent {
    // Struct to hold delegation info.
    struct CoinDelegator {
        uint256 stakedAmount;
        uint256 realtimeAmount;
        uint256 transferredAmount;
        uint256 changeRound;
    }

    // Total amounts staked per candidate (validator)
    mapping(address => uint256) public stakedAmounts;
    // Total amounts delegated by a delegator.
    mapping(address => uint256) public delegatedAmounts;

    // Mapping from a delegator address to an array of candidate addresses.
    mapping(address => address[]) private candidateList;
    // Nested mapping: candidate => delegator => CoinDelegator info.
    mapping(address => mapping(address => CoinDelegator)) public delegations;

    // Mock function to simulate staking CORE.
    // The caller (delegator) specifies a validator (candidate) and sends ETH.
    function delegateCoin(address validator, uint256 amount) external payable {
        require(msg.value == amount, "Incorrect ETH sent");
        
        // Update totals.
        stakedAmounts[validator] += amount;
        delegatedAmounts[msg.sender] += amount;
        
        // If the candidate is not already in the delegator's candidate list, add it.
        bool found = false;
        address[] storage candidates = candidateList[msg.sender];
        for (uint256 i = 0; i < candidates.length; i++) {
            if (candidates[i] == validator) {
                found = true;
                break;
            }
        }
        if (!found) {
            candidates.push(validator);
        }
        
        // Update the delegation info.
        CoinDelegator storage info = delegations[validator][msg.sender];
        info.stakedAmount += amount;
        info.realtimeAmount += amount; // For simplicity, assume realtime equals staked.
        // transferredAmount and changeRound remain 0.
    }

    // Mock function to simulate unstaking CORE.
    // The caller (delegator) calls this specifying the candidate from which to undelegate.
    function undelegateCoin(address validator, uint256 amount) external payable {
        require(stakedAmounts[validator] >= amount, "Not enough staked CORE");
        stakedAmounts[validator] -= amount;
        delegatedAmounts[msg.sender] -= amount;
        
        CoinDelegator storage info = delegations[validator][msg.sender];
        require(info.stakedAmount >= amount, "Not enough delegated");
        info.stakedAmount -= amount;
        if (info.realtimeAmount >= amount) {
            info.realtimeAmount -= amount;
        } else {
            info.realtimeAmount = 0;
        }
        
        // Return funds to the caller.
        payable(msg.sender).transfer(amount);
    }

    // Get the candidate list (i.e. validators) for a given delegator.
    function getCandidateListByDelegator(address delegator) external view returns (address[] memory) {
        return candidateList[delegator];
    }

    // Get the delegation (CoinDelegator) information for a given candidate and delegator.
    function getDelegator(address candidate, address delegator) external view returns (CoinDelegator memory) {
        return delegations[candidate][delegator];
    }

    // A simple mock for transferCoin (not used in our tests).
    function transferCoin(address sourceCandidate, address targetCandidate, uint256 amount) external {
        require(stakedAmounts[sourceCandidate] >= amount, "Not enough staked at source");
        stakedAmounts[sourceCandidate] -= amount;
        stakedAmounts[targetCandidate] += amount;
    }
}
