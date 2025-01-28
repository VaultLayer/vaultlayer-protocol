const { expect } = require("chai");
const { ethers } = require("hardhat");

// Helper function to calculate repayment and protocol fees
async function calculateRepayment(loanAmount, interestRate, protocolFeeRate, nftLendAuction, loanId) {
  const totalRepayment = await nftLendAuction.getTotalRepayment(loanId);
  const borrowerProtocolFee = totalRepayment.mul(protocolFeeRate).div(10000);
  const lenderProtocolFee = totalRepayment.mul(protocolFeeRate).div(10000);
  const lenderPayout = totalRepayment.sub(lenderProtocolFee);
  const requiredRepayment = totalRepayment.add(borrowerProtocolFee);

  return { totalRepayment, borrowerProtocolFee, lenderProtocolFee, lenderPayout, requiredRepayment };
}

describe("NFTLendAuctionV1", function () {
  let NFTLendAuction, nftLendAuction, owner, borrower, lender1, lender2, nftContract, anotherNFTContract;

  beforeEach(async function () {
    [owner, borrower, lender1, lender2] = await ethers.getSigners();

    // Deploy MockNFT contract
    const MockNFT = await ethers.getContractFactory("MockNFT");
    nftContract = await MockNFT.deploy();
    await nftContract.deployed();

    // Deploy another NFT contract for testing disallowed cases
    anotherNFTContract = await MockNFT.deploy();
    await anotherNFTContract.deployed();

    // Mint an NFT to the borrower
    await nftContract.connect(borrower).mint();
    await anotherNFTContract.connect(borrower).mint();

    // Deploy the NFTLendAuction contract
    const NFTLendAuction = await ethers.getContractFactory("NFTLendAuctionV1");
    nftLendAuction = await NFTLendAuction.deploy(owner.address);
    await nftLendAuction.deployed();

    // Allow the first NFT contract by the owner
    await nftLendAuction.connect(owner).updateAllowedNFT(nftContract.address, true);
  });

  it("should allow a borrower to list a loan with an allowed NFT and specific loanType", async function () {
    await nftContract.connect(borrower).approve(nftLendAuction.address, 1);
    const loanType = 0; // LoanType.FIXED

    await expect(
      nftLendAuction
        .connect(borrower)
        .listLoan(nftContract.address, 1, ethers.utils.parseEther("10"), 1000, 604800, loanType)
    )
      .to.emit(nftLendAuction, "LoanListed")
      .withArgs(
        0,
        borrower.address,
        nftContract.address,
        1,
        ethers.utils.parseEther("10"),
        1000,
        604800,
        loanType
      );

    const loan = await nftLendAuction.loans(0);
    expect(loan.borrower).to.equal(borrower.address);
    expect(loan.loanAmount).to.equal(ethers.utils.parseEther("10"));
    expect(loan.loanType).to.equal(loanType);
  });

  it("should prevent listing a loan without a valid loanType", async function () {
    await nftContract.connect(borrower).approve(nftLendAuction.address, 1);
    const invalidLoanType = 2; // Invalid type, not FIXED or APR

    await expect(
      nftLendAuction
        .connect(borrower)
        .listLoan(nftContract.address, 1, ethers.utils.parseEther("10"), 1000, 604800, invalidLoanType)
    ).to.be.revertedWithoutReason;
  });

  it("should prevent withdrawals with zero balance", async function () {
    await expect(
      nftLendAuction.connect(lender1).withdrawFunds(lender1.address)
    ).to.be.revertedWith("No funds to withdraw");
  });

  it("should handle multiple withdrawals without overpayment", async function () {
    const loanAmount = ethers.utils.parseEther("10");
    await nftContract.connect(borrower).approve(nftLendAuction.address, 1);
    await nftLendAuction.connect(borrower).listLoan(nftContract.address, 1, loanAmount, 1000, 604800, 0);

    await nftLendAuction.connect(lender1).placeBid(0, 800, { value: loanAmount });

    const lenderBalanceBefore = await ethers.provider.getBalance(lender1.address);

    await nftLendAuction.connect(borrower).delistLoan(0);

    const pendingWithdrawal = await nftLendAuction.pendingWithdrawals(lender1.address);
    expect(pendingWithdrawal).to.equal(loanAmount);

    // Perform first withdrawal
    const tx1 = await nftLendAuction.connect(lender1).withdrawFunds(lender1.address);
    const receipt1 = await tx1.wait();
    const gasUsed1 = receipt1.gasUsed.mul(receipt1.effectiveGasPrice);
    const lenderBalanceAfterFirst = await ethers.provider.getBalance(lender1.address);
    expect(lenderBalanceAfterFirst.add(gasUsed1)).to.equal(lenderBalanceBefore.add(loanAmount));

    // Attempt second withdrawal
    await expect(
      nftLendAuction.connect(lender1).withdrawFunds(lender1.address)
    ).to.be.revertedWith("No funds to withdraw");
  });

  it("should prevent a borrower from listing a loan with a disallowed NFT", async function () {
    await anotherNFTContract.connect(borrower).approve(nftLendAuction.address, 1);
    const loanType = 0; // LoanType.FIXED
    await expect(
      nftLendAuction
        .connect(borrower)
        .listLoan(anotherNFTContract.address, 1, ethers.utils.parseEther("10"), 1000, 604800, loanType)
    ).to.be.revertedWith("NFT contract not allowed");
  });

  it("should allow the owner to update the allowed NFT list", async function () {
    // Disallow the previously allowed contract
    await nftLendAuction.connect(owner).updateAllowedNFT(nftContract.address, false);

    await nftContract.connect(borrower).approve(nftLendAuction.address, 1);

    await expect(
      nftLendAuction
        .connect(borrower)
        .listLoan(nftContract.address, 1, ethers.utils.parseEther("10"), 1000, 604800, 0)
    ).to.be.revertedWith("NFT contract not allowed");

    // Re-allow the contract
    await nftLendAuction.connect(owner).updateAllowedNFT(nftContract.address, true);

    await nftLendAuction
      .connect(borrower)
      .listLoan(nftContract.address, 1, ethers.utils.parseEther("10"), 1000, 604800, 0);

    const loan = await nftLendAuction.loans(0);
    expect(loan.borrower).to.equal(borrower.address);
  });

  it("should prevent non-owners from updating the allowed NFT list", async function () {
    await expect(
      nftLendAuction.connect(borrower).updateAllowedNFT(nftContract.address, false)
    ).to.be.revertedWithCustomError(nftLendAuction, "AccessControlUnauthorizedAccount");
  });

  it("should emit an event when updating the allowed NFT list", async function () {
    await expect(
      nftLendAuction.connect(owner).updateAllowedNFT(nftContract.address, false)
    )
      .to.emit(nftLendAuction, "AllowedNFTUpdated")
      .withArgs(nftContract.address, false);
  });

  it("should refund escrowed funds when delisting a loan", async function () {
    const loanAmount = ethers.utils.parseEther("10");
    await nftContract.connect(borrower).approve(nftLendAuction.address, 1);
    await nftLendAuction.connect(borrower).listLoan(nftContract.address, 1, loanAmount, 1000, 604800, 0);

    await nftLendAuction.connect(lender1).placeBid(0, 800, { value: loanAmount });

    const lenderBalanceBefore = await ethers.provider.getBalance(lender1.address);

    await nftLendAuction.connect(borrower).delistLoan(0);

    const pendingWithdrawal = await nftLendAuction.pendingWithdrawals(lender1.address);
    expect(pendingWithdrawal).to.equal(loanAmount);

    const tx = await nftLendAuction.connect(lender1).withdrawFunds(lender1.address);
    const receipt = await tx.wait();
    // Calculate gas cost
    const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice);

    const lenderBalanceAfter = await ethers.provider.getBalance(lender1.address);
    expect(lenderBalanceAfter.add(gasUsed)).to.equal(lenderBalanceBefore.add(loanAmount));
  });

  it("should transfer escrow amount to borrower upon loan acceptance", async function () {
    const loanAmount = ethers.utils.parseEther("10");

    await nftContract.connect(borrower).approve(nftLendAuction.address, 1);
    await nftLendAuction
      .connect(borrower)
      .listLoan(nftContract.address, 1, loanAmount, 1000, 604800, 0);

    await nftLendAuction.connect(lender1).placeBid(0, 800, { value: loanAmount });

    const borrowerBalanceBefore = await ethers.provider.getBalance(borrower.address);

    // Borrower accepts the loan
    const tx = await nftLendAuction.connect(borrower).acceptLoan(0);
    const receipt = await tx.wait();

    // Calculate gas cost
    const gasUsed = receipt.gasUsed;
    const gasPrice = tx.gasPrice;
    const gasCost = gasUsed.mul(gasPrice);

    const borrowerBalanceAfter = await ethers.provider.getBalance(borrower.address);

    // Borrower's balance difference should match the loan amount minus gas costs
    expect(borrowerBalanceAfter.sub(borrowerBalanceBefore).add(gasCost)).to.equal(loanAmount);
  });

  it("should refund the previous bidder when a new bid is placed", async function () {
    const loanAmount = ethers.utils.parseEther("10");

    await nftContract.connect(borrower).approve(nftLendAuction.address, 1);
    await nftLendAuction
      .connect(borrower)
      .listLoan(nftContract.address, 1, loanAmount, 1000, 604800, 0); // 1 week

    // First lender places a bid
    await nftLendAuction.connect(lender1).placeBid(0, 900, { value: loanAmount });

    const pendingBefore = await nftLendAuction.pendingWithdrawals(lender1.address);
    expect(pendingBefore).to.equal(0);

    await nftLendAuction.connect(lender2).placeBid(0, 800, { value: loanAmount });

    const pendingAfter = await nftLendAuction.pendingWithdrawals(lender1.address);
    expect(pendingAfter).to.equal(loanAmount);
  });

  it("should allow lenders to cancel bids and refund escrowed funds", async function () {
    const loanAmount = ethers.utils.parseEther("10");
    await nftContract.connect(borrower).approve(nftLendAuction.address, 1);
    await nftLendAuction.connect(borrower).listLoan(nftContract.address, 1, loanAmount, 1000, 604800, 0);

    await nftLendAuction.connect(lender1).placeBid(0, 800, { value: loanAmount });

    // Move time forward by 1 day
    await network.provider.send("evm_increaseTime", [24 * 3601]);
    await network.provider.send("evm_mine");

    const lenderBalanceBefore = await ethers.provider.getBalance(lender1.address);

    await nftLendAuction.connect(lender1).cancelBid(0);

    const lenderBalanceAfter = await ethers.provider.getBalance(lender1.address);
    expect(lenderBalanceAfter).to.be.above(lenderBalanceBefore);

    const loan = await nftLendAuction.loans(0);
    expect(loan.lender).to.equal(ethers.constants.AddressZero);
    expect(loan.currentInterestRate).to.equal(loan.maxInterestRate);
  });

  it("should prevent non-lenders from canceling bids", async function () {
    const loanAmount = ethers.utils.parseEther("10");
    await nftContract.connect(borrower).approve(nftLendAuction.address, 1);
    await nftLendAuction.connect(borrower).listLoan(nftContract.address, 1, loanAmount, 1000, 604800, 0);

    await nftLendAuction.connect(lender1).placeBid(0, 800, { value: loanAmount });

    await expect(
      nftLendAuction.connect(lender2).cancelBid(0)
    ).to.be.revertedWith("Not loan lender");
  });

  it("should prevent bid cancellation for accepted loans", async function () {
    const loanAmount = ethers.utils.parseEther("10");
    await nftContract.connect(borrower).approve(nftLendAuction.address, 1);
    await nftLendAuction.connect(borrower).listLoan(nftContract.address, 1, loanAmount, 1000, 604800, 0);

    await nftLendAuction.connect(lender1).placeBid(0, 800, { value: loanAmount });
    await nftLendAuction.connect(borrower).acceptLoan(0);

    await expect(
      nftLendAuction.connect(lender1).cancelBid(0)
    ).to.be.revertedWith("Loan already accepted");
  });

  it("should allow funds withdrawal by lender after repayment", async function () {
    const loanAmount = ethers.utils.parseEther("10");
    const interestRate = 800; // 8% interest rate
    const protocolFeeRate = 200; // 2% protocol fee

    await nftContract.connect(borrower).approve(nftLendAuction.address, 1);
    await nftLendAuction
      .connect(borrower)
      .listLoan(nftContract.address, 1, loanAmount, 1000, 604800, 0); // LoanType.FIXED

    await nftLendAuction.connect(lender1).placeBid(0, interestRate, { value: loanAmount });
    await nftLendAuction.connect(borrower).acceptLoan(0);

    // Calculate repayment details
    const { totalRepayment, borrowerProtocolFee, lenderProtocolFee, lenderPayout, requiredRepayment } =
    await calculateRepayment(loanAmount, interestRate, protocolFeeRate, nftLendAuction, 0);

    // Borrower repays the loan
    await nftLendAuction.connect(borrower).repayLoan(0, { value: totalRepayment.add(borrowerProtocolFee) });

    // Verify NFT ownership returned to borrower
    expect(await nftContract.ownerOf(1)).to.equal(borrower.address);

    const pendingWithdrawal = await nftLendAuction.pendingWithdrawals(lender1.address);
    expect(pendingWithdrawal).to.equal(lenderPayout);

    const lenderBalanceBefore = await ethers.provider.getBalance(lender1.address);
    const tx = await nftLendAuction.connect(lender1).withdrawFunds(lender1.address);
    const receipt = await tx.wait();
    const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice);

    const lenderBalanceAfter = await ethers.provider.getBalance(lender1.address);
    expect(lenderBalanceAfter.add(gasUsed)).to.equal(lenderBalanceBefore.add(lenderPayout));

    const finalPending = await nftLendAuction.pendingWithdrawals(lender1.address);
    expect(finalPending).to.equal(0);
  });


  it("should require lender to pay protocol fee upon claiming a defaulted loan", async function () {
    const loanAmount = ethers.utils.parseEther("10");
    const interestRate = 800; // 8% interest
    const protocolFeeRate = 200; // 2% protocol fee

    await nftContract.connect(borrower).approve(nftLendAuction.address, 1);
    await nftLendAuction
      .connect(borrower)
      .listLoan(nftContract.address, 1, loanAmount, 1000, 2, 0); // 2 seconds duration, LoanType.FIXED

    await nftLendAuction.connect(lender1).placeBid(0, interestRate, { value: loanAmount });
    await nftLendAuction.connect(borrower).acceptLoan(0);

    // Calculate total repayment and lender's protocol fee
    const { totalRepayment, borrowerProtocolFee, lenderProtocolFee, lenderPayout, requiredRepayment } =
      await calculateRepayment(loanAmount, interestRate, protocolFeeRate, nftLendAuction, 0);


    // Advance time beyond the loan duration
    await ethers.provider.send("evm_increaseTime", [3]);
    await ethers.provider.send("evm_mine", []);

    // Lender claims the defaulted loan
    await expect(
      nftLendAuction.connect(lender1).claimDefaultedLoan(0, {
        value: lenderProtocolFee,
      })
    )
      .to.emit(nftLendAuction, "LoanDefaulted")
      .withArgs(0, lender1.address);

    // Verify protocol fee balance updated
    const protocolFeeBalance = await nftLendAuction.protocolFeeBalance();
    expect(protocolFeeBalance).to.equal(lenderProtocolFee);

    // Verify NFT transferred to lender
    expect(await nftContract.ownerOf(1)).to.equal(lender1.address);
  });

  it("should correctly track active loans", async function () {
    const loanAmount = ethers.utils.parseEther("10");
    const interestRate = 800; // 8% interest rate
    const protocolFeeRate = 200; // 2% protocol fee

    // Approve and list two loans
    await nftContract.connect(borrower).approve(nftLendAuction.address, 1);
    await nftContract.connect(borrower).mint(); // Mint a second NFT for testing
    await nftContract.connect(borrower).approve(nftLendAuction.address, 2);

    await nftLendAuction
      .connect(borrower)
      .listLoan(nftContract.address, 1, loanAmount, 1000, 604800, 0); // Loan 1
    await nftLendAuction
      .connect(borrower)
      .listLoan(nftContract.address, 2, ethers.utils.parseEther("20"), 1000, 604800, 0); // Loan 2

    // Verify both loans are active
    let activeLoans = await nftLendAuction.getActiveLoans();
    expect(activeLoans.length).to.equal(2);

    // Place a bid and accept the first loan
    await nftLendAuction.connect(lender1).placeBid(0, interestRate, { value: loanAmount });
    await nftLendAuction.connect(borrower).acceptLoan(0);

    // Repay the first loan
    // Calculate total repayment and lender's protocol fee
    const { totalRepayment, borrowerProtocolFee, lenderProtocolFee, lenderPayout, requiredRepayment } =
      await calculateRepayment(loanAmount, interestRate, protocolFeeRate, nftLendAuction, 0);

    await nftLendAuction.connect(borrower).repayLoan(0, { value: requiredRepayment });

    // Verify only one loan is active
    activeLoans = await nftLendAuction.getActiveLoans();
    expect(activeLoans.length).to.equal(1);

    // Verify the remaining loan is still active
    expect(activeLoans[0].toNumber()).to.equal(1);
  });

  it("should act as a circuit breaker when max loans is set to zero", async function () {
    const loanAmount = ethers.utils.parseEther("10");

    await nftContract.connect(borrower).approve(nftLendAuction.address, 1);

    // Set max active loans to zero
    await nftLendAuction.connect(owner).setMaxActiveLoans(0);

    await expect(
      nftLendAuction.connect(borrower).listLoan(nftContract.address, 1, loanAmount, 1000, 604800, 0)
    ).to.be.revertedWith("Active loan limit reached");
  });

  it("should enforce max active loans limit", async function () {
    const loanAmount = ethers.utils.parseEther("10");

    await nftContract.connect(borrower).approve(nftLendAuction.address, 1);

    // Set max active loans to 5
    await nftLendAuction.connect(owner).setMaxActiveLoans(5);

    for (let i = 0; i < 5; i++) {
      await nftContract.connect(borrower).mint(); // Mint new NFT for each loan
      await nftContract.connect(borrower).approve(nftLendAuction.address, i + 1);
      await nftLendAuction.connect(borrower).listLoan(nftContract.address, i + 1, loanAmount, 1000, 604800, 0);
    }

    // Attempt to exceed max loans
    await nftContract.connect(borrower).mint();
    await nftContract.connect(borrower).approve(nftLendAuction.address, 6);
    await expect(
      nftLendAuction.connect(borrower).listLoan(nftContract.address, 6, loanAmount, 1000, 604800, 0)
    ).to.be.revertedWith("Active loan limit reached");
  });

  it("should allow the owner to update the protocol fee rate", async function () {
    const newFeeRate = 300; // 3%
    await nftLendAuction.connect(owner).setProtocolFeeRate(newFeeRate);

    const updatedFeeRate = await nftLendAuction.protocolFeeRate();
    expect(updatedFeeRate).to.equal(newFeeRate);
  });

  it("should prevent non-owners from updating the protocol fee rate", async function () {
    await expect(
      nftLendAuction.connect(borrower).setProtocolFeeRate(300)
    ).to.be.revertedWithCustomError(nftLendAuction, "AccessControlUnauthorizedAccount");
  });

  it("should prevent non-owners from withdrawing protocol fees", async function () {
    await expect(
      nftLendAuction.connect(borrower).withdrawProtocolFees(borrower.address)
    ).to.be.revertedWithCustomError(nftLendAuction, "AccessControlUnauthorizedAccount");
  });

  it("should fail to withdraw protocol fees and excess ETH if no funds are available", async function () {
    await expect(
      nftLendAuction.connect(owner).withdrawProtocolFees(owner.address)
    ).to.be.revertedWith("No funds available for withdrawal");
  });

  it("should process pending withdrawals correctly", async function () {
    const loanAmount = ethers.utils.parseEther("10");
  
    // Simulate protocol fees
    await nftContract.connect(borrower).approve(nftLendAuction.address, 1);
    await nftLendAuction.connect(borrower).listLoan(nftContract.address, 1, loanAmount, 1000, 604800, 0);
    await nftLendAuction.connect(lender1).placeBid(0, 800, { value: loanAmount });
    await nftLendAuction.connect(borrower).acceptLoan(0);
  
    const totalRepayment = await nftLendAuction.getTotalRepayment(0);
    const protocolFee = totalRepayment.mul(200).div(10000);
    await nftLendAuction.connect(borrower).repayLoan(0, { value: totalRepayment.add(protocolFee) });
  
    // Assert pending withdrawals before processing
    const pendingBorrower = await nftLendAuction.pendingWithdrawals(borrower.address);
    const pendingLender = await nftLendAuction.pendingWithdrawals(lender1.address);
    const expectedPendingWithdrawals = pendingBorrower.add(pendingLender);
  
    expect(await nftLendAuction.totalPendingWithdrawals()).to.equal(expectedPendingWithdrawals);
  
    // Process pending withdrawals
    if (pendingBorrower.gt(0)) {
      await nftLendAuction.connect(borrower).withdrawFunds(borrower.address);
    }
  
    if (pendingLender.gt(0)) {
      await nftLendAuction.connect(lender1).withdrawFunds(lender1.address);
    }
  
    // Verify pending withdrawals cleared
    expect(await nftLendAuction.totalPendingWithdrawals()).to.equal(0);
  });
  
  it("should withdraw protocol fees and excess ETH correctly", async function () {
    const loanAmount = ethers.utils.parseEther("10");

    // Simulate protocol fees
    await nftContract.connect(borrower).approve(nftLendAuction.address, 1);
    await nftLendAuction.connect(borrower).listLoan(nftContract.address, 1, loanAmount, 1000, 604800, 0);
    await nftLendAuction.connect(lender1).placeBid(0, 800, { value: loanAmount });
    await nftLendAuction.connect(borrower).acceptLoan(0);

    const totalRepayment = await nftLendAuction.getTotalRepayment(0);
    const protocolFee = totalRepayment.mul(200).div(10000);
    await nftLendAuction.connect(borrower).repayLoan(0, { value: totalRepayment.add(protocolFee) });

    // Verify balance before withdrawal
    const contractBalanceBefore = await ethers.provider.getBalance(nftLendAuction.address);
    const ownerBalanceBefore = await ethers.provider.getBalance(owner.address);

    // Assert total balance matches protocol fees + pending withdrawals
    const totalPendingWithdrawals = await nftLendAuction.totalPendingWithdrawals();
    const protocolFeeBalance = await nftLendAuction.protocolFeeBalance();
    const expectedTotalBalance = totalPendingWithdrawals.add(protocolFeeBalance);

    expect(contractBalanceBefore).to.equal(expectedTotalBalance);

    // Withdraw protocol fees and excess ETH
    const tx = await nftLendAuction.connect(owner).withdrawProtocolFees(owner.address);
    const receipt = await tx.wait();
    const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice);

    const contractBalanceAfter = await ethers.provider.getBalance(nftLendAuction.address);
    const ownerBalanceAfter = await ethers.provider.getBalance(owner.address);

    // Assertions
    expect(contractBalanceAfter).to.equal(totalPendingWithdrawals); // Pending withdrawals should remain
    expect(ownerBalanceAfter.add(gasUsed)).to.equal(ownerBalanceBefore.add(protocolFeeBalance));
  });
  
  it("should not affect escrowed funds when withdrawing protocol fees", async function () {
    const loanAmount = ethers.utils.parseEther("10");
  
    // Repay a previous loan to generate protocol fees
    await nftContract.connect(borrower).approve(nftLendAuction.address, 1);
    await nftLendAuction.connect(borrower).listLoan(nftContract.address, 1, loanAmount, 1000, 604800, 0);
    await nftLendAuction.connect(lender1).placeBid(0, 800, { value: loanAmount });
    await nftLendAuction.connect(borrower).acceptLoan(0);
  
    const totalRepayment = await nftLendAuction.getTotalRepayment(0);
    const protocolFee = totalRepayment.mul(200).div(10000);
    await nftLendAuction.connect(borrower).repayLoan(0, { value: totalRepayment.add(protocolFee) });
  
    // Mint a second NFT for the borrower
    await nftContract.connect(borrower).mint(); // Token ID 2

    // List a second loan and place a bid
    await nftContract.connect(borrower).approve(nftLendAuction.address, 2);
    await nftLendAuction.connect(borrower).listLoan(nftContract.address, 2, loanAmount, 1000, 604800, 0);
    await nftLendAuction.connect(lender2).placeBid(1, 800, { value: loanAmount });
  
    // Verify escrowed funds before withdrawal
    const escrowedFundsBefore = await nftLendAuction.escrowedFunds(1);
    expect(escrowedFundsBefore).to.equal(loanAmount);
  
    // Withdraw protocol fees
    await nftLendAuction.connect(owner).withdrawProtocolFees(owner.address);
  
    // Verify escrowed funds remain unchanged
    const escrowedFundsAfter = await nftLendAuction.escrowedFunds(1);
    expect(escrowedFundsAfter).to.equal(escrowedFundsBefore);
  }); 
  

  it("should repay the lender and reclaim NFT upon APR loan repayment", async function () {
    const loanAmount = ethers.utils.parseEther("10");
    const interestRate = 1200; // 12% annual interest
    const protocolFeeRate = 200; // 2% protocol fee

    await nftContract.connect(borrower).approve(nftLendAuction.address, 1);

    // Borrower lists the loan
    await nftLendAuction
      .connect(borrower)
      .listLoan(nftContract.address, 1, loanAmount, 1500, 604800, 1); // LoanType.APR

    // Lender places a bid
    await nftLendAuction.connect(lender1).placeBid(0, interestRate, { value: loanAmount });

    // Borrower accepts the loan
    await nftLendAuction.connect(borrower).acceptLoan(0);

    // Advance time within the loan duration
    await ethers.provider.send("evm_increaseTime", [5 * 24 * 60 * 60]); // 5 days (within duration)
    await ethers.provider.send("evm_mine", []);

    // Fetch total repayment and protocol fee details from the contract
    const { totalRepayment, borrowerProtocolFee, lenderProtocolFee, lenderPayout, requiredRepayment } =
      await calculateRepayment(loanAmount, interestRate, protocolFeeRate, nftLendAuction, 0);

    // Borrower repays the loan
    await nftLendAuction.connect(borrower).repayLoan(0, { value: requiredRepayment });
    
    const pendingWithdrawal = await nftLendAuction.pendingWithdrawals(lender1.address);
    expect(pendingWithdrawal).to.equal(lenderPayout);

    const lenderBalanceBefore = await ethers.provider.getBalance(lender1.address);
    const tx = await nftLendAuction.connect(lender1).withdrawFunds(lender1.address);
    const receipt = await tx.wait();
    const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice);

    const lenderBalanceAfter = await ethers.provider.getBalance(lender1.address);
    expect(lenderBalanceAfter.add(gasUsed)).to.equal(lenderBalanceBefore.add(lenderPayout));

    // Verify NFT ownership returned to borrower
    expect(await nftContract.ownerOf(1)).to.equal(borrower.address);
  });

  it("should calculate a minimum interest of one day for early APR loan repayment", async function () {
    const loanAmount = ethers.utils.parseEther("10");
    const interestRate = 1200; // 12% annual interest
    const protocolFeeRate = 200; // 2% protocol fee

    await nftContract.connect(borrower).approve(nftLendAuction.address, 1);

    // Borrower lists the loan
    await nftLendAuction
      .connect(borrower)
      .listLoan(nftContract.address, 1, loanAmount, 1500, 604800, 1); // LoanType.APR

    // Lender places a bid
    await nftLendAuction.connect(lender1).placeBid(0, interestRate, { value: loanAmount });

    // Borrower accepts the loan
    await nftLendAuction.connect(borrower).acceptLoan(0);

    // Fetch total repayment and protocol fee details from the contract
    const { totalRepayment, borrowerProtocolFee, lenderProtocolFee, lenderPayout, requiredRepayment } =
      await calculateRepayment(loanAmount, interestRate, protocolFeeRate, nftLendAuction, 0);


    // Borrower repays the loan immediately
    await nftLendAuction.connect(borrower).repayLoan(0, { value: requiredRepayment });
    
    const pendingWithdrawal = await nftLendAuction.pendingWithdrawals(lender1.address);
    expect(pendingWithdrawal).to.equal(lenderPayout);

    const lenderBalanceBefore = await ethers.provider.getBalance(lender1.address);
    const tx = await nftLendAuction.connect(lender1).withdrawFunds(lender1.address);
    const receipt = await tx.wait();
    const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice);

    const lenderBalanceAfter = await ethers.provider.getBalance(lender1.address);
    expect(lenderBalanceAfter.add(gasUsed)).to.equal(lenderBalanceBefore.add(lenderPayout));

    // Verify NFT ownership returned to borrower
    expect(await nftContract.ownerOf(1)).to.equal(borrower.address);
  });

  it("should allow lender to claim NFT on APR loan default", async function () {
    const loanAmount = ethers.utils.parseEther("10");
    const interestRate = 1200; // 12% annual interest
    const protocolFeeRate = 200; // 2% protocol fee

    await nftContract.connect(borrower).approve(nftLendAuction.address, 1);

    // Borrower lists the loan
    await nftLendAuction
      .connect(borrower)
      .listLoan(nftContract.address, 1, loanAmount, 1500, 604800, 1); // LoanType.APR

    // Lender places a bid
    await nftLendAuction.connect(lender1).placeBid(0, interestRate, { value: loanAmount });

    // Borrower accepts the loan
    await nftLendAuction.connect(borrower).acceptLoan(0);

    // Simulate loan default (advance time beyond loan duration)
    await ethers.provider.send("evm_increaseTime", [604800 + 1]); // 7 days + 1 second
    await ethers.provider.send("evm_mine", []);

    const { totalRepayment, borrowerProtocolFee, lenderProtocolFee, lenderPayout, requiredRepayment } =
      await calculateRepayment(loanAmount, interestRate, protocolFeeRate, nftLendAuction, 0);


    // Lender claims NFT
    const tx = await nftLendAuction.connect(lender1).claimDefaultedLoan(0, { value: lenderProtocolFee });
    const receipt = await tx.wait();
    const gasUsed = receipt.gasUsed;
    const gasPrice = tx.gasPrice || (await ethers.provider.getGasPrice());
    const gasCost = gasUsed.mul(gasPrice);

    // Verify NFT ownership transferred to lender
    expect(await nftContract.ownerOf(1)).to.equal(lender1.address);
  });

  it("should track and clear collateralization status correctly", async function () {
    const loanAmount = ethers.utils.parseEther("10");

    // Approve NFT and list as collateral
    await nftContract.connect(borrower).approve(nftLendAuction.address, 1);
    await nftLendAuction.connect(borrower).listLoan(nftContract.address, 1, loanAmount, 1000, 604800, 0);

    // Check collateralization status
    expect(await nftLendAuction.isCollateralized(nftContract.address, 1)).to.be.true;

    // Attempt to list the same NFT again
    await expect(
        nftLendAuction.connect(borrower).listLoan(nftContract.address, 1, loanAmount, 1000, 604800, 0)
    ).to.be.revertedWith("Not NFT owner");

    // Delist the loan
    await nftLendAuction.connect(borrower).delistLoan(0);

    // Verify collateralization status is cleared
    expect(await nftLendAuction.isCollateralized(nftContract.address, 1)).to.be.false;

     // List and accept a new loan
     await nftContract.connect(borrower).approve(nftLendAuction.address, 1);
     await nftLendAuction.connect(borrower).listLoan(nftContract.address, 1, loanAmount, 1000, 604800, 0);
     await nftLendAuction.connect(lender1).placeBid(1, 800, { value: loanAmount });
     await nftLendAuction.connect(borrower).acceptLoan(1);
 
     // Repay the loan
     const totalRepayment = await nftLendAuction.getTotalRepayment(1);
     const protocolFee = totalRepayment.mul(200).div(10000);
     await nftLendAuction.connect(borrower).repayLoan(1, { value: totalRepayment.add(protocolFee) });
 
     // Verify collateralization status is cleared after repayment
     expect(await nftLendAuction.isCollateralized(nftContract.address, 1)).to.be.false;
});


});
