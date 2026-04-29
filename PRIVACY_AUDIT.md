# Frontend Privacy Audit

Scope: `src/` and `index.html` of this repo, plus the production bundle in `dist/assets/`. Goal: catch any place the dapp leaks user state to a third party, logs sensitive data, or persists secrets in a way that makes them recoverable beyond the user's own browser profile.

## Findings

### ✅ Clean — no leaks

| Check | Result |
|---|---|
| `console.log` / `console.error` / `console.debug` / `console.info` / `console.warn` / `console.trace` | **0 hits in src/** |
| `fetch()` / `XMLHttpRequest` / `navigator.sendBeacon` | **0 hits** — every chain interaction goes through viem (publicClient → RPC) or the Nox handle library |
| Analytics packages (gtag, mixpanel, segment, sentry, datadog, amplitude, posthog, fullstory, hotjar) | **0 imports, 0 script tags** |
| Cookies / `sessionStorage` | **0 usages** |
| External `<script src="https://…">` tags in `index.html` | **None** — only Vite-bundled local assets |
| Private key / mnemonic / seed phrase references | **0 hits** |
| `process.env` / `import.meta.env` reads | **0 reads** — no secrets shipped to the bundle |
| `window.open` / cross-frame `postMessage` | **0 hits** |

### ✅ Network egress: minimal and expected

The only HTTPS endpoints the dapp actually contacts at runtime:

| Host | Purpose | Risk |
|---|---|---|
| `sepolia-rollup.arbitrum.io/rpc` | Arbitrum Sepolia RPC (read-only chain queries via viem `publicClient`) | None — public chain data |
| `apps.ovh-tdx-dev.noxprotocol.dev` | Nox TEE oracle for encrypt-input / decrypt-handle | Trusted by design (Nox attestation model) |
| `thegraph.arbitrum-sepolia-testnet.noxprotocol.io` | Nox handle resolution / lookup | Same trust boundary as Nox itself |

Other domains found as string constants in the bundle (`viem.sh`, `abitype.dev`, `4byte.sourcify.dev`, `oxlib.sh`, `ipfs.io`, `arweave.net`, `docs.soliditylang.org`, `api-sepolia.arbiscan.io`) are documentation / type-def URLs baked into the viem and abitype packages. They are not contacted at runtime.

The wallet's own RPC (whatever MetaMask is configured against) is also contacted, but that's the user's choice and not under our control.

### ⚠️ Documented local-only storage (not a leak — your machine, your data)

| Key | Contents | Risk |
|---|---|---|
| `fission:session` | account, last-decrypted portfolio (bigints as strings), hasUsdcApproval, chainId, useRelay toggle, last screen | Anyone with file-system access to your browser profile can read your decrypted balances. Trade-off for "no re-decrypt on refresh" UX. |
| `fission:pendingRedeem:{account}` | per-pending-redeem `{ id, salt, recipient, amountHandle, clearUsdc }` | The salt is what hides the recipient on-chain between request and settle. Browser-profile compromise unmasks the recipient. |

Both are written via `window.localStorage.setItem` only — never serialised over the wire. Disconnect modal explicitly calls `clearSession()`. Settling a redeem removes its pending entry.

### ⚠️ Irreducible client-side observables

A privacy-conscious user should know:

- **Browser tab → MetaMask popup**: the dapp passes the actor address to MetaMask for signing. MetaMask logs this in its own internal history. Nothing we can do about that.
- **Wallet → wallet's RPC provider**: MetaMask's RPC (Infura by default unless the user changed it) sees every tx the user signs, including the cleartext calldata. Use a relayed variant + a separate submitter wallet to break the actor-vs-submitter linkage at the wallet-RPC layer.
- **Vercel access logs**: serving the static dapp from Vercel means Vercel sees the user's IP + UA on each page load. Static asset only — no API routes that touch user state.

## Recommendation

For hackathon-grade privacy: ✅ acceptable.

For mainnet-grade privacy: deploy the static bundle to IPFS (or self-host) so there's no centralised access log; ship a Tor-onion alternative for users who can't trust their wallet's RPC; recommend users connect through a separate relayer wallet for every confidential action.
