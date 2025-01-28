// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
* @title NFTLendAuction
* @notice A decentralized lending platform where borrowers can list NFTs as collateral for loans.
*         Lenders compete to provide loans by bidding with lower interest rates.
*         Loans can be repaid or claimed by lenders in case of default.
*/
contract NFTLendAuctionV2 is ReentrancyGuard, AccessControl {
    bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

    // Enum to define loan types
    enum LoanType { FIXED, APR }

    struct Loan {
        address borrower; // Borrower's address
        address lender; // Current lender (bidder offering the lowest rate)
        address nftAddress; // Address of the NFT contract
        uint256 tokenId; // Token ID of the NFT used as collateral
        uint256 loanAmount; // Amount of the loan in wei
        uint256 maxInterestRate; // Maximum acceptable interest rate (basis points)
        uint256 currentInterestRate; // Current best bid interest rate (basis points)
        uint256 duration; // Duration of the loan in seconds
        uint256 startTime; // Loan start time (0 if not accepted)
        LoanType loanType; // Fixed or APR
        bool isAccepted; // Whether the loan is accepted
    }

    IERC20 public loanCoin; // ERC-20 token for liquidity
    uint256 public loanCounter; // Counter to track the total number of loans created
    mapping(uint256 => Loan) public loans; // Mapping of loan IDs to loan details
    mapping(uint256 => uint256) public escrowedFunds; // Mapping of loan IDs to escrowed lender funds
    mapping(address => bool) public allowedNFTs; // Tracks which NFT contracts are allowed

    uint256 public maxActiveLoans = 1000; // Default maximum size for active loans
    uint256[] public activeLoanIds; // List of IDs for currently active loans
    mapping(uint256 => bool) public activeLoans; // Tracks whether a loan ID is active

    uint256 public protocolFeeRate = 200; // Protocol fee rate in basis points (5%)
    uint256 public protocolFeeBalance; // Accumulated protocol fees


    // Events
    event LoanListed(
        uint256 indexed loanId,
        address indexed borrower,
        address nftAddress,
        uint256 tokenId,
        uint256 loanAmount,
        uint256 maxInterestRate,
        uint256 duration,
        LoanType loanType // Fixed or APR
    );

    event LoanDelisted(uint256 indexed loanId, address indexed borrower);

    event LoanBidPlaced(
        uint256 indexed loanId,
        address indexed lender,
        uint256 currentInterestRate
    );

    event LoanBidCancelled(uint256 indexed loanId, address indexed lender);

    event LoanAccepted(
        uint256 indexed loanId,
        address indexed borrower,
        address indexed lender,
        uint256 startTime
    );

    event LoanRepaid(
        uint256 indexed loanId,
        address indexed borrower,
        uint256 repaymentAmount
    );

    event LoanDefaulted(
        uint256 indexed loanId,
        address indexed lender
    );

    event AllowedNFTUpdated(address indexed nftAddress, bool allowed);

    event ProtocolFeeRateUpdated(uint256 newFeeRate);

    event ProtocolFeesWithdrawn(address to, uint256 amount);


    // Modifiers
    modifier onlyBorrower(uint256 loanId) {
        require(msg.sender == loans[loanId].borrower, "Not loan borrower");
        _;
    }

    modifier onlyLender(uint256 loanId) {
        require(msg.sender == loans[loanId].lender, "Not loan lender");
        _;
    }

    modifier onlyNftOwner(address nftAddress, uint256 tokenId) {
        require(IERC721(nftAddress).ownerOf(tokenId) == msg.sender, "Not NFT owner");
        _;
    }

    modifier loanExists(uint256 loanId) {
        require(loans[loanId].borrower != address(0), "Loan does not exist");
        _;
    }

    modifier isNotAccepted(uint256 loanId) {
        require(!loans[loanId].isAccepted, "Loan already accepted");
        _;
    }

    modifier isAllowedNFT(address nftAddress) {
        require(allowedNFTs[nftAddress], "NFT contract not allowed");
        _;
    }

    /**
    * @notice Initializes the contract and sets the owner.
    */
    constructor(address _loanCoin) {
        loanCoin = IERC20(_loanCoin);
        // Grant the initial owner the DEFAULT_ADMIN_ROLE and OWNER_ROLE
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OWNER_ROLE, msg.sender);
        _grantRole(MANAGER_ROLE, msg.sender);
    }

    // Admin can grant roles to other addresses
    function grantManagerRole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        grantRole(MANAGER_ROLE, account);
    }

    // Function for the admin to adjust the maximum size of activeLoanIds
    function setMaxActiveLoans(uint256 newMax) external onlyRole(OWNER_ROLE) {
        maxActiveLoans = newMax;
    }

    /**
    * @notice Updates the list of allowed NFT contracts.
    * @param nftAddress Address of the NFT contract.
    * @param allowed Whether the NFT contract is allowed.
    */
    function updateAllowedNFT(address nftAddress, bool allowed) external onlyRole(MANAGER_ROLE) {
        allowedNFTs[nftAddress] = allowed;
        emit AllowedNFTUpdated(nftAddress, allowed);
    }

    // Admin can revoke roles from other addresses
    function revokeManagerRole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        revokeRole(MANAGER_ROLE, account);
    }

    /**
    * @notice Sets the protocol fee rate.
    * @param newFeeRate New protocol fee rate in basis points.
    */
    function setProtocolFeeRate(uint256 newFeeRate) external onlyRole(OWNER_ROLE) {
        require(newFeeRate <= 1000, "Fee rate too high"); // Max 10%
        protocolFeeRate = newFeeRate;
        emit ProtocolFeeRateUpdated(newFeeRate);
    }

    /**
    * @notice Lists a new loan by depositing an NFT as collateral.
    * @param nftAddress Address of the NFT contract.
    * @param tokenId Token ID of the NFT.
    * @param loanAmount Desired loan amount in wei.
    * @param maxInterestRate Maximum acceptable interest rate (basis points).
    * @param duration Loan duration in seconds.
    */
    function listLoan(
        address nftAddress,
        uint256 tokenId,
        uint256 loanAmount,
        uint256 maxInterestRate,
        uint256 duration,
        LoanType loanType // Specify loan type
    ) external nonReentrant isAllowedNFT(nftAddress) onlyNftOwner(nftAddress, tokenId) {
        require(activeLoanIds.length < maxActiveLoans, "Active loan limit reached");
        require(loanAmount > 0, "Loan amount must be greater than zero");
        require(maxInterestRate > 0, "Interest rate must be greater than zero");
        require(duration > 0, "Loan duration must be greater than zero");
        require(uint256(loanType) <= uint256(type(LoanType).max), "Invalid loan type");

        // Transfer the NFT to the contract
        IERC721(nftAddress).transferFrom(msg.sender, address(this), tokenId);

        // Create a new loan
        loans[loanCounter] = Loan({
            borrower: msg.sender,
            lender: address(0),
            nftAddress: nftAddress,
            tokenId: tokenId,
            loanAmount: loanAmount,
            maxInterestRate: maxInterestRate,
            currentInterestRate: maxInterestRate,
            duration: duration,
            startTime: 0,
            loanType: loanType, // Assign loan type
            isAccepted: false
        });

        // Track active loan
        activeLoans[loanCounter] = true;
        activeLoanIds.push(loanCounter);

        emit LoanListed(
            loanCounter,
            msg.sender,
            nftAddress,
            tokenId,
            loanAmount,
            maxInterestRate,
            duration,
            loanType
        );

        loanCounter++;
    }

    /**
    * @notice Places a bid to offer a loan at a specified interest rate.
    * @param loanId ID of the loan to bid on.
    * @param interestRate Proposed interest rate (basis points).
    */
    function placeBid(uint256 loanId, uint256 interestRate)
    external
    payable
    nonReentrant
    loanExists(loanId)
    isNotAccepted(loanId) {
        Loan storage loan = loans[loanId];
        require(
            interestRate < loan.currentInterestRate && interestRate <= loan.maxInterestRate,
            "Bid interest rate invalid"
        );
        require(loanCoin.transferFrom(msg.sender, address(this), loan.loanAmount), "Loan Amount Transfer failed");

        // Refund the previous lender if there is one
        if (loan.lender != address(0)) {
            loanCoin.transfer(loan.lender, escrowedFunds[loanId]);
        }

        // Update loan details
        loan.lender = msg.sender;
        loan.currentInterestRate = interestRate;
        escrowedFunds[loanId] = loan.loanAmount;

        emit LoanBidPlaced(loanId, msg.sender, interestRate);

    }

    /**
    * @notice Delist a loan
    * @param loanId ID of the loan to delist.
    */
    function delistLoan(uint256 loanId) external nonReentrant loanExists(loanId) isNotAccepted(loanId) onlyBorrower(loanId) {
        Loan storage loan = loans[loanId];

        // Refund escrowed funds to the last bidder (if any)
        if (loan.lender != address(0)) {
            uint256 escrowAmount = escrowedFunds[loanId];
            escrowedFunds[loanId] = 0; // Clear escrow
            loanCoin.transfer(loan.lender, escrowAmount);
        }

        // Return the NFT to the borrower
        IERC721(loan.nftAddress).safeTransferFrom(address(this), loan.borrower, loan.tokenId);

        // Clean up loan data
        delete loans[loanId];
        _removeActiveLoan(loanId);

        emit LoanDelisted(loanId, loan.borrower);

    }

    /**
    * @notice Accepts a loan bid, starting the loan.
    * @param loanId ID of the loan to accept.
    */
    function acceptLoan(uint256 loanId)
    external
    nonReentrant
    loanExists(loanId)
    isNotAccepted(loanId)
    onlyBorrower(loanId) {
        Loan storage loan = loans[loanId];
        require(loan.lender != address(0), "No lender bid yet");

        require(loan.startTime == 0, "Loan already started");
        loan.startTime = block.timestamp;

        loan.isAccepted = true;

        uint256 loanAmount = escrowedFunds[loanId];
        escrowedFunds[loanId] = 0;
        loanCoin.transfer(loan.borrower, loanAmount);

        emit LoanAccepted(loanId, loan.borrower, loan.lender, loan.startTime);

    }

    /**
    * @notice Get the total required repayment for a loan.
    * @param loanId ID of the loan to repay.
    */
    function getTotalRepayment(uint256 loanId)
        public
        view
        loanExists(loanId)
        returns (uint256)
    {
        Loan storage loan = loans[loanId];
        
        uint256 interestAmount;

        if (loan.loanType == LoanType.FIXED) {
            // Fixed interest calculation
            interestAmount = (loan.loanAmount * loan.currentInterestRate) / 10000;
        } else if (loan.loanType == LoanType.APR) {
            // APR interest calculation
            uint256 annualizedInterest = (loan.loanAmount * loan.currentInterestRate) / 10000;

            if (loan.isAccepted) {
                // Pro-rate interest for elapsed days
                uint256 elapsedTimeInDays = (block.timestamp - loan.startTime) / 1 days;
                interestAmount = (annualizedInterest * (elapsedTimeInDays > 0 ? elapsedTimeInDays : 1)) / 365;
            } else {
                // Calculate APR based on full loan duration if not yet accepted
                uint256 durationInDays = loan.duration / 1 days;
                interestAmount = (annualizedInterest * (durationInDays > 0 ? durationInDays : 1)) / 365;
            }
        }

        // Return total repayment: principal + interest
        return loan.loanAmount + interestAmount;
    }

    /**
    * @notice Repays a loan and returns the NFT collateral to the borrower.
    * @param loanId ID of the loan to repay.
    */
    function repayLoan(uint256 loanId)
        external
        payable
        nonReentrant
        loanExists(loanId)
        onlyBorrower(loanId)
    {
        Loan storage loan = loans[loanId];
        require(loan.isAccepted, "Loan not accepted yet");
        require(block.timestamp >= loan.startTime, "Repayment before loan start time");
        require(block.timestamp <= loan.startTime + loan.duration, "Loan duration expired");

        // Get total repayment amount
        uint256 totalRepayment = getTotalRepayment(loanId);

        // Calculate protocol fees
        uint256 borrowerProtocolFee = (totalRepayment * protocolFeeRate) / 10000;
        uint256 lenderProtocolFee = (totalRepayment * protocolFeeRate) / 10000;

        // Total amount required from borrower
        uint256 requiredRepayment = totalRepayment + borrowerProtocolFee;
        require(loanCoin.transferFrom(msg.sender, address(this), requiredRepayment), "Payment failed");

        // Calculate lender payout
        uint256 lenderPayout = totalRepayment - lenderProtocolFee;

        // Update protocol fee balance
        protocolFeeBalance += (lenderProtocolFee + borrowerProtocolFee);

        // Transfer NFT back to borrower
        loan.isAccepted = false;
        IERC721(loan.nftAddress).safeTransferFrom(address(this), loan.borrower, loan.tokenId);

        // Transfer lender payout
        loanCoin.transfer(loan.lender, lenderPayout);

        emit LoanRepaid(loanId, loan.borrower, requiredRepayment);

        _removeActiveLoan(loanId);
    }


    /**
    * @notice Cancels a bid if the borrower doesn't accept.
    * @param loanId ID of the loan to cancel.
    */
    function cancelBid(uint256 loanId) external nonReentrant loanExists(loanId) isNotAccepted(loanId) onlyLender(loanId) {
        Loan storage loan = loans[loanId];

        // Refund escrowed funds to the lender
        uint256 escrowAmount = escrowedFunds[loanId];
        escrowedFunds[loanId] = 0; // Clear escrow
        loanCoin.transfer(loan.lender, escrowAmount);

        // Clear lender information
        loan.lender = address(0);
        loan.currentInterestRate = loan.maxInterestRate; // Reset to max rate

        emit LoanBidCancelled(loanId, loan.lender);

    }


    /**
    * @notice Claims an NFT as collateral if the borrower defaults.
    * @param loanId ID of the loan to claim.
    */
    function claimDefaultedLoan(uint256 loanId)
    external
    payable
    nonReentrant
    loanExists(loanId) {
        Loan storage loan = loans[loanId];
        require(loan.isAccepted, "Loan not accepted");
        require(block.timestamp > loan.startTime + loan.duration, "Loan not expired");

        // Get the total repayment (principal + interest)
        uint256 totalRepayment = getTotalRepayment(loanId);

        // Calculate the lender's protocol fee based on the total repayment
        uint256 lenderProtocolFee = (totalRepayment * protocolFeeRate) / 10000;

        // Ensure lender sends the correct protocol fee
        require(loanCoin.transferFrom(msg.sender, address(this), lenderProtocolFee), "Protocol fee failed");
        
        // Update protocol fee balance
        protocolFeeBalance += lenderProtocolFee;

        // Transfer NFT to the lender
        loan.isAccepted = false;
        IERC721(loan.nftAddress).safeTransferFrom(address(this), loan.lender, loan.tokenId);

        emit LoanDefaulted(loanId, loan.lender);

        _removeActiveLoan(loanId);
    }


    /**
    * @notice Returns the IDs of all active loans.
    */
    function getActiveLoans() external view returns (uint256[] memory) {
        return activeLoanIds;
    }

    /**
    * @dev Removes a loan from the active loan list.
    * @param loanId ID of the loan to remove.
    */
    function _removeActiveLoan(uint256 loanId) private {
        delete activeLoans[loanId];
        for (uint256 i = 0; i < activeLoanIds.length;) {
            if (activeLoanIds[i] == loanId) {
                activeLoanIds[i] = activeLoanIds[activeLoanIds.length - 1];
                activeLoanIds.pop();
                break;
            }
            unchecked {
                i++;
            }
        }
    }

    /**
    * @notice Withdraws accumulated protocol fees to the specified address.
    * @param to Address to receive the fees.
    */
    function withdrawProtocolFees(address payable to) external nonReentrant onlyRole(OWNER_ROLE) {
        require(to != address(0), "Invalid recipient address");
        uint256 amount = protocolFeeBalance;

        protocolFeeBalance = 0;

        (bool success,) = to.call {
            value: amount
        }("");
        require(success, "Withdrawal failed");

        emit ProtocolFeesWithdrawn(to, amount);
    }

    // Withdraw locked Ether sent to the contract by mistake
    function withdrawEther(address payable to) external nonReentrant onlyRole(OWNER_ROLE) {
        require(to != address(0), "Invalid recipient address");

        // Calculate the total balance held by the contract
        uint256 totalBalance = address(this).balance;

        // Calculate total escrowed funds (sum of all values in escrowedFunds mapping)
        uint256 totalEscrowedFunds = 0;
        for (uint256 i = 0; i < activeLoanIds.length; i++) {
            totalEscrowedFunds += escrowedFunds[activeLoanIds[i]];
        }

        // Calculate withdrawable amount:
        uint256 withdrawableAmount = totalBalance - totalEscrowedFunds - protocolFeeBalance;
        require(withdrawableAmount > 0, "No funds available for withdrawal");

        // Perform the withdrawal
        (bool success,) = to.call {
            value: withdrawableAmount
        }("");
        require(success, "Ether transfer failed");

        emit ProtocolFeesWithdrawn(to, withdrawableAmount);
    }

}