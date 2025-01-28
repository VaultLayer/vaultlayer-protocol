# NFT Lending Subgraph

## Overview
This subgraph indexes events from the **NFTLendAuction** smart contract, enabling efficient querying of loan data, bids, and user activities. It powers decentralized applications that require insights into NFT-backed loan markets.

Queries (HTTP):   https://thegraph.coredao.org/subgraphs/name/vaultlayer-nft-lend-auction-v1


## Features
- Tracks loans listed, accepted, repaid, defaulted, and delisted.
- Indexes bids placed and canceled for loans.
- Captures borrower and lender relationships.
- Supports different loan types (Fixed and APR).


## Schema
### Entities:
1. **Loan**
   - `id: ID!` - Unique identifier for each loan.
   - `borrower: String!` - Address of the borrower.
   - `lender: String` - Address of the lender.
   - `nftAddress: String!` - NFT contract address.
   - `tokenId: BigInt!` - NFT token ID.
   - `loanAmount: BigDecimal!` - Loan amount.
   - `maxInterestRate: BigDecimal!` - Maximum allowed interest rate.
   - `currentInterestRate: BigDecimal` - Current best bid interest rate.
   - `duration: BigInt!` - Loan duration in seconds.
   - `startTime: BigInt` - Loan start timestamp.
   - `loanType: String!` - Loan type ("FIXED" or "APR").
   - `isAccepted: Boolean!` - Status indicating whether the loan has been accepted.
   - `status: String!` - Loan status ("New", "Accepted", "Repaid", "Defaulted", "Delisted").

2. **User**
   - `id: ID!` - Address of the user.

## Event Handlers
- **LoanListed**: Tracks new loans listed on the platform.
- **LoanAccepted**: Updates loans as accepted with lender details.
- **LoanRepaid**: Marks loans as repaid.
- **LoanDefaulted**: Tracks loans that have defaulted.
- **LoanBidPlaced**: Updates loan bids with new interest rates and lender details.
- **LoanBidCancelled**: Cancels loan bids and resets interest rates.
- **LoanDelisted**: Marks loans as delisted.

## Query Example
Fetch all active loans (New or Accepted):
```graphql
{
  loans(where: { status_in: ["New", "Accepted"] }) {
    id
    borrower
    lender
    nftAddress
    tokenId
    loanAmount
    maxInterestRate
    currentInterestRate
    duration
    startTime
    loanType
    isAccepted
    status
  }
}
```

## Setup and Deployment
1. **Install dependencies:**
```bash
yarn install
```
2. **Generate types:**
```bash
graph codegen
```
3. **Build subgraph:**
```bash
graph build
```
4. **Deploy subgraph:**
```bash
graph deploy --node https://thegraph.coredao.org/deploy/ --access-token $CORE_GRAPH_KEY vaultlayer-nft-lend-auction
```

## Usage in App
```javascript
const subgraphUrl = "https://thegraph.coredao.org/subgraphs/name/vaultlayer-nft-lend-auction";
fetchActiveLoans(userAddress, subgraphUrl)
  .then((data) => {
    console.log("Borrowed Loans:", data.borrowedLoans);
    console.log("Lended Loans:", data.lendedLoans);
    console.log("Active Loans:", data.activeLoans);
  })
  .catch((error) => console.error("Error:", error));
```

## Notes
- Ensure the subgraph has synced past the deployment block.
- If no loans are returned, check the event emissions and logs.
- Test queries in the GraphQL playground provided by the subgraph endpoint.

## License
This subgraph is released under the MIT License.

