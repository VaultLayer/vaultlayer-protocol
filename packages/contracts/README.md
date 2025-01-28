# NFTLendAuction Smart Contract v1

This repository contains the NFTLendAuction smart contract, a decentralized lending platform where borrowers can list NFTs as collateral for loans, and lenders can bid by offering loans at competitive interest rates.

## Features
- Borrowers can list NFTs as collateral for loans.
- Lenders can bid by offering loans at lower interest rates.
- Borrowers can accept loans, locking in the terms.
- Lenders can cancel bids if the loan is not accepted.
- Borrowers can delist unaccepted loans, refunding escrowed funds to the lender.
- Lenders can claim NFT collateral if the borrower defaults.

## Contract Summary
- **Loan Struct**:
  - Stores loan details, including borrower, lender, NFT address, token ID, loan amount, interest rate, and duration.
- **Key Functions**:
  - `listLoan`: Allows a borrower to list an NFT for a loan.
  - `placeBid`: Allows a lender to offer a loan at a lower interest rate.
  - `acceptLoan`: Allows a borrower to accept a loan offer.
  - `repayLoan`: Allows a borrower to repay the loan and reclaim their NFT.
  - `cancelBid`: Allows lenders to cancel their bids for unaccepted loans.
  - `delistLoan`: Allows borrowers to delist their loans and refund escrowed funds to lenders.

## Security Audits

- [NFTLendAuctionV1_AuditReport_InterFi.pdf](https://github.com/VaultLayer/nft-lend-auction/blob/main/contracts/audits/NFTLendAuctionV1_AuditReport_InterFi.pdf) 

> ⚠️ **Warning:** This contract is provided as is, use at your own risk.


## Protocol Fees and Interest Calculations

### Loan Types
The contract supports two loan types:
1. **Fixed Interest Loans (LoanType.FIXED):**
   - Interest is calculated based on the full loan amount and the interest rate specified.
   - Formula: `Interest = Loan Amount × Interest Rate ÷ 10000`.

2. **APR-Based Loans (LoanType.APR):**
   - Interest is calculated based on the duration of the loan.
   - If the loan is accepted, interest is prorated based on the elapsed time since acceptance.
   - If the loan is not yet accepted, interest is calculated based on the full loan duration.
   - Formula:
     - Accepted Loan: `Interest = (Loan Amount × Interest Rate ÷ 10000) × (Elapsed Days ÷ 365)`.
     - Pending Loan: `Interest = (Loan Amount × Interest Rate ÷ 10000) × (Duration Days ÷ 365)`.

### Borrower Repayment
When a borrower repays a loan, the repayment amount includes:
- **Principal:** The original loan amount.
- **Interest:** Based on the loan type (Fixed or APR).
- **Borrower Protocol Fee:** A percentage of the total repayment (`Total Repayment × Protocol Fee Rate ÷ 10000`).

### Lender Protocol Fee
When the lender claims collateral from a defaulted loan, they are required to pay:
- **Lender Protocol Fee:** A percentage of the hypothetical repayment (`Total Repayment × Protocol Fee Rate ÷ 10000`).

### Calculations
- **Total Repayment:** `Principal + Interest`
- **Borrower Payment on Repayment:** `Total Repayment + Borrower Protocol Fee`
- **Lender Payout on Repayment:** `Total Repayment - Lender Protocol Fee`
- **Lender Payment on Default Claim:** `Lender Protocol Fee`

These fees ensure fairness and sustainable revenue for the protocol, while incentivizing participation from both borrowers and lenders.


## Getting Started
### Prerequisites
- [Node.js](https://nodejs.org/) and npm
- [Hardhat](https://hardhat.org/)
- Core Chain node endpoint (RPC URL)

### Setup
1. Install:
```bash
npm install
npm run test
```

## License

This project is licensed under the MIT License.
Copyright (c) 2024 VaultLayer
