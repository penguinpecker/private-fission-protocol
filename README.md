# Private Fission Protocol

A confidential Pendle-style yield market on Arbitrum Sepolia. Users deposit USDC into the protocol's Aave-backed yield adapter and receive encrypted SY in return; SY can be split into encrypted PT (principal) and YT (yield), traded through a confidential AMM with Uniswap-V2 fees plus encrypted slippage, and redeemed at maturity — all with balances, fills, swap amounts, and LP shares stored as Nox handles on-chain. The adapter custodies the aUSDC and batches actual Aave deposits via a permissionless `rebalance()` so individual mints are unlinkable from Aave events.

> Submitted to the [iExec Vibe Coding Challenge](https://dorahacks.io/) — built on iExec Nox + Confidential Tokens, vibe-coded with Claude Code.

## Live deployment

| | Address (Arbitrum Sepolia, chainId 421614) |
|---|---|
| **dApp** | https://private-fission-protocol.vercel.app/ |
| Market | [`0x32AFc6748E3752f73b68619667dC2624e098c26F`](https://sepolia.arbiscan.io/address/0x32AFc6748E3752f73b68619667dC2624e098c26F) |
| Vault | [`0x4Da1AF0Fe50492EbD85010A096f7e3aDEe6B5412`](https://sepolia.arbiscan.io/address/0x4Da1AF0Fe50492EbD85010A096f7e3aDEe6B5412) |
| Adapter | [`0x5336e0d969cBE43c19981AC88613fCF7AE4a86D1`](https://sepolia.arbiscan.io/address/0x5336e0d969cBE43c19981AC88613fCF7AE4a86D1) |
| Factory | [`0x07dAF75612Dea30B9941EA3241fe6b6792c5d0e9`](https://sepolia.arbiscan.io/address/0x07dAF75612Dea30B9941EA3241fe6b6792c5d0e9) |
| USDC (test) | [`0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`](https://sepolia.arbiscan.io/token/0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d) — get test USDC at [faucet.circle.com](https://faucet.circle.com/) |

All four contracts are verified on Arbiscan.

## Project docs

- [SUBMISSION.md](./SUBMISSION.md) — hackathon submission checklist + 4-minute demo script + X post template
- [feedback.md](./feedback.md) — concrete feedback on iExec Nox tooling and SDK ergonomics
- [PRIVACY_AUDIT.md](./PRIVACY_AUDIT.md) — frontend leak audit (no console logs, no analytics, no third-party fetches; localStorage scope documented)

## Run Locally

```bash
npm install
npm run dev -- --port 3000
```

Open `http://127.0.0.1:3000/`.

## Product Flow

- Public homepage explains confidential SY/PT/YT markets.
- Connect unlocks the sidebar; market owner sees an extra Admin tab.
- Aave USDC 30D market shows PT, YT, and PT + YT strategies.
- Strategy pages: encrypted swap ticket with slippage, LP add/remove, post-maturity redemption (PT 1:1, YT pro-rata yield, SY → USDC).
- Wrong-network banner with one-click switch to Arbitrum Sepolia.
- All entry points have an EIP-712 relayed variant (toggle in the privacy modal).

## Contracts (`contracts/`)

- **`FissionMarket.sol`** — main entry point. Wraps every confidential action (`mintSY`, `fission`, `combine`, `redeemPT`, `requestSYRedeem`/`settleSYRedeem`, `redeemYTToSY`, the four AMM routes, `addLiquiditySYPT`/`removeLiquiditySYPT`, `addLiquiditySYYT`/`removeLiquiditySYYT`) with an EIP-712 relayed variant. Constructor takes a `MarketConfig` struct so the same code can target different yield sources / underlyings.
- **`FissionPositionVault.sol`** — single confidential vault holding SY, PT, YT, LP-SY-PT, LP-SY-YT under one address. Custom `_update` suppresses the standard ERC-7984 `ConfidentialTransfer` event for privacy.
- **`AaveUSDCYieldAdapter.sol`** — generic Aave V3 single-asset adapter. Constructor takes `(market, usdc, aUsdc, pool)` so the addresses aren't hardcoded.
- **`FissionMarketFactory.sol`** — owner-only registry of deployed markets. The market's full creation bytecode exceeds 24KB so the factory is a registry, not a deployer.
- **`FissionAddresses.sol`** — pinned Nox + Arbitrum Sepolia constants used by the deploy script.

Compile:

```bash
npm run compile
```

## Deployment

`.env` values are copied from `.env.example`. `.env`, build artifacts, caches, broadcasts, and generated deployment files are ignored by git.

```bash
npm run deploy:arbitrum-sepolia          # Deploys market + vault + adapter + factory; registers market.
npm run verify:arbitrum-sepolia          # Verifies all four on Arbiscan.
npm run add:amm-liquidity -- sy 250000   # Owner-only AMM top-up (encrypted).
```

Users need Arbitrum Sepolia USDC in their wallet before minting SY: `mintSY` transfers real USDC into the Aave-backed adapter before confidential SY is minted.

## Confidential AMM

- Uniswap V2 constant-product on encrypted reserves.
- 30 bps fee retained in reserves; LP shares accrue swap fees implicitly.
- Caller passes `encryptedMinAmountOut`. Below the minimum: zero out, input refunded — both branches are encrypted no-ops so observers cannot tell which path ran.
- Two pools: SY/PT and SY/YT, each with its own LP token (kinds 3 and 4 in the vault).
- Initial LP supply equal to SY seed amount, locked to the market — captures seed-time backing while diluting correctly on new deposits.
- `addLiquiditySYPT` / `addLiquiditySYYT` accept any ratio: contract mints LP proportional to the limiting side and refunds the over-supplied side.

## Maturity & Redemption

- Pre-maturity, `notMatured`-gated entry points: `mintSY`, `fission`, all four swap routes, `addLiquidity*`, `removeLiquidity*`.
- `combine` (PT + YT → SY) stays open both pre- and post-maturity.
- **PT redemption** (post-maturity): `redeemPT(handle, proof)` burns encrypted PT 1:1 for SY.
- **SY → USDC redemption** (any time): two-step with anonymized state. `requestSYRedeem(clearUsdc, commit)` burns the equivalent encrypted SY and stakes the burned-amount handle for public decryption. The on-chain request stores `commit = keccak256(recipient, salt)` instead of the recipient address, plus the encrypted handle — no cleartext amount in storage. `settleSYRedeem(id, recipient, salt, proof)` is gated by a 5-minute `REDEEM_MIN_DELAY`, validates the commit, decrypts the burned amount, decrements `principalDeposited`, and withdraws USDC from the adapter (paying out of the float buffer when possible).
- **YT yield claim** (post-maturity, post-snapshot): `snapshotMaturity()` locks `maturityYieldUsdc = aaveBalance - principalDeposited`, folds it into `principalDeposited`, and locks the encrypted user-held YT supply. `redeemYTToSY(handle, proof)` burns user's YT and **mints encrypted SY** equal to their pro-rata yield share — no public decryption, no cleartext per-claim payout. The user later exits via the standard SY → USDC bucket path.
- Yield buffer guard: `harvestAaveYield` reserves `principalDeposited` (which now includes folded yield post-snapshot) so an admin sweep cannot dip into either user principal or unclaimed YT yield.

## Privacy Layers

1. **Uniform action events.** Fission, combine, redeemPT, all four AMM routes, LP add/remove emit a single event signature with two opaque handles and no indexed topics. The standard ERC-7984 `ConfidentialTransfer` event is suppressed by the vault.
2. **Single vault address.** SY, PT, YT, LP-SY-PT, LP-SY-YT all live in one contract — observers can't filter by leg via contract address.
3. **Trimmed Nox ACL surface.** Internal allows are pruned to only what's strictly needed; the public allow-graph carries fewer "X can decrypt Y" entries per action.
4. **Fixed-denomination entry/exit.** `mintSY` and `requestSYRedeem` accept only `{1, 10, 100, 1000, 10000}` USDC, replacing the exact-amount fingerprint with a five-bucket anonymity set. The 1 USDC bucket exists so YT-routed yield (which can be small) can exit via the same anonymity-set path.
5. **EIP-712 meta-transactions.** Every confidential entry point has a `relayed*` variant; `_fromExternalAs` rebinds the Nox proof to the actor so a relayer can submit on behalf of the signer.
6. **Aave float buffer.** The yield adapter parks USDC in a float and only batches deposits/withdrawals to Aave via a permissionless `rebalance()`. Aave `Supply`/`Withdraw` events are no longer 1:1 with user mints/redeems.
7. **Anonymized redeem requests.** `RedeemRequest` storage holds a `keccak256(recipient, salt)` commit and an encrypted amount handle — no recipient address, no cleartext amount. `settleSYRedeem` requires the salt+recipient (kept off-chain) and is gated by a 5-minute `REDEEM_MIN_DELAY` to break tx-timing correlation.
8. **Encrypted YT yield distribution.** `redeemYTToSY` mints encrypted SY equal to the user's pro-rata yield share without any public decryption. Yield exits blend with principal exits in the bucket anonymity set.

### Known limits

- The cleartext-USDC bridge boundary is fundamental: bucket sizes leak by design, and aggregate USDC in/out of the adapter address remains public. Per-user linkage to Aave is broken; per-bucket counts are not.
- `settleSYRedeem` publicly decrypts the burned SY amount (so the contract knows how much USDC to release). The amount is therefore visible in the adapter's USDC ERC-20 transfer, just not before settle and not paired with the original requester address (recipient is supplied at settle time).
- Nox itself sees who decrypts what handles — privacy depends on the iExec Nox network's TEE attestation model.
- Per-action gas cost still varies by path. Timing/gas analysis can fingerprint action types even with uniform events. Padding to equalise needs measurement against the deployed Nox precompile and is left as future work.
- The relay UI signs and submits with the same wallet by default. Full meta-tx privacy benefit requires a separate relayer wallet.

## Tests

```bash
npx hardhat test test/FissionMarket.test.js
```

Covers access control, denominations, maturity gates, EIP-712 happy/replay/wrong-actor paths, redeem state machine, yield buffer guards, snapshot bookkeeping, multi-market registry, LP add/remove gating. The test rig installs mock NoxCompute / Aave / USDC contracts at the pinned addresses via `hardhat_setCode` so contract logic runs end-to-end on a local EDR network without the real precompile.

## Frontend (`src/`)

- **`addresses.js`** — chain + contract addresses.
- **`abis.js`** — minimal ABI surface for the market, vault, factory, and ERC-20.
- **`fissionApi.js`** — wallet/clients, Nox encryption, all read/write helpers, EIP-712 `signRelayed*` / `submitRelayed*` pairs, admin helpers (`adminAddAmmLiquidity`, `adminHarvestAaveYield`).
- **`main.js`** — single-file vanilla Vite app. Modal-driven flows; admin sidebar tab unlocks for `market.owner()`.

## Etherscan verification

After deploy, populate `ETHERSCAN_API_KEY` in `.env` and run:

```bash
npm run verify:arbitrum-sepolia
```

Hits the Etherscan v2 unified API (`chainid=421614`) and verifies the Market, the FissionPositionVault, the Aave adapter, and the FissionMarketFactory using the standard JSON input from `artifacts/build-info`.
