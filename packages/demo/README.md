# NFTLendAuction Frontend

This is the React-based frontend for the NFTLendAuction platform. Users can interact with the smart contract to list loans, place bids, accept loans, repay loans, cancel bids, and delist loans.

## Features
- Connect wallet using MetaMask.
- View all active loans and filter loans by borrower or lender.
- List new loans by specifying NFT details, loan amount, interest rate, and duration.
- Place bids with dynamically calculated interest rates.
- Accept loans as borrowers and repay loans to reclaim NFTs.
- Cancel bids or delist loans.

## Technology Stack
- **React**: Frontend framework.
- **TypeScript**: For type safety.
- **Material-UI (MUI)**: UI components.
- **ethers.js**: For blockchain interactions.

## Getting Started
### Prerequisites
- [Node.js](https://nodejs.org/) and npm
- Deployed NFTLendAuction smart contract on Core Chain


### Setup
1. Install:
```bash
npm install
npm run dev
```

## License

This project is licensed under the MIT License.
Copyright (c) 2024 VaultLayer
