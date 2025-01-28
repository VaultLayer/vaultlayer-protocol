const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("NFTLendAuctionV2", function () {
  let NFTLendAuctionV2, nftLendAuction, MockNFT, MockERC20;
  let owner, borrower, lender1, lender2;
  let nftContract, erc20Token;
  let loanAmount, interestRate, protocolFeeRate;

  beforeEach(async function () {
    [owner, borrower, lender1, lender2] = await ethers.getSigners();

    // Deploy MockNFT contract
    MockNFT = await ethers.getContractFactory("MockNFT");
    nftContract = await MockNFT.deploy();
    await nftContract.deployed();

    // Deploy MockERC20 contract
    MockERC20 = await ethers.getContractFactory("MockERC20");
    erc20Token = await MockERC20.deploy("MockUSD", "MUSD", 18);
    await erc20Token.deployed();

    // Mint NFT for borrower
    await nftContract.connect(borrower).mint();

    // Deploy NFTLendAuctionV2 contract
    const NFTLendAuctionV2 = await ethers.getContractFactory("NFTLendAuctionV2");
    nftLendAuction = await NFTLendAuctionV2.deploy(erc20Token.address);
    await nftLendAuction.deployed();

    // Allow NFT contract
    await nftLendAuction.connect(owner).updateAllowedNFT(nftContract.address, true);

    // Loan parameters
    loanAmount = ethers.utils.parseEther("10");
    interestRate = 800; // 8% interest rate
    protocolFeeRate = 200; // 2% protocol fee

    // Mint ERC-20 tokens for lenders
    await erc20Token.mint(lender1.address, ethers.utils.parseEther("1000"));
    await erc20Token.mint(lender2.address, ethers.utils.parseEther("1000"));
  });

  it("should allow lender to place a bid and borrower to accept the loan", async function () {
    const loanType = 0; // FIXED

    // Approve NFT for listing
    await nftContract.connect(borrower).approve(nftLendAuction.address, 1);

    // List Loan
    await nftLendAuction
      .connect(borrower)
      .listLoan(nftContract.address, 1, loanAmount, 1000, 604800, loanType);

    // Approve ERC-20 tokens for lender
    await erc20Token.connect(lender1).approve(nftLendAuction.address, loanAmount);

    // Get balances before
    const lenderBalanceBefore = await erc20Token.balanceOf(lender1.address);
    const escrowBalanceBefore = await erc20Token.balanceOf(nftLendAuction.address);

    // Place a bid
    await expect(nftLendAuction.connect(lender1).placeBid(0, interestRate))
      .to.emit(nftLendAuction, "LoanBidPlaced")
      .withArgs(0, lender1.address, interestRate);

    // Get balances after
    const lenderBalanceAfter = await erc20Token.balanceOf(lender1.address);
    const escrowBalanceAfter = await erc20Token.balanceOf(nftLendAuction.address);

    // Validate balances
    expect(lenderBalanceBefore.sub(lenderBalanceAfter)).to.equal(loanAmount);
    expect(escrowBalanceAfter.sub(escrowBalanceBefore)).to.equal(loanAmount);

    // Accept loan
    await expect(nftLendAuction.connect(borrower).acceptLoan(0))
      .to.emit(nftLendAuction, "LoanAccepted");
  });

  it("should allow borrower to repay the loan and reclaim NFT", async function () {
    const loanType = 0; // FIXED
  
    // Approve NFT transfer
    await nftContract.connect(borrower).approve(nftLendAuction.address, 1);
  
    // List loan
    await nftLendAuction
      .connect(borrower)
      .listLoan(nftContract.address, 1, loanAmount, 1000, 604800, loanType);
  
    // Approve ERC20 tokens for lender and place bid
    await erc20Token.connect(lender1).approve(nftLendAuction.address, loanAmount);
    await nftLendAuction.connect(lender1).placeBid(0, interestRate);
    await nftLendAuction.connect(borrower).acceptLoan(0);
  
    // Calculate repayment details
    const interestAmount = loanAmount.mul(interestRate).div(10000); // Principal * Rate / 10000
    const totalRepayment = loanAmount.add(interestAmount); // Total repayment = Principal + Interest
    const borrowerProtocolFee = totalRepayment.mul(protocolFeeRate).div(10000); // Total repayment * Protocol Fee Rate
    const lenderProtocolFee = totalRepayment.mul(protocolFeeRate).div(10000); // Total repayment * Protocol Fee Rate
    const lenderPayout = totalRepayment.sub(lenderProtocolFee); // Lender payout = Total repayment - Lender's protocol fee

  
    // Mint and approve ERC20 tokens for borrower
    await erc20Token.mint(borrower.address, totalRepayment.add(borrowerProtocolFee)); // Include fees
    await erc20Token.connect(borrower).approve(nftLendAuction.address, totalRepayment.add(borrowerProtocolFee));
  
    // --- Balances Before ---
    const lenderBalanceBefore = await erc20Token.balanceOf(lender1.address);
    const protocolBalanceBefore = await erc20Token.balanceOf(nftLendAuction.address);
  
    // --- Repay Loan ---
    await nftLendAuction.connect(borrower).repayLoan(0);
  
    // --- Balances After ---
    const lenderBalanceAfter = await erc20Token.balanceOf(lender1.address);
    const protocolBalanceAfter = await erc20Token.balanceOf(nftLendAuction.address);
  
    // --- Validations ---
    // 1. Check lender received repayment minus lender protocol fee
    expect(lenderBalanceAfter.sub(lenderBalanceBefore)).to.equal(lenderPayout);
  
    // 2. Check protocol balance increased by both fees
    expect(protocolBalanceAfter.sub(protocolBalanceBefore)).to.equal(
      borrowerProtocolFee.add(lenderProtocolFee)
    );
  
    // 3. Verify NFT ownership returned to borrower
    expect(await nftContract.ownerOf(1)).to.equal(borrower.address);
  });
  
  

  it("should allow lender to claim NFT upon loan default", async function () {
    const loanType = 0; // FIXED

    // Approve NFT
    await nftContract.connect(borrower).approve(nftLendAuction.address, 1);

    // List loan
    await nftLendAuction
      .connect(borrower)
      .listLoan(nftContract.address, 1, loanAmount, 1000, 604800, loanType);

    // Approve ERC-20 tokens for lender and place bid
    await erc20Token.connect(lender1).approve(nftLendAuction.address, loanAmount);
    await nftLendAuction.connect(lender1).placeBid(0, interestRate);
    await nftLendAuction.connect(borrower).acceptLoan(0);

    // Advance time beyond the loan duration
    await ethers.provider.send("evm_increaseTime", [604800 + 1]); // 1 week + 1 second
    await ethers.provider.send("evm_mine", []);

    // Calculate protocol fee
    const interest = loanAmount.mul(interestRate).div(10000);
    const totalRepayment = loanAmount.add(interest);
    const protocolFee = totalRepayment.mul(protocolFeeRate).div(10000);

    // Approve protocol fee
    await erc20Token.connect(lender1).approve(nftLendAuction.address, protocolFee);

    // Claim defaulted loan
    await expect(nftLendAuction.connect(lender1).claimDefaultedLoan(0))
      .to.emit(nftLendAuction, "LoanDefaulted")
      .withArgs(0, lender1.address);

    // Verify NFT ownership transferred to lender
    expect(await nftContract.ownerOf(1)).to.equal(lender1.address);
  });
});
