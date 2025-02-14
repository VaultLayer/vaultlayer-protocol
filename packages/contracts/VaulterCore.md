# VaultLayer CORE Shares (vltCORE) Contract

## Overview
VaultLayer is a decentralized protocol that unlocks liquidity and maximizes yield for Bitcoin staked on Layer 1 (L1) using Smart Vaults. The `vltCORE` contract represents tokenized shares of CORE collateral that users receive when they deposit CORE into the VaultLayer system.

## Features
- **Bitcoin-backed yield**: Users earn optimized staking rewards by maintaining a 1:8000 BTC-to-CORE ratio.
- **Liquidity access**: Tokenized `vltCORE` shares can be traded, staked, or used as collateral.
- **Automated rebalancing**: Ensures rewards are dynamically distributed between BTC stakers and CORE depositors.
- **Staking and delegation**: Facilitates CORE staking via CoreDAO’s staking mechanism.
- **BTC transaction validation**: Records BTC stakes and tracks rewards through off-chain verification.

## Smart Contract Architecture
### Core Components
- **ERC-20 Standard**: Implements `vltCORE` as an ERC-20 token with minting and burning functionalities.
- **Reentrancy Guard**: Protects against reentrancy attacks during deposits and withdrawals.
- **Pausable**: Allows administrators to pause contract functions in case of emergency.
- **Access Control**: Uses role-based permissions for secure governance.

### External Dependencies
- **`IStakeHub`**: Claims and tracks staking rewards from CoreDAO.
- **`IBitcoinStake`**: Verifies BTC staking transactions and their ownership.
- **`ICoreAgent`**: Facilitates CORE delegation, undelegation, and staking rewards management.

## Installation and Deployment
### Prerequisites
Ensure you have the following installed:
- Node.js v16+
- Hardhat
- OpenZeppelin Contracts

### Setup
1. Clone the repository:
   ```sh
   git clone git@github.com:VaultLayer/vaultlayer-protocol.git
   cd vltCORE
   ```
2. Install dependencies:
   ```sh
   npm install
   ```
3. Compile the contracts:
   ```sh
   npx hardhat compile
   ```
4. Run tests:
   ```sh
   npx hardhat test
   ```

### Deployment
To deploy `VaultLayer` to a testnet:
```sh
npx hardhat run scripts/deployVL.js --network <network-name>
```

## Contract Functions
### Governance Functions
- `setPlatformFee(uint256 newFee)`: Updates the platform fee (max 10%).
- `setReserveRatio(uint256 newRatio)`: Updates the CORE reserve ratio.
- `setGrade(uint256 index, uint256 lowerBound, uint256 upperBound, uint256 btcRewardRatio)`: Adjusts reward balancing.
- `pause()` / `unpause()`: Enables/disables contract interactions.

### User Functions
- `depositCORE()`: Deposits CORE and mints `vltCORE` shares.
- `withdrawCORE(uint256 shares)`: Burns `vltCORE` shares and withdraws CORE.
- `claimRewards()`: Claims accrued rewards for the user.
- `recordBTCStake(bytes calldata btcTx, bytes memory script)`: Registers a BTC stake and links it to a CORE delegation.
- `claimBTCRewards(bytes memory ethPubKey, bytes memory signature, string memory message, address recipient)`: Claims BTC rewards using a signature verification mechanism.

### Oracle Agent Staking Functions
- `stakeCORE(address validator, uint256 amount)`: Stakes CORE to meet the optimal BTC-to-CORE ratio.
- `unstakeCORE(uint256 amount)`: Unstakes CORE from CoreDAO’s staking system.
- `claimCoreRewards()`: Claims CORE rewards from CoreDAO and distributes them accordingly.

### Reward Distribution
Rewards are dynamically balanced based on deviation from the target **1:8000 BTC-to-CORE** ratio using a grading system. The protocol classifies the ratio deviation into five predefined grades, each with a different BTC reward ratio:

| Grade | Deviation Interval  | BTC Reward Ratio (basis points) |
|-------|--------------------|----------------------------|
| 0     | 0 - 100           | 8000                       |
| 1     | 100 - 500         | 6500                       |
| 2     | 500 - 1400        | 5000                       |
| 3     | 1400 - 10000      | 4500                       |
| 4     | 10000+            | 2000                       |

The **BTC reward ratio** determines how much of the staking rewards are allocated to BTC stakers vs. CORE depositors. The remaining percentage is allocated to CORE depositors. 

**Example Calculation:**
- If the deviation falls into grade 2, then **50% of rewards** are allocated to BTC stakers, and **50% to CORE depositors**.
- If the deviation falls into grade 4, then only **20% of rewards** go to BTC stakers, and **80% go to CORE depositors**.

The contract dynamically adjusts these reward splits each round to incentivize maintaining the optimal 1:8000 ratio.

## Security Features
- **Reentrancy Protection**: Prevents multiple withdrawals within the same transaction.
- **Time-locked Withdrawals**: Ensures CORE deposits remain locked for at least one round.
- **Proof-of-Ownership for BTC Rewards**: Uses ECDSA signatures to verify BTC stake ownership before reward claims.
- **Automated Rebalancing**: Dynamically adjusts BTC and CORE reward ratios to reach the Core dual Staking Max Tier of yield.

## Testing
To run tests:
```sh
npx hardhat test
```
The test suite covers:
- Core functionality (deposit, withdraw, staking, claiming rewards).
- Security tests (reentrancy, permission checks, overflow handling).
- Reward distribution logic.

## Contact
For more information, visit:
- Website: [vaultlayer.xyz](https://vaultlayer.xyz)
- Documentation: [docs.vaultlayer.xyz](https://docs.vaultlayer.xyz)
- Twitter: [@VaultLayer](https://twitter.com/VaultLayer)
- Telegram: [@bitcoin_defi_strategy](https://t.me/bitcoin_defi_strategy)

