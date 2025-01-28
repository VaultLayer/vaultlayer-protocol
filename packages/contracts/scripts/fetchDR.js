const ethers = require("ethers");

// Setup provider and contract
const provider = new ethers.providers.JsonRpcProvider("https://rpc.coredao.org");


async function fetchDelegatorData(delegatorAddress) {
  const coreAgentAddress = "0x0000000000000000000000000000000000001011";

  const abi = [
    // ABI for rewardMap
    "function rewardMap(address delegator) external view returns (uint256 reward, uint256 accStakedAmount)",
    // ABI for getCandidateListByDelegator
    "function getCandidateListByDelegator(address delegator) external view returns (address[] memory)",
    // ABI for getDelegator
    "function getDelegator(address candidate, address delegator) external view returns (uint256 stakedAmount, uint256 realtimeAmount, uint256 transferredAmount, uint256 changeRound)",
    "function accruedRewardMap(address candidate, uint256 round) external view returns (uint256)",
    "function claimReward(address delegator, uint256 round) external returns (uint256, int256, uint256)",
  ];
  const contract = new ethers.Contract(coreAgentAddress, abi, provider);

  // Fetch RewardMap details
  const rewardData = await contract.rewardMap(delegatorAddress);
  console.log("Reward Details:");
  console.log("Reward Amount:", rewardData.reward.toString());
  console.log("Acc Staked Amount:", rewardData.accStakedAmount.toString());

  // Fetch Candidate List
  const candidates = await contract.getCandidateListByDelegator(delegatorAddress);
  console.log("\nCandidates:", candidates);

  let delegatorDetails = [];

  // Loop through candidates to fetch delegator and candidate info
  for (const candidate of candidates) {
    const delegator = await contract.getDelegator(candidate, delegatorAddress);
    const accruedReward = await contract.accruedRewardMap(candidate, delegator.changeRound.toString());
    console.log("Accrued Reward:", accruedReward.toString());
    delegatorDetails.push({
      candidate,
      stakedAmount: delegator.stakedAmount.toString(),
      realtimeAmount: delegator.realtimeAmount.toString(),
      transferredAmount: delegator.transferredAmount.toString(),
      changeRound: delegator.changeRound.toString(),
      accruedReward: accruedReward.toString(),
    });
  }

  console.log("\nDelegator Details:");
  console.table(delegatorDetails);
}



async function fetchPendingRewards(delegatorPrivateKey) {
  const stakeHubAddress = "0x0000000000000000000000000000000000001010"; // Replace with StakeHub contract address

  // ABI for StakeHub's claimReward function
  const abi = [
    "function claimReward() external returns (uint256[] memory)"
  ];
  // Create wallet for the delegator
  const wallet = new ethers.Wallet(delegatorPrivateKey, provider);
  const contract = new ethers.Contract(stakeHubAddress, abi, wallet);

  try {
    // Simulate the call using callStatic
    const pendingRewards = await contract.callStatic.claimReward();

    // Define asset types based on your description
    const assetTypes = ["CORE", "HashRate", "BTC Staking"];

    // Output results
    console.log("Pending Rewards by Asset Type:");
    let totalReward = ethers.BigNumber.from(0);

    pendingRewards.forEach((reward, index) => {
      const formattedReward = ethers.utils.formatUnits(reward, 18); // Assuming 18 decimals
      console.log(`${assetTypes[index]}: ${formattedReward} CORE`);
      totalReward = totalReward.add(reward);
    });

    console.log("\nTotal Pending Rewards:", ethers.utils.formatUnits(totalReward, 18), "CORE");
  } catch (error) {
    console.error("Error fetching pending rewards:", error);
  }
}

// Replace with the delegator's private key
const delegatorPrivateKey = ""; // Replace securely!
//fetchPendingRewards(delegatorPrivateKey);

/*
Pending Rewards by Asset Type:
CORE: 0.190879685236456692 ETH
HashRate: 0.0 ETH
BTC Staking: 1.911722945462138216 ETH

Total Pending Rewards: 2.102602630698594908 ETH
*/



// Replace with actual delegator address
fetchDelegatorData("0xd6eeF6A4ceB9270776d6b388cFaBA62f5Bc3357f");

/*
Reward Details:
Reward Amount: 0
Acc Staked Amount: 0

Candidates: [ '0xA21CBd3caa4Fe89BCcD1D716c92cE4533E4D4733' ]
Accrued Reward: 10563161998055278059356

Delegator Details:
┌─────────┬──────────────────────────────────────────────┬──────────────┬─────────────────────────┬───────────────────┬─────────────┬───────────────────────────┐
│ (index) │ candidate                                    │ stakedAmount │ realtimeAmount          │ transferredAmount │ changeRound │ accruedReward             │
├─────────┼──────────────────────────────────────────────┼──────────────┼─────────────────────────┼───────────────────┼─────────────┼───────────────────────────┤
│ 0       │ '0xA21CBd3caa4Fe89BCcD1D716c92cE4533E4D4733' │ '0'          │ '800000000000000000000' │ '0'               │ '20088'     │ '10563161998055278059356' │
└─────────┴──────────────────────────────────────────────┴──────────────┴─────────────────────────┴───────────────────┴─────────────┴───────────────────────────┘
*/

