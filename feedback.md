# Feedback on iExec Nox & Confidential Token tooling

Built **Private Fission Protocol** — a confidential Pendle-style yield market — across the Vibe Coding Challenge window using Claude Code as the primary AI assistant. This document captures concrete, actionable feedback on Nox, the confidential token primitives, and the surrounding dev experience.

## What worked well

### Solidity SDK ergonomics
- `Nox.toEuint256(uint256)`, `Nox.add`, `Nox.mul`, `Nox.div`, `Nox.select`, `Nox.le`, `Nox.eq` etc. read like native Solidity. Writing the AMM constant-product math (`amountOut = (amountIn × 0.997 × reserveOut) / (reserveIn × 10000 + amountIn × 0.997)`) on encrypted values was almost a 1:1 port from a public-AMM implementation.
- `Nox.safeAdd` / `Nox.safeSub` returning `(ebool success, euint256)` is the right abstraction — let us implement saturating-on-failure transfer semantics in `_update` cleanly with `Nox.select`.
- `Nox.allowPublicDecryption(handle)` for staked-decrypt flows is concise and let us write a clean two-step redeem (request stakes the handle, settle resolves it).

### EIP-712 meta-tx integration
- The example pattern of `_fromExternalAs(externalEuint256, proof, actor)` rebinding the Nox proof to a non-msg.sender `actor` is exactly what's needed for relayed-meta-tx privacy. Worked first try once we wired the EIP-712 `_verifyAndConsume` helper.

### The handle library (`@iexec-nox/handle`) on the frontend
- `createViemHandleClient(walletClient)` + `encryptInput(value, type, contract)` + `decrypt(handle)` is a clean three-call surface. We had a working "encrypt amount → submit → later decrypt" loop in <30 minutes.

## Pain points (the constructive part)

### 1. `decrypt()` returns `{ value, solidityType }`, not the value
The TypeScript declaration is correct (`Promise<{ value: JsValue<T>; solidityType: T }>`) but the natural-feeling call site is:
```js
const balance = await handleClient.decrypt(handle);
```
Most devs (and the LLM I was pair-programming with) will then template-string `balance` and get `[object Object]`. We hit this in production and it took a screenshot from the user to catch. Suggestion: either return the unwrapped value directly, or document this prominently with a short JSDoc on the public API.

### 2. Uninitialized handle → `chainId 0` mismatch
`vault.read.confidentialBalanceOf(kind, account)` returns `0x000…000` for kinds the user has never been credited. Passing that to `handleClient.decrypt()` throws:
```
Handle chainId (0) does not match connected chainId (421614)
```
This is technically correct (the handle is uninitialized so its embedded chainId field is 0) but it broke our entire `Promise.all([decrypt(sy), decrypt(pt), …])` if any single kind was empty. Suggestion: have `decrypt()` return `0n` for the all-zero handle (or expose a public `isInitialized(handle)` helper and document the recommended early-return pattern).

### 3. ACL surface is easy to leak privacy through
Calling `Nox.allow(handle, addr)` repeatedly across an action grows the public allow-graph. We had to consciously prune `Nox.allowThis(...)` and per-actor `Nox.allow(...)` calls to the minimum required by the next compute step. A linter / static-analysis hint that flagged "this allow is unused after the next compute step" would help maintain tight ACL hygiene.

### 4. Public-decrypt latency is undocumented
`Nox.publicDecrypt(handle, proof)` returns the cleartext but the `proof` is generated off-chain by an oracle and there's no guidance on the SLA. We had to design a 2-step request/settle pattern around this. Suggestion: a paragraph in the docs about expected latency between `Nox.allowPublicDecryption(handle)` and the proof being ready.

### 5. Bytecode-size headroom on confidential contracts
`FissionMarket.sol` got within ~2KB of the 24KB EIP-170 limit before we factored it. The Nox runtime calls add nontrivial overhead. We ended up making `FissionMarketFactory` a pure registry (not a deployer) because the constructor bytecode was too large to invoke from a factory. Suggestion: a "size budget" note in the docs ("plan to factor out functionality once your market exceeds N internal compute calls").

### 6. Mocking for tests
We had to install the real Nox compute contract bytecode at the pinned address via `hardhat_setCode` for test runs. The `MockNoxCompute` we wrote works, but the canonical "how to test offline" recipe wasn't in any docs we found. Suggestion: ship a published `@iexec-nox/test-helpers` package with a `setupNoxMocks(provider, ethers)` function.

### 7. Default Nox `ConfidentialTransfer` event semantics
We made a deliberate privacy choice to suppress the standard `ConfidentialTransfer` event in our vault — emitting it would have leaked which leg (SY/PT/YT) was touched even though amounts stay encrypted. The standard's mandatory emission feels at odds with the privacy goal of the underlying primitive. Worth considering an opt-out / "uniform-event" mode in the standard token implementations.

## On the broader Vibe Coding workflow

- Claude Code + Cursor-style iteration was a force multiplier here. Specific cycle: open a Solidity file → describe the privacy property → let the assistant draft the encrypted-math primitive → review for ACL leaks → run the existing test suite → iterate. The Nox SDK is mature enough that the AI rarely hallucinated wrong API names.
- The two failure modes the AI repeatedly hit were the two pain points above (`decrypt()` return shape, uninitialized-handle behavior) — both would be fixed by tighter type defs / docs.

## Net summary

The Nox primitive set is genuinely powerful and the SDK is well-shaped. The friction is concentrated in (1) handle library return-types/edge cases on the frontend and (2) standards-vs-privacy tension when ERC-7984's mandatory event emission undermines the privacy you bought by encrypting balances. Both are fixable without breaking changes.

We shipped a working confidential yield market in about a week of evening-and-weekend hacking with this stack. That's a strong validation of the developer experience.
