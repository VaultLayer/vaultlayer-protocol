const { ethers } = require("hardhat");

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);

    // Replace this with the address of the existing contract
    const coreAgentAddress = "0x0000000000000000000000000000000000001011";

    const DelegatorReader = await ethers.getContractFactory("DelegatorReader");
    const reader = await DelegatorReader.deploy(coreAgentAddress);

    await reader.deployed();
    console.log("DelegatorReader deployed to:", reader.address);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
