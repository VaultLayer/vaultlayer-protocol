// VaultLayer Oracle Agent

const fetch = require('node-fetch');
const ethers = require('ethers');
const bitcoin = require('bitcoinjs-lib');

const VAULT_CONTRACT_ADDRESS = '0xYourVaultContractAddress';
const STAKEHUB_CONTRACT_ADDRESS = '0xYourStakeHubAddress';
const COREAGENT_CONTRACT_ADDRESS = '0xYourCoreAgentAddress';
const RPC_URL = 'https://rpc-url';
const PRIVATE_KEY = 'your-private-key';
const MEMPOOL_API = 'https://mempool.space/api/tx'; // Example mempool API endpoint
const BTC_DELEGATIONS_API = 'https://your-api-endpoint/btc-delegations';
const VALIDATORS_API = 'https://staking-api.coredao.org/staking/status/validators';

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

const vaultABI = [
    'function claimCoreRewards() external returns (uint256 reward)',
    'function stakeCORE(address validator, uint256 amount) external',
    'function unstakeCORE(address validator, uint256 amount) external',
    'function getDelegatorDetails(address delegatorAddress) external view returns (address[] memory candidates, uint256[] memory stakedAmounts, uint256[] memory realtimeAmounts, uint256[] memory transferredAmounts, uint256[] memory changeRounds)',
    'function recordBTCStake(bytes32 txId, uint256 btcAmount, bytes memory script) external'
];

const vaultContract = new ethers.Contract(VAULT_CONTRACT_ADDRESS, vaultABI, wallet);

async function performDailyTasks() {
    try {
        console.log('Starting daily tasks...');

        // 1. Claim CORE rewards from previous round and handle round updates internally in contract
        const rewards = await vaultContract.claimCoreRewards();
        console.log(`Rewards claimed: ${rewards}`);

        // 2. Check BTC staking transactions delegated to our contract for next round
        const delegatedTxCount = await processBTCDelegations();
        console.log(`Delegated BTC transactions processed: ${delegatedTxCount}`);
      
        // 3. Adjust CORE staking to maintain ratio
        await adjustCOREStaking();
        console.log('CORE staking adjusted.');

        console.log('Daily tasks completed successfully!');
    } catch (error) {
        console.error('Error during daily tasks:', error);
    }
}

async function processBTCDelegations() {
    try {
        console.log('Fetching BTC delegations...');
        const response = await fetch(BTC_DELEGATIONS_API);
        const data = await response.json();
        const txIds = data.txIds; // List of txIDs from API

        let processedCount = 0;

        for (const txId of txIds) {
            try {
                // Fetch raw tx details from mempool
                const txResponse = await fetch(`${MEMPOOL_API}/${txId}/hex`);
                const rawTxHex = await txResponse.text();

                // Decode the raw transaction
                const tx = bitcoin.Transaction.fromHex(rawTxHex);

                // Extract BTC amount from the first output
                const btcAmount = tx.outs[0].value; // Amount in satoshis

                // Extract script from the first output
                const script = Buffer.from(tx.outs[0].script).toString('hex'); // Extract script

                // Record BTC Stake in contract
                await vaultContract.recordBTCStake(tx, btcAmount, script);
                console.log(`Processed BTC txId: ${txId}`);
                processedCount++;
            } catch (error) {
                console.error(`Failed to process txId: ${txId}`, error);
            }
        }

        return processedCount;
    } catch (error) {
        console.error('Error fetching BTC delegations:', error);
        return 0;
    }
}

async function adjustCOREStaking() {
    try {
        console.log('Adjusting CORE staking...');

        const requiredCoreForYield = (await vaultContract.totalBTCStaked()) * 8000 / 1e8;
        const totalCoreStaked = await vaultContract.totalCoreStaked();

        if (totalCoreStaked < requiredCoreForYield) {
            const response = await fetch(VALIDATORS_API);
            const data = await response.json();
            const validators = data.data.validatorsList;

            validators.sort((a, b) => parseFloat(b.estimatedCoreRewardRate) - parseFloat(a.estimatedCoreRewardRate));
            const bestValidator = validators[0];

            const amountToStake = requiredCoreForYield - totalCoreStaked;
            await vaultContract.stakeCORE(bestValidator.operatorAddress, amountToStake);
            console.log(`Staked additional CORE to validator: ${bestValidator.name}`);
        } else if (totalCoreStaked > requiredCoreForYield) {
            let amountToUnstake = totalCoreStaked - requiredCoreForYield;
            const delegatorDetails = await vaultContract.getDelegatorDetails(wallet.address);

            for (let i = 0; i < delegatorDetails[0].length && amountToUnstake > 0; i++) {
                const validator = delegatorDetails[0][i];
                const stakedAmount = delegatorDetails[1][i];
                const amount = Math.min(stakedAmount, amountToUnstake);

                await vaultContract.unstakeCORE(validator, amount);
                console.log(`Unstaked ${amount} CORE from validator: ${validator}`);
                amountToUnstake -= amount;
            }
        }
    } catch (error) {
        console.error('Error adjusting CORE staking:', error);
    }
}

performDailyTasks();
