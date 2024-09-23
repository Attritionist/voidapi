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
    '0xB14e941D34d61ae251Ccc08AC15B8455AE9F60A5',
    '0x4ddf7D913E218c2Ae6d13036793AD815d37Fac7E',
    '0x9858271D467e1786C5035618BFa30c18C7D4b215',
    '0x263Ea0A3cF3845Fc52a30c6E81DBd985B7290fBf',
    '0x1F43031a6294b9C2219887C9E9F5b3671433df3c',
    '0xA6d470b00963c0c082E93c3E985D287e677A9477',
    '0xF2DE7d73e8e56822aFdF19FD08D999c78AbD933b',
    '0xF6820B05E43a8aC09D82D57D583837C243C81d35',
    '0xAF3e0fc1ad6907f885e063E181C248983feE1459',
    '0x15539E7FE9842a53c6fD578345E15cccA80aa253',
    '0x66FA42CfD1789AA7f87C1eF988bf04CB145c9465',
    '0xa2b01D461B811096EAB039f0283655326440e78f',
    '0x0abF279C2313A1CEB175ad0094A117F27A350AaD',
    '0x7377FF4f6AC21C1Be5D943482B3c439d080f65c1',
    '0xe5fe953ca480d0a7b22ED664a7370A36038c13aE',
    '0xA0ecC6ef7C4e6aE8fC61c0B4daD2Ec86c20f7f86',
    '0x39f0c947fcea3Ca8AA6B9eaA9045a95709B6F59a',
    '0xEd8a52E5B3A244Cad7cd03dd1Cc2a0cfC1281148',
    '0xf83Fc6AA70cBcB221E22E77c1FE831259c6Cd68c',
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
        const cacheDuration = 30 * 60 * 1000; // Cache for 20 minutes
        cache.put('circulatingSupply', { circulatingSupply }, cacheDuration);
        res.json({ circulatingSupply });
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
});

app.get('/api/pool-supply', async (req, res) => { res.header('Access-Control-Allow-Origin', '*'); const cachedResponse = cache.get('poolSupply'); if (cachedResponse) { return res.json(cachedResponse); } try { const delay = 500 let poolSupply = 0;


    for (const address of LIQUIDITY_POOL_ADDRESSES) {
        const response = await axios.get(BASESCAN_API_URL(address));
        const tokenBalance = parseInt(response.data.result);
        console.log(Liquidity Pool Address: ${address}, Token Balance: ${tokenBalance});
        poolSupply += tokenBalance;
        await new Promise(resolve => setTimeout(resolve, delay));
    }

    poolSupply /= 1e18; // Adjust this based on the token's decimals
    const cacheDuration = 10 * 60 * 1000; // Cache for 5 minutes
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
