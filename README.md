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

## Contracts

The contract prototype is under `contracts/`.

- `FissionMarket.sol`: coordinates SY minting, SY -> PT + YT fission, recombination, owner-only encrypted AMM liquidity top-ups, and private AMM routes.
- `FissionPositionToken.sol`: ERC-7984 confidential token used for SY, PT, and YT balances.
- `AaveUSDCYieldAdapter.sol`: connects the market reserve to Aave V3 USDC on Arbitrum Sepolia.
- `FissionAddresses.sol`: pinned Nox and Aave Arbitrum Sepolia addresses.

Compile contracts:

```bash
npm run compile
```

Deployment uses `.env` values copied from `.env.example`. `.env`, build artifacts, caches, broadcasts, and generated deployment files are ignored by git.

Deploy and top up confidential AMM reserves:

```bash
npm run deploy:arbitrum-sepolia
npm run add:amm-liquidity -- sy 250000
npm run add:amm-liquidity -- pt 250000
npm run add:amm-liquidity -- yt 1000000
```

Users need Arbitrum Sepolia USDC in their wallet before minting SY, because `mintSY` transfers real USDC into the Aave-backed adapter before confidential SY is minted.

## Frontend API Bindings

Frontend contract bindings live in `src/lib/`.

- `addresses.js`: network, Aave, Nox, and Fission contract addresses.
- `abis.js`: minimal frontend ABI surface.
- `fissionApi.js`: wallet, Nox encryption, mint, fission, AMM swap, and confidential balance helpers.
