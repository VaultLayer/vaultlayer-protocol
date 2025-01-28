const hre = require("hardhat");

async function main() {
  // Specify the allowed NFT contracts
  const allowedNFTs = [
    "0xa2F47B8832dc2Ceab46123B9ad0Ce4eEc4774f6B", // LSV-v0
    "0xcc89552ff8dAfD016c91B7694dc0B69E23F2479D", // Core Origin NFT
    "0xe48696582061011BeADcDB1eb132Ff2261CED5cf", // Coretoshis
    "0x111d7E1E58Dd8f957c12197b69d3284aea801ad1" // COREx Genesis Apostle
  ];

  const governAddress = "0x925C888A308dB8DBE3aEb271b461937Ec784565D";
  console.log("Deploying NFTLendAuction contract...");
  
  // Deploy the contract
  const NFTLendAuction = await hre.ethers.getContractFactory("NFTLendAuctionV1");
  const nftLendAuction = await NFTLendAuction.deploy(governAddress);

  await nftLendAuction.deployed();
  console.log("NFTLendAuction deployed to:", nftLendAuction.address);

  // Add allowed NFT contracts
  /*console.log("Updating allowed NFT contracts...");
  for (const nft of allowedNFTs) {
    const tx = await nftLendAuction.updateAllowedNFT(nft, true);
    await tx.wait();
    console.log(`Allowed NFT contract: ${nft}`);
  }*/

  console.log("Deployment and setup completed!");
}

// Error handling
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
