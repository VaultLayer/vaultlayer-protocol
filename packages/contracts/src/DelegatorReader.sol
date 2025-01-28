// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface ICoreAgent {
    struct CoinDelegator {
        uint256 stakedAmount;
        uint256 realtimeAmount;
        uint256 transferredAmount;
        uint256 changeRound;
    }

    struct Candidate {
        uint256 amount;
        uint256 realtimeAmount;
        uint256[] continuousRewardEndRounds;
    }

    struct Delegator {
        address[] candidates;
        uint256 amount;
    }

    struct Reward {
        uint256 reward;
        uint256 accStakedAmount;
    }

    function getDelegator(address candidate, address delegator) external view returns (CoinDelegator memory);
    function getCandidateListByDelegator(address delegator) external view returns (address[] memory);
}

contract DelegatorReader {
    ICoreAgent public coreAgent;

    constructor(address _coreAgentAddress) {
        coreAgent = ICoreAgent(_coreAgentAddress);
    }

    
    /*

    // Fetch how much CORE our address has delegated to CORE validators (candidates):

    Sample output:

    Delegator Info: [
        [ '0xA21CBd3caa4Fe89BCcD1D716c92cE4533E4D4733' ],
        [ BigNumber { value: "0" } ],
        [ BigNumber { value: "800000000000000000000" } ],
        [ BigNumber { value: "0" } ],
        [ BigNumber { value: "20088" } ],
        candidates: [ '0xA21CBd3caa4Fe89BCcD1D716c92cE4533E4D4733' ],
        stakedAmounts: [ BigNumber { value: "0" } ],
        realtimeAmounts: [ BigNumber { value: "800000000000000000000" } ],
        transferredAmounts: [ BigNumber { value: "0" } ],
        changeRounds: [ BigNumber { value: "20088" } ]
        ]

    */
    function getDelegatorDetails(address delegatorAddress)
        public
        view
        returns (
            address[] memory candidates,
            uint256[] memory stakedAmounts,
            uint256[] memory realtimeAmounts,
            uint256[] memory transferredAmounts,
            uint256[] memory changeRounds
        )
    {
        // Fetch delegator candidates list
        candidates = coreAgent.getCandidateListByDelegator(delegatorAddress);
        uint256 length = candidates.length;

        // Initialize arrays to store details
        stakedAmounts = new uint256[](length);
        realtimeAmounts = new uint256[](length);
        transferredAmounts = new uint256[](length);
        changeRounds = new uint256[](length);

        // Loop through each candidate to fetch delegator details
        for (uint256 i = 0; i < length; i++) {
            ICoreAgent.CoinDelegator memory delegator = coreAgent.getDelegator(candidates[i], delegatorAddress);
            stakedAmounts[i] = delegator.stakedAmount;
            realtimeAmounts[i] = delegator.realtimeAmount;
            transferredAmounts[i] = delegator.transferredAmount;
            changeRounds[i] = delegator.changeRound;
        }
    }

    function simulateClaimReward(address stakeHubAddress) external view returns (uint256[] memory) {
        // ABI-encoded function signature for `claimReward()`
        bytes memory data = abi.encodeWithSignature("claimReward()");

        // Perform a low-level static call
        (bool success, bytes memory result) = stakeHubAddress.staticcall(data);

        require(success, "Static call failed");

        // Decode the returned data
        return abi.decode(result, (uint256[]));
    }

}
