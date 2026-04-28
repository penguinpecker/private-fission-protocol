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
- Strategy pages include charts and buy/sell actions through the confidential AMM.
- USDC redemption is a two-step async flow (burn SY, then settle once Nox attests).
- Post-maturity, PT redeems 1:1 for confidential SY.

## Contracts

The contract prototype is under `contracts/`.

- `FissionMarket.sol`: SY mint, SY/USDC two-step redeem, fission/combine, post-maturity PT redeem, owner-only encrypted AMM liquidity top-ups, EIP-712 meta-tx variants of every confidential action, and confidential AMM swaps with a 30 bps fee plus encrypted slippage guard.
- `FissionPositionVault.sol`: single confidential vault holding SY, PT, and YT under one contract address; the standard ERC-7984 `ConfidentialTransfer` event is intentionally suppressed.
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

## Maturity & Redemption

- `mintSY`, `fission`, and all `swap*`/`sell*` routes revert after `maturity`.
- `combine` (PT + YT → SY) stays open.
- `redeemPT(externalEuint256, bytes)` opens at `block.timestamp >= maturity` and burns encrypted PT 1:1 for SY.
- `requestSYRedeem(uint256 clearUsdc)` burns the equivalent encrypted SY and stakes a `Nox.eq(transferred, requested)` handle for public attestation.
- `settleSYRedeem(uint256 id, bytes proof)` validates the Nox attestation; on success it withdraws `clearUsdc` USDC from Aave to the user. The redeemed USDC amount is intentionally public — converting back to a public asset reveals exit size.

## AMM Math

- Uniswap V2 constant product on encrypted reserves.
- 30 bps fee retained in the reserve as accrued LP yield.
- Caller passes `encryptedMinAmountOut`. If the encrypted fill falls below the minimum, the swap pays zero out and refunds the input — both branches are encrypted no-ops so on-chain observers cannot tell which path ran.
- AMM reserves are seeded by the constructor and topped up by `addAmmLiquidity` (owner-only, mints fresh confidential tokens). This is a prototype incentive model — there is no LP token and no externally-funded liquidity.

## Privacy Layers

Layered defenses stack on top of each other; later layers assume the earlier ones are in place.

1. **Uniform action events.** `fission`, `combine`, `redeemPT`, and all four AMM swap routes emit a single `ConfidentialAction(handleA, handleB)` event with no indexed topics. Observers cannot filter by user or route. The `from`/`to`/`amount`-indexed `ConfidentialTransfer` event of the underlying ERC-7984 tokens is suppressed entirely by the vault's custom `_update`, so per-leg activity logs no longer leak who moved what.
2. **Trimmed Nox ACL surface.** Each ERC-7984 mint/burn/transfer relies only on the allows that `_update` already grants. No redundant `Nox.allow` / `allowThis` calls are made — the public ACL graph carries fewer "X can decrypt Y" entries.
3. **Fixed-denomination entry/exit.** `mintSY` and `requestSYRedeem` accept only `{10, 100, 1000, 10000}` USDC. The cleartext-amount fingerprint that survives the encrypted balance system is replaced by a four-bucket anonymity set.
4. **EIP-712 meta-transactions.** Every confidential action and the redeem request also exposes a `relayed*` variant. The signer authorises off-chain; any third party submits the tx. `msg.sender` becomes the relayer, and the proof binding is rewritten to validate against the actor's address (`_fromExternalAs`) so the encrypted handle is consumable from a different submitter. Combined with layer (1), the on-chain trace no longer carries a per-user activity signal.

Limits:
- `requestSYRedeem` / `mintSY` reveal the cleartext denomination by design.
- The Aave deposit/withdraw side leaks USDC flows in/out of the adapter.
- Nox itself sees who decrypts what handles — privacy depends on the iExec Nox network's TEE attestation model.
- Per-action gas cost still varies by path (e.g. swap is heavier than fission). On-chain timing/gas analysis can fingerprint action types even with uniform events. Padding to equalise needs measurement against the deployed Nox precompile and is left as future work.

## Frontend API Bindings

Frontend contract bindings live in `src/lib/`.

- `addresses.js`: network, Aave, Nox, and Fission contract addresses.
- `abis.js`: minimal frontend ABI surface.
- `fissionApi.js`: wallet, Nox encryption, mint, fission, AMM swap, redeem, and confidential balance helpers, plus EIP-712 sign/submit helpers (`signRelayed*`, `submitRelayed*`) for relayed actions.

## Etherscan verification

After `npm run deploy:arbitrum-sepolia` finishes, populate `ETHERSCAN_API_KEY` in `.env` and run:

```bash
npm run verify:arbitrum-sepolia
```

The script hits the Etherscan v2 unified API (`chainid=421614`) and verifies the Market, the FissionPositionVault, and the Aave adapter using the standard JSON input from `artifacts/build-info`.
