const { expect } = require("chai");
const { ethers } = require("hardhat");
const { toRpcSig } = require('@ethereumjs/util');


function calculateTxId(tx) {
  // Perform the first SHA-256 hash
  const inputHash1 = ethers.utils.sha256('0x'+tx);

  // Perform abi.encodePacked
  const packed = ethers.utils.concat([inputHash1]); // Concatenates input bytes

  // Compute SHA-256 hash
  const inputHash2 = ethers.utils.sha256(packed);
  // Return the final hash
  return inputHash2;
}

describe("VaultLayer Contract", function () {
  let VaultLayer, vaultLayer;
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

    // Deploy VaultLayer contract
    const VaultLayer = await ethers.getContractFactory("VaultLayer");
    // Link the deployed BitcoinHelper library to VaultLayer
    /*const VaultLayer = await ethers.getContractFactory("VaultLayer", {
      libraries: {
          BitcoinHelper: bitcoinHelper.address,
      },
    });*/
    vaultLayer = await VaultLayer.deploy(
      stakeHub.address,
      bitcoinStake.address,
      coreAgent.address
    );
  });

  it("Should initialize correctly", async function () {
    expect(await vaultLayer.btcPriceInCore()).to.equal(60000);
    expect(await vaultLayer.minCollateralRatio()).to.equal(200);
    expect(await vaultLayer.btcRewardRatio()).to.equal(50);
    expect(await vaultLayer.coreRewardRatio()).to.equal(50);
    expect(await vaultLayer.platformFee()).to.equal(500);
  });

  it("Should deposit CORE with locktime", async function () {
    await vaultLayer.connect(addr1).depositCORE({ value: ethers.utils.parseEther("1") });
    const deposit = await vaultLayer.coreDeposits(addr1.address);
    expect(deposit).to.equal(ethers.utils.parseEther("1"));
    expect(await vaultLayer.totalCoreDeposits()).to.equal(ethers.utils.parseEther("1"));
  });

  it("Should not allow withdraw CORE before 1 round", async function () {
    const depositAmount = ethers.utils.parseEther("1");

    await vaultLayer.connect(addr1).depositCORE({ value: depositAmount });
    const shares = await vaultLayer.balanceOf(addr1.address); // Get the correct shares minted

    await expect(
      vaultLayer.connect(addr1).withdrawCORE(shares)
    ).to.be.revertedWith("Withdrawal locked for this round");
});

it("Should allow withdraw CORE after 1 round", async function () {
    const depositAmount = ethers.utils.parseEther("1");

    await vaultLayer.connect(addr1).depositCORE({ value: depositAmount });
    const shares = await vaultLayer.balanceOf(addr1.address); // Get the correct shares minted

    await vaultLayer.setNewRound(1);

    await expect(() =>
      vaultLayer.connect(addr1).withdrawCORE(shares)
    ).to.changeEtherBalance(addr1, depositAmount);
});


  it("Should record BTC stake", async function () {
    const rawTx = "02000000025c3190fe579bc48f41caac8aef2f68334341ff531909fd4817be3e52a022e7ca0100000000feffffff64cb4a4447e0bef3d3029c4d2abfd28b4961c8eff08af41b5b43afed21ccaee80000000000feffffff03404b4c00000000002200203087124dc197dbc0d4787bd3682223b966dd842896be6776f0504c8a67d1dd1d0000000000000000536a4c505341542b01045cd6eef6a4ceb9270776d6b388cfaba62f5bc3357fa21cbd3caa4fe89bccd1d716c92ce4533e4d47330004178c8667b17576a914332046df873f53e867a3e76f75b2a2f37f013f2f88ac7554100000000000160014332046df873f53e867a3e76f75b2a2f37f013f2f00000000";
    const memoryTx = '0x'+rawTx;
    const txId = calculateTxId(rawTx);
    const btcAmount = ethers.utils.parseUnits("1", 8); // 1 BTC in sats
    const script = "0x04178c8667b17576a914332046df873f53e867a3e76f75b2a2f37f013f2f88ac";
    console.log("BTC txID hash:", txId.toString());
    await bitcoinStake.addBtcTx(memoryTx, btcAmount, 0, 1000, 0);
    await bitcoinStake.addReceipt(memoryTx, vaultLayer.address, 0);
    
    const storedTx = await bitcoinStake.btcTxMap(txId);
    console.log("Mock stored BTC amount:", storedTx.amount.toString());

    const tx = await vaultLayer.recordBTCStake(memoryTx, btcAmount, script);
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

    const storedBtcTx = await vaultLayer.btcTxMap(txId);
    console.log("Stored BTC Amount:", storedBtcTx.amount.toString());
    console.log("Stored PubKey:", storedBtcTx.pubKey);

    expect(storedBtcTx.amount).to.equal(btcAmount);
    expect(await vaultLayer.totalBTCStaked()).to.equal(btcAmount);
  });


  it("Should claim BTC rewards", async function () {
    const rawTx = "02000000025c3190fe579bc48f41caac8aef2f68334341ff531909fd4817be3e52a022e7ca0100000000feffffff64cb4a4447e0bef3d3029c4d2abfd28b4961c8eff08af41b5b43afed21ccaee80000000000feffffff03404b4c00000000002200203087124dc197dbc0d4787bd3682223b966dd842896be6776f0504c8a67d1dd1d0000000000000000536a4c505341542b01045cd6eef6a4ceb9270776d6b388cfaba62f5bc3357fa21cbd3caa4fe89bccd1d716c92ce4533e4d47330004178c8667b17576a914332046df873f53e867a3e76f75b2a2f37f013f2f88ac7554100000000000160014332046df873f53e867a3e76f75b2a2f37f013f2f00000000";
    const memoryTx = '0x'+rawTx;
    const txId = calculateTxId(rawTx);
    const btcAmount = ethers.utils.parseUnits("1", 8); // 1 BTC in sats
    const script = "0x04178c8667b17576a914332046df873f53e867a3e76f75b2a2f37f013f2f88ac";
    console.log("BTC txID hash:", txId.toString());
    await bitcoinStake.addBtcTx(memoryTx, btcAmount, 0, 1000, 0);
    await bitcoinStake.addReceipt(memoryTx, vaultLayer.address, 0);
    
    const tx = await vaultLayer.recordBTCStake(memoryTx, btcAmount, script);
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

    /*
    const compressedPubKey = "0x032db951d5a638c52b729882f52e3c86131f0a191b3f318e69f1707aa97763a949";
    const signatureBase64 = "INnDOUvdAAk7fIeTsR+jM3AWmJHzufg8Q6JL6bE0zAyxSKpMwZOWJTvcbeut9cqixuKj39aZt2hgiq7dhLxIaCs=";
    const message = 'recipient: ';
    const recipient = "0xd6eeF6A4ceB9270776d6b388cFaBA62f5Bc3357f";
    

    const compressedPubKey = "0x02c29ab360da10dbcfe26000e13232911bcedc83bfd4c758ad7eaaed5f5ef8ebca";
    const signatureBase64 = "IOSqN9vdXwV00Wc0ZnAMK2UvTyMzhlsUr4xBU62uk5OmF/H23xZQ56b1xY1dASaAf2CdGIsg8x1dEn/ds0CwAaw=";
    const message = `Welcome to b14g! \n\nSignature using for: `;
    const recipient = "0x5fbdb2315678afecb367f032d93f642f64180aa3";
    */

    const compressedPubKey = "0x03305b9c0c6eaade5388092028d561ef061a32046aea06e6f8fe0c56b1b2f0a7b2";
    const ethPubKey = "0x04305b9c0c6eaade5388092028d561ef061a32046aea06e6f8fe0c56b1b2f0a7b25cdfa8da2d41b2cf92b5d4a6b4521f9eb9797f4f2cea177b590c09d836216267";
    const signatureBase64 = "INnDOUvdAAk7fIeTsR+jM3AWmJHzufg8Q6JL6bE0zAyxSKpMwZOWJTvcbeut9cqixuKj39aZt2hgiq7dhLxIaCs=";
    const message = 'recipient: ';
    const recipient = "0xd6eeF6A4ceB9270776d6b388cFaBA62f5Bc3357f";

    const pubKey = ethers.utils.hexlify("0x332046df873f53e867a3e76f75b2a2f37f013f2f");

    const btcStakeBefore = await vaultLayer.btcStakes(pubKey);
    console.log("btcStake pendingRewards before round:", btcStakeBefore.pendingRewards.toString());

    await stakeHub.setRound(1);
    await stakeHub.addReward(ethers.utils.parseEther("10"));  // Mock total rewards: 10 ETH

    // Claim the core rewards
    await vaultLayer.claimCoreRewards();

    const btcStake = await vaultLayer.btcStakes(pubKey);
    console.log("btcStake pendingRewards after round:", btcStake.pendingRewards.toString());


    // Convert Base64 signature to Hex
    
    let signatureBuffer = Buffer.from(signatureBase64, "base64");
    let v = BigInt(signatureBuffer[0] - 4);
    let r = signatureBuffer.subarray(1, 33);
    let s = signatureBuffer.subarray(33, 65);
    console.log("v:", v, typeof v);
    console.log("r:", r.toString('hex'));
    console.log("s:", s.toString('hex'));

    let signature = toRpcSig(v, r, s);

    console.log('claimBTCRewards params: ', pubKey, compressedPubKey, signature, message, recipient);

    await vaultLayer.claimBTCRewards(pubKey, compressedPubKey, signature, message, recipient);

    expect(await vaultLayer.balanceOf(recipient)).to.equal(ethers.utils.parseEther("475"));
  });

  it("Should rebalance rewards when only CORE is deposited", async function () {
    // Initial reward ratios should be 50/50
    let initialBtcRewardRatio = await vaultLayer.btcRewardRatio();
    let initialCoreRewardRatio = await vaultLayer.coreRewardRatio();
    expect(initialBtcRewardRatio.toNumber()).to.equal(50);
    expect(initialCoreRewardRatio.toNumber()).to.equal(50);

    // Deposit 10 CORE to create an imbalance (since no BTC is staked)
    await vaultLayer.connect(addr1).depositCORE({ value: ethers.utils.parseEther("10") });

    // Retrieve updated reward ratios
    const updatedBtcRewardRatio = await vaultLayer.btcRewardRatio();
    const updatedCoreRewardRatio = await vaultLayer.coreRewardRatio();

    console.log(`BTC Reward Ratio after deposit: ${updatedBtcRewardRatio.toString()}`);
    console.log(`CORE Reward Ratio after deposit: ${updatedCoreRewardRatio.toString()}`);

    // Since no BTC is staked, the ratio should shift towards rewarding BTC more to incentivize BTC deposits
    expect(updatedBtcRewardRatio).to.be.greaterThan(initialBtcRewardRatio);
    expect(updatedCoreRewardRatio).to.be.lessThan(initialCoreRewardRatio);
});


it("Should claim CORE rewards and distribute correctly", async function () {
  await stakeHub.setRound(1);
  await stakeHub.addReward(ethers.utils.parseEther("10"));  // Mock total rewards: 10 ETH

  // Claim the core rewards
  await vaultLayer.claimCoreRewards();

  // Calculate expected reward after platform fee deduction
  const totalReward = ethers.utils.parseEther("10");
  const platformFee = totalReward.mul(500).div(10000);  // 5% platform fee
  const netReward = totalReward.sub(platformFee);

  // Expected CORE distribution based on the current ratio
  const expectedCoreRewards = netReward.mul(50).div(100);  // coreRewardRatio is 50%

  const actualPendingRewards = await vaultLayer.pendingCoreRewards();

  console.log(`Expected CORE Rewards: ${expectedCoreRewards.toString()}`);
  console.log(`Actual CORE Rewards: ${actualPendingRewards.toString()}`);

  expect(actualPendingRewards).to.equal(expectedCoreRewards);
});


  it("Should stake and unstake CORE", async function () {
    const rawTx = "02000000025c3190fe579bc48f41caac8aef2f68334341ff531909fd4817be3e52a022e7ca0100000000feffffff64cb4a4447e0bef3d3029c4d2abfd28b4961c8eff08af41b5b43afed21ccaee80000000000feffffff03404b4c00000000002200203087124dc197dbc0d4787bd3682223b966dd842896be6776f0504c8a67d1dd1d0000000000000000536a4c505341542b01045cd6eef6a4ceb9270776d6b388cfaba62f5bc3357fa21cbd3caa4fe89bccd1d716c92ce4533e4d47330004178c8667b17576a914332046df873f53e867a3e76f75b2a2f37f013f2f88ac7554100000000000160014332046df873f53e867a3e76f75b2a2f37f013f2f00000000";
    const memoryTx = '0x'+rawTx;
    const txId = calculateTxId(rawTx);
    const btcAmount = ethers.utils.parseUnits("0.1", 8); // 1 BTC in sats
    const script = "0x04178c8667b17576a914332046df873f53e867a3e76f75b2a2f37f013f2f88ac";

    await bitcoinStake.addBtcTx(memoryTx, btcAmount, 0, 1000, 0);
    await bitcoinStake.addReceipt(memoryTx, vaultLayer.address, 0);
    
    const storedTx = await bitcoinStake.btcTxMap(txId);
    await vaultLayer.recordBTCStake(memoryTx, btcAmount, script);

    const validator = addr2.address;

    await vaultLayer.connect(addr1).depositCORE({ value: ethers.utils.parseEther("1000") });

    await vaultLayer.stakeCORE(validator, ethers.utils.parseEther("1000"));
    expect(await vaultLayer.totalCoreStaked()).to.equal(ethers.utils.parseUnits("800", 18));

    await vaultLayer.unstakeCORE(validator, ethers.utils.parseUnits("800", 18));
    expect(await vaultLayer.totalCoreStaked()).to.equal(0);
  });
});
