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
'0x2e7c9dba25d80fcffd3ff950cc18c152996001af',
'0x02ab296dcf0797920132f8544d11528a61653c5a',
'0x7fe32fba24be9e76482cb593be991a4bfe364758',
'0x6476ceee6f2b7c0e6952039f5dc8a6cdc502365c',
'0xa4c0fa89cddd57c93a50385814df1b4cf25c70b3',
'0xa723ad20ff828d251a4634e9a395650b975fb2d5',
'0x1ff8b842e153b607db6eba7b1b9e0092ac3b4cac',
'0xa86b1992533eba267045a50bd72ca6f825a6ecd5',
'0xed327613adfe770eb233b679433c1ad04474b313',
'0x571466136742dde0bedc5aa3ad8fe62c7e5697c9',
'0x93e6e894c6d312d64368080b62b8b13b00408fd1',
'0x65010a20330bc4c36b77abbfbebb8c5b105f8057',
'0x8db1d8eb3c0fb95b827dce94745fb3f1e2c853d5',
'0x8ea0e42869ed008f3bee4daeb0ffec45daf13235',
'0x17e4d1c1e9fc9791fed7915bdc9478c87fc51a7d',
'0x13234df0d359fcedcebc3da35d6b0ca09678e5c2',
'0x1b97dcc48648299d764e5465fea5e76a56154b42',
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
const BASE_RPC_URL = 'https://base-mainnet.g.alchemy.com/v2/cMtAjQC4y6PRsNa9E4QNiwiAexSLvp7I';
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
        const delay = 750
        let poolSupply = 0;

        for (const address of LIQUIDITY_POOL_ADDRESSES) {
            const response = await axios.get(BASESCAN_API_URL(address));
            const tokenBalance = parseInt(response.data.result);
            console.log(`Liquidity Pool Address: ${address}, Token Balance: ${tokenBalance}`);
            poolSupply += tokenBalance;
            await new Promise(resolve => setTimeout(resolve, delay));
        }

        poolSupply /= 1e18; // Adjust this based on the token's decimals
        const cacheDuration = 30 * 60 * 1000; // Cache for 30 minutes
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

        const cacheDuration = 5 * 60 * 1000; // Cache for 5 minute
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

        const cacheDuration = 10 * 60 * 1000; // Cache for 10 minutes
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

    // Cache for 5 minute
    cache.put('yinTotalSupply', result, 5 * 60 * 1000);

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
