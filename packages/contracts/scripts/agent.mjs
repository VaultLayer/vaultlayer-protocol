// VaultLayer Oracle Agent
import { ethers } from "ethers";
import * as bitcoin from "bitcoinjs-lib";
import 'dotenv/config';

import VaulterCore from "../artifacts/src/VaulterCore.sol/VaulterCore.json" assert { type: "json" };

const RPC_URL = "https://rpc.coredao.org";
const MEMPOOL_API = "https://mempool.space/api";
const PRIVATE_KEY = process.env.PRIVATE_KEY;

// Replace with the deployed contract address
const VAULTER_CORE_CONTRACT_ADDRESS = '0x03CE4E6785639db0fc4138Ad70c76fe047a9496f';

const CORE_API_LIVENET_URI = 'https://stake.coredao.org';
const VALIDATORS_API = 'https://staking-api.coredao.org/staking/status/validators';

const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

const vaulterCore = new ethers.Contract(VAULTER_CORE_CONTRACT_ADDRESS, VaulterCore.abi, wallet);

export function calculateTxId(tx) {
    // Perform the first SHA-256 hash
    const inputHash1 = ethers.utils.sha256('0x' + tx);

    // Perform abi.encodePacked
    const packed = ethers.utils.concat([inputHash1]); // Concatenates input bytes

    // Compute SHA-256 hash
    const inputHash2 = ethers.utils.sha256(packed);
    // Return the final hash
    return inputHash2;
}

async function getGasFees() {
    const gasPrice = await provider.getGasPrice();
    const maxPriorityFeePerGas = gasPrice; // 95% of gasPrice as tip
    const maxFeePerGas = gasPrice.add(ethers.utils.parseUnits('1', 'gwei')); // gasPrice + buffer
    console.log(`Max Fee Per Gas: ${ethers.utils.formatUnits(maxFeePerGas, 'gwei')} Gwei`);
    console.log(`Max Priority Fee Per Gas: ${ethers.utils.formatUnits(maxPriorityFeePerGas, 'gwei')} Gwei`);
  
    return { maxFeePerGas, maxPriorityFeePerGas };
  }

async function performDailyTasks() {
    try {
        console.log('Starting daily tasks...');

        // Global state before the round:
        await getGlobalParameters();

        // 1. Claim CORE rewards from previous round and handle round updates internally in contract    
        try {
            // First check if we have pending rewards or not    
            const rewardsSummary = await getPendingRewards();
        
            if (rewardsSummary.hasPendingRewards) {
              console.log("🚀 Pending rewards detected, claiming now...");
        
              // Call the claim function
              const rewards = await claimCoreRewards();
              console.log(`✅ Rewards claimed: ${rewards}`);
            } else {
              console.log("✅ No pending rewards at the moment.");
            }
          } catch (error) {
            console.error("❌ Error during check and claim:", error.message);
          }
        
        // 2. Check BTC staking transactions delegated to our contract for next round
        const delegatedTxCount = await processBTCDelegations();
        console.log(`✅ Delegated BTC transactions processed: ${delegatedTxCount}`);
      
        // 3. Adjust CORE staking to maintain ratio
        await adjustCOREStaking();
        console.log('CORE staking adjusted.');

        console.log('Daily tasks completed successfully!');
    } catch (error) {
        console.error('Error during daily tasks:', error);
    }
}

// 🛡️ Utility: Fetch Pending Rewards from CoreDAO Staking API
async function getPendingRewards() {
    const apiUrl = `https://staking-api.coredao.org/staking/summary/core?coreAddress=${VAULTER_CORE_CONTRACT_ADDRESS}`;
    
    try {
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
  
      if (!response.ok) {
        throw new Error(`API request failed with status: ${response.status}`);
      }
  
      const data = await response.json();
  
      if (data.code !== "00000") {
        throw new Error(`API error: ${data.message}`);
      }
  
      const rewards = data.data;
      console.log("CoreDAO Staking Rewards Summary:", rewards);
  
      // 📝 Check for pending rewards
      const hasPendingRewards = (
        parseFloat(rewards.pendingCoreReward) > 0 ||
        parseFloat(rewards.pendingHashReward) > 0 ||
        parseFloat(rewards.pendingBTCReward) > 0
      );
  
      return {
        hasPendingRewards,
        pendingCoreReward: rewards.pendingCoreReward,
        pendingHashReward: rewards.pendingHashReward,
        pendingBTCReward: rewards.pendingBTCReward,
        claimedCoreReward: rewards.claimedCoreReward,
        claimedHashReward: rewards.claimedHashReward,
        claimedBTCReward: rewards.claimedBTCReward,
        stakedCoreAmount: rewards.stakedCoreAmount,
        stakedBTCAmount: rewards.stakedBTCAmount,
      };
    } catch (error) {
      console.error("Error fetching CoreDAO staking rewards:", error.message);
      throw error;
    }
  }
  

  export async function getGlobalParameters() {
    try {
      // 📝 Fetch All Global Parameters
      const [
        totalAssets,
        totalSupply,
        pricePerShare,
        totalBTCStaked,
        totalCoreDeposits,
        totalCoreStaked,
        pendingCoreRewards,
        btcRewardRatio,
        coreRewardRatio,
        protocolFees,
      ] = await Promise.all([
        vaulterCore.totalAssets(),
        vaulterCore.totalSupply(),
        vaulterCore.getPricePerShare(),
        vaulterCore.totalBTCStaked(),
        vaulterCore.totalCoreDeposits(),
        vaulterCore.totalCoreStaked(),
        vaulterCore.pendingCoreRewards(),
        vaulterCore.btcRewardRatio(),
        vaulterCore.coreRewardRatio(),
        vaulterCore.pendingProtocolFees(),
      ]);
  
      // 🟡 Log Results
      console.log("🔹 Global Parameters from VaulterCore:");
      console.log("🟠Total Assets (CORE):", ethers.utils.formatUnits(totalAssets, 18));
      console.log("🟠Total Supply (vltCORE):", ethers.utils.formatUnits(totalSupply, 18));
      console.log("🟠Price per Share (vltCORE):", ethers.utils.formatUnits(pricePerShare, 18));
      console.log("🟠Total BTC Staked:", ethers.utils.formatUnits(totalBTCStaked, 8));
      console.log("🟠Total CORE Deposits:", ethers.utils.formatUnits(totalCoreDeposits, 18));
      console.log("🟠Total CORE Staked:", ethers.utils.formatUnits(totalCoreStaked, 18));
      console.log("🟠Pending CORE Rewards:", ethers.utils.formatUnits(pendingCoreRewards, 18));
      console.log("🟠BTC Reward Ratio:", btcRewardRatio.toString());
      console.log("🟠CORE Reward Ratio:", coreRewardRatio.toString());
      console.log("🟠Pending Protocol Fees:", ethers.utils.formatUnits(protocolFees, 18));
  
      // 🟠Return Results Object
      return {
        totalAssets: ethers.utils.formatUnits(totalAssets, 18),
        totalSupply: ethers.utils.formatUnits(totalSupply, 18),
        pricePerShare: ethers.utils.formatUnits(pricePerShare, 18),
        totalBTCStaked: ethers.utils.formatUnits(totalBTCStaked, 8),
        totalCoreDeposits: ethers.utils.formatUnits(totalCoreDeposits, 18),
        totalCoreStaked: ethers.utils.formatUnits(totalCoreStaked, 18),
        pendingCoreRewards: ethers.utils.formatUnits(pendingCoreRewards, 18),
        btcRewardRatio: btcRewardRatio.toString(),
        coreRewardRatio: coreRewardRatio.toString(),
        protocolFees: ethers.utils.formatUnits(protocolFees, 18),
      };
    } catch (error) {
      console.error("❌ Error fetching global parameters:", error.message);
      throw error;
    }
  }
  

async function claimCoreRewards() {
    try {
      // Step 1️⃣: Try Estimating Gas
      let gasEstimate;
      try {
        gasEstimate = await vaulterCore.estimateGas.claimCoreRewards({
          maxFeePerGas: ethers.utils.parseUnits('32', 'gwei'),
          maxPriorityFeePerGas: ethers.utils.parseUnits('31', 'gwei'),
        });
        console.log(`Estimated Gas: ${gasEstimate.toString()}`);
      } catch (estimateError) {
        console.error('Gas estimation failed:', estimateError.message);
        console.log('Falling back to manual gas limit...');
        gasEstimate = ethers.BigNumber.from('300000'); // Use manual gas limit
      }
  
      // Step 2️⃣: Call Contract with Manual Gas Limit (if needed)
      const tx = await vaulterCore.claimCoreRewards({
        gasLimit: gasEstimate.mul(120).div(100), // Add 20% buffer
        maxFeePerGas: ethers.utils.parseUnits('32', 'gwei'),
        maxPriorityFeePerGas: ethers.utils.parseUnits('31', 'gwei'),
        type: 2, // EIP-1559
      });
  
      console.log(`Transaction sent: ${tx.hash}`);
      const receipt = await tx.wait();
      console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
      console.log(`Gas Used: ${receipt.gasUsed.toString()}`);
    } catch (error) {
      console.error('❌ Transaction failed:', error.message);
  
      // Step 3️⃣: Decode Revert Reason (if available)
      if (error.error && error.error.body) {
        try {
          const errorBody = JSON.parse(error.error.body);
          if (errorBody.error && errorBody.error.data) {
            console.log('Revert Reason:', errorBody.error.data);
          }
        } catch (parseError) {
          console.error('Failed to parse revert reason:', parseError.message);
        }
      }
    }
  }

async function processBTCDelegations() {
    try {
        const { maxFeePerGas, maxPriorityFeePerGas } = await getGasFees();

        console.log('Fetching BTC delegations...');

        const apiUri = CORE_API_LIVENET_URI;
        const url = `${apiUri}/api/staking/search_mystaking_btc_delegator`;
        const all = await fetch(url, {
            method: 'post',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                pageNum: '1',
                pageSize: '3',
                addressHash: VAULTER_CORE_CONTRACT_ADDRESS,
            }),
        }).then(result => result.json());

        console.log('getCorePositions:', all.data.records);        

        let processedCount = 0;

        for (const position of all.data.records) {
            try {                
                // Fetch raw tx details from mempool
                const txResponse = await fetch(`${MEMPOOL_API}/tx/${position.btcTxId}/hex`);
                const rawTx = await txResponse.text();
                //console.log("Decoding Bitcoin transaction...", rawTx);
                const tx = bitcoin.Transaction.fromHex(rawTx);
                const txClone = new bitcoin.Transaction();
                txClone.version = tx.version;

                tx.ins.forEach(input => {
                    txClone.addInput(input.hash, input.index, input.sequence, Buffer.alloc(0));
                });

                tx.outs.forEach(output => {
                    txClone.addOutput(output.script, output.value);
                });

                const btcTx = txClone.toHex();
                //console.log("Formatted BTC transaction for contract:", btcTx);

                const calculatedTxId = calculateTxId(btcTx);
                console.log("Calculated TxId:", calculatedTxId);

                const isOnMap = await vaulterCore.btcTxMap(calculatedTxId);
                if (isOnMap.amount.isZero()){
                    // Estimate gas limit
                    const gasEstimate = await vaulterCore.estimateGas.recordBTCStake(`0x${btcTx}`, `0x${position.script}`, {
                        maxFeePerGas,
                        maxPriorityFeePerGas,
                    });
                    // Record BTC Stake in contract
                    const response = await vaulterCore.recordBTCStake(`0x${btcTx}`, `0x${position.script}`, {
                        gasLimit: gasEstimate.mul(120).div(100), // Add 20% buffer
                        maxFeePerGas,
                        maxPriorityFeePerGas,
                        type: 2, // EIP-1559 Transaction
                    });
                    //TODO WAIT
                    console.log(`✅ Processed BTC txId ${position.btcTxId} with core TX: ${response.hash}`);
                    processedCount++;
                } else {
                    console.log(`${position.btcTxId} already processed`);
                }                
            } catch (error) {
                console.error(`❌ Failed to process txId: ${position.btcTxId}`, error);
            }
        }

        return processedCount;
    } catch (error) {
        console.error('❌ Error fetching BTC delegations:', error);
        return 0;
    }
}

/**
 * Fetches the list of validators from CoreDAO and returns the best one
 * based on the highest estimatedCoreRewardRate.
 *
 * @returns {Promise<Object>} The best validator object.
 */
export async function getBestValidator() {
    
    try {
      // Fetch validator data from CoreDAO API
      const response = await fetch(VALIDATORS_API);
      if (!response.ok) {
        throw new Error(`Failed to fetch validators: ${response.statusText}`);
      }
  
      const data = await response.json();
      const validators = data.data.validatorsList;
  
      if (!validators || validators.length === 0) {
        throw new Error("No validators found");
      }
  
      // Filter only active validators (status 17 usually means active)
      const activeValidators = validators.filter(
        (validator) => validator.status === 17 && parseFloat(validator.estimatedCoreRewardRate) > 0
      );
  
      if (activeValidators.length === 0) {
        throw new Error("No active validators with rewards found");
      }
  
      // Sort validators by estimatedCoreRewardRate (descending order)
      activeValidators.sort(
        (a, b) =>
          parseFloat(b.estimatedCoreRewardRate) - parseFloat(a.estimatedCoreRewardRate)
      );
  
      // Get the best validator (highest estimatedCoreRewardRate)
      const bestValidator = activeValidators[0];
  
      console.log("🏅 Best Validator Found:");
      console.log(`🔹 Name: ${bestValidator.name}`);
      console.log(`🔹 Operator Address: ${bestValidator.operatorAddress}`);
      console.log(`🔹 Reward Rate: ${bestValidator.estimatedCoreRewardRate}%`);
      console.log(`🔹 Staked CORE: ${bestValidator.stakedCoreAmount}`);
      console.log(`🔹 Staked BTC: ${bestValidator.stakedBTCAmount}`);
      console.log(`🔹 Hybrid Score: ${bestValidator.hybridScore}`);
  
      return bestValidator;
    } catch (error) {
      console.error("❌ Error fetching best validator:", error.message);
      throw error;
    }
  }
  

async function adjustCOREStaking() {
    try {
        console.log('Adjusting CORE staking...');
        const totalBTCStaked = await vaulterCore.totalBTCStaked();
        const totalCoreDeposits = await vaulterCore.totalCoreDeposits();
        const totalCoreStaked = await vaulterCore.totalCoreStaked();
        console.log("AdjustCOREStaking: total BTC staked:", ethers.utils.formatUnits(totalBTCStaked, 8));
        console.log("AdjustCOREStaking: total CORE Deposits:", ethers.utils.formatUnits(totalCoreDeposits, 18));
        console.log("AdjustCOREStaking: total CORE Staked:", ethers.utils.formatUnits(totalCoreStaked, 18));

        const requiredCoreForYield = totalBTCStaked
        .mul(ethers.BigNumber.from("8000"))
        .mul(ethers.BigNumber.from("1000000000000000000")) // 1e18
        .div(ethers.BigNumber.from("100000000"));         // 1e8
        console.log("AdjustCOREStaking: requiredCoreForYield:", ethers.utils.formatUnits(requiredCoreForYield, 18));
        
        const { maxFeePerGas, maxPriorityFeePerGas } = await getGasFees();

        if (totalCoreStaked.lt(requiredCoreForYield)) {
            let amountToStake = requiredCoreForYield.sub(totalCoreStaked);
            // Ensure minimum stake amount is 1 CORE
            const minimumStake = ethers.utils.parseUnits("1", 18);
            if (amountToStake.lt(minimumStake)) {
                amountToStake = minimumStake;
            }
            console.log(`Staking additional CORE: ${ethers.utils.formatUnits(amountToStake)}`);
            //TODO Check balance before staking
            const bestValidator = await getBestValidator();
            // Estimate gas limit
            /*const gasEstimate = await vaulterCore.estimateGas.stakeCORE(bestValidator.operatorAddress, amountToStake, {
                maxFeePerGas,
                maxPriorityFeePerGas,
            });*/
            const response = await vaulterCore.stakeCORE(bestValidator.operatorAddress, amountToStake, {
                //gasLimit: gasEstimate.mul(120).div(100), // Add 20% buffer
                gasLimit: 1000000, // Set manually
                maxFeePerGas,
                maxPriorityFeePerGas,
                type: 2, // EIP-1559 Transaction
            });
            console.log(`✅ Staked additional CORE to validator: ${bestValidator.name} with core TX: ${response.hash}`);
        } else if (totalCoreStaked.gt(requiredCoreForYield)) {
            let amountToUnstake = totalCoreStaked.sub(requiredCoreForYield);
            console.log(`Un-Staking CORE: ${ethers.utils.formatUnits(amountToUnstake)}`);

            await vaulterCore.unstakeCORE(amountToUnstake);
        }
    } catch (error) {
        console.error('❌ Error adjusting CORE staking:', error);
    }
}

performDailyTasks();
