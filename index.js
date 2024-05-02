const express = require('express');
const axios = require('axios');
const app = express();
const port = 3000;

const MAX_SUPPLY = 100000000; // Set your actual max supply here
const BURN_WALLET = '0x0000000000000000000000000000000000000000';
const VOID_CONTRACT_ADDRESS = '0x21eceaf3bf88ef0797e3927d855ca5bb569a47fc';
const BASESCAN_API_KEY = '8PDS3RB8W8AZFMEICBADAYRXD4VMJX5MJJ'; // Replace with your BaseScan API key
const BASESCAN_API_URL = `https://api.basescan.org/api?module=account&action=tokenbalance&contractaddress=${VOID_CONTRACT_ADDRESS}&address=${BURN_WALLET}&tag=latest&apikey=${BASESCAN_API_KEY}`;

app.get('/api/circulating-supply', async (req, res) => {
    try {
        const response = await axios.get(BASESCAN_API_URL);
        const burnedTokens = parseInt(response.data.result) / 1e18; // Adjust this based on the token's decimals
        const circulatingSupply = MAX_SUPPLY - burnedTokens;
        res.json({ circulatingSupply: circulatingSupply });
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
