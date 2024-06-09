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
    '0x6D8b0d8825F8C8a885a2809fbf03983A9430F999'
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
    settings: {
        maxStalledCount: 0, // Disable automatic retries on stalled jobs
    }
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
poolQueue.process(async (job) => { // Process up to 3 jobs concurrently
    const { poolAddress } = job.data;
    const poolApiUrl = `https://api.basescan.org/api?module=account&action=tokenbalance&contractaddress=${VOID_CONTRACT_ADDRESS}&address=${poolAddress}&tag=latest&apikey=${BASESCAN_API_KEY}`;
    try {
        const response = await axios.get(poolApiUrl);
        return parseFloat(response.data.result) / 1e18; // Correctly handle token decimals
    } catch (error) {
        throw new Error(`Failed to fetch data for pool address ${poolAddress}: ${error.message}`);
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
