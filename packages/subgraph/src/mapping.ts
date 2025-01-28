import { ethereum, BigInt, Bytes, BigDecimal, log } from "@graphprotocol/graph-ts";
import { LoanListed, LoanAccepted, LoanRepaid, LoanDefaulted, LoanBidPlaced, LoanBidCancelled, LoanDelisted, PendingWithdrawalAdded, FundsWithdrawn } from "../generated/NFTLendAuctionV1/NFTLendAuctionV1";
import { Loan, User } from "../generated/schema";


export function handleLoanListed(event: LoanListed): void {
  let loan = new Loan(event.params.loanId.toString());
  loan.borrower = event.params.borrower.toHexString();
  loan.lender = "0x0000000000000000000000000000000000000000";
  loan.nftAddress = event.params.nftAddress;
  loan.tokenId = event.params.tokenId;
  loan.loanAmount = event.params.loanAmount.toBigDecimal();
  loan.maxInterestRate = event.params.maxInterestRate.toBigDecimal();
  loan.currentInterestRate = event.params.maxInterestRate.toBigDecimal();
  loan.duration = event.params.duration;
  loan.startTime = new BigInt(0); // Default to 0
  loan.isAccepted = false;
  loan.loanType = event.params.loanType == 0 ? "FIXED" : "APR";
  loan.status = "New";
  loan.save();

  let user = User.load(event.params.borrower.toHexString());
  if (!user) {
    user = new User(event.params.borrower.toHexString());
    user.totalWithdrawn = BigDecimal.fromString("0");
    user.pendingWithdraw = BigDecimal.fromString("0");
    user.save();
  }
}

export function handleLoanAccepted(event: LoanAccepted): void {
  let loan = Loan.load(event.params.loanId.toString());
  if (loan) {
    loan.lender = event.params.lender.toHexString();
    loan.startTime = event.params.startTime;
    loan.isAccepted = true;
    loan.status = "Accepted";
    loan.save();

    let user = User.load(event.params.lender.toHexString());
    if (!user) {
      user = new User(event.params.lender.toHexString());
      user.totalWithdrawn = BigDecimal.fromString("0");
      user.pendingWithdraw = BigDecimal.fromString("0");
      user.save();
    }
  }
}

export function handleLoanRepaid(event: LoanRepaid): void {
  let loan = Loan.load(event.params.loanId.toString());
  if (loan) {
    loan.status = "Repaid";
    loan.save();
  }
}

export function handleLoanDefaulted(event: LoanDefaulted): void {
  let loan = Loan.load(event.params.loanId.toString());
  if (loan) {
    loan.status = "Defaulted";
    loan.save();
  }
}

export function handleLoanBidPlaced(event: LoanBidPlaced): void {
  let loan = Loan.load(event.params.loanId.toString());
  if (loan) {
    loan.currentInterestRate = event.params.currentInterestRate.toBigDecimal();
    loan.lender = event.params.lender.toHexString();
    loan.save();

    let user = User.load(event.params.lender.toHexString());
    if (!user) {
      user = new User(event.params.lender.toHexString());
      user.totalWithdrawn = BigDecimal.fromString("0");
      user.pendingWithdraw = BigDecimal.fromString("0");
      user.save();
    }
  }
}

export function handleLoanBidCancelled(event: LoanBidCancelled): void {
  let loan = Loan.load(event.params.loanId.toString());
  if (loan) {
    loan.currentInterestRate = loan.maxInterestRate;
    loan.lender = null;
    loan.save();
  }
}

export function handleLoanDelisted(event: LoanDelisted): void {
  let loan = Loan.load(event.params.loanId.toString());
  if (loan) {
    loan.status = "Delisted";
    loan.save();
  }
}

export function handlePendingWithdrawalAdded(event: PendingWithdrawalAdded): void {
  let user = User.load(event.params.recipient.toHexString());
  if (!user) {
    user = new User(event.params.recipient.toHexString());
    user.totalWithdrawn = BigDecimal.fromString("0");
    user.pendingWithdraw = BigDecimal.fromString("0");
  }
  user.pendingWithdraw = user.pendingWithdraw.plus(event.params.amount.toBigDecimal());
  user.save();
}


export function handleFundsWithdrawn(event: FundsWithdrawn): void {
  let user = User.load(event.params.user.toHexString());
  if (user) {
    user.totalWithdrawn = user.totalWithdrawn.plus(event.params.amount.toBigDecimal());
    user.pendingWithdraw = user.pendingWithdraw.minus(event.params.amount.toBigDecimal());
    user.save();
  }
}
