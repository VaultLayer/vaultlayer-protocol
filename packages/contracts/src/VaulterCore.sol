// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/Address.sol";
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

    function delegateCoin(address validator, uint256 amount) external payable;
    function undelegateCoin(address validator, uint256 amount) external payable;
    function transferCoin(address sourceCandidate, address targetCandidate, uint256 amount) external;
}

contract VaulterCore is ERC20, ReentrancyGuard, AccessControl, Pausable {
    using Address for address payable;

    // CoreDAO Staking Hub Contract
    IStakeHub public immutable stakeHub;
    IBitcoinStake public immutable bitcoinStake;
    ICoreAgent public immutable coreAgent;

    // Roles
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // Vault parameters
    uint256 constant MIN_BTC_STAKED = 1e5;   // minimal BTC stake (e.g. 0.001 BTC)
    uint256 constant MIN_CORE_STAKED = 1e20;  // minimal CORE stake (e.g. 100 CORE in wei)
    uint256 public btcRewardRatio = 5000;
    uint256 public coreRewardRatio = 5000;
    uint256 public platformFee = 500; // Platform fee in basis points (5%)
    uint256 public reserveRatio = 200;

    // Fixed-point scaling factor
    uint256 public constant BTC_DECIMALS = 1e8;
    uint256 public constant CORE_DECIMALS = 1e18;
    
    // The ideal (target) human BTC/CORE ratio, expressed in fixed-point.
    // BTC_TO_CORE_RATIO_FOR_MAX_YIELD = 1 BTC / 8000 CORE (But 2x : 1/16000)
    uint256 public targetRatio = BTC_DECIMALS / 8000;

    // Grade structure: each grade defines a deviation interval (D in fixed-point)
    // and the corresponding BTC reward ratio (in basis points).
    struct Grade {
        uint256 lowerBound; // inclusive, e.g., 0
        uint256 upperBound; // exclusive, e.g., 0.7e18 for grade 0
        uint256 btcRewardRatio; // in basis points (0 to 10000)
    }
    // We'll use exactly 5 grades.
    Grade[5] public grades;


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
    mapping(address => uint256) public coreDepositRound; // Tracks the round of each deposit
    mapping(address => uint256) public lastClaimed;
    uint256 public totalCoreDeposits; 
    uint256 public totalCoreStaked; // Track CORE staked
    uint256 public pendingCoreRewards;
    uint256 public pendingBTCRewards;

    uint256 public pendingProtocolFees;

    // Events
    event BTCStaked(bytes32 indexed txId, bytes20 indexed pubKey, uint256 amount, uint256 endRound);
    event COREDeposited(address indexed user, uint256 amount, uint256 round);
    event COREStaked(address indexed validator, uint256 amount);
    event COREUnstaked(address indexed candidate, uint256 amount);
    event RewardsDistributed(bytes32 indexed txId, uint256 btcReward, address indexed user, uint256 coreReward);
    event BTCRewardsClaimed(bytes20 indexed pubKey, uint256 reward);
    event RewardsClaimed(address indexed user, uint256 reward);
    event Rebalanced(uint256 btcRewardRatio, uint256 coreRewardRatio);
    event ExpiredStakeRemoved(bytes32 indexed txId, bytes20 indexed pubKey, uint256 amount);
    event BTCDelegationTransferred(bytes32 indexed txId, address indexed targetCandidate);
    event COREStakeTransferred(address indexed sourceCandidate, address indexed targetCandidate, uint256 amount);
    event GradeUpdated(uint256 index, uint256 lowerBound, uint256 upperBound, uint256 btcRewardRatio);
    event PlatformFeeUpdated(uint256 newFee);
    event ReserveRatioUpdated(uint256 newRatio);    

    constructor(IStakeHub _stakeHub, IBitcoinStake _bitcoinStake, ICoreAgent _coreAgent) ERC20("Vaulter CORE", "vltCORE") {
        stakeHub = _stakeHub;
        bitcoinStake = _bitcoinStake;
        coreAgent = _coreAgent;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);

        // Set up 5 default grades.
        // All bounds are in a deviation factor of currentRatio/targetRatio.
        grades[0] = Grade(0, 100, 8000);
        grades[1] = Grade(100, 500, 6500);
        grades[2] = Grade(500, 1400, 5000);
        grades[3] = Grade(1400, 10000, 4500);
        grades[4] = Grade(10000, 10000000, 2000);
    }

    // Governance parameter setters
    function setPlatformFee(uint256 newFee) external onlyRole(ADMIN_ROLE) {
        require(newFee <= 10000, "Fee too high");
        platformFee = newFee;
        emit PlatformFeeUpdated(newFee);
    }

    function setReserveRatio(uint256 newRatio) external onlyRole(ADMIN_ROLE) {
        require(newRatio > 0, "Reserve ratio must be > 0");
        reserveRatio = newRatio;
        emit ReserveRatioUpdated(newRatio);
    }

    /// @notice Allows the gov to update one of the 5 grades.
    /// @param index The grade index (0 to 4).
    /// @param lowerBound The inclusive lower bound of D 
    /// @param upperBound The exclusive upper bound of D 
    /// @param btcRewardRatio The desired BTC reward ratio (basis points).
    function setGrade(
        uint256 index,
        uint256 lowerBound,
        uint256 upperBound,
        uint256 btcRewardRatio
    ) external onlyRole(ADMIN_ROLE) {
        require(index < 5, "Index must be 0-4");
        require(upperBound > lowerBound, "Upper bound must exceed lower");
        require(btcRewardRatio <= 10000, "Cannot exceed 10000");
        grades[index] = Grade(lowerBound, upperBound, btcRewardRatio);
        emit GradeUpdated(index, lowerBound, upperBound, btcRewardRatio);
    }

    /// @notice Allows the gov to update the targetRatio.
    /// @param newTargetRatio The new target ratio. This is the ideal human ratio.
    function setTargetRatio(uint256 newTargetRatio) external onlyRole(ADMIN_ROLE) {
        require(newTargetRatio > 0, "Target must be positive");
        targetRatio = newTargetRatio;
    }

    // Pausable functions.
    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }
    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    /*** ERC-4626-Like Methods ***/

    function totalAssets() public view returns (uint256) {
        return totalCoreDeposits + pendingCoreRewards + pendingBTCRewards;
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        return (assets * CORE_DECIMALS) / getPricePerShare();
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        return (shares * getPricePerShare()) / CORE_DECIMALS;
    }

    function maxDeposit(address) public pure returns (uint256) {
        return type(uint256).max;
    }

    function maxWithdraw(address owner) public view returns (uint256) {
        return convertToAssets(balanceOf(owner));
    }

    function getPricePerShare() public view returns (uint256) {
        return totalSupply() == 0 ? CORE_DECIMALS : (totalAssets() * CORE_DECIMALS) / totalSupply();
    }

    // Deposit CORE
    function depositCORE() external payable nonReentrant whenNotPaused {
        require(msg.value > 0, "Invalid amount");
        uint256 shares = convertToShares(msg.value);
        
        coreDepositRound[msg.sender] = roundTag; // Track the deposit round
        totalCoreDeposits += msg.value;
        
        _mint(msg.sender, shares);  // Ensure shares are minted properly

        emit COREDeposited(msg.sender, msg.value, roundTag);
    }

    // Pending Rewards for core depositor
    function getPendingCoreRewards(
        address depositor
    ) public view returns (uint256) {
        if(roundTag > lastClaimed[depositor]){
            uint256 totalShares = balanceOf(depositor);
            uint256 assets = convertToAssets(totalShares);
            uint256 reward = (assets * pendingCoreRewards) / (totalCoreDeposits); // Pro-rata rewards based on total deposits
            return convertToShares(reward);
        } else return 0;
    }

    function _claimRewards() internal {
        if(roundTag > lastClaimed[msg.sender]){
            lastClaimed[msg.sender] = roundTag;
            uint256 totalShares = balanceOf(msg.sender);
            uint256 assets = convertToAssets(totalShares);
            uint256 reward = (assets * pendingCoreRewards) / (totalCoreDeposits); // Pro-rata rewards based on total deposits
            if(reward > 0 && reward <= pendingCoreRewards){
                pendingCoreRewards -= reward;
                uint256 shares = convertToShares(reward);
                _mint(msg.sender, shares);
                emit RewardsClaimed(msg.sender, shares);
            }
        }
    }

    function claimRewards() external nonReentrant whenNotPaused {
        _claimRewards();
    }


    // Record BTC Stake linked to a BTC Public Key and BTC txid
    function recordBTCStake(bytes calldata btcTx, bytes memory script) external nonReentrant whenNotPaused {
        // Check that the provided btcTx contains the script bytes.
        require(BitcoinHelper.bytesContains(btcTx, script), "BTC transaction does not include provided script");

        bytes32 txId = BitcoinHelper.calculateTxId(btcTx);
        // Ensure that the txId is not already recorded.
        require(btcTxMap[txId].amount == 0, "BTC stake already recorded");

        // Verify txId exists on BitcoinStake contract
        (uint64 amount,, uint64 blockTimestamp, uint32 lockTime,) = bitcoinStake.btcTxMap(txId);
        require(amount > 0, "BTC tx not found in btcTxMap");

        (, address delegator, uint256 round) = bitcoinStake.receiptMap(txId);
        require(delegator != address(0), "BTC tx not found in receiptMap");
        require(delegator == address(this), "BTC tx does not delegate to us");

        uint256 endRound = round + (lockTime / 1 days);

        (uint256 scriptLockTime, bytes20 pubKey) = BitcoinHelper.extractBitcoinAddress(script);
        require(lockTime == scriptLockTime, "BTC tx lockTime != scriptLockTime");
        btcTxMap[txId] = BtcTx(amount, scriptLockTime, blockTimestamp, endRound, pubKey);
        btcTxIds.push(txId); // Track txId for iteration

        btcStakes[pubKey].stakedAmount += amount;
        totalBTCStaked += amount;

        emit BTCStaked(txId, pubKey, amount, endRound);
    }


    // Claim Rewards with Proof-of-Ownership of the same PubKey used for ETH and BTC address derivation
    function claimBTCRewards(
        bytes memory ethPubKey,
        bytes memory signature,
        string memory message,
        address recipient
    ) external nonReentrant whenNotPaused {
        require(BitcoinHelper.verifyEthPubKeySignature(message, signature, ethPubKey, recipient), "Invalid signature");
        
        bytes20 btcPubKeyHash = BitcoinHelper.convertEthToBtcPubKeyHash(ethPubKey);

        BtcStake storage stake = btcStakes[btcPubKeyHash];
        require(stake.stakedAmount > 0, "No staked BTC for btcPubKeyHash");

        uint256 reward = stake.pendingRewards;
        require(reward > 0, "No pending rewards");

        // Clear pending rewards before transferring
        stake.pendingRewards = 0;
        pendingBTCRewards -= reward;

        uint256 shares = convertToShares(reward);
        _mint(recipient, shares);
        emit BTCRewardsClaimed(btcPubKeyHash, shares);
    }

     // Pending Rewards for the same PubKey used for ETH and BTC address derivation
    function getPendingBTCRewards(
        bytes memory ethPubKey
    ) public view returns (uint256) {
        bytes20 btcPubKeyHash = BitcoinHelper.convertEthToBtcPubKeyHash(ethPubKey);

        BtcStake storage stake = btcStakes[btcPubKeyHash];
        
        return convertToShares(stake.pendingRewards);
    }

    // Stake CORE tokens into CoreAgent
    function stakeCORE(address validator, uint256 amount) external nonReentrant onlyRole(ADMIN_ROLE) {
        uint256 requiredCoreForYield = (totalBTCStaked * CORE_DECIMALS) / targetRatio;
        require(totalCoreStaked <= requiredCoreForYield, "Already at required CORE staking");

        uint256 amountToStake = requiredCoreForYield - totalCoreStaked;
        uint256 stakeAmount = amount < amountToStake ? amount : amountToStake;
        require(stakeAmount <= address(this).balance, "Insufficient funds to stake");

        try coreAgent.delegateCoin{value: stakeAmount}(validator, stakeAmount) {

            totalCoreStaked += stakeAmount;

            emit COREStaked(validator, stakeAmount);

        } catch Error(string memory reason) {
            revert(reason);
        } catch {
            revert("delegateCoin failed");
        }
    }

    // Withdraw CORE liquidity
    function withdrawCORE(uint256 shares) external nonReentrant {
        require(shares > 0 && shares <= balanceOf(msg.sender), "Invalid shares");
        require(roundTag > coreDepositRound[msg.sender], "Withdrawal locked for this round"); // Enforce 1 full round lock

        // claim any pending rewards
        _claimRewards();

        uint256 assets = convertToAssets(shares);
        // Check if the vault has enough funds.
        if (assets > address(this).balance) {
            uint256 deficit = assets - address(this).balance;
            _unstakeCORE(deficit);
            require(assets <= address(this).balance, "Insufficient funds even after unstaking");
        }

        totalCoreDeposits -= assets;
        _burn(msg.sender, shares);

        payable(msg.sender).sendValue(assets);
    }

    function unstakeCORE(uint256 amount) external nonReentrant onlyRole(ADMIN_ROLE) {
        _unstakeCORE(amount);
    }

    // Unstake CORE tokens from CoreAgent
    // Internal function that loops through candidate validators until
    // the requested amount is unstaked.
    function _unstakeCORE(uint256 amount) internal {
        require(amount > 0, "Invalid withdrawal amount");
        require(totalCoreStaked >= amount, "Not enough staked CORE available");
        address[] memory candidates;
        try coreAgent.getCandidateListByDelegator(address(this)) returns (address[] memory _candidates) {
            candidates = _candidates;
        } catch {
            revert("getCandidateListByDelegator failed");
        }
        uint256 remainingAmount = amount;

        for (uint256 i = 0; i < candidates.length && remainingAmount > 0; i++) {
            uint256 availableStake;
            try coreAgent.getDelegator(candidates[i], address(this)) returns (ICoreAgent.CoinDelegator memory delegatorInfo) {
                availableStake = delegatorInfo.realtimeAmount;
            } catch {
                continue;
            }
            if (availableStake == 0) continue;
            uint256 unstakeAmount = availableStake >= remainingAmount ? remainingAmount : availableStake;
            try coreAgent.undelegateCoin(candidates[i], unstakeAmount) {
                remainingAmount -= unstakeAmount;
                totalCoreStaked -= unstakeAmount;
                emit COREUnstaked(candidates[i], unstakeAmount);
            } catch Error(string memory reason) {
                revert(reason);
            } catch {
                revert("undelegateCoin failed");
            }
        }
        require(remainingAmount == 0, "Could not unstake enough funds");
    }

    // Transfer BTC delegation
    function transferBTCDelegation(bytes32 txId, address targetCandidate) external onlyRole(ADMIN_ROLE) {
        // Ensure the transaction exists in btcTxMap
        BtcTx storage btcTx = btcTxMap[txId];
        require(btcTx.amount > 0, "Invalid BTC txId");
        require(block.timestamp <= btcTx.depositTime + btcTx.lockTime, "BTC stake expired");

        // Call the CoreDAO BitcoinStake contract to transfer delegation
        try bitcoinStake.transfer(txId, targetCandidate) {
            emit BTCDelegationTransferred(txId, targetCandidate);
        } catch Error(string memory reason) {
            revert(reason);
        } catch {
            revert("bitcoinStake.transfer failed");
        }
    }

    // Transfer CORE stake
    function transferCOREStake(address sourceCandidate, address targetCandidate, uint256 amount) external onlyRole(ADMIN_ROLE) {
        require(totalCoreStaked >= amount, "Insufficient CORE staked");
        try coreAgent.transferCoin(sourceCandidate, targetCandidate, amount) {
            emit COREStakeTransferred(sourceCandidate, targetCandidate, amount);
        } catch Error(string memory reason) {
            revert(reason);
        } catch {
            revert("transferCoin failed");
        }
    }

    // Claim CORE Rewards and distribute pending rewards
    function claimCoreRewards() external onlyRole(ADMIN_ROLE) returns (uint256) {
        uint256 currentRound = stakeHub.roundTag();
        try stakeHub.roundTag() returns (uint256 _roundTag) {
            currentRound = _roundTag;
        } catch {
            revert("roundTag() failed");
        }
        require(currentRound > roundTag, "No new round available");

        // Claim CORE rewards from the stake hub
        uint256[] memory rewards;
        try stakeHub.claimReward() returns (uint256[] memory _rewards) {
            rewards = _rewards;
        } catch {
            revert("claimReward() failed");
        }
        uint256 totalReward;
        for (uint256 i = 0; i < rewards.length; i++) {
            totalReward += rewards[i];
        }
        if (totalReward != 0) {
            uint256 fee = (totalReward * platformFee) / 10000;
            // Accumulate protocol fee.
            pendingProtocolFees += fee;
            uint256 netReward = totalReward - fee;

            // Distribute BTC rewards
            for (uint256 i = btcTxIds.length; i > 0; i--) {
                uint256 index = i - 1; // Safe because i > 0
                bytes32 txId = btcTxIds[index];
                BtcTx storage bt = btcTxMap[txId];
                uint256 btcReward = ((netReward * btcRewardRatio) / 10000) * bt.amount / totalBTCStaked;
                btcStakes[bt.pubKey].pendingRewards += btcReward;
                pendingBTCRewards += btcReward;

                if (block.timestamp > bt.lockTime) {
                    // Remove expired txId: update totalBTCStaked first
                    totalBTCStaked -= bt.amount;                    
                    // Remove expired txId by swapping with the last element and popping
                    btcTxIds[index] = btcTxIds[btcTxIds.length - 1];
                    btcTxIds.pop();
                    emit ExpiredStakeRemoved(txId, bt.pubKey, bt.amount);
                }
            }

            // Distribute CORE rewards
            pendingCoreRewards += (netReward * coreRewardRatio) / 10000;
        }

        _rebalanceRewardRatio();
        roundTag = currentRound; // Update the round   

        return totalReward;
    }


    // Dynamic Rebalancing     
    function _rebalanceRewardRatio() internal {
        if (totalBTCStaked < MIN_BTC_STAKED) {
            btcRewardRatio = 0;
            coreRewardRatio = 10000;
            emit Rebalanced(btcRewardRatio, coreRewardRatio);
            return;
        }
        if (totalCoreDeposits < MIN_CORE_STAKED) {
            btcRewardRatio = 10000;
            coreRewardRatio = 0;
            emit Rebalanced(btcRewardRatio, coreRewardRatio);
            return;
        }
        
        // Compute the current ratio in fixed-point:
        uint256 currentRatio = (totalBTCStaked * CORE_DECIMALS) / (totalCoreDeposits);
        // Compute the deviation factor D = currentRatio / targetRatio.
        uint256 D_fixed = (currentRatio * 1000) / ( targetRatio * 100 / reserveRatio);
        
        // Now, using our fixed 5-grade table, determine the applicable BTC reward ratio.
        // The grades are defined in terms of D_fixed.
        uint256 newBtcRewardRatio = 5000; // default
        for (uint256 i = 0; i < 5; i++) {
            if (D_fixed >= grades[i].lowerBound && D_fixed < grades[i].upperBound) {
                newBtcRewardRatio = grades[i].btcRewardRatio;
                break;
            }
        }
        
        btcRewardRatio = newBtcRewardRatio;
        coreRewardRatio = 10000 - newBtcRewardRatio;
        emit Rebalanced(btcRewardRatio, coreRewardRatio);
    }

    function withdrawProtocolFees(address payable recipient) external nonReentrant onlyRole(ADMIN_ROLE) {
        uint256 amount = pendingProtocolFees;
        require(amount > 0, "No fees to withdraw");
        pendingProtocolFees = 0;
        recipient.transfer(amount);
    }

    // Accept plain ETH transfers
    receive() external payable {}

    // Catch all unexpected function calls
    fallback() external payable {
        revert("Fallback function not allowed");
    }

}
