const { expect } = require("chai");
const { ethers } = require("hardhat");
const { toRpcSig } = require('@ethereumjs/util');


function calculateTxId(tx) {
  // Perform the first SHA-256 hash
  const inputHash1 = ethers.utils.sha256('0x' + tx);

  // Perform abi.encodePacked
  const packed = ethers.utils.concat([inputHash1]); // Concatenates input bytes

  // Compute SHA-256 hash
  const inputHash2 = ethers.utils.sha256(packed);
  // Return the final hash
  return inputHash2;
}

describe("VaulterCore Contract", function () {
  let VaulterCore, vaulterCore;
  let MockStakeHub, stakeHub;
  let MockBitcoinStake, bitcoinStake;
  let MockCoreAgent, coreAgent;
  let owner, addr1, addr2;

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();

    // Deploy the BitcoinHelper library first
    const BitcoinHelper = await ethers.getContractFactory("BitcoinHelper");
    const bitcoinHelper = await BitcoinHelper.deploy();
    await bitcoinHelper.deployed();
    console.log("BitcoinHelper deployed at:", bitcoinHelper.address);

    // Deploy mock contracts
    MockStakeHub = await ethers.getContractFactory("MockStakeHub");
    stakeHub = await MockStakeHub.deploy();

    MockBitcoinStake = await ethers.getContractFactory("MockBitcoinStake");
    bitcoinStake = await MockBitcoinStake.deploy();

    MockCoreAgent = await ethers.getContractFactory("MockCoreAgent");
    coreAgent = await MockCoreAgent.deploy();

    // Deploy VaulterCore contract
    // Link the deployed BitcoinHelper library to VaulterCore
    const VaulterCore = await ethers.getContractFactory("VaulterCore", {
      libraries: {
        BitcoinHelper: bitcoinHelper.address,
      },
    });
    vaulterCore = await VaulterCore.deploy(
      stakeHub.address,
      bitcoinStake.address,
      coreAgent.address
    );
  });

  it("Should initialize correctly", async function () {
    expect(await vaulterCore.btcRewardRatio()).to.equal(5000);
    expect(await vaulterCore.coreRewardRatio()).to.equal(5000);
    expect(await vaulterCore.platformFee()).to.equal(500);
  });

  it("Should deposit CORE with locktime", async function () {
    const depositAmount = ethers.utils.parseEther("1");

    // Deposit 1 CORE into the vault
    await vaulterCore.connect(addr1).depositCORE({ value: depositAmount });

    // Retrieve the share balance of addr1
    const shareBalance = await vaulterCore.balanceOf(addr1.address);
    console.log("vltCORE share Balance:", shareBalance.toString());

    // Calculate the expected shares from the deposit amount.
    // For the initial deposit, convertToShares should return the correct share amount.
    const expectedShares = await vaulterCore.convertToShares(depositAmount);

    // For a deposit of 1 CORE and with minCollateralRatio set to 200:
    //   overCollateralizedAssets = (1e18 * 100) / 200 = 5e17
    //   getPricePerShare() returns 1e18 for the first deposit.
    // So, convertToShares returns (5e17 * 1e18) / 1e18 = 5e17, i.e. 500000000000000000.
    const calculatedShares = ethers.BigNumber.from("1000000000000000000");

    expect(shareBalance).to.equal(calculatedShares);
    expect(shareBalance).to.equal(expectedShares);
  });

  it("Should not allow withdraw CORE before 1 round", async function () {
    const depositAmount = ethers.utils.parseEther("1");

    await vaulterCore.connect(addr1).depositCORE({ value: depositAmount });
    const shares = await vaulterCore.balanceOf(addr1.address); // Get the correct shares minted

    await expect(
      vaulterCore.connect(addr1).withdrawCORE(shares)
    ).to.be.revertedWith("Withdrawal locked for this round");
  });

  it("Should allow withdraw CORE after 1 round", async function () {
    const depositAmount = ethers.utils.parseEther("1");

    await vaulterCore.connect(addr1).depositCORE({ value: depositAmount });
    const shares = await vaulterCore.balanceOf(addr1.address); // Get the correct shares minted

    await stakeHub.setRound(1);
    // Claim the core rewards
    await vaulterCore.claimCoreRewards();

    await expect(() =>
      vaulterCore.connect(addr1).withdrawCORE(shares)
    ).to.changeEtherBalance(addr1, depositAmount);
  });


  it("Should record BTC stake", async function () {
    const rawTx = "02000000000101b4bc7b1410c36d8e5919280b771ea7143cd33b8f4a7f5aa87ca8bfda06ca8a0d0200000000ffffffff031027000000000000220020631c19fc18fc13e12120a83c92dc303c17ce0bc09d93c5c51e1e5e238276973c0000000000000000536a4c505341542b01045a0f21a1d7b8c0927851e8a80d16a473416421f657de442f5ba55687a24f04419424e0dc2593cc9f4c0004bfc3a067b17576a9143187b3627e6e80c7911ef627a8589ccc51aa8cd888ac80a00000000000001600143187b3627e6e80c7911ef627a8589ccc51aa8cd802483045022100a6a3b45dcd46ceb466d9a81da485d66f0ccacf9cc5f9f3d1553bb43d5741802002202df9c3dcd1695d016c68d1c271d620c0df8616b678893efa69f9fd4062e1bd2b0121035cea681f98a4e06d2d06678daf45e9e73eca6e3f85383c3bc35401eef2c1fe8000000000";
    const memoryTx = '0x' + rawTx;
    const txId = calculateTxId(rawTx);
    const btcAmount = ethers.utils.parseUnits("1", 8); // 1 BTC in sats
    const script = "0x04bfc3a067b17576a9143187b3627e6e80c7911ef627a8589ccc51aa8cd888ac";
    console.log("BTC txID hash:", txId.toString());
    await bitcoinStake.addBtcTx(memoryTx, btcAmount, 0, 1738589119, 0);
    await bitcoinStake.addReceipt(memoryTx, vaulterCore.address, 0);

    const storedTx = await bitcoinStake.btcTxMap(txId);
    console.log("Mock stored BTC amount:", storedTx.amount.toString());

    const tx = await vaulterCore.recordBTCStake(memoryTx, script);
    const receipt = await tx.wait();

    // Find the event in the logs
    const event = receipt.events?.find(e => e.event === "BTCStaked");

    // Output event details to the console
    if (event) {
      console.log("BTCStaked Event Emitted:");
      console.log("txId:", event.args.txId);
      console.log("pubKey:", event.args.pubKey);
      console.log("amount:", event.args.amount.toString());
      console.log("endRound:", event.args.endRound.toString());
    } else {
      console.log("BTCStaked event not found");
    }

    const storedBtcTx = await vaulterCore.btcTxMap(txId);
    console.log("Stored BTC Amount:", storedBtcTx.amount.toString());
    console.log("Stored PubKey:", storedBtcTx.pubKey);

    expect(storedBtcTx.amount).to.equal(btcAmount);
    expect(await vaulterCore.totalBTCStaked()).to.equal(btcAmount);
  });

  it("should revert when the provided script is not found in btcTx and when recording a duplicate tx", async function () {
    // Use a raw transaction string (same as in other tests)
    const rawTx =
      "02000000000101b4bc7b1410c36d8e5919280b771ea7143cd33b8f4a7f5aa87ca8bfda06ca8a0d0200000000ffffffff031027000000000000220020631c19fc18fc13e12120a83c92dc303c17ce0bc09d93c5c51e1e5e238276973c0000000000000000536a4c505341542b01045a0f21a1d7b8c0927851e8a80d16a473416421f657de442f5ba55687a24f04419424e0dc2593cc9f4c0004bfc3a067b17576a9143187b3627e6e80c7911ef627a8589ccc51aa8cd888ac80a00000000000001600143187b3627e6e80c7911ef627a8589ccc51aa8cd802483045022100a6a3b45dcd46ceb466d9a81da485d66f0ccacf9cc5f9f3d1553bb43d5741802002202df9c3dcd1695d016c68d1c271d620c0df8616b678893efa69f9fd4062e1bd2b0121035cea681f98a4e06d2d06678daf45e9e73eca6e3f85383c3bc35401eef2c1fe8000000000";
    const memoryTx = "0x" + rawTx;
    // 1 BTC in satoshis
    const btcAmount = ethers.utils.parseUnits("1", 8);

    // This is the valid script that is contained in rawTx (as used in other tests)
    const validScript = "0x04bfc3a067b17576a9143187b3627e6e80c7911ef627a8589ccc51aa8cd888ac";
    // An invalid script that is not present in rawTx
    const invalidScript = "0xdeadbeef";

    // Prepare the mock BitcoinStake with the raw transaction:
    await bitcoinStake.addBtcTx(memoryTx, btcAmount, 0, 1738589119, 0);
    await bitcoinStake.addReceipt(memoryTx, vaulterCore.address, 0);

    // (1) Try to record the BTC stake with an invalid script.
    await expect(
      vaulterCore.recordBTCStake(memoryTx, invalidScript)
    ).to.be.revertedWith("BTC transaction does not include provided script");

    // (2) Record the BTC stake using the valid script. This should succeed.
    await vaulterCore.recordBTCStake(memoryTx, validScript);

    // (3) Try to record the same BTC stake again.
    await expect(
      vaulterCore.recordBTCStake(memoryTx, validScript)
    ).to.be.revertedWith("BTC stake already recorded");
  });

  it("Should claim BTC rewards", async function () {
    const rawTx = "0200000001b4bc7b1410c36d8e5919280b771ea7143cd33b8f4a7f5aa87ca8bfda06ca8a0d0200000000ffffffff031027000000000000220020631c19fc18fc13e12120a83c92dc303c17ce0bc09d93c5c51e1e5e238276973c0000000000000000536a4c505341542b01045a0f21a1d7b8c0927851e8a80d16a473416421f657de442f5ba55687a24f04419424e0dc2593cc9f4c0004bfc3a067b17576a9143187b3627e6e80c7911ef627a8589ccc51aa8cd8880200000001b4bc7b1410c36d8e5919280b771ea7143cd33b8f4a7f5aa87ca8bfda06ca8a0d0200000000ffffffff031027000000000000220020631c19fc18fc13e12120a83c92dc303c17ce0bc09d93c5c51e1e5e238276973c0000000000000000536a4c505341542b01045a0f21a1d7b8c0927851e8a80d16a473416421f657de442f5ba55687a24f04419424e0dc2593cc9f4c0004bfc3a067b17576a9143187b3627e6e80c7911ef627a8589ccc51aa8cd888ac80a00000000000001600143187b3627e6e80c7911ef627a8589ccc51aa8cd800000000ac80a00000000000001600143187b3627e6e80c7911ef627a8589ccc51aa8cd800000000";
    const memoryTx = '0x' + rawTx;
    const txId = calculateTxId(rawTx);
    const btcAmount = ethers.utils.parseUnits("0.1", 8); // BTC in sats
    const script = "0x04bfc3a067b17576a9143187b3627e6e80c7911ef627a8589ccc51aa8cd888ac";
    console.log("BTC txID hash:", txId.toString());
    await bitcoinStake.addBtcTx(memoryTx, btcAmount, 0, 1738589119, 0);
    await bitcoinStake.addReceipt(memoryTx, vaulterCore.address, 0);

    const tx = await vaulterCore.recordBTCStake(memoryTx, script);
    const receipt = await tx.wait();
    // Find the event in the logs
    const event = receipt.events?.find(e => e.event === "BTCStaked");

    // Output event details to the console
    if (event) {
      console.log("BTCStaked Event Emitted:");
      console.log("txId:", event.args.txId);
      console.log("pubKey:", event.args.pubKey);
      console.log("amount:", event.args.amount.toString());
      console.log("endRound:", event.args.endRound.toString());
    } else {
      console.log("BTCStaked event not found");
    }

    const ethPubKey = "0x045cea681f98a4e06d2d06678daf45e9e73eca6e3f85383c3bc35401eef2c1fe80ff05cec2452562123aff9fe8d8e53d863be580403239c8fc2aebbdd1882281a5";
    const signature = "0xb762cbd42521deacb8fe3263d0a8eeac2d5005f5b434b4dc2681bbb20e3dfb3a3044e242013a056862642bcc3e18da02b94590cc592f340ddf476b0e6d4b49cc1c";
    const recipient = "0x0f21A1d7b8c0927851E8a80d16a473416421f657".toLowerCase();
    const message = 'recipient: ';
    const fullMessage = `${message}${recipient}`;
    const prefixedMessage = `\x19Ethereum Signed Message:\n${fullMessage.length}${fullMessage}`;
    const messageHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(prefixedMessage));

    const recoveredPubKey = ethers.utils.recoverPublicKey(messageHash, signature);
    console.log("Recovered Public Key:", recoveredPubKey);
    const recoveredOffchain = ethers.utils.recoverAddress(messageHash, signature);
    console.log("Recovered Off-chain Address:", recoveredOffchain);

    const pubKey = ethers.utils.hexlify("0x3187b3627e6e80c7911ef627a8589ccc51aa8cd8");

    const btcStakeBefore = await vaulterCore.btcStakes(pubKey);
    console.log("btcStake pendingRewards before round:", btcStakeBefore.pendingRewards.toString());

    await stakeHub.setRound(1);
    await stakeHub.addReward(ethers.utils.parseEther("10"));  // Mock total rewards

    // Claim the core rewards
    await vaulterCore.claimCoreRewards();

    const btcStake = await vaulterCore.btcStakes(pubKey);
    console.log("btcStake pendingRewards after round:", btcStake.pendingRewards.toString()); // 9.5 CORE

    await vaulterCore.claimBTCRewards(ethers.utils.arrayify(ethPubKey), ethers.utils.arrayify(signature), message, recipient);

    expect(await vaulterCore.balanceOf(recipient)).to.equal(ethers.utils.parseEther("4.75")); // 4.75 colletarized vltCORE
  });

  it("Should rebalance rewards when only CORE is deposited", async function () {
    // Initial reward ratios should be 50/50
    let initialBtcRewardRatio = await vaulterCore.btcRewardRatio();
    let initialCoreRewardRatio = await vaulterCore.coreRewardRatio();
    expect(initialBtcRewardRatio.toNumber()).to.equal(5000);
    expect(initialCoreRewardRatio.toNumber()).to.equal(5000);

    // Deposit 10 CORE to create an imbalance (since no BTC is staked)
    await vaulterCore.connect(addr1).depositCORE({ value: ethers.utils.parseEther("10") });

    await stakeHub.setRound(1);
    await stakeHub.addReward(ethers.utils.parseEther("10"));  // Mock total rewards

    // Claim the core rewards
    await vaulterCore.claimCoreRewards();

    // Retrieve updated reward ratios
    const updatedBtcRewardRatio = await vaulterCore.btcRewardRatio();
    const updatedCoreRewardRatio = await vaulterCore.coreRewardRatio();

    console.log(`BTC Reward Ratio after deposit: ${updatedBtcRewardRatio.toString()}`);
    console.log(`CORE Reward Ratio after deposit: ${updatedCoreRewardRatio.toString()}`);

    // Since no BTC is staked, the ratio should shift towards rewarding BTC more to incentivize BTC deposits
    expect(updatedBtcRewardRatio.toNumber()).to.equal(0);
    expect(updatedCoreRewardRatio.toNumber()).to.equal(10000);
  });


  it("Should claim CORE rewards and distribute correctly", async function () {
    await stakeHub.setRound(1);
    await stakeHub.addReward(ethers.utils.parseEther("10"));  // Mock total rewards: 10 ETH

    // Claim the core rewards
    await vaulterCore.claimCoreRewards();

    // Calculate expected reward after platform fee deduction
    const totalReward = ethers.utils.parseEther("10");
    const platformFee = totalReward.mul(500).div(10000);  // 5% platform fee
    const netReward = totalReward.sub(platformFee);

    // Expected CORE distribution based on the current ratio
    const expectedCoreRewards = netReward.mul(50).div(100);  // coreRewardRatio is 50%

    const actualPendingRewards = await vaulterCore.pendingCoreRewards();

    console.log(`Expected CORE Rewards: ${expectedCoreRewards.toString()}`);
    console.log(`Actual CORE Rewards: ${actualPendingRewards.toString()}`);

    expect(actualPendingRewards).to.equal(expectedCoreRewards);
  });


  it("Should stake and unstake CORE", async function () {
    const rawTx = "0200000001b4bc7b1410c36d8e5919280b771ea7143cd33b8f4a7f5aa87ca8bfda06ca8a0d0200000000ffffffff031027000000000000220020631c19fc18fc13e12120a83c92dc303c17ce0bc09d93c5c51e1e5e238276973c0000000000000000536a4c505341542b01045a0f21a1d7b8c0927851e8a80d16a473416421f657de442f5ba55687a24f04419424e0dc2593cc9f4c0004bfc3a067b17576a9143187b3627e6e80c7911ef627a8589ccc51aa8cd8880200000001b4bc7b1410c36d8e5919280b771ea7143cd33b8f4a7f5aa87ca8bfda06ca8a0d0200000000ffffffff031027000000000000220020631c19fc18fc13e12120a83c92dc303c17ce0bc09d93c5c51e1e5e238276973c0000000000000000536a4c505341542b01045a0f21a1d7b8c0927851e8a80d16a473416421f657de442f5ba55687a24f04419424e0dc2593cc9f4c0004bfc3a067b17576a9143187b3627e6e80c7911ef627a8589ccc51aa8cd888ac80a00000000000001600143187b3627e6e80c7911ef627a8589ccc51aa8cd800000000ac80a00000000000001600143187b3627e6e80c7911ef627a8589ccc51aa8cd800000000";
    const memoryTx = '0x' + rawTx;
    const txId = calculateTxId(rawTx);
    const btcAmount = ethers.utils.parseUnits("0.1", 8); // BTC in sats
    const script = "0x04bfc3a067b17576a9143187b3627e6e80c7911ef627a8589ccc51aa8cd888ac";

    await bitcoinStake.addBtcTx(memoryTx, btcAmount, 0, 1738589119, 0);
    await bitcoinStake.addReceipt(memoryTx, vaulterCore.address, 0);

    const storedTx = await bitcoinStake.btcTxMap(txId);
    await vaulterCore.recordBTCStake(memoryTx, script);

    const validator = addr2.address;

    await vaulterCore.connect(addr1).depositCORE({ value: ethers.utils.parseEther("1000") });

    await vaulterCore.stakeCORE(validator, ethers.utils.parseEther("1000"));
    expect(await vaulterCore.totalCoreStaked()).to.equal(ethers.utils.parseUnits("800", 18));

    await vaulterCore.unstakeCORE(ethers.utils.parseUnits("800", 18));
    expect(await vaulterCore.totalCoreStaked()).to.equal(0);
  });

  it("Should trigger unstaking via withdrawCORE when vault funds are insufficient", async function () {
    const rawTx = "0200000001b4bc7b1410c36d8e5919280b771ea7143cd33b8f4a7f5aa87ca8bfda06ca8a0d0200000000ffffffff031027000000000000220020631c19fc18fc13e12120a83c92dc303c17ce0bc09d93c5c51e1e5e238276973c0000000000000000536a4c505341542b01045a0f21a1d7b8c0927851e8a80d16a473416421f657de442f5ba55687a24f04419424e0dc2593cc9f4c0004bfc3a067b17576a9143187b3627e6e80c7911ef627a8589ccc51aa8cd8880200000001b4bc7b1410c36d8e5919280b771ea7143cd33b8f4a7f5aa87ca8bfda06ca8a0d0200000000ffffffff031027000000000000220020631c19fc18fc13e12120a83c92dc303c17ce0bc09d93c5c51e1e5e238276973c0000000000000000536a4c505341542b01045a0f21a1d7b8c0927851e8a80d16a473416421f657de442f5ba55687a24f04419424e0dc2593cc9f4c0004bfc3a067b17576a9143187b3627e6e80c7911ef627a8589ccc51aa8cd888ac80a00000000000001600143187b3627e6e80c7911ef627a8589ccc51aa8cd800000000ac80a00000000000001600143187b3627e6e80c7911ef627a8589ccc51aa8cd800000000";
    const memoryTx = '0x' + rawTx;
    const txId = calculateTxId(rawTx);
    const btcAmount = ethers.utils.parseUnits("0.1", 8); // BTC in sats
    const script = "0x04bfc3a067b17576a9143187b3627e6e80c7911ef627a8589ccc51aa8cd888ac";

    await bitcoinStake.addBtcTx(memoryTx, btcAmount, 0, 1738589119, 0);
    await bitcoinStake.addReceipt(memoryTx, vaulterCore.address, 0);

    const storedTx = await bitcoinStake.btcTxMap(txId);
    await vaulterCore.recordBTCStake(memoryTx, script);

    const validator = addr2.address;

    await vaulterCore.connect(addr1).depositCORE({ value: ethers.utils.parseEther("1000") });

    await vaulterCore.stakeCORE(validator, ethers.utils.parseEther("1000"));
    expect(await vaulterCore.totalCoreStaked()).to.equal(ethers.utils.parseUnits("800", 18));

    await stakeHub.setRound(1);
    // Claim the core rewards
    await vaulterCore.claimCoreRewards();
    
    // Get the vault token (vltCORE) balance of addr1.
    const sharesAddr1 = await vaulterCore.balanceOf(addr1.address);
    console.log("sharesAddr1:", ethers.utils.formatUnits(sharesAddr1, 18));
    const expectedAssets = await vaulterCore.convertToAssets(sharesAddr1);
    console.log("expectedAssets:", ethers.utils.formatUnits(expectedAssets, 18));
    totalCoreStaked = await vaulterCore.totalCoreStaked();
    console.log("totalCoreStaked:", ethers.utils.formatUnits(totalCoreStaked, 18));

    // When addr1 calls withdrawCORE, the contract should detect that assets > contract.balance and call _unstakeCORE.
    await vaulterCore.connect(addr1).withdrawCORE(sharesAddr1);

    // Verify that the vault’s totalCoreStaked is reduced (in our test we expect it to be 0 after unstaking).
    expect(await vaulterCore.totalCoreStaked()).to.equal(0);
  });

  /* ---------------------------------------------------------
  // Sequential Rounds Simulation (Rounds 1 through 5)
  Round 1: Deposits match the ideal 1:8000 ratio.
  Round 2: A deposit of excess CORE should make the CORE reward ratio greater than BTC.
  Round 3: An additional BTC stake is recorded, requiring more CORE to be staked.
  Round 4: The first BTC stake expires, which is reflected in the ratio update.
  Round 5: A withdrawal is performed (burning vault shares) and the ratios are output afterward.
  // --------------------------------------------------------- */
  it("should simulate 5 rounds with varying BTC/CORE deposits, outputting reward ratios after each round", async function () {
    // Provided raw transaction and script
    const rawTx =
      "0200000001b4bc7b1410c36d8e5919280b771ea7143cd33b8f4a7f5aa87ca8bfda06ca8a0d0200000000ffffffff031027000000000000220020631c19fc18fc13e12120a83c92dc303c17ce0bc09d93c5c51e1e5e238276973c0000000000000000536a4c505341542b01045a0f21a1d7b8c0927851e8a80d16a473416421f657de442f5ba55687a24f04419424e0dc2593cc9f4c0004bfc3a067b17576a9143187b3627e6e80c7911ef627a8589ccc51aa8cd8880200000001b4bc7b1410c36d8e5919280b771ea7143cd33b8f4a7f5aa87ca8bfda06ca8a0d0200000000ffffffff031027000000000000220020631c19fc18fc13e12120a83c92dc303c17ce0bc09d93c5c51e1e5e238276973c0000000000000000536a4c505341542b01045a0f21a1d7b8c0927851e8a80d16a473416421f657de442f5ba55687a24f04419424e0dc2593cc9f4c0004bfc3a067b17576a9143187b3627e6e80c7911ef627a8589ccc51aa8cd888ac80a00000000000001600143187b3627e6e80c7911ef627a8589ccc51aa8cd800000000ac80a00000000000001600143187b3627e6e80c7911ef627a8589ccc51aa8cd800000000";
    const script = "0x04bfc3a067b17576a9143187b3627e6e80c7911ef627a8589ccc51aa8cd888ac";
    const pubKey = ethers.utils.hexlify("0x3187b3627e6e80c7911ef627a8589ccc51aa8cd8");

    console.log(" ----- Round 1: Proper ratio deposit (0.1 BTC : 800 CORE) -----");
    const memoryTx1 = "0x" + rawTx;
    const txId = calculateTxId(rawTx);
    const btcAmount1 = ethers.utils.parseUnits("0.1", 8); // 0.1 BTC (in satoshis)
    // Use addBtcTx with dummy parameters; recordBTCStake will use the provided script to extract lockTime=1738589119.
    await bitcoinStake.addBtcTx(memoryTx1, btcAmount1, 0, 1738589119, 0);
    await bitcoinStake.addReceipt(memoryTx1, vaulterCore.address, 1);
    await vaulterCore.recordBTCStake(memoryTx1, script);

    //before any CORE deposit, totalAssets should be 0 and pricePerShare should be 1e18.
    let pricePerShare = await vaulterCore.getPricePerShare();
    expect(pricePerShare).to.equal(ethers.BigNumber.from("1000000000000000000"));
    let totalAssets = await vaulterCore.totalAssets();
    expect(totalAssets).to.equal(0);

    // addr1 deposits exactly 1600 CORE
    await vaulterCore.connect(addr1).depositCORE({ value: ethers.utils.parseEther("1600") });
    // After deposit, totalAssets should equal the deposit
    totalAssets = await vaulterCore.totalAssets();
    expect(totalAssets).to.equal(ethers.utils.parseEther("1600"));
    let totalSupply = await vaulterCore.totalSupply();
    console.log("After addr1 CORE deposit, totalSupply of vltCORE:", ethers.utils.formatUnits(totalSupply, 18));
    // For the first deposit, getPricePerShare should still be ~1e18.
    pricePerShare = await vaulterCore.getPricePerShare();
    expect(pricePerShare).to.equal(ethers.BigNumber.from("1000000000000000000"));

    // Stake the required CORE via CoreAgent (800 CORE)
    await vaulterCore.stakeCORE(addr2.address, ethers.utils.parseEther("800"));
    let totalCoreStaked = await vaulterCore.totalCoreStaked();
    expect(totalCoreStaked).to.equal(ethers.utils.parseEther("800"));
    pricePerShare = await vaulterCore.getPricePerShare();
    console.log("Round 1, getPricePerShare:", ethers.utils.formatUnits(pricePerShare, 18));

    await stakeHub.setRound(1);
    await stakeHub.addReward(ethers.utils.parseEther("10")); // scaled-down reward
    await vaulterCore.claimCoreRewards();

    // After rewards are claimed, check:
    // - totalAssets should now be increased by the net reward distribution
    totalAssets = await vaulterCore.totalAssets();
    console.log("After Round 1, totalAssets of CORE:", ethers.utils.formatUnits(totalAssets, 18));
    totalSupply = await vaulterCore.totalSupply();
    console.log("After Round 1, totalSupply of vltCORE:", ethers.utils.formatUnits(totalSupply, 18));
    // - getPricePerShare() increase due to rewards
    pricePerShare = await vaulterCore.getPricePerShare();
    console.log("After Round 1, getPricePerShare:", ethers.utils.formatUnits(pricePerShare, 18));
    // - Check pending rewards accrued for the BTC stake.
    let btcStake = await vaulterCore.btcStakes(pubKey);
    console.log("After Round 1, pending BTC rewards:", ethers.utils.formatUnits(btcStake.pendingRewards, 18));
    const totalBTCStaked1 = await vaulterCore.totalBTCStaked();
    const totalCoreDeposits1 = await vaulterCore.totalCoreDeposits();
    console.log("After Round 1, total BTC staked:", ethers.utils.formatUnits(totalBTCStaked1, 8),
      "total CORE Deposits:", ethers.utils.formatUnits(totalCoreDeposits1, 18));
    totalCoreStaked = await vaulterCore.totalCoreStaked();
    console.log("After Round 1, totalCoreStaked:", ethers.utils.formatUnits(totalCoreStaked, 18));
    let pendingCoreRewards = await vaulterCore.pendingCoreRewards();
    console.log("After Round 1, pendingCoreRewards:", ethers.utils.formatUnits(pendingCoreRewards, 18));
    const updatedBtcRewardRatio1 = await vaulterCore.btcRewardRatio();
    const updatedCoreRewardRatio1 = await vaulterCore.coreRewardRatio();
    console.log("After Round 1, BTC Reward Ratio:", updatedBtcRewardRatio1.toString(),
      ", CORE Reward Ratio:", updatedCoreRewardRatio1.toString());
    let protocolFees = await vaulterCore.pendingProtocolFees();
    console.log("After Round 1, protocolFees:", ethers.utils.formatUnits(protocolFees, 18));
    console.log("##################################################");

    console.log(" ----- Round 2: Excess 2000 CORE deposit relative to BTC -----");
    // Now, addr2 deposits an additional 2000 CORE, so totalCoreDeposits becomes 800 + 2000 = 2800 CORE.
    await vaulterCore.connect(addr2).depositCORE({ value: ethers.utils.parseEther("2000") });
    totalAssets = await vaulterCore.totalAssets();
    pricePerShare = await vaulterCore.getPricePerShare();
    console.log("Round 2, totalAssets:", ethers.utils.formatUnits(totalAssets, 18));
    totalSupply = await vaulterCore.totalSupply();
    console.log("Round 2, totalSupply of vltCORE:", ethers.utils.formatUnits(totalSupply, 18));
    console.log("Round 2, getPricePerShare:", ethers.utils.formatUnits(pricePerShare, 18));
    // Attempt to stake extra CORE; contract logic should only stake as needed (still 800 total)
    await vaulterCore.stakeCORE(addr2.address, ethers.utils.parseEther("2000"));
    expect(await vaulterCore.totalCoreStaked()).to.equal(ethers.utils.parseEther("800"));

    // Process rewards for round 2.
    await stakeHub.setRound(2);
    await stakeHub.addReward(ethers.utils.parseEther("5"));
    await vaulterCore.claimCoreRewards();
    totalAssets = await vaulterCore.totalAssets();
    pricePerShare = await vaulterCore.getPricePerShare();
    console.log("After Round 2, totalAssets:", ethers.utils.formatUnits(totalAssets, 18));
    totalSupply = await vaulterCore.totalSupply();
    console.log("After Round 2, totalSupply of vltCORE:", ethers.utils.formatUnits(totalSupply, 18));
    console.log("After Round 2, getPricePerShare:", ethers.utils.formatUnits(pricePerShare, 18));
    btcStake = await vaulterCore.btcStakes(pubKey);
    console.log("After Round 2, pending BTC rewards:", ethers.utils.formatUnits(btcStake.pendingRewards, 18));
    const totalBTCStaked2 = await vaulterCore.totalBTCStaked();
    const totalCoreDeposits2 = await vaulterCore.totalCoreDeposits();
    console.log("After Round 2, total BTC staked:", ethers.utils.formatUnits(totalBTCStaked2, 8),
      "total CORE Deposits:", ethers.utils.formatUnits(totalCoreDeposits2, 18));
    totalCoreStaked = await vaulterCore.totalCoreStaked();
    console.log("After Round 2, totalCoreStaked:", ethers.utils.formatUnits(totalCoreStaked, 18));
     pendingCoreRewards = await vaulterCore.pendingCoreRewards();
    console.log("After Round 2, pendingCoreRewards:", ethers.utils.formatUnits(pendingCoreRewards, 18));
    const updatedBtcRewardRatio2 = await vaulterCore.btcRewardRatio();
    const updatedCoreRewardRatio2 = await vaulterCore.coreRewardRatio();
    console.log("After Round 2, BTC Reward Ratio:", updatedBtcRewardRatio2.toString(),
      ", CORE Reward Ratio:", updatedCoreRewardRatio2.toString());
    protocolFees = await vaulterCore.pendingProtocolFees();
    console.log("After Round 2, protocolFees:", ethers.utils.formatUnits(protocolFees, 18));
    console.log("##################################################");


    console.log(" ----- Round 3: Excess BTC stake (another 0.6 BTC) -----");
    // Reuse the provided rawTx and script
    const rawTx3 = "02000000016074790d4f21516b182f1542023b90d938e91640fb473908ae1c23321d0fcb980200000000ffffffff031027000000000000220020b55aaa01a70f4ccc4772507463bde55155e4e3abed874d7d18161ea4f6588b730000000000000000536a4c505341542b01045a0f21a1d7b8c0927851e8a80d16a473416421f657de442f5ba55687a24f04419424e0dc2593cc9f4c00047352a167b17576a9143187b3627e6e80c7911ef627a8589ccc51aa8cd888ac7a780000000000001600143187b3627e6e80c7911ef627a8589ccc51aa8cd800000000";
    const script3 = "0x047352a167b17576a9143187b3627e6e80c7911ef627a8589ccc51aa8cd888ac";
    const memoryTx3 = "0x" + rawTx3;
    const btcAmount3 = ethers.utils.parseUnits("0.6", 8);
    await bitcoinStake.addBtcTx(memoryTx3, btcAmount3, 0, 1738625651, 0);
    await bitcoinStake.addReceipt(memoryTx3, vaulterCore.address, 3);
    await vaulterCore.recordBTCStake(memoryTx3, script3);

    // Stake half the CORE we had from before
    await vaulterCore.stakeCORE(addr2.address, ethers.utils.parseEther("1000"));
    expect(await vaulterCore.totalCoreStaked()).to.equal(ethers.utils.parseEther("1800"));

    await stakeHub.setRound(3);
    await stakeHub.addReward(ethers.utils.parseEther("8"));
    await vaulterCore.claimCoreRewards();
    totalAssets = await vaulterCore.totalAssets();
    pricePerShare = await vaulterCore.getPricePerShare();
    console.log("After Round 3, totalAssets:", ethers.utils.formatUnits(totalAssets, 18));
    totalSupply = await vaulterCore.totalSupply();
    console.log("After Round 3, totalSupply of vltCORE:", ethers.utils.formatUnits(totalSupply, 18));
    console.log("After Round 3, getPricePerShare:", ethers.utils.formatUnits(pricePerShare, 18));
    btcStake = await vaulterCore.btcStakes(pubKey);
    console.log("After Round 3, pending BTC rewards:", ethers.utils.formatUnits(btcStake.pendingRewards, 18));
    const totalBTCStaked3 = await vaulterCore.totalBTCStaked();
    const totalCoreDeposits3 = await vaulterCore.totalCoreDeposits();
    console.log("After Round 3, total BTC staked:", ethers.utils.formatUnits(totalBTCStaked3, 8),
      "total CORE Deposits:", ethers.utils.formatUnits(totalCoreDeposits3, 18));
    totalCoreStaked = await vaulterCore.totalCoreStaked();
    console.log("After Round 3, totalCoreStaked:", ethers.utils.formatUnits(totalCoreStaked, 18));
    pendingCoreRewards = await vaulterCore.pendingCoreRewards();
    console.log("After Round 3, pendingCoreRewards:", ethers.utils.formatUnits(pendingCoreRewards, 18));
    const updatedBtcRewardRatio3 = await vaulterCore.btcRewardRatio();
    const updatedCoreRewardRatio3 = await vaulterCore.coreRewardRatio();
    console.log("After Round 3, BTC Reward Ratio:", updatedBtcRewardRatio3.toString(),
      ", CORE Reward Ratio:", updatedCoreRewardRatio3.toString());
    protocolFees = await vaulterCore.pendingProtocolFees();
    console.log("After Round 3, protocolFees:", ethers.utils.formatUnits(protocolFees, 18));
    console.log("##################################################");

    console.log(" ----- Round 4: Expire the first BTC stake -----");
    // Retrieve the current block timestamp and calculate the offset so that:
    //   block.timestamp > depositTime + 1738589119
    const currentBlock = await ethers.provider.getBlock("latest");
    const depositTime = currentBlock.timestamp;
    //console.log("Current block timestamp:", depositTime);

    // Print the stored values for the first BTC stake (using its txId)
    const btcTxRecord = await vaulterCore.btcTxMap(txId);
    /*
    console.log("BtcTxMap for txId:", txId);
    console.log("Amount:", ethers.utils.formatUnits(btcTxRecord.amount, 18));
    console.log("LockTime:", btcTxRecord.lockTime.toString());
    console.log("DepositTime:", btcTxRecord.depositTime.toString());
    console.log("EndRound:", btcTxRecord.endRound.toString());
    console.log("PubKey:", btcTxRecord.pubKey);
    */
    // Set the target timestamp to a value between the two lockTimes.
    const targetTimestamp = 1738600000; // between 1738589119 and 1738625651
    // Calculate the offset needed to reach the target timestamp.
    const offset = targetTimestamp - currentBlock.timestamp;
    await ethers.provider.send("evm_increaseTime", [offset]);
    await ethers.provider.send("evm_mine");
    const newBlock = await ethers.provider.getBlock("latest");
    //console.log("New block timestamp after increase:", newBlock.timestamp);
    await stakeHub.setRound(4);
    await stakeHub.addReward(ethers.utils.parseEther("20"));
    const txClaim4 = await vaulterCore.claimCoreRewards();
    const receiptClaim4 = await txClaim4.wait();
    let expiredRemoved = false;
    for (const event of receiptClaim4.events) {
      if (event.event === "ExpiredStakeRemoved") {
        expiredRemoved = true;
        console.log("Expired BTC stake removed for txId:", event.args.txId);
      }
    }
    expect(expiredRemoved).to.equal(true);
    // After expiration, only the second BTC stake (0.6 BTC) should remain.
    const totalBTCAfter = await vaulterCore.totalBTCStaked();
    expect(totalBTCAfter).to.equal(btcAmount3);
    totalAssets = await vaulterCore.totalAssets();
    pricePerShare = await vaulterCore.getPricePerShare();
    console.log("After Round 4, totalAssets:", ethers.utils.formatUnits(totalAssets, 18));
    totalSupply = await vaulterCore.totalSupply();
    console.log("After Round 4, totalSupply of vltCORE:", ethers.utils.formatUnits(totalSupply, 18));
    console.log("After Round 4, getPricePerShare:", ethers.utils.formatUnits(pricePerShare, 18));
    btcStake = await vaulterCore.btcStakes(pubKey);
    console.log("After Round 4, pending BTC rewards:", ethers.utils.formatUnits(btcStake.pendingRewards, 18));
    const totalBTCStaked4 = await vaulterCore.totalBTCStaked();
    const totalCoreDeposits4 = await vaulterCore.totalCoreDeposits();
    console.log("After Round 4, total BTC staked:", ethers.utils.formatUnits(totalBTCStaked4, 8),
      "total CORE Deposits:", ethers.utils.formatUnits(totalCoreDeposits4, 18));
    totalCoreStaked = await vaulterCore.totalCoreStaked();
    console.log("After Round 4, totalCoreStaked:", ethers.utils.formatUnits(totalCoreStaked, 18));
    pendingCoreRewards = await vaulterCore.pendingCoreRewards();
    console.log("After Round 4, pendingCoreRewards:", ethers.utils.formatUnits(pendingCoreRewards, 18));
    const updatedBtcRewardRatio4 = await vaulterCore.btcRewardRatio();
    const updatedCoreRewardRatio4 = await vaulterCore.coreRewardRatio();
    console.log("After Round 4, BTC Reward Ratio:", updatedBtcRewardRatio4.toString(),
      ", CORE Reward Ratio:", updatedCoreRewardRatio4.toString());
    protocolFees = await vaulterCore.pendingProtocolFees();
    console.log("After Round 4, protocolFees:", ethers.utils.formatUnits(protocolFees, 18));
    console.log("##################################################");

    console.log(" ----- Round 5: Liquidity provider withdraws CORE (vault shares burned) -----");
    let sharesAddr1 = await vaulterCore.balanceOf(addr1.address);
    console.log("Round 5, addr1 vltCORE shares balance:", ethers.utils.formatUnits(sharesAddr1, 18));
    const claimRewards = await vaulterCore.connect(addr1).claimRewards();
    sharesAddr1 = await vaulterCore.balanceOf(addr1.address);
    console.log("Round 5, addr1 vltCORE shares balance after claim rewards:", ethers.utils.formatUnits(sharesAddr1, 18));
    totalAssets = await vaulterCore.totalAssets();
    pricePerShare = await vaulterCore.getPricePerShare();
    console.log("Round 5, totalAssets:", ethers.utils.formatUnits(totalAssets, 18));
    totalSupply = await vaulterCore.totalSupply();
    console.log("Round 5, totalSupply of vltCORE:", ethers.utils.formatUnits(totalSupply, 18));
    console.log("Round 5, getPricePerShare:", ethers.utils.formatUnits(pricePerShare, 18));
    const initialBalanceAddr1 = await ethers.provider.getBalance(addr1.address);
    const txWithdraw = await vaulterCore.connect(addr1).withdrawCORE(sharesAddr1);
    await txWithdraw.wait();
    sharesAddr1 = await vaulterCore.balanceOf(addr1.address);
    console.log("Round 5, addr1 vltCORE shares balance after withdraw:", ethers.utils.formatUnits(sharesAddr1, 18));
    //expect(await vaulterCore.balanceOf(addr1.address)).to.equal(0);
    const finalBalanceAddr1 = await ethers.provider.getBalance(addr1.address);
    console.log("Round 5, addr1 balance increased: ", ethers.utils.formatUnits(finalBalanceAddr1.sub(initialBalanceAddr1), 18));

    await stakeHub.setRound(5);
    const txClaim5 = await vaulterCore.claimCoreRewards();
    totalAssets = await vaulterCore.totalAssets();
    pricePerShare = await vaulterCore.getPricePerShare();
    console.log("After Round 5, totalAssets:", ethers.utils.formatUnits(totalAssets, 18));
    totalSupply = await vaulterCore.totalSupply();
    console.log("After Round 5, totalSupply of vltCORE:", ethers.utils.formatUnits(totalSupply, 18));
    console.log("After Round 5, getPricePerShare:", ethers.utils.formatUnits(pricePerShare, 18));
    btcStake = await vaulterCore.btcStakes(pubKey);
    console.log("After Round 5, pending BTC rewards:", ethers.utils.formatUnits(btcStake.pendingRewards, 18));
    const totalBTCStaked5 = await vaulterCore.totalBTCStaked();
    const totalCoreDeposits5 = await vaulterCore.totalCoreDeposits();
    console.log("After Round 5, total BTC staked:", ethers.utils.formatUnits(totalBTCStaked5, 8),
      "total CORE Deposits:", ethers.utils.formatUnits(totalCoreDeposits5, 18));
    totalCoreStaked = await vaulterCore.totalCoreStaked();
    console.log("After Round 5, totalCoreStaked:", ethers.utils.formatUnits(totalCoreStaked, 18));
    pendingCoreRewards = await vaulterCore.pendingCoreRewards();
    console.log("After Round 5, pendingCoreRewards:", ethers.utils.formatUnits(pendingCoreRewards, 18));
    const updatedBtcRewardRatio5 = await vaulterCore.btcRewardRatio();
    const updatedCoreRewardRatio5 = await vaulterCore.coreRewardRatio();
    console.log("After Round 5, BTC Reward Ratio:", updatedBtcRewardRatio5.toString(),
      ", CORE Reward Ratio:", updatedCoreRewardRatio5.toString());
    protocolFees = await vaulterCore.pendingProtocolFees();
    console.log("After Round 5, protocolFees:", ethers.utils.formatUnits(protocolFees, 18));
    console.log("##################################################");

    console.log(" ----- Round 6: BTC rewards are claimed -----");
    sharesAddr1 = await vaulterCore.balanceOf(addr1.address);
    console.log("Round 6, addr1 vltCORE shares balance:", ethers.utils.formatUnits(sharesAddr1, 18));

    const ethPubKey = "0x045cea681f98a4e06d2d06678daf45e9e73eca6e3f85383c3bc35401eef2c1fe80ff05cec2452562123aff9fe8d8e53d863be580403239c8fc2aebbdd1882281a5";
    const signature = "0xb762cbd42521deacb8fe3263d0a8eeac2d5005f5b434b4dc2681bbb20e3dfb3a3044e242013a056862642bcc3e18da02b94590cc592f340ddf476b0e6d4b49cc1c";
    const recipient = "0x0f21A1d7b8c0927851E8a80d16a473416421f657".toLowerCase();
    const message = 'recipient: ';
    const fullMessage = `${message}${recipient}`;
    const prefixedMessage = `\x19Ethereum Signed Message:\n${fullMessage.length}${fullMessage}`;
    const messageHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(prefixedMessage));
    btcStake = await vaulterCore.btcStakes(pubKey);
    console.log("Round 6, btcStake pendingRewards:", ethers.utils.formatUnits(btcStake.pendingRewards, 18));
    let balanceBefore = await vaulterCore.balanceOf(recipient);
    console.log("Round 6, recipient balanceBefore:", ethers.utils.formatUnits(balanceBefore, 18));
    await vaulterCore.claimBTCRewards(ethers.utils.arrayify(ethPubKey), ethers.utils.arrayify(signature), message, recipient);
    let balanceAfter = await vaulterCore.balanceOf(recipient);
    console.log("Round 6, recipient balanceAfter:", ethers.utils.formatUnits(balanceAfter, 18));

    await stakeHub.setRound(6);
    await stakeHub.addReward(ethers.utils.parseEther("10"));
    await vaulterCore.claimCoreRewards();

    totalAssets = await vaulterCore.totalAssets();
    pricePerShare = await vaulterCore.getPricePerShare();
    console.log("After Round 6, totalAssets:", ethers.utils.formatUnits(totalAssets, 18));
    totalSupply = await vaulterCore.totalSupply();
    console.log("After Round 6, totalSupply of vltCORE:", ethers.utils.formatUnits(totalSupply, 18));
    console.log("After Round 6, getPricePerShare:", ethers.utils.formatUnits(pricePerShare, 18));
    btcStake = await vaulterCore.btcStakes(pubKey);
    console.log("After Round 6, pending BTC rewards:", ethers.utils.formatUnits(btcStake.pendingRewards, 18));
    const totalBTCStaked6 = await vaulterCore.totalBTCStaked();
    const totalCoreDeposits6 = await vaulterCore.totalCoreDeposits();
    console.log("After Round 6, total BTC staked:", ethers.utils.formatUnits(totalBTCStaked6, 8),
      "total CORE Deposits:", ethers.utils.formatUnits(totalCoreDeposits6, 18));
    const updatedBtcRewardRatio6 = await vaulterCore.btcRewardRatio();
    const updatedCoreRewardRatio6 = await vaulterCore.coreRewardRatio();
    console.log("After Round 6, BTC Reward Ratio:", updatedBtcRewardRatio6.toString(),
      ", CORE Reward Ratio:", updatedCoreRewardRatio6.toString());
    protocolFees = await vaulterCore.pendingProtocolFees();
    console.log("After Round 6, protocolFees:", ethers.utils.formatUnits(protocolFees, 18));
  });
});