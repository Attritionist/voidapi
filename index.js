const express = require('express');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const cache = require('memory-cache');
const Queue = require('bull');
const app = express();
const port = 3000;
const BASESCAN_API_KEY = process.env["BASESCAN_API_KEY"];

const MAX_SUPPLY = 100000000; // Set your actual max supply here
const BURN_WALLET = '0x0000000000000000000000000000000000000000';
const VOID_CONTRACT_ADDRESS = '0x21eceaf3bf88ef0797e3927d855ca5bb569a47fc';
const BASESCAN_API_URL = `https://api.basescan.org/api?module=account&action=tokenbalance&contractaddress=${VOID_CONTRACT_ADDRESS}&address=${BURN_WALLET}&tag=latest&apikey=${BASESCAN_API_KEY}`;
const LIQUIDITY_POOLS = [
    // Add your liquidity pool contract addresses here
    '0xB14e941D34d61ae251Ccc08AC15B8455AE9F60A5',
    '0x6D8b0d8825F8C8a885a2809fbf03983A9430F999',
    '0x66FA42CfD1789AA7f87C1eF988bf04CB145c9465',
    '0xF2DE7d73e8e56822aFdF19FD08D999c78AbD933b',
    '0xa2b01D461B811096EAB039f0283655326440e78f',
    '0x1F43031a6294b9C2219887C9E9F5b3671433df3c',
    '0xe5fe953ca480d0a7b22ED664a7370A36038c13aE',
    '0x263Ea0A3cF3845Fc52a30c6E81DBd985B7290fBf',
    '0x9858271D467e1786C5035618BFa30c18C7D4b215',
    '0x7377FF4f6AC21C1Be5D943482B3c439d080f65c1',
    '0x62159Ad25141BCE7FD2973c0c2A388d695814A22',
    '0x15539E7FE9842a53c6fD578345E15cccA80aa253',
    '0x0abF279C2313A1CEB175ad0094A117F27A350AaD',
    '0xfc3696a5DC49A571a62Ef7164f9157ECF52b6ab2',
    '0x53a631150d7cbcC1d1C125c6C14369612C93C7b3',
    '0x22209e375160aB400c97C4684ff91B6320eE7D9D',
    '0x39f0c947fcea3Ca8AA6B9eaA9045a95709B6F59a',
    '0x90D5A12ae6f1E066737a131a89a636B56036d88b',
];
const limiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 15 minutes
    max: 10000 // limit each IP to 100 requests per windowMs
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
        const response = await axios.get(BASESCAN_API_URL);
        const burnedTokens = parseInt(response.data.result) / 1e18; // Adjust this based on the token's decimals
        const circulatingSupply = MAX_SUPPLY - burnedTokens;
        const cacheDuration = 30 * 60 * 1000; // Cache for 30 minutes
        cache.put('circulatingSupply', { circulatingSupply }, cacheDuration);
        res.json({ circulatingSupply });
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
});

// Queue for handling API requests
const poolQueue = new Queue('pool-supply-queue', {
    limiter: {
        max: 3,
        duration: 1000,
    },
    defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: true,
    },
});

// Fetch pool balances and cache the result
app.get('/api/pool-supply', async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');

    const cachedResponse = cache.get('poolSupply');
    if (cachedResponse) {
        return res.json(cachedResponse);
    }

    try {
        const poolBalances = await getPoolBalances();
        const totalPoolSupply = poolBalances.reduce((acc, balance) => acc + balance, 0);
        const cacheDuration = 30 * 60 * 1000; // Cache for 30 minutes
        cache.put('poolSupply', { totalPoolSupply }, cacheDuration);
        res.json({ totalPoolSupply });
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
});

async function getPoolBalances() {
    const poolBalancesPromises = LIQUIDITY_POOLS.map(poolAddress => 
        poolQueue.add({ poolAddress })
    );

    const poolBalancesResults = await Promise.all(poolBalancesPromises);
    return poolBalancesResults.map(job => job.returnvalue);
}

// Process queue jobs
poolQueue.process(3, async (job) => { // Process up to 3 jobs concurrently
    const { poolAddress } = job.data;
    const poolApiUrl = `https://api.basescan.org/api?module=account&action=tokenbalance&contractaddress=${VOID_CONTRACT_ADDRESS}&address=${poolAddress}&tag=latest&apikey=${BASESCAN_API_KEY}`;
    const response = await axios.get(poolApiUrl);
    return parseInt(response.data.result) / 1e18; // Correctly handle token decimals
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
