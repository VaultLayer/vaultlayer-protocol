const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BitcoinHelper Library Test", function () {
  let bitcoinHelperTest;

  before(async function () {
    const BitcoinHelperTest = await ethers.getContractFactory("BitcoinTest");
    bitcoinHelperTest = await BitcoinHelperTest.deploy();
    await bitcoinHelperTest.deployed();
  });

  it("Should extract public key hash and timelock from redeem script", async function () {
    const redeemScript = "0x04178c8667b17576a914332046df873f53e867a3e76f75b2a2f37f013f2f88ac";

    const expectedPubKeyHash = "0x332046df873f53e867a3e76f75b2a2f37f013f2f";
    const expectedTimelock = 1736870935;

    // Encode as bytes
    const scriptBytes = ethers.utils.arrayify(redeemScript);
    const tx = await bitcoinHelperTest.testExtractBitcoinAddress(scriptBytes);

    const timelock = tx[0];
    const pubKeyHash = tx[1];

    expect(timelock).to.equal(expectedTimelock);
    expect(pubKeyHash).to.equal(expectedPubKeyHash);
    
  });

});
