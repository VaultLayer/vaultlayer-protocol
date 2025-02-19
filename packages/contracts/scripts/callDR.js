const { ethers } = require("hardhat");

async function main() {
    const [caller] = await ethers.getSigners();
    console.log("Calling contract with the account:", caller.address);

    // Replace with the deployed DelegatorReader contract address
    const DelegatorReaderAddress = "0x1AD38d8F0619434A0f0dc26DF6683Fa351d91fc8";

    const DelegatorReader = await ethers.getContractAt("DelegatorReader", DelegatorReaderAddress);

    // Replace with the specific addresses you want to query
    const delegatorAddress = "0xd6eeF6A4ceB9270776d6b388cFaBA62f5Bc3357f";

    // Fetch and display delegator info
    const delegatorInfo = await DelegatorReader.getDelegatorDetails(delegatorAddress);
    console.log("Delegator Info:", delegatorInfo);

    /*

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

    try {

        const round = await DelegatorReader.getRound();
        console.log("round:", round);

        const stakeHubAddress = "0x0000000000000000000000000000000000001010";
        // Call the simulateClaimReward function on the DelegatorReader contract
        const rewards = await DelegatorReader.simulateClaimReward(stakeHubAddress);
    
        console.log("Pending Rewards by Asset Type:");
        const assetTypes = ["CORE", "HashRate", "BTC Staking"];
        let totalReward = ethers.BigNumber.from(0);
    
        rewards.forEach((reward, index) => {
          const formattedReward = ethers.utils.formatUnits(reward, 18); // Assuming 18 decimals
          console.log(`${assetTypes[index]}: ${formattedReward} CORE`);
          totalReward = totalReward.add(reward);
        });
    
        console.log("\nTotal Pending Rewards:", ethers.utils.formatUnits(totalReward, 18), "CORE");
      } catch (error) {
        console.error("Error simulating claimReward:", error);
      }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
