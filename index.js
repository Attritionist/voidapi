const express = require('express');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const cache = require('memory-cache');
const { ethers } = require('ethers');
const app = express();
const port = 3000;

const BASESCAN_API_KEY = process.env["BASESCAN_API_KEY"];
const MAX_SUPPLY = 100000000; // Set your actual max supply here
const BURN_WALLET = '0x0000000000000000000000000000000000000000';
const VOID_CONTRACT_ADDRESS = '0x21eceaf3bf88ef0797e3927d855ca5bb569a47fc';
const LIQUIDITY_POOL_ADDRESSES = [
    '0xb14e941d34d61ae251ccc08ac15b8455ae9f60a5',
    '0x53a1d9ad828d2ac5f67007738cc5688a753241ba',
    '0xa2b01d461b811096eab039f0283655326440e78f',
    '0x263ea0a3cf3845fc52a30c6e81dbd985b7290fbf',
    '0xf6820b05e43a8ac09d82d57d583837c243c81d35',
    '0xA0ecC6ef7C4e6aE8fC61c0B4daD2Ec86c20f7f86',
    '0x15539e7fe9842a53c6fd578345e15ccca80aa253',
    '0x0abf279c2313a1ceb175ad0094a117f27a350aad',
    '0xe5fe953ca480d0a7b22ed664a7370a36038c13ae',
    '0xf2de7d73e8e56822afdf19fd08d999c78abd933b',
    '0x1f43031a6294b9c2219887c9e9f5b3671433df3c',
    '0x7377ff4f6ac21c1be5d943482b3c439d080f65c1',
    '0x39f0c947fcea3ca8aa6b9eaa9045a95709b6f59a',
    '0xA6d470b00963c0c082E93c3E985D287e677A9477',
    '0xEd8a52E5B3A244Cad7cd03dd1Cc2a0cfC1281148',
];
// Constants for YANG contract
const YANG_ADDRESS = '0x384C9c33737121c4499C85D815eA57D1291875Ab';
const YIN_ADDRESS = '0xeCb36fF12cbe4710E9Be2411de46E6C180a4807f';
const YANG_INITIAL_SUPPLY = 2500000; // 2.5 million
const YANG_ABI = [
  "function getCurrentHour() public view returns (uint256)",
  "function getBlockData(uint256 _hour) public view returns (uint256 _yangPrice, uint256 _growthRate, uint256 _change, uint256 _created)",
  "function totalSupply() public view returns (uint256)",
  "function getCurrentPrice() public view returns (uint256)"
];
const YIN_ABI = [
  "function totalSupply() public view returns (uint256)"
];
const BASE_RPC_URL = 'https://mainnet.base.org';
const BASESCAN_API_URL = (address) => `https://api.basescan.org/api?module=account&action=tokenbalance&contractaddress=${VOID_CONTRACT_ADDRESS}&address=${address}&tag=latest&apikey=${BASESCAN_API_KEY}`;
const provider = new ethers.JsonRpcProvider(BASE_RPC_URL);
const yangContract = new ethers.Contract(YANG_ADDRESS, YANG_ABI, provider);
const yinContract = new ethers.Contract(YIN_ADDRESS, YIN_ABI, provider);

const limiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 20000 // limit each IP to 20000 requests per windowMs
});

// Apply the rate limiting middleware to all requests
app.use(limiter);

// Helper function to fetch token data from Basescan
async function getTokenData(contractAddress) {
  const response = await axios.get(BASESCAN_API_URL, {
    params: {
      module: 'stats',
      action: 'tokensupply',
      contractaddress: contractAddress,
      apikey: BASESCAN_API_KEY
    }
  });
  return ethers.formatUnits(response.data.result, 8); // Assuming 8 decimals for both tokens
}

app.get('/api/circulating-supply', async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    const cachedResponse = cache.get('circulatingSupply');
    if (cachedResponse) {
        return res.json(cachedResponse);
    }
    try {
        const response = await axios.get(BASESCAN_API_URL(BURN_WALLET));
        const burnedTokens = parseInt(response.data.result) / 1e18; // Adjust this based on the token's decimals
        const circulatingSupply = MAX_SUPPLY - burnedTokens;
        const cacheDuration = 20 * 60 * 1000; // Cache for 20 minutes
        cache.put('circulatingSupply', { circulatingSupply }, cacheDuration);
        res.json({ circulatingSupply });
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
});

app.get('/api/pool-supply', async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    const cachedResponse = cache.get('poolSupply');
    if (cachedResponse) {
        return res.json(cachedResponse);
    }
    try {
        const delay = 500
        let poolSupply = 0;

        for (const address of LIQUIDITY_POOL_ADDRESSES) {
            const response = await axios.get(BASESCAN_API_URL(address));
            const tokenBalance = parseInt(response.data.result);
            console.log(`Liquidity Pool Address: ${address}, Token Balance: ${tokenBalance}`);
            poolSupply += tokenBalance;
            await new Promise(resolve => setTimeout(resolve, delay));
        }

        poolSupply /= 1e18; // Adjust this based on the token's decimals
        const cacheDuration = 5 * 60 * 1000; // Cache for 5 minutes
        cache.put('poolSupply', { poolSupply }, cacheDuration);
        res.json({ poolSupply });
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
});

app.get('/api/yang-data', async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    const cachedResponse = cache.get('yangData');
    if (cachedResponse) {
        return res.json(cachedResponse);
    }
    try {
        const currentHour = await yangContract.getCurrentHour();
        const blockData = await yangContract.getBlockData(currentHour);
        const totalSupply = await yangContract.totalSupply();

        const circulatingSupply = ethers.formatUnits(totalSupply, 8);
        const burnedAmount = YANG_INITIAL_SUPPLY - parseFloat(circulatingSupply);

        const yangData = {
            yangPrice: ethers.formatUnits(blockData._yangPrice, 8),
            growthRate: ethers.formatUnits(blockData._growthRate, 4),
            currentHour: currentHour.toString(),
            circulatingSupply,
            burnedAmount: burnedAmount.toFixed(8)
        };

        const cacheDuration = 1 * 60 * 1000; // Cache for 1 minute
        cache.put('yangData', yangData, cacheDuration);

        res.json(yangData);
    } catch (error) {
        console.error('Error fetching YANG data:', error);
        res.status(500).json({ error: 'Failed to fetch YANG data', details: error.message });
    }
});

app.get('/api/yin-circulating-supply', async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    const cachedResponse = cache.get('yinData');
    if (cachedResponse) {
        return res.json(cachedResponse);
    }
    try {
        const totalSupply = await yinContract.totalSupply();
        const circulatingSupply = ethers.formatUnits(totalSupply, 8);

        const yinData = {
            circulatingSupply
        };

        const cacheDuration = 5 * 60 * 1000; // Cache for 5 minutes
        cache.put('yinData', yinData, cacheDuration);

        res.json(yinData);
    } catch (error) {
        console.error('Error fetching YIN data:', error);
        res.status(500).json({ error: 'Failed to fetch YIN data', details: error.message });
    }
});

// New function to get YIN total supply based on YANG data
async function getYinTotalSupply() {
  const cachedData = cache.get('yinTotalSupply');
  if (cachedData) {
    return cachedData;
  }

  try {
    const [currentPrice, totalSupply] = await Promise.all([
      yangContract.getCurrentPrice(),
      yangContract.totalSupply()
    ]);

    const yangToYinRatio = ethers.formatUnits(currentPrice, 8);
    const yangCirculatingSupply = ethers.formatUnits(totalSupply, 8);
    const yinTotalSupplyValue = parseFloat(yangCirculatingSupply) * parseFloat(yangToYinRatio);

    const result = yinTotalSupplyValue.toFixed(8);

    // Cache for 1 minute
    cache.put('yinTotalSupply', result, 60 * 1000);

    return result;
  } catch (error) {
    console.error('Error calculating YIN total supply:', error);
    throw error;
  }
}


app.get('/api/yin-total-supply', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  try {
    const yinTotalSupply = await getYinTotalSupply();
    res.json({ yinTotalSupply });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch YIN total supply', details: error.message });
  }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
