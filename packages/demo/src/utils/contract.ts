import { ethers } from "ethers";
import NFTLendAuctionV1 from "../contracts/NFTLendAuctionV1.json";

export function getContract(signerOrProvider: ethers.Signer | ethers.providers.Provider) {
  const contractAddress = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS!;
  const abi = NFTLendAuctionV1.abi;

  return new ethers.Contract(contractAddress, abi, signerOrProvider);
}
