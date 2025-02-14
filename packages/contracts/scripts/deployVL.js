const { ethers } = require("hardhat");

async function main() {
    // Get contract factories
    const BitcoinHelper = await ethers.getContractFactory("BitcoinHelper");
    const [deployer] = await ethers.getSigners();

    console.log("Deploying BitcoinHelper...");
    const bitcoinHelper = await BitcoinHelper.deploy();
    await bitcoinHelper.deployed();
    console.log("BitcoinHelper deployed at:", bitcoinHelper.address);

    // Get VaultLayer contract factory after BitcoinHelper is deployed
    const VaulterCore = await ethers.getContractFactory("VaulterCore", {
        libraries: {
            BitcoinHelper: bitcoinHelper.address,
        },
    });

    console.log("Deploying VaulterCore with deployer:", deployer.address);

    // Define addresses for external dependencies
    const stakeHubAddress = "0x0000000000000000000000000000000000001010";
    const bitcoinStakeAddress = "0x0000000000000000000000000000000000001014";
    const coreAgentAddress = "0x0000000000000000000000000000000000001011";

    // Deploy VaulterCore contract
    const vaulterCore = await VaulterCore.deploy(stakeHubAddress, bitcoinStakeAddress, coreAgentAddress);
    await vaulterCore.deployed();

    console.log("VaulterCore deployed at:", vaulterCore.address);

    // Verify contract deployment
    console.log("Verifying contract...");
    await hre.run("verify:verify", {
        address: vaulterCore.address,
        constructorArguments: [stakeHubAddress, bitcoinStakeAddress, coreAgentAddress],
    });

    console.log("VaulterCore verified successfully.");
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
