import React, { useEffect, useState, useCallback } from "react";
import { ethers } from "ethers";
import {
    Container,
    Typography,
    Button,
    Tooltip,
    Box,
    Modal,
    TextField,
    Card,
    CardContent,
    CardActions,
} from "@mui/material";
import { getContract } from "../utils/contract";

type Loan = {
    id: number;
    nftAddress: string;
    tokenId: number;
    borrower: string;
    lender: string;
    loanAmount: string;
    maxInterestRate: string;
    currentInterestRate: string;
    duration: string;
    startTime: string; // Friendly start time
    endTime: string; // Friendly end time
    isAccepted: boolean;
    loanType: string;
};

const allowedNFTs = process.env.NEXT_PUBLIC_ALLOWED_NFTS?.split(",") || [];

export default function Home() {
    const [walletAddress, setWalletAddress] = useState<string | null>(null);
    const [signer, setSigner] = useState<ethers.Signer | null>(null);
    const [loans, setLoans] = useState<Loan[]>([]);
    const [newLoan, setNewLoan] = useState({
        nftAddress: "",
        tokenId: "",
        loanAmount: "",
        maxInterestRate: "",
        durationDays: "", // Input duration in days
        loanType: "" // 0 for Fixed, 1 for APR
    });
    const [pendingWithdrawals, setPendingWithdrawals] = useState<string>("0");
    const [openModal, setOpenModal] = useState(false);


    const fetchLoans = async () => {
        try {
            // Use the RPC provider instead of a signer
            const provider = new ethers.providers.JsonRpcProvider(process.env.NEXT_PUBLIC_RPC_URL);
            const contract = getContract(provider);
    
            // Fetch active loan IDs
            const activeLoanIds = await contract.getActiveLoans();
            console.log("Active Loan IDs:", activeLoanIds);
    
            const fetchedLoans: Loan[] = [];
    
            for (const id of activeLoanIds) {
                try {
                    // Fetch loan details for each active loan
                    const loan = await contract.loans(id);
    
                    const startTime = Number(loan.startTime);
                    const duration = Number(loan.duration);
    
                    const startTimeFormatted =
                        startTime > 0
                            ? new Date(startTime * 1000).toLocaleString()
                            : "Not Started";
    
                    const endTimeFormatted =
                        startTime > 0
                            ? new Date((startTime + duration) * 1000).toLocaleString()
                            : "N/A";
    
                    fetchedLoans.push({
                        id: id.toNumber(),
                        borrower: loan.borrower,
                        lender: loan.lender,
                        nftAddress: loan.nftAddress,
                        tokenId: Number(loan.tokenId),
                        loanAmount: ethers.utils.formatEther(loan.loanAmount),
                        maxInterestRate: (Number(loan.maxInterestRate) / 100).toFixed(1), // Convert bps to percentage
                        currentInterestRate: (Number(loan.currentInterestRate) / 100).toFixed(1), // Convert bps to percentage
                        duration: (duration / 86400).toFixed(1), // Convert seconds to days
                        startTime: startTimeFormatted,
                        endTime: endTimeFormatted,
                        isAccepted: loan.isAccepted, // Updated terminology
                        loanType: loan.loanType === 0 ? "Fixed" : "APR"
                    });
                } catch (error) {
                    console.warn(`Error fetching loan ID ${id.toNumber()}:`, error);
                }
            }
    
            setLoans(fetchedLoans);
        } catch (error) {
            console.error("Error fetching loans:", error);
        }
    };

    useEffect(() => {
        fetchLoans();
    }, []); // Fetch loans when the component mounts

    useEffect(() => {
        if (walletAddress) fetchLoans();
    }, [walletAddress]);
  

    const fetchPendingWithdrawals = useCallback(async () => {
        try {
            const provider = new ethers.providers.JsonRpcProvider(process.env.NEXT_PUBLIC_RPC_URL);
            const contract = getContract(provider);
    
            if (walletAddress) {
                const amount = await contract.pendingWithdrawals(walletAddress);
                setPendingWithdrawals(ethers.utils.formatEther(amount));
            }
        } catch (error) {
            console.error("Error fetching pending withdrawals:", error);
        }
    }, [walletAddress]); // Ensure all dependencies are included

    useEffect(() => {
        if (walletAddress) fetchPendingWithdrawals();
    }, [walletAddress, fetchPendingWithdrawals]);

    
    const connectWallet = async () => {
        try {
            const provider = new ethers.providers.Web3Provider((window as any).ethereum);
            await provider.send("eth_requestAccounts", []);
            const signer = provider.getSigner();
            const address = await signer.getAddress();
            setSigner(signer);
            setWalletAddress(address);
        } catch (error) {
            console.error("Error connecting wallet:", error);
        }
    };

    const disconnectWallet = () => {
        setWalletAddress(null);
        setSigner(null);
        console.log("Wallet disconnected");
      };
      

    const handleListLoan = async () => {
        try {
            if (!signer) return;

            const contract = getContract(signer);
            const { nftAddress, tokenId, loanAmount, maxInterestRate, durationDays, loanType } = newLoan;

            if (!allowedNFTs.includes(nftAddress)) {
                alert("This NFT contract is not allowed.");
                return;
            }

            const nftContract = new ethers.Contract(
                nftAddress,
                [
                    "function getApproved(uint256 tokenId) public view returns (address)",
                    "function approve(address to, uint256 tokenId) public",
                ],
                signer
            );


            // Check if the token is already approved
            const approvedAddress = await nftContract.getApproved(tokenId);
            if (approvedAddress.toLowerCase() !== contract.address.toLowerCase()) {
                // Approve the token
                const approvalTx = await nftContract.approve(contract.address, tokenId);
                await approvalTx.wait();
                console.log(`NFT approved for loan listing (Token ID: ${tokenId})`);
            }


            const durationInSeconds = Number(durationDays) * 86400; // Convert days to seconds

            // Prepare transaction details
            const transactionData = {
                to: contract.address,
                data: contract.interface.encodeFunctionData("listLoan", [
                    nftAddress,
                    tokenId,
                    ethers.utils.parseEther(loanAmount),
                    Math.round(Number(maxInterestRate) * 100), // Convert percentage to bps
                    durationInSeconds,
                    loanType
                ]),
            };

            // Estimate gas
            let gasEstimate;
            try {
                gasEstimate = await signer.estimateGas(transactionData);
            } catch (error) {
                console.error("Gas estimation failed, using fallback gas limit:", error);
                gasEstimate = ethers.BigNumber.from("300000"); // Set a reasonable default gas limit
            }

            try {
                const tx = await signer.sendTransaction({
                    ...transactionData,
                    gasLimit: gasEstimate,
                });
                const receipt = await tx.wait();

                // Extract LoanId from the LoanListed event
                const loanListedEvent = receipt.logs.find(log =>
                    log.topics[0] === ethers.utils.id("LoanListed(uint256, address, address, uint256, uint256, uint256, uint256, uint8)") // 0xa1245a80903048d748a2cbd2d90c4e25d716e52ebe400f5d87e3cb233dbb1564
                );

                if (!loanListedEvent) {
                    throw new Error("LoanListed event not found in transaction receipt");
                }

                const loanId = ethers.BigNumber.from(loanListedEvent.topics[1]).toNumber();

                console.log("New Loan ID:", loanId);
                alert(`Loan successfully listed with Loan ID: ${loanId}`);
                
            } catch (error: any) {
                if (error.code === ethers.errors.CALL_EXCEPTION) {
                    console.error("Revert reason:", error.reason || error.data || "Unknown");
                } else {
                    console.error("Error:", error);
                }
            }

            setOpenModal(false);
            fetchLoans();
        } catch (error) {
            console.error("Error listing loan:", error);
        }
    };

    const handleDelistLoan = async (loanId: number) => {
        try {
            if (!signer) return;
            const contract = getContract(signer);
            const tx = await contract.delistLoan(loanId);
            await tx.wait();
            fetchLoans();
        } catch (error) {
            console.error("Error delisting loan:", error);
        }
    };

    const handleAcceptLoan = async (loanId: number) => {
        try {
            if (!signer) return;
    
            const contract = getContract(signer);
    
            // Fetch loan details
            const totalRepayment = await contract.getTotalRepayment(loanId);

            const protocolFeeRate = await contract.protocolFeeRate();
            const borrowerProtocolFee = totalRepayment.mul(protocolFeeRate).div(10000);
            const requiredRepayment = totalRepayment.add(borrowerProtocolFee);
            // Inform the user about the repayment amount
            if (
                !window.confirm(
                    `Before the time duration you will have to repay ${ethers.utils.formatEther(requiredRepayment)} $CORE, including a protocol fee of ${ethers.utils.formatEther(
                        borrowerProtocolFee
                    )} $CORE. Not repaying means loosing the NFT and associated Staked-BTC on it, Proceed?`
                )
            ) {
                return;
            }
    
            // Execute transaction
            const tx = await contract.acceptLoan(loanId);
            await tx.wait();
    
            fetchLoans();
        } catch (error) {
            console.error("Error accepting loan:", error);
        }
    };

    const handleRepayLoan = async (loanId: number) => {
        try {
            if (!signer) return;
    
            const contract = getContract(signer);
    
            // Fetch loan details
            const totalRepayment = await contract.getTotalRepayment(loanId);

            const protocolFeeRate = await contract.protocolFeeRate();
            const borrowerProtocolFee = totalRepayment.mul(protocolFeeRate).div(10000);
            const requiredRepayment = totalRepayment.add(borrowerProtocolFee);

            // Inform the user about the repayment amount
            if (
                !window.confirm(
                    `You will repay ${ethers.utils.formatEther(requiredRepayment)} $CORE, including a protocol fee of ${ethers.utils.formatEther(
                        borrowerProtocolFee
                    )} $CORE. Not repaying means loosing the NFT and associated Staked-BTC on it, Proceed?`
                )
            ) {
                return;
            }
    
            // Execute the repayment transaction
            const tx = await contract.repayLoan(loanId, { value: requiredRepayment });
            await tx.wait();
    
            fetchLoans();
        } catch (error) {
            console.error("Error repaying loan:", error);
        }
    };
    
    const handleClaimDefaultedLoan = async (loanId: number) => {
        try {
            if (!signer) return;
    
            const contract = getContract(signer);
    
            // Fetch loan details
            const totalRepayment = await contract.getTotalRepayment(loanId);
            const protocolFeeRate = await contract.protocolFeeRate();
            const lenderProtocolFee = totalRepayment.mul(protocolFeeRate).div(10000);


            // Log the fee for debugging
            console.log("Lender Protocol Fee:", lenderProtocolFee);
            console.log("Lender Protocol Fee:", ethers.utils.formatEther(lenderProtocolFee));
    
            // Inform the user about the protocol fee required
            if (
                !window.confirm(
                    `To claim the defaulted collateral, you will pay a protocol fee of ${ethers.utils.formatEther(
                        lenderProtocolFee
                    )} $CORE. Proceed?`
                )
            ) {
                return;
            }
    
            // Execute the claim transaction
            const tx = await contract.claimDefaultedLoan(loanId, { value: lenderProtocolFee });
            await tx.wait();
    
            fetchLoans();
        } catch (error) {
            console.error("Error claiming defaulted loan:", error);
        }
    };

    const handlePlaceBid = async (loanId: number) => {
        try {
            if (!signer) return;
    
            const contract = getContract(signer);
    
            // Fetch the loan details to get the currentInterestRate
            const loan = await contract.loans(loanId);
    
            const currentInterestRate = Number(loan.currentInterestRate); // In bps
    
            // Calculate the new bid amount (1% lower, subtract 100 bps)
            const bidAmount = currentInterestRate - 100;
    
            if (bidAmount <= 0) {
                alert("Cannot place a bid lower than 0 bps.");
                return;
            }
    
            console.log(`Placing bid with interest rate: ${bidAmount / 100}%`);
    
            // Place the bid with the calculated bidAmount
            const tx = await contract.placeBid(loanId, bidAmount, {
                value: ethers.utils.parseEther(ethers.utils.formatEther(loan.loanAmount)),
            });
    
            await tx.wait();
    
            fetchLoans();
        } catch (error) {
            console.error("Error placing bid:", error);
        }
    };
    

    const handleCancelBid = async (loanId: number) => {
        try {
            if (!signer) return;
    
            const contract = getContract(signer);
    
            // Call the cancelBid function
            const tx = await contract.cancelBid(loanId);
            await tx.wait();
    
            console.log(`Bid for Loan ${loanId} successfully canceled`);
            fetchLoans();
        } catch (error) {
            console.error("Error canceling bid:", error);
        }
    };
    
    const handleWithdrawFunds = async () => {
        try {
            if (!signer) return;

            const contract = getContract(signer);
            const tx = await contract.withdrawFunds(walletAddress);
            await tx.wait();

            alert("Funds withdrawn successfully!");
            fetchPendingWithdrawals();
        } catch (error) {
            console.error("Error withdrawing funds:", error);
        }
    };


    return (
        <Container>
            <Typography variant="h4" gutterBottom>
                NFT Lend Auction
            </Typography>

            {!walletAddress ? (
                <Button variant="contained" onClick={connectWallet}>
                    Connect Wallet
                </Button>
            ) : (
                <Box>
                    <Typography>Wallet Connected: {walletAddress}</Typography>
                    <Button variant="outlined" color="error" onClick={disconnectWallet} sx={{ marginTop: 2 }}>
                    Disconnect Wallet
                    </Button>
                </Box>
            )}


            {walletAddress && (
                <Box sx={{ marginTop: 4 }}>
                    <Typography variant="h5">Pending Withdrawals</Typography>
                    <Card sx={{ marginBottom: 2 }}>
                        <CardContent>
                            <Typography>
                                Pending Amount: {pendingWithdrawals} $CORE
                            </Typography>
                        </CardContent>
                        <CardActions>
                            <Button
                                variant="contained"
                                color="primary"
                                disabled={parseFloat(pendingWithdrawals) === 0}
                                onClick={handleWithdrawFunds}
                            >
                                Withdraw Funds
                            </Button>
                        </CardActions>
                    </Card>
                </Box>
            )}

            <Button variant="contained" onClick={() => setOpenModal(true)} sx={{ marginTop: 2 }}>
                List New Loan
            </Button>

            <Modal open={openModal} onClose={() => setOpenModal(false)}>
                <Box sx={{ padding: 4, backgroundColor: "white", margin: "auto", maxWidth: 400 }}>
                    <Typography variant="h6">List a New Loan</Typography>
                    <TextField
                        fullWidth
                        label="NFT Address"
                        margin="normal"
                        value={newLoan.nftAddress}
                        onChange={(e) => setNewLoan({ ...newLoan, nftAddress: e.target.value })}
                    />
                    <TextField
                        fullWidth
                        label="Token ID"
                        margin="normal"
                        value={newLoan.tokenId}
                        onChange={(e) => setNewLoan({ ...newLoan, tokenId: e.target.value })}
                    />
                    <TextField
                        fullWidth
                        label="Loan Amount ($CORE)"
                        margin="normal"
                        value={newLoan.loanAmount}
                        onChange={(e) => setNewLoan({ ...newLoan, loanAmount: e.target.value })}
                    />
                    <TextField
                        fullWidth
                        label="Max Interest Rate (%)"
                        margin="normal"
                        value={newLoan.maxInterestRate}
                        onChange={(e) => setNewLoan({ ...newLoan, maxInterestRate: e.target.value })}
                    />
                    <TextField label="Loan Type (0=Fixed, 1=APR)" value={newLoan.loanType} onChange={(e) => setNewLoan({ ...newLoan, loanType: e.target.value })} />
                    <TextField
                        fullWidth
                        label="Term Duration (days)"
                        margin="normal"
                        value={newLoan.durationDays}
                        onChange={(e) => setNewLoan({ ...newLoan, durationDays: e.target.value })}
                    />
                    <Button variant="contained" onClick={handleListLoan} sx={{ marginTop: 2 }}>
                        Submit
                    </Button>
                </Box>
            </Modal>

            <Box sx={{ marginTop: 4 }}>
                {loans.map((loan) => (
                    <Card key={loan.id} sx={{ marginBottom: 2 }}>
                        <CardContent>
                            <Typography>Loan ID: {loan.id}</Typography>
                            <Typography>NFT Contract: {loan.nftAddress}</Typography>
                            <Typography>Token ID: {loan.tokenId}</Typography>
                            <Typography>Borrower: {loan.borrower}</Typography>
                            <Typography>Lender: {loan.lender || "None"}</Typography>
                            <Typography>Loan Amount: {loan.loanAmount} $CORE</Typography>
                            <Typography>Max Interest Rate: {loan.maxInterestRate}%</Typography>
                            <Typography>Loan Type: {loan.loanType}</Typography>
                            <Typography>Current Interest Rate: {loan.currentInterestRate}%</Typography>
                            <Typography>Duration: {loan.duration} days</Typography>
                            <Typography>Start Time: {loan.startTime}</Typography>
                            <Typography>End Time: {loan.endTime}</Typography>
                            <Typography>Status: {loan.isAccepted ? "Accepted" : "Pending"}</Typography>
                        </CardContent>
                        <CardActions>
                            {loan.borrower.toLowerCase() === walletAddress?.toLowerCase() && !loan.isAccepted && (
                                <Button variant="contained" color="error" onClick={() => handleDelistLoan(loan.id)}>
                                    Delist Loan
                                </Button>
                            )}

                            {/* Show "Accept Loan" button for loans owned by the user with bids */}
                            {loan.borrower.toLowerCase() === walletAddress?.toLowerCase() && !loan.isAccepted && loan.lender && (
                                <Button variant="contained" onClick={() => handleAcceptLoan(loan.id)}>
                                    Accept Loan
                                </Button>
                            )}
                            {/* Show "Repay Loan" button for accepted loans owned by the user */}
                            {loan.borrower.toLowerCase() === walletAddress?.toLowerCase() && loan.isAccepted && (
                                <Button variant="contained" onClick={() => handleRepayLoan(loan.id)}>
                                    Repay Loan
                                </Button>
                            )}
                            {/* Show "Place Bid" button for loans not owned by the user and not yet accepted */}
                            {loan.borrower.toLowerCase() !== walletAddress?.toLowerCase() && !loan.isAccepted && (
                                <Tooltip title="Bid with a 1% lower interest rate than the current rate.">
                                    <Button
                                        variant="contained"
                                        onClick={() => handlePlaceBid(loan.id)}
                                    >
                                        Bid 1% Less Rate
                                    </Button>
                                </Tooltip>
                            )}
                            {loan.lender.toLowerCase() === walletAddress?.toLowerCase() && !loan.isAccepted && (
                                <Button variant="outlined" color="error" onClick={() => handleCancelBid(loan.id)}>
                                    Cancel Bid
                                </Button>
                            )}
                            {loan.lender.toLowerCase() === walletAddress?.toLowerCase() && loan.isAccepted && (
                                <Button variant="outlined" color="error" onClick={() => handleClaimDefaultedLoan(loan.id)}>
                                    Claim Defaulted
                                </Button>
                            )}
                        </CardActions>
                    </Card>
                ))}
            </Box>

        </Container>
    );
}
