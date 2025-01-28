// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "./BitcoinHelper.sol"; 

interface IStakeHub {
    function claimReward() external returns (uint256[] memory rewards);
    function roundTag() external view returns (uint256);
}

interface IBitcoinStake {
    function btcTxMap(bytes32 txId) external view returns (uint64 amount, uint32 outputIndex, uint64 blockTimestamp, uint32 lockTime, uint32 usedHeight);
    function receiptMap(bytes32 txId) external view returns (address candidate, address delegator, uint256 round);
    function transfer(bytes32 txId, address targetCandidate) external;
}

interface ICoreAgent {
    function delegateCoin(address validator, uint256 amount) external payable;
    function undelegateCoin(address validator, uint256 amount) external payable;
    function transferCoin(address sourceCandidate, address targetCandidate, uint256 amount) external;
}

contract VaultLayer is ERC20, ReentrancyGuard, AccessControl {
    // CoreDAO Staking Hub Contract
    IStakeHub public immutable stakeHub;
    IBitcoinStake public immutable bitcoinStake;
    ICoreAgent public immutable coreAgent;

    // Roles
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // Vault parameters
    uint256 public constant BTC_TO_CORE_RATIO_FOR_MAX_YIELD = 8000; // 1 BTC : 8,000 CORE -> Max Tier Ratio
    uint256 public btcPriceInCore = 60000; // 1 BTC = 60K $CORE
    uint256 public minCollateralRatio = 200; // 200% over-collateralization
    uint256 public btcRewardRatio = 50;
    uint256 public coreRewardRatio = 50;
    uint256 public interestRate = 500; // 5% Interest on withdrawals
    uint256 public platformFee = 500; // Platform fee in basis points (5%)

    // the current round, it is updated in setNewRound.
    uint256 public roundTag;

    // BTC Staking Data
    struct BtcTx {
        uint256 amount;
        uint256 lockTime;
        uint256 depositTime;
        uint256 endRound;
        bytes20 pubKey;
    }

    struct BtcStake {
        uint256 stakedAmount;
        uint256 pendingRewards;
    }

    bytes32[] public btcTxIds; // Track all txIds for iteration
    mapping(bytes32 => BtcTx) public btcTxMap; // txId -> BtcTx
    mapping(bytes20 => BtcStake) public btcStakes; // pubKey -> BtcStake
    uint256 public totalBTCStaked; 
    
    // CORE Liquidity Providers
    mapping(address => uint256) public coreDeposits;
    mapping(address => uint256) public coreDepositRound; // Tracks the round of each deposit
    uint256 public totalCoreDeposits; 
    uint256 public totalCoreStaked; // Track CORE staked
    uint256 public pendingCoreRewards;

    // Events
    event BTCStaked(bytes32 indexed txId, bytes20 indexed pubKey, uint256 amount, uint256 endRound);
    event COREDeposited(address indexed user, uint256 amount, uint256 round);
    event RewardsDistributed(bytes32 indexed txId, uint256 btcReward, address indexed user, uint256 coreReward);
    event RewardsClaimed(bytes20 indexed pubKey, uint256 reward);
    event Rebalanced(uint256 btcRewardRatio, uint256 coreRewardRatio);
    event ExpiredStakeRemoved(bytes32 indexed txId, bytes20 indexed pubKey, uint256 amount);
    event BTCDelegationTransferred(bytes32 indexed txId, address indexed targetCandidate);
    event COREStakeTransferred(address indexed sourceCandidate, address indexed targetCandidate, uint256 amount);



    constructor(IStakeHub _stakeHub, IBitcoinStake _bitcoinStake, ICoreAgent _coreAgent) ERC20("VaultLayer CORE Shares", "vlCORE") {
        stakeHub = _stakeHub;
        bitcoinStake = _bitcoinStake;
        coreAgent = _coreAgent;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
    }

    /*** ERC-4626-Like Methods ***/

    function totalAssets() public view returns (uint256) {
        return address(this).balance;
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        uint256 overCollateralizedAssets = (assets * 100) / minCollateralRatio;
        return (overCollateralizedAssets * 1e18) / getPricePerShare();
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        uint256 assets = (shares * getPricePerShare()) / 1e18;
        return (assets * minCollateralRatio) / 100; // Adjust for over-collateralization
    }

    function maxDeposit(address) public pure returns (uint256) {
        return type(uint256).max;
    }

    function maxWithdraw(address owner) public view returns (uint256) {
        return convertToAssets(balanceOf(owner));
    }

    function getPricePerShare() public view returns (uint256) {
        uint256 collateralizedAssets = (totalAssets() * 100) / minCollateralRatio;
        return totalSupply() == 0 ? 1e18 : (collateralizedAssets * 1e18) / totalSupply();
    }

    /// Start new round, this is called by the Oracle Agent
    /// @param round The new round tag
    function setNewRound(uint256 round) external onlyRole(ADMIN_ROLE) {
        roundTag = round;
    }

    // Deposit CORE
    function depositCORE() external payable nonReentrant {
        require(msg.value > 0, "Invalid amount");

        coreDeposits[msg.sender] += msg.value;
        coreDepositRound[msg.sender] = roundTag; // Track the deposit round
        totalCoreDeposits += msg.value;

        uint256 shares = convertToShares(msg.value);
        _mint(msg.sender, shares);  // Ensure shares are minted properly

        emit COREDeposited(msg.sender, msg.value, roundTag);
        _rebalanceRewardRatio();
    }

    // Withdraw CORE liquidity
    function withdrawCORE(uint256 shares) external nonReentrant {
        require(shares > 0 && shares <= balanceOf(msg.sender), "Invalid shares");
        require(roundTag > coreDepositRound[msg.sender], "Withdrawal locked for this round"); // Enforce 1 full round lock

        uint256 assets = convertToAssets(shares);
        require(assets <= address(this).balance, "Insufficient vault balance");

        uint256 reward = (assets * coreRewardRatio) / (100 * totalCoreDeposits); // Pro-rata rewards based on total deposits
        pendingCoreRewards -= reward;
        uint256 payout = assets + reward;

        coreDeposits[msg.sender] -= assets;
        totalCoreDeposits -= assets;
        _burn(msg.sender, shares);

        payable(msg.sender).transfer(payout);
        _rebalanceRewardRatio();
    }


    // 1. We Record BTC Stake linked to a BTC Public Key and BTC txid
    function recordBTCStake(bytes calldata btcTx, uint256 btcAmount, bytes memory script) external onlyRole(ADMIN_ROLE) {
        require(btcAmount > 0, "Invalid BTC amount");

        bytes32 txId = BitcoinHelper.calculateTxId(btcTx);

        // Verify txId exists on BitcoinStake contract
        (uint64 amount,, uint64 blockTimestamp, uint32 lockTime,) = bitcoinStake.btcTxMap(txId);
        require(amount > 0, "BTC tx not found in btcTxMap");

        (, address delegator, uint256 round) = bitcoinStake.receiptMap(txId);
        require(delegator != address(0), "BTC tx not found in receiptMap");
        require(delegator == address(this), "BTC tx does not delegate to us");

        uint256 endRound = round + (lockTime / 1 days);

        (uint256 scriptLockTime, bytes20 pubKey) = BitcoinHelper.extractBitcoinAddress(script);
        btcTxMap[txId] = BtcTx(btcAmount, scriptLockTime, blockTimestamp, endRound, pubKey);
        btcTxIds.push(txId); // Track txId for iteration

        btcStakes[pubKey].stakedAmount += btcAmount;
        totalBTCStaked += btcAmount;

        emit BTCStaked(txId, pubKey, btcAmount, endRound);
        _rebalanceRewardRatio();
    }

    // Claim Rewards with Proof-of-Ownership
    function claimBTCRewards(
        bytes20 pubKey, // BTC pubPeky Hash
        bytes memory ethPubKey
        bytes memory signature,
        string memory message,
        address recipient
    ) external {
        bytes20 btcPubKeyHash = BitcoinHelper.convertEthToBtcPubKeyHash(ethPubKey);
        require(pubKey == btcPubKeyHash, "Invalid pubKey");

        require(BitcoinHelper.verifyEthPubKeySignature(message, signature, ethPubKey, recipient), "Invalid signature");
        
        BtcStake storage stake = btcStakes[pubKey];
        require(stake.stakedAmount > 0, "No staked BTC");

        uint256 reward = stake.pendingRewards;
        require(reward > 0, "No pending rewards");

        // Clear pending rewards before transferring
        stake.pendingRewards = 0;

        uint256 rewardWithCollateral = reward * 100 / minCollateralRatio;
        _mint(recipient, rewardWithCollateral);
        emit RewardsClaimed(pubKey, rewardWithCollateral);

        _rebalanceRewardRatio();
    }

    // Stake CORE tokens into CoreAgent
    function stakeCORE(address validator, uint256 amount) external onlyRole(ADMIN_ROLE) {
        uint256 requiredCoreForYield = (totalBTCStaked * BTC_TO_CORE_RATIO_FOR_MAX_YIELD * 1e18) / 1e8;
        require(totalCoreStaked <= requiredCoreForYield, "Already at required CORE staking");
        uint256 amountToStake = requiredCoreForYield - totalCoreStaked;
        uint256 stakeAmount = amount < amountToStake ? amount : amountToStake;
        require(stakeAmount <= address(this).balance, "Insufficient funds to stake");
        coreAgent.delegateCoin{value: stakeAmount}(validator, stakeAmount);
        totalCoreStaked += stakeAmount;
        _rebalanceRewardRatio();
    }

    // Unstake CORE tokens from CoreAgent
    function unstakeCORE(address validator, uint256 amount) external onlyRole(ADMIN_ROLE) {
        coreAgent.undelegateCoin(validator, amount);
        totalCoreStaked -= amount;
        _rebalanceRewardRatio();
    }

    // Transfer BTC delegation
    function transferBTCDelegation(bytes32 txId, address targetCandidate) external onlyRole(ADMIN_ROLE) {
        // Ensure the transaction exists in btcTxMap
        BtcTx storage btcTx = btcTxMap[txId];
        require(btcTx.amount > 0, "Invalid BTC txId");
        require(block.timestamp <= btcTx.depositTime + btcTx.lockTime, "BTC stake expired");

        // Call the CoreDAO BitcoinStake contract to transfer delegation
        bitcoinStake.transfer(txId, targetCandidate);
        
        emit BTCDelegationTransferred(txId, targetCandidate);
    }

    // Transfer CORE stake
    function transferCOREStake(address sourceCandidate, address targetCandidate, uint256 amount) external onlyRole(ADMIN_ROLE) {
        require(totalCoreStaked >= amount, "Insufficient CORE staked");
        coreAgent.transferCoin(sourceCandidate, targetCandidate, amount);
        emit COREStakeTransferred(sourceCandidate, targetCandidate, amount);
    }

    // Claim CORE Rewards and distribute pending rewards
    function claimCoreRewards() external onlyRole(ADMIN_ROLE) returns (uint256) {
        uint256 currentRound = stakeHub.roundTag();
        require(currentRound > roundTag, "No new round available");

        // Claim CORE rewards from the stake hub
        uint256[] memory rewards = stakeHub.claimReward();
        uint256 totalReward;
        for (uint256 i = 0; i < rewards.length; i++) {
            totalReward += rewards[i];
        }
        if (totalReward != 0) {
            uint256 fee = (totalReward * platformFee) / 10000;
            uint256 netReward = totalReward - fee;

            // Distribute BTC rewards
            for (uint256 i = 0; i < btcTxIds.length; i++) {
                bytes32 txId = btcTxIds[i];
                BtcTx storage bt = btcTxMap[txId];
                uint256 btcReward = ((netReward * btcRewardRatio) / 100) * bt.amount / totalBTCStaked;
                btcStakes[bt.pubKey].pendingRewards += btcReward;

                if (block.timestamp > bt.depositTime + bt.lockTime) {                    
                    // Remove expired txId
                    btcTxIds[i] = btcTxIds[btcTxIds.length - 1];
                    btcTxIds.pop();
                    i--; // Adjust loop after removal
                    emit ExpiredStakeRemoved(txId, bt.pubKey, bt.amount);
                }
            }

            // Distribute CORE rewards
            pendingCoreRewards += (netReward * coreRewardRatio) / 100;
        }

        _rebalanceRewardRatio();
        roundTag = currentRound; // Update the round   

        return totalReward;
    }


    // Dynamic Rebalancing
    function _rebalanceRewardRatio() internal {
        uint256 targetRatio = 1e18 / 8000;

        // Prevent division by zero errors
        uint256 btcStaked = totalBTCStaked > 0 ? totalBTCStaked : 1;
        uint256 coreStaked = totalCoreStaked > 0 ? totalCoreStaked : 1;

        uint256 currentRatio = (btcStaked * 1e18) / coreStaked; // Scale for precision
        uint256 ratioDeviation = (currentRatio * 1e18) / targetRatio; // Scale for precision

        uint256 newBtcRewardRatio;
        uint256 newCoreRewardRatio;

        if (ratioDeviation > 1e18) { // Too much BTC relative to CORE
            uint256 adjustmentFactor = ratioDeviation / 1e18;
            newBtcRewardRatio = (btcRewardRatio * 1e18) / adjustmentFactor; // Scale down BTC
        } else { // Too much CORE relative to BTC
            uint256 adjustmentFactor = (1e18 * 1e18) / ratioDeviation;
            newBtcRewardRatio = (btcRewardRatio * adjustmentFactor) / 1e18; // Scale up BTC
        }

        // Ensure the ratios stay within bounds
        if (newBtcRewardRatio > 10000) {
            newBtcRewardRatio = 10000;
        }
        if (newBtcRewardRatio < 0) {
            newBtcRewardRatio = 0;
        }

        newCoreRewardRatio = 10000 - newBtcRewardRatio; // Ensure total ratio sums to 100%

        // Update reward ratios safely
        btcRewardRatio = newBtcRewardRatio;
        coreRewardRatio = newCoreRewardRatio;

        emit Rebalanced(btcRewardRatio, coreRewardRatio);
    }

    // Accept plain ETH transfers
    receive() external payable {}

    // Catch all unexpected function calls
    fallback() external payable {
        revert("Fallback function not allowed");
    }

}
