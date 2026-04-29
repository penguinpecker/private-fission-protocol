# Hackathon Submission — Private Fission Protocol

iExec Vibe Coding Challenge · DoraHacks · Submission deadline 2026-05-02 03:29 UTC.

## TL;DR

A confidential Pendle-style yield market on Arbitrum Sepolia, built on iExec Nox + Confidential Tokens (ERC-7984 primitives). Users deposit USDC into the protocol's Aave-backed yield adapter and receive encrypted SY; SY splits into encrypted PT (principal) and YT (yield), trades through a confidential AMM with encrypted slippage, and redeems at maturity — balances, fills, swap amounts, and LP shares all stored as Nox handles on-chain. The adapter custodies the aUSDC and batches actual Aave deposits, so individual user mints are unlinkable from Aave Supply events.

## Live links

- **dApp** (Vercel): https://private-fission-protocol.vercel.app/
- **GitHub**: https://github.com/penguinpecker/private-fission-protocol
- **Contract addresses** (Arbitrum Sepolia, all verified on Arbiscan):
  - Market `0x32AFc6748E3752f73b68619667dC2624e098c26F`
  - Vault `0x4Da1AF0Fe50492EbD85010A096f7e3aDEe6B5412`
  - Adapter `0x5336e0d969cBE43c19981AC88613fCF7AE4a86D1`
  - Factory `0x07dAF75612Dea30B9941EA3241fe6b6792c5d0e9`

## Hackathon requirement checklist

| # | Requirement | Weight | Status |
|---|---|---|---|
| 1 | End-to-end working, no mocked data | ⭐⭐⭐ | ✅ Live on-chain on Arbitrum Sepolia |
| 2 | Deployed on Arbitrum or Arbitrum Sepolia | ⭐⭐ | ✅ Sepolia chainId 421614, contracts verified |
| 3 | `feedback.md` about iExec tools | ⭐⭐ | ✅ See [feedback.md](./feedback.md) |
| 4 | 4 min max demo video | ⭐⭐ | ⬜ Record using script below |
| 5 | Tech: leverage Confidential Tokens + Nox | ⭐ | ✅ See "Privacy Layers" in README |
| 6 | Real-world use case in RWA/DeFi | ⭐ | ✅ Pendle-style yield market — solves copy-trade / MEV / position-leak |
| 7 | Code quality | ⭐ | ✅ 36 tests passing, atomic commits, contracts verified |
| 8 | UX | ⭐ | ✅ Single-file Vite app, modal-driven flow, persistent session |
| 9 | Public GitHub repo | submission | ✅ |
| 10 | README with install/usage | submission | ✅ |
| 11 | Functional frontend | submission | ✅ |
| 12 | Vibe-coded with AI tools | submission | ✅ Built with Claude Code |
| 13 | Confidential Tokens have utility | submission | ✅ SY/PT/YT/LP all confidential, in-app currency |
| 14 | Privacy audit | bonus | ✅ See [PRIVACY_AUDIT.md](./PRIVACY_AUDIT.md) |

## 4-minute demo script

Record at 1080p with screen + microphone. Target: 3:30 to leave headroom.

### Setup before recording (1 min, off-camera)
1. MetaMask connected, Arbitrum Sepolia selected, deployer wallet (`0xE48C…a9Ad`) loaded with test USDC from https://faucet.circle.com/
2. Open dapp at the Vercel URL
3. Approval done once before recording so the demo doesn't burn time on it
4. Have https://sepolia.arbiscan.io/address/0x32AFc6748E3752f73b68619667dC2624e098c26F open in a side tab

### 0:00 – 0:30 — Hook (problem → product)
"Pendle-style yield markets leak your principal size, your fill price, and your yield strategy on every trade. **Private Fission Protocol** moves that whole flow onto encrypted balances using iExec Nox confidential tokens. Same composability with Aave; nothing observable on-chain."

Show the homepage and the "PT-USDC-30D" market card.

### 0:30 – 1:30 — Mint encrypted SY
1. Click **Mint SY** → pick **10 USDC** bucket
2. Approve + mint — show MetaMask confirmation
3. After tx lands, point at the resulting Arbiscan transaction: highlight that the `mintSY` calldata only carries `10000000` (clear bucket) and the resulting `ConfidentialAction` event has only two opaque handles — no amount, no kind
4. Click **Decrypt** → show the SY balance appears (`1.0` SY-USDC)

Talking point: "The bucket size is the only thing visible. The wallet didn't give up its actual position size to the chain."

### 1:30 – 2:30 — Fission + AMM swap
1. Click **PT Strategy** card → **Buy PT** (SY → PT swap)
2. Submit — show the `swapSYForPT` confirmation
3. Highlight the slippage min-out is encrypted in the calldata too
4. After tx lands, decrypt portfolio: now shows SY ↓ and PT ↑ (around 1.0229 PT for 1 SY)
5. Open the tx on Arbiscan: the input handle, output handle, and refund branch are all opaque

Talking point: "The AMM ran a Uniswap V2 constant-product on encrypted reserves. You didn't see how big the pool is, what price you got, or whether your slippage tripped."

### 2:30 – 3:15 — Anonymized SY redeem
1. Portfolio → **Redeem** → 1 USDC bucket
2. Show the request tx on Arbiscan: the `RedeemRequested` event holds `(id, commit, amountHandle)` — **no recipient address, no cleartext amount**
3. Wait the 5-min `REDEEM_MIN_DELAY` (or fast-forward by saying "5 minutes later…" in voiceover)
4. Click **Settle redemption** → MetaMask signs → USDC arrives in wallet

Talking point: "The recipient was hidden until settle. The USDC payout is unlinkable from the original request because the float buffer in the adapter batches Aave events."

### 3:15 – 4:00 — YT yield route + close
1. (If pre-maturity) skip the YT yield demo; mention it briefly: "After maturity, YT holders claim through `redeemYTToSY` — yield comes back as encrypted SY, not cleartext USDC, so the per-claim ratio doesn't leak."
2. End on a slide showing privacy layers and the GitHub URL.

Voiceover close: "Built with Claude Code on iExec Nox in [N] days. Code, contracts, audit, feedback all in the repo."

## X (Twitter) post template

```
🥷 Private Fission Protocol

Pendle-style yield markets where everything stays encrypted: principal size, swap fills, slippage, LP shares, even per-leg activity.

Built on @iEx_ec Nox + Confidential Tokens.
Vibe-coded with @Chain_GPT-class tooling (Claude Code).

🎬 [4-min demo video link]
🐙 https://github.com/penguinpecker/private-fission-protocol
🔗 https://private-fission-protocol.vercel.app/

#ConfidentialDeFi #iExec #VibeCoding
```

## Submission checklist

- [ ] Demo video recorded ≤ 4:00, uploaded (YouTube unlisted or X native)
- [ ] X post published, tagging `@iEx_ec` and `@Chain_GPT`, including demo link + GitHub link
- [ ] Joined the Vibe Coding Challenge channel in iExec Discord (https://discord.gg/RXYHBJceMe)
- [ ] BUIDL submitted on DoraHacks before 2026-05-02 03:29 UTC
- [ ] Repository visibility = public ✅
- [ ] feedback.md present ✅
- [ ] Contracts verified on Arbiscan ✅
