// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

contract MockStakeHub {
    uint256[] public rewards;

    function addReward(uint256 reward) external {
        rewards.push(reward);
    }

    function claimReward() external view returns (uint256[] memory) {
        return rewards;
    }
    /*
    function roundTag() external view returns (uint256) {
        return roundTag;
    }*/
}
