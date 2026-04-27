# Private Fission Protocol

Prototype frontend for Private Fission Protocol, a confidential Pendle-style yield market.

## Run Locally

```bash
npm install
npm run dev -- --port 3000
```

Open `http://127.0.0.1:3000/`.

## Product Flow

- Public homepage explains confidential SY/PT/YT markets.
- Connect unlocks the app sidebar and available markets.
- Aave USDC 30D market shows PT, YT, and PT + YT strategies.
- Strategy pages include charts and buy/swap/sell actions through the confidential AMM.
