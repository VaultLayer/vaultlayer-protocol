require("@nomicfoundation/hardhat-toolbox");
require('@nomiclabs/hardhat-ethers');
require("dotenv").config();

/**
 * @type import('hardhat/config').HardhatUserConfig
 */

module.exports = {
   defaultNetwork: 'hardhat',

   networks: {
      hardhat: {
        chainId: 1337, // Local Hardhat network
        initialDate: "2023-07-01T00:00:00.000Z", // For our BTC staking tests
        accounts: {
          count: 10, // Number of accounts to generate
          accountsBalance: "10000000000000000000000" // Each account starts with 10,000 ETH
        },
      },
      core: {
         url: 'https://rpc.coredao.org',
         accounts: [process.env.PRIVATE_KEY],
         chainId: 1116,
      }
   },
   solidity: {
      compilers: [
        {
           version: '0.8.23',
           settings: {
              evmVersion: 'paris',
              optimizer: {
                 enabled: true,
                 runs: 200,
              },
           },
        },
      ],
   },
   etherscan: {
    apiKey: {
      core: process.env.SCAN_API_KEY,
    },
    customChains: [
      {
        network: "core",
        chainId: 1116,
        urls: {
          apiURL: "https://openapi.coredao.org/api",
          browserURL: "https://scan.coredao.org/"
        }
      },
    ],
  },
   paths: {
      sources: './src',
      cache: './cache',
      artifacts: './artifacts',
   },
   mocha: {
      timeout: 20000,
   },
};
