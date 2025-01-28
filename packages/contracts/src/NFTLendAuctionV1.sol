// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title NFTLendAuction
 * @notice A decentralized lending platform where borrowers can list NFTs as collateral for loans.
 *         Lenders compete to provide loans by bidding with lower interest rates.
 *         Loans can be repaid or claimed by lenders in case of default.
 */
contract NFTLendAuctionV1 is ReentrancyGuard, AccessControl {
    bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

    // Enum to define loan types
    enum LoanType {
        FIXED,
        APR
    }

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

    uint256 public loanCounter; // Counter to track the total number of loans created
    mapping(uint256 => Loan) public loans; // Mapping of loan IDs to loan details
    mapping(uint256 => uint256) public escrowedFunds; // Mapping of loan IDs to escrowed lender funds
    mapping(address => bool) public allowedNFTContracts; // Tracks which NFT contracts are allowed
    mapping(address => mapping(uint256 => bool)) public isCollateralized;

    uint256 public maxActiveLoans = 1000; // Default maximum size for active loans
    uint256[] public activeLoanIds; // List of IDs for currently active loans
    mapping(uint256 => bool) public activeLoans; // Tracks whether a loan ID is active

    uint256 public protocolFeeRate = 200; // Protocol fee rate in basis points (5%)
    uint256 public protocolFeeBalance; // Accumulated protocol fees

    // Refund handling
    mapping(address => uint256) public pendingWithdrawals;
    uint256 public totalPendingWithdrawals; // Accumulated pending withdrawals

    // Add bid cooldown period
    mapping(uint256 => uint256) public bidTimestamps; // Timestamp for the last bid placed
    uint256 public bidCancelPeriod = 1 days; // Initial cooldown period

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

    event LoanDefaulted(uint256 indexed loanId, address indexed lender);

    event AllowedNFTUpdated(address indexed nftAddress, bool allowed);

    event ProtocolFeeRateUpdated(uint256 newFeeRate);

    event ProtocolFeesWithdrawn(address to, uint256 amount);

    event MaxActiveLoansUpdated(uint256 newMaxActiveLoans);

    event BidCancelPeriodUpdated(uint256 newBidCancelPeriod);

    event PendingWithdrawalAdded(address indexed recipient, uint256 amount);

    event FundsWithdrawn(
        address indexed user,
        uint256 amount,
        address indexed to
    );

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
        require(
            IERC721(nftAddress).ownerOf(tokenId) == msg.sender,
            "Not NFT owner"
        );
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
        require(allowedNFTContracts[nftAddress], "NFT contract not allowed");
        _;
    }

    /**
     * @notice Initializes the contract and sets the govern address.
     */
    constructor(address _govAddress) {
        // Grant the initial owner the DEFAULT_ADMIN_ROLE and OWNER_ROLE
        _grantRole(DEFAULT_ADMIN_ROLE, _govAddress);
        _grantRole(OWNER_ROLE, _govAddress);
        _grantRole(MANAGER_ROLE, _govAddress);
    }

    // Admin can grant roles to other addresses
    function grantManagerRole(
        address account
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        grantRole(MANAGER_ROLE, account);
    }

    // Function for the admin to adjust the maximum size of activeLoanIds
    function setMaxActiveLoans(uint256 newMax) external onlyRole(OWNER_ROLE) {
        maxActiveLoans = newMax;
        emit MaxActiveLoansUpdated(maxActiveLoans);
    }

    /**
     * @notice Updates the list of allowed NFT contracts.
     * @param nftAddress Address of the NFT contract.
     * @param allowed Whether the NFT contract is allowed.
     */
    function updateAllowedNFT(
        address nftAddress,
        bool allowed
    ) external onlyRole(MANAGER_ROLE) {
        require(nftAddress != address(0), "Invalid NFT address");
        require(nftAddress.code.length > 0, "Address is not a contract");

        // Check if the contract supports ERC721 interface
        try IERC721(nftAddress).supportsInterface(0x80ac58cd) returns (
            bool isERC721
        ) {
            require(isERC721, "Contract does not support ERC721 interface");
        } catch {
            revert("Failed to verify ERC721 interface");
        }

        // Verify the presence of 'safeTransferFrom(address,address,uint256)'
        bytes4 safeTransferSelector = bytes4(
            keccak256("safeTransferFrom(address,address,uint256)")
        );
        require(
            nftAddress.code.length > 0 && safeTransferSelector != bytes4(0),
            "Contract lacks safeTransferFrom"
        );

        allowedNFTContracts[nftAddress] = allowed;
        emit AllowedNFTUpdated(nftAddress, allowed);
    }

    // Admin can revoke roles from other addresses
    function revokeManagerRole(
        address account
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        revokeRole(MANAGER_ROLE, account);
    }

    /**
     * @notice Sets the protocol fee rate.
     * @param newFeeRate New protocol fee rate in basis points.
     */
    function setProtocolFeeRate(
        uint256 newFeeRate
    ) external onlyRole(OWNER_ROLE) {
        require(newFeeRate <= 1000, "Fee rate too high"); // Max 10%
        protocolFeeRate = newFeeRate;
        emit ProtocolFeeRateUpdated(newFeeRate);
    }

    /**
     * @notice Sets the BidCancelPeriod.
     * @param newBidCancelPeriod New newBidCancelPeriod.
     */
    function setBidCancelPeriod(
        uint256 newBidCancelPeriod
    ) external onlyRole(OWNER_ROLE) {
        require(
            newBidCancelPeriod > 1 hours,
            "New BidCancelPeriod is less than 1 hour"
        );
        bidCancelPeriod = newBidCancelPeriod;
        emit BidCancelPeriodUpdated(newBidCancelPeriod);
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
    )
        external
        nonReentrant
        isAllowedNFT(nftAddress)
        onlyNftOwner(nftAddress, tokenId)
    {
        require(
            activeLoanIds.length < maxActiveLoans,
            "Active loan limit reached"
        );
        require(
            !isCollateralized[nftAddress][tokenId],
            "NFT is already collateralized"
        );
        require(loanAmount > 0, "Loan amount must be greater than zero");
        require(maxInterestRate > 0, "Interest rate must be greater than zero");
        require(duration > 0, "Loan duration must be greater than zero");
        require(
            uint256(loanType) <= uint256(type(LoanType).max),
            "Invalid loan type"
        );

        uint256 loanId = loanCounter;
        // Create a new loan
        loans[loanId] = Loan({
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
        activeLoans[loanId] = true;
        activeLoanIds.push(loanId);

        loanCounter++;

        // Mark NFT as collateralized
        isCollateralized[nftAddress][tokenId] = true;

        // Transfer the NFT to the contract
        try
            IERC721(nftAddress).transferFrom(msg.sender, address(this), tokenId)
        {
            emit LoanListed(
                loanId,
                msg.sender,
                nftAddress,
                tokenId,
                loanAmount,
                maxInterestRate,
                duration,
                loanType
            );
        } catch {
            revert("NFT transfer failed"); // Abort on failure
        }
    }

    /**
     * @notice Adds a pending withdrawal for a specified recipient.
     * @dev Internal function to record funds owed to a recipient without transferring immediately.
     * @param recipient The address of the recipient who can later withdraw the funds.
     * @param amount The amount of funds to be added to the pending withdrawals.
     */
    function addPendingWithdrawal(address recipient, uint256 amount) internal {
        pendingWithdrawals[recipient] += amount;
        totalPendingWithdrawals += amount; // Update global pending withdrawals
        emit PendingWithdrawalAdded(recipient, amount);
    }

    /**
     * @notice Allows a user to withdraw their pending funds.
     * @dev Ensures withdrawals are safe from reentrancy attacks and logs the withdrawal event.
     * @param to The address where the funds should be sent.
     */
    function withdrawFunds(address payable to) external nonReentrant {
        require(to != address(0), "Invalid address");

        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "No funds to withdraw");

        pendingWithdrawals[msg.sender] = 0;
        totalPendingWithdrawals -= amount; // Deduct from global pending withdrawals
        payable(to).transfer(amount);

        emit FundsWithdrawn(msg.sender, amount, to);
    }

    /**
     * @notice Places a bid to offer a loan at a specified interest rate.
     * @param loanId ID of the loan to bid on.
     * @param interestRate Proposed interest rate (basis points).
     */
    function placeBid(
        uint256 loanId,
        uint256 interestRate
    ) external payable nonReentrant loanExists(loanId) isNotAccepted(loanId) {
        Loan storage loan = loans[loanId];
        require(
            interestRate < loan.currentInterestRate &&
                interestRate <= loan.maxInterestRate,
            "Bid interest rate invalid"
        );
        require(msg.value == loan.loanAmount, "Incorrect loan amount");

        address previousBidder = loan.lender;
        uint256 escrowRefund = 0;
        if (previousBidder != address(0)) {
            escrowRefund = escrowedFunds[loanId];
        }
        // Update loan details
        loan.lender = msg.sender;
        loan.currentInterestRate = interestRate;
        escrowedFunds[loanId] = msg.value;

        // Setting cooldown period start
        bidTimestamps[loanId] = block.timestamp;

        // Refund the previous lender if there is one
        if (previousBidder != address(0) && escrowRefund > 0) {
            addPendingWithdrawal(previousBidder, escrowRefund);
        }
        emit LoanBidPlaced(loanId, msg.sender, interestRate);
    }

    /**
     * @notice Delist a loan
     * @param loanId ID of the loan to delist.
     */
    function delistLoan(
        uint256 loanId
    )
        external
        nonReentrant
        loanExists(loanId)
        isNotAccepted(loanId)
        onlyBorrower(loanId)
    {
        Loan memory loan = loans[loanId];

        // Refund escrowed funds to the last bidder (if any)
        address previousBidder = loan.lender;
        uint256 escrowRefund = 0;
        if (previousBidder != address(0)) {
            escrowRefund = escrowedFunds[loanId];
            escrowedFunds[loanId] = 0; // Clear escrow
            if (escrowRefund > 0) {
                addPendingWithdrawal(previousBidder, escrowRefund);
            }
        }

        // Clean up loan data
        delete loans[loanId];
        _removeActiveLoan(loanId);
        // Mark NFT as no longer collateralized
        isCollateralized[loan.nftAddress][loan.tokenId] = false;

        // Return the NFT to the borrower
        try
            IERC721(loan.nftAddress).safeTransferFrom(
                address(this),
                loan.borrower,
                loan.tokenId
            )
        {
            emit LoanDelisted(loanId, loan.borrower);
        } catch {
            revert("NFT transfer failed"); // Abort on failure
        }
    }

    /**
     * @notice Accepts a loan bid, starting the loan.
     * @param loanId ID of the loan to accept.
     */
    function acceptLoan(
        uint256 loanId
    )
        external
        nonReentrant
        loanExists(loanId)
        isNotAccepted(loanId)
        onlyBorrower(loanId)
    {
        Loan storage loan = loans[loanId];
        require(loan.lender != address(0), "No lender bid yet");
        require(
            escrowedFunds[loanId] == loan.loanAmount,
            "Escrowed funds do not match loan amount"
        );
        require(loan.startTime == 0, "Loan already started");
        loan.startTime = block.timestamp;

        loan.isAccepted = true;

        uint256 loanAmount = escrowedFunds[loanId];
        escrowedFunds[loanId] = 0;
        payable(loan.borrower).transfer(loanAmount);

        emit LoanAccepted(loanId, loan.borrower, loan.lender, loan.startTime);
    }

    /**
     * @notice Get the total required repayment for a loan.
     * @param loanId ID of the loan to repay.
     */
    function getTotalRepayment(
        uint256 loanId
    ) public view loanExists(loanId) returns (uint256) {
        Loan storage loan = loans[loanId];

        uint256 interestAmount;

        if (loan.loanType == LoanType.FIXED) {
            // Fixed interest calculation
            interestAmount =
                (loan.loanAmount * loan.currentInterestRate) /
                10000;
        } else if (loan.loanType == LoanType.APR) {
            // APR interest calculation
            uint256 annualizedInterest = (loan.loanAmount *
                loan.currentInterestRate) / 10000;

            if (loan.isAccepted) {
                // Pro-rate interest for elapsed days
                uint256 elapsedTimeInDays = (block.timestamp - loan.startTime) /
                    1 days;
                // If less than a day, use 1 day as minimum
                interestAmount =
                    (annualizedInterest *
                        (elapsedTimeInDays > 0 ? elapsedTimeInDays : 1)) /
                    365;
            } else {
                // Calculate APR based on full loan duration if not yet accepted
                uint256 durationInDays = loan.duration / 1 days;
                interestAmount =
                    (annualizedInterest *
                        (durationInDays > 0 ? durationInDays : 1)) /
                    365;
            }
        }

        // Return total repayment: principal + interest
        return loan.loanAmount + interestAmount;
    }

    // Calculate Protocol Fee
    function calculateProtocolFee(
        uint256 amount
    ) internal view returns (uint256) {
        return (amount * protocolFeeRate) / 10000;
    }

    /**
     * @notice Repays a loan and returns the NFT collateral to the borrower.
     * @param loanId ID of the loan to repay.
     */
    function repayLoan(
        uint256 loanId
    ) external payable nonReentrant loanExists(loanId) onlyBorrower(loanId) {
        Loan storage loan = loans[loanId];
        require(loan.isAccepted, "Loan not accepted yet");
        require(
            block.timestamp >= loan.startTime,
            "Repayment before loan start time"
        );
        require(
            block.timestamp <= loan.startTime + loan.duration,
            "Loan duration expired"
        );

        // Get total repayment amount
        uint256 totalRepayment = getTotalRepayment(loanId);

        // Calculate protocol fees
        uint256 borrowerProtocolFee = calculateProtocolFee(totalRepayment);
        uint256 lenderProtocolFee = calculateProtocolFee(totalRepayment);

        // Total amount required from borrower
        uint256 requiredRepayment = totalRepayment + borrowerProtocolFee;
        require(msg.value >= requiredRepayment, "Incorrect repayment amount");

        // Calculate lender payout
        uint256 lenderPayout = totalRepayment - lenderProtocolFee;

        // Update protocol fee balance
        protocolFeeBalance += (lenderProtocolFee + borrowerProtocolFee);

        // Clean up loan data
        loan.isAccepted = false;
        _removeActiveLoan(loanId);
        // Mark NFT as no longer collateralized
        isCollateralized[loan.nftAddress][loan.tokenId] = false;

        // Add Pending lender payout
        addPendingWithdrawal(loan.lender, lenderPayout);

        // Transfer NFT back to borrower
        try
            IERC721(loan.nftAddress).safeTransferFrom(
                address(this),
                loan.borrower,
                loan.tokenId
            )
        {
            emit LoanRepaid(loanId, loan.borrower, msg.value);
        } catch {
            revert("NFT transfer failed"); // Abort on failure
        }
    }

    /**
     * @notice Cancels a bid if the borrower doesn't accept.
     * @param loanId ID of the loan to cancel.
     */
    function cancelBid(
        uint256 loanId
    )
        external
        nonReentrant
        loanExists(loanId)
        isNotAccepted(loanId)
        onlyLender(loanId)
    {
        Loan storage loan = loans[loanId];

        // Enforce cooldown period before cancel
        require(
            block.timestamp >= bidTimestamps[loanId] + bidCancelPeriod,
            "bidCancelPeriod not met"
        );

        // Refund escrowed funds to the last bidder (if any)
        address previousBidder = loan.lender;
        uint256 escrowRefund = escrowedFunds[loanId];
        escrowedFunds[loanId] = 0; // Clear escrow

        // Clear lender information
        loan.lender = address(0);
        loan.currentInterestRate = loan.maxInterestRate; // Reset to max rate

        if (previousBidder != address(0) && escrowRefund > 0) {
            payable(previousBidder).transfer(escrowRefund);
        }

        emit LoanBidCancelled(loanId, loan.lender);
    }

    /**
     * @notice Claims an NFT as collateral if the borrower defaults.
     * @param loanId ID of the loan to claim.
     */
    function claimDefaultedLoan(
        uint256 loanId
    ) external payable nonReentrant loanExists(loanId) {
        Loan storage loan = loans[loanId];
        require(loan.isAccepted, "Loan not accepted");
        require(
            block.timestamp > loan.startTime + loan.duration,
            "Loan not expired"
        );

        // Get the total repayment (principal + interest)
        uint256 totalRepayment = getTotalRepayment(loanId);

        // Calculate the lender's protocol fee based on the total repayment
        uint256 lenderProtocolFee = calculateProtocolFee(totalRepayment);

        // Ensure lender sends the correct protocol fee
        require(msg.value == lenderProtocolFee, "Incorrect protocol fee sent");

        // Update protocol fee balance
        protocolFeeBalance += lenderProtocolFee;

        // Clean up loan data
        loan.isAccepted = false;
        _removeActiveLoan(loanId);
        // Mark NFT as no longer collateralized
        isCollateralized[loan.nftAddress][loan.tokenId] = false;

        // Transfer NFT to the lender
        try
            IERC721(loan.nftAddress).safeTransferFrom(
                address(this),
                loan.lender,
                loan.tokenId
            )
        {
            emit LoanDefaulted(loanId, loan.lender);
        } catch {
            revert("NFT transfer failed"); // Abort on failure
        }
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
        for (uint256 i = 0; i < activeLoanIds.length; ) {
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
     * @notice Withdraws accumulated protocol fees and excess ETH to the specified address.
     * @param to Address to receive the fees.
     */
    function withdrawProtocolFees(
        address payable to
    ) external nonReentrant onlyRole(OWNER_ROLE) {
        require(to != address(0), "Invalid recipient address");

        // Calculate the total balance held by the contract
        uint256 totalBalance = address(this).balance;

        // Calculate total escrowed funds
        uint256 totalEscrowedFunds = 0;
        for (uint256 i = 0; i < activeLoanIds.length; i++) {
            totalEscrowedFunds += escrowedFunds[activeLoanIds[i]];
        }

        // Calculate withdrawable amount: (protocol fees + excess funds)
        uint256 withdrawableAmount = totalBalance -
            totalEscrowedFunds -
            totalPendingWithdrawals; // Use global pending withdrawals

        require(withdrawableAmount > 0, "No funds available for withdrawal");

        // Reset protocol fees (if any were included in the balance)
        protocolFeeBalance = 0;

        // Perform the withdrawal
        (bool success, ) = to.call{value: withdrawableAmount}("");
        require(success, "Withdrawal failed");

        emit ProtocolFeesWithdrawn(to, withdrawableAmount);
    }
}
