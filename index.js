const express = require('express');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const cache = require('memory-cache');
const app = express();
const port = 3000;
const BASESCAN_API_KEY = process.env["BASESCAN_API_KEY"];
const MAX_SUPPLY = 100000000; // Set your actual max supply here
const BURN_WALLET = '0x0000000000000000000000000000000000000000';
const VOID_CONTRACT_ADDRESS = '0x21eceaf3bf88ef0797e3927d855ca5bb569a47fc';
const LIQUIDITY_POOL_ADDRESSES = [
    '0xb14e941d34d61ae251ccc08ac15b8455ae9f60a5',
    '0xa79e45668972e13cdb6c9ed1debfc5b0d04cb0bd',
    '0x9858271D467e1786C5035618BFa30c18C7D4b215',
    '0x6d8b0d8825f8c8a885a2809fbf03983a9430f999',
    '0xa2b01d461b811096eab039f0283655326440e78f',
    '0x263ea0a3cf3845fc52a30c6e81dbd985b7290fbf',
    '0x15539e7fe9842a53c6fd578345e15ccca80aa253',
    '0x0abf279c2313a1ceb175ad0094a117f27a350aad',
    '0xe5fe953ca480d0a7b22ed664a7370a36038c13ae',
    '0xf2de7d73e8e56822afdf19fd08d999c78abd933b',
    '0x66fa42cfd1789aa7f87c1ef988bf04cb145c9465',
    '0x928be5748ea9d03925a3b5f85e3a5e2502cd7bcf',
    '0x1f43031a6294b9c2219887c9e9f5b3671433df3c',
    '0x7377ff4f6ac21c1be5d943482b3c439d080f65c1',
    '0x3c0f2679210c0bc074682ecb83b9e7d39411c478',
];

const BASESCAN_API_URL = (address) => `https://api.basescan.org/api?module=account&action=tokenbalance&contractaddress=${VOID_CONTRACT_ADDRESS}&address=${address}&tag=latest&apikey=${BASESCAN_API_KEY}`;

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 10 minutes
    max: 10000 // limit each IP to 10000 requests per windowMs
});

// Apply the rate limiting middleware to all requests
app.use(limiter);

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
        const cacheDuration = 30 * 60 * 1000; // Cache for 30 minutes
        cache.put('circulatingSupply', { circulatingSupply }, cacheDuration);3
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
        const cacheDuration = 15 * 60 * 1000; // Cache for 15 minutes
        cache.put('poolSupply', { poolSupply }, cacheDuration);
        res.json({ poolSupply });
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
