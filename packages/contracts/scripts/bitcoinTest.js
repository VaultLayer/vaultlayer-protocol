const { ethers } = require("ethers");
const bitcoin = require("bitcoinjs-lib");

function calculateTxId(tx) {
    // Perform the first SHA-256 hash
    const inputHash1 = ethers.utils.sha256('0x'+tx);

    // Perform abi.encodePacked
    const packed = ethers.utils.concat([inputHash1]); // Concatenates input bytes

    // Compute SHA-256 hash
    const inputHash2 = ethers.utils.sha256(packed);
    // Return the final hash
    return inputHash2;
}


// Example: Full raw Bitcoin transaction (including witness data)
const rawTx =
    "020000000001025c3190fe579bc48f41caac8aef2f68334341ff531909fd4817be3e52a022e7ca0100000000feffffff64cb4a4447e0bef3d3029c4d2abfd28b4961c8eff08af41b5b43afed21ccaee80000000000feffffff03404b4c00000000002200203087124dc197dbc0d4787bd3682223b966dd842896be6776f0504c8a67d1dd1d0000000000000000536a4c505341542b01045cd6eef6a4ceb9270776d6b388cfaba62f5bc3357fa21cbd3caa4fe89bccd1d716c92ce4533e4d47330004178c8667b17576a914332046df873f53e867a3e76f75b2a2f37f013f2f88ac7554100000000000160014332046df873f53e867a3e76f75b2a2f37f013f2f02483045022100b050819656dfbe730f82eef422635db3219311fb550e2dd8d3c53337832c0fb0022009f841f41f9d1a6831b3a84bd30866b85b7fa167fb71fcf24ab2be200acce0310121032db951d5a638c52b729882f52e3c86131f0a191b3f318e69f1707aa97763a94902483045022100853e844f57d8b054f732bcb7badca1016febf49236cc8711c8ce8097db9c4f630220500c8db61977581d9e9de2abdee96d88992411d5253e9f79f89955b1af8ff7240121032db951d5a638c52b729882f52e3c86131f0a191b3f318e69f1707aa97763a94900000000";

// Decode the raw transaction
const tx = bitcoin.Transaction.fromHex(rawTx);

// Manually create a non-SegWit version (legacy format)
const txClone = new bitcoin.Transaction();
txClone.version = tx.version; // Copy version

// Add inputs
tx.ins.forEach(input => {
  txClone.addInput(input.hash, input.index, input.sequence, Buffer.alloc(0)); // Empty scriptSig
});

// Add outputs
tx.outs.forEach(output => {
  txClone.addOutput(output.script, output.value);
});

// Serialize without SegWit marker/flag
const btcTx = txClone.toHex(); // Fully legacy serialization

console.log("btcTx:", btcTx);

console.log('expected:', btcTx === "02000000025c3190fe579bc48f41caac8aef2f68334341ff531909fd4817be3e52a022e7ca0100000000feffffff64cb4a4447e0bef3d3029c4d2abfd28b4961c8eff08af41b5b43afed21ccaee80000000000feffffff03404b4c00000000002200203087124dc197dbc0d4787bd3682223b966dd842896be6776f0504c8a67d1dd1d0000000000000000536a4c505341542b01045cd6eef6a4ceb9270776d6b388cfaba62f5bc3357fa21cbd3caa4fe89bccd1d716c92ce4533e4d47330004178c8667b17576a914332046df873f53e867a3e76f75b2a2f37f013f2f88ac7554100000000000160014332046df873f53e867a3e76f75b2a2f37f013f2f00000000")

// Example usage
//const tx = ; // Replace with your input bytes
const txId = calculateTxId(btcTx);
console.log("Transaction ID:", txId);


// Redeem Script (replace with your actual script)
const redeemScriptHex = "04178c8667b17576a914332046df873f53e867a3e76f75b2a2f37f013f2f88ac";
const redeemScript = Buffer.from(redeemScriptHex, 'hex');

// Parse redeem script
const scriptChunks = bitcoin.script.decompile(redeemScript);
console.log("Script Chunks:", scriptChunks);

let timelock, pubKey, pubKeyHash, address;

// Extract timelock (first 4 bytes in little-endian)
if (scriptChunks[0].length === 4) {
    timelock = scriptChunks[0].readUInt32LE(0); // Little-endian to big-endian
    const readableDate = new Date(timelock * 1000).toUTCString(); // Convert to human-readable date
    console.log("Timelock (Unix):", timelock);
    console.log("Timelock (UTC):", readableDate); // Print human-readable date
}

// Detect script type
if (scriptChunks[4] === bitcoin.opcodes.OP_HASH160) {
    // P2PKH-style script
    console.log("Script Type: P2PKH with timelock");

    // Extract public key hash (20 bytes)
    pubKeyHash = scriptChunks[5].toString('hex');
    console.log("Public Key Hash:", pubKeyHash);

    // Generate Bitcoin address from public key hash
    const { address } = bitcoin.payments.p2wpkh({ hash: Buffer.from(pubKeyHash, 'hex'), network: bitcoin.networks.bitcoin });
    const { address: testAddress } = bitcoin.payments.p2wpkh({ hash: Buffer.from(pubKeyHash, 'hex'), network: bitcoin.networks.testnet });
    console.log("Bitcoin Address:", address);
    console.log("Testnet Address:", testAddress);

} else if (scriptChunks[4] === bitcoin.opcodes.OP_CHECKSIG) {
    // P2PK-style script
    console.log("Script Type: P2PK with timelock");

    // Extract public key (33 bytes compressed)
    pubKey = scriptChunks[3].toString('hex');
    console.log("Public Key:", pubKey);

    // Generate Bitcoin address from public key
    const { address } = bitcoin.payments.p2wpkh({ pubkey: Buffer.from(pubKey, 'hex') });
    const { address: testAddress } = bitcoin.payments.p2wpkh({ pubkey: Buffer.from(pubKey, 'hex'), network: bitcoin.networks.testnet });
    console.log("Bitcoin Address:", address);
    console.log("Testnet Address:", testAddress);
}
