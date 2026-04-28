import { createViemHandleClient } from '@iexec-nox/handle';
import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeEventLog,
  encodeAbiParameters,
  getContract,
  http,
  keccak256,
  parseUnits,
  toHex
} from 'viem';
import { arbitrumSepolia } from 'viem/chains';
import { CHAIN, EXTERNAL_ADDRESSES, FISSION_ADDRESSES, VAULT_KIND } from './addresses.js';
import { erc20Abi, fissionFactoryAbi, fissionMarketAbi, vaultAbi } from './abis.js';

const RELAY_DEFAULT_DEADLINE_SECONDS = 30 * 60;

const EIP712_DOMAIN = {
  name: 'FissionMarket',
  version: '1',
  chainId: arbitrumSepolia.id,
  get verifyingContract() {
    return FISSION_ADDRESSES.market;
  }
};

const RELAY_TYPES = {
  MintSY: [
    { name: 'actor', type: 'address' },
    { name: 'clearAmount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' }
  ],
  Fission: [
    { name: 'actor', type: 'address' },
    { name: 'encryptedAmount', type: 'bytes32' },
    { name: 'proofHash', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' }
  ],
  Combine: [
    { name: 'actor', type: 'address' },
    { name: 'encryptedAmount', type: 'bytes32' },
    { name: 'proofHash', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' }
  ],
  RedeemPT: [
    { name: 'actor', type: 'address' },
    { name: 'encryptedAmount', type: 'bytes32' },
    { name: 'proofHash', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' }
  ],
  Swap: [
    { name: 'actor', type: 'address' },
    { name: 'route', type: 'uint8' },
    { name: 'encryptedAmountIn', type: 'bytes32' },
    { name: 'proofInHash', type: 'bytes32' },
    { name: 'encryptedMinAmountOut', type: 'bytes32' },
    { name: 'proofMinHash', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' }
  ],
  RequestSYRedeem: [
    { name: 'actor', type: 'address' },
    { name: 'clearUsdc', type: 'uint256' },
    { name: 'commit', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' }
  ],
  SettleSYRedeem: [
    { name: 'id', type: 'uint256' },
    { name: 'recipient', type: 'address' },
    { name: 'salt', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' }
  ],
  RedeemYTToSY: [
    { name: 'actor', type: 'address' },
    { name: 'encryptedAmount', type: 'bytes32' },
    { name: 'proofHash', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' }
  ]
};

export function createClients() {
  if (!window.ethereum) {
    throw new Error('Wallet provider not found');
  }

  const walletClient = createWalletClient({
    chain: arbitrumSepolia,
    transport: custom(window.ethereum)
  });

  const publicClient = createPublicClient({
    chain: arbitrumSepolia,
    transport: http(CHAIN.rpcUrl)
  });

  return { publicClient, walletClient };
}

export async function connectWallet() {
  const { walletClient } = createClients();
  const [account] = await walletClient.requestAddresses();
  return account;
}

export async function readChainId() {
  if (!window.ethereum) return null;
  const hex = await window.ethereum.request({ method: 'eth_chainId' });
  return parseInt(hex, 16);
}

/**
 * Build EIP-1559 gas overrides anchored on the current base fee.
 *
 * Why: MetaMask's auto-estimator sometimes submits with `maxFeePerGas` slightly *below* the
 * latest block's base fee on Arbitrum Sepolia (low-traffic network with rapid base-fee jitter),
 * which RPCs reject with "max fee per gas less than block base fee". Setting the overrides
 * explicitly with a 2× base-fee headroom + 0.1 gwei priority skips MetaMask's estimator and
 * avoids the race.
 */
async function gasOverrides() {
  const { publicClient } = createClients();
  const block = await publicClient.getBlock({ blockTag: 'latest' });
  const baseFee = block.baseFeePerGas ?? 100_000_000n;
  const priority = 100_000_000n; // 0.1 gwei
  return {
    maxPriorityFeePerGas: priority,
    maxFeePerGas: baseFee * 2n + priority
  };
}

async function writeOpts(account) {
  return { account, ...(await gasOverrides()) };
}

export const EXPECTED_CHAIN_ID = 421614;

export async function switchToArbitrumSepolia() {
  if (!window.ethereum) throw new Error('No wallet provider');
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x66eee' }]
    });
  } catch (err) {
    if (err.code === 4902) {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: '0x66eee',
          chainName: 'Arbitrum Sepolia',
          nativeCurrency: { name: 'Ethereum', symbol: 'ETH', decimals: 18 },
          rpcUrls: ['https://sepolia-rollup.arbitrum.io/rpc'],
          blockExplorerUrls: ['https://sepolia.arbiscan.io']
        }]
      });
    } else {
      throw err;
    }
  }
}

/**
 * Reads the registry from the factory contract. Returns an empty array if no factory address is
 * configured — the frontend then falls back to the single hardcoded market address.
 */
export async function listFactoryMarkets() {
  if (!FISSION_ADDRESSES.factory) return [];
  const { publicClient } = createClients();
  const factory = getContract({
    address: FISSION_ADDRESSES.factory,
    abi: fissionFactoryAbi,
    client: publicClient
  });
  return factory.read.allMarkets();
}

export async function readMaturity() {
  const { publicClient } = createClients();
  const market = getContract({
    address: FISSION_ADDRESSES.market,
    abi: fissionMarketAbi,
    client: publicClient
  });
  return market.read.maturity();
}

/**
 * Pending redeems are now identified by a (commit, salt) pair generated client-side. The salt
 * is a per-request secret kept in localStorage so observers can't link `RedeemRequested` to a
 * recipient. We walk our stored tickets and refresh their on-chain `settled` status.
 */
const PENDING_KEY_PREFIX = 'fission:pendingRedeem:';

function pendingKey(account) {
  return `${PENDING_KEY_PREFIX}${account.toLowerCase()}`;
}

function loadPending(account) {
  try {
    const raw = window.localStorage.getItem(pendingKey(account));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function savePending(account, list) {
  try {
    window.localStorage.setItem(pendingKey(account), JSON.stringify(list));
  } catch {
    /* localStorage unavailable — pending list lost on reload, but flow still works */
  }
}

function appendPending(account, ticket) {
  const list = loadPending(account);
  list.push({ ...ticket, id: ticket.id.toString() });
  savePending(account, list);
}

function removePending(account, id) {
  const idStr = id.toString();
  const list = loadPending(account).filter((t) => t.id !== idStr);
  savePending(account, list);
}

export async function listPendingRedeemsForAccount(account) {
  const { publicClient } = createClients();
  const market = getContract({
    address: FISSION_ADDRESSES.market,
    abi: fissionMarketAbi,
    client: publicClient
  });
  const stored = loadPending(account);
  const open = [];
  for (const t of stored) {
    const id = BigInt(t.id);
    const r = await market.read.redeemRequests([id]);
    const [, amountHandle, requestBlockTime, settled] = r;
    if (settled) continue;
    open.push({
      id,
      amountHandle,
      requestBlockTime: Number(requestBlockTime),
      salt: t.salt,
      recipient: t.recipient,
      clearUsdc: t.clearUsdc
    });
  }
  // Reconcile localStorage with chain (drop already-settled).
  const liveIds = new Set(open.map((o) => o.id.toString()));
  const reconciled = stored.filter((t) => liveIds.has(t.id));
  if (reconciled.length !== stored.length) savePending(account, reconciled);
  return open;
}

function generateSalt() {
  const bytes = new Uint8Array(32);
  (window.crypto || window.msCrypto).getRandomValues(bytes);
  return toHex(bytes);
}

function commitFor(recipient, salt) {
  const encoded = encodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes32' }],
    [recipient, salt]
  );
  return keccak256(encoded);
}

const MAX_UINT256 = (1n << 256n) - 1n;

/**
 * Approve once for the maximum amount; the frontend stops asking for fresh approvals on every
 * mint. The user can still call the underlying ERC-20 to revoke.
 */
export async function approveUSDC() {
  const { walletClient } = createClients();
  const [account] = await walletClient.getAddresses();
  const usdc = getContract({
    address: EXTERNAL_ADDRESSES.usdc,
    abi: erc20Abi,
    client: walletClient
  });
  return usdc.write.approve([FISSION_ADDRESSES.adapter, MAX_UINT256], { account, ...(await gasOverrides()) });
}

export async function readUSDCAllowance(owner) {
  const { publicClient } = createClients();
  const usdc = getContract({
    address: EXTERNAL_ADDRESSES.usdc,
    abi: erc20Abi,
    client: publicClient
  });
  return usdc.read.allowance([owner, FISSION_ADDRESSES.adapter]);
}

export async function mintSY(amount) {
  const { walletClient } = createClients();
  const [account] = await walletClient.getAddresses();
  const market = getMarketContract(walletClient);
  return market.write.mintSY([parseUnits(cleanAmount(amount), 6)], { account, ...(await gasOverrides()) });
}

export async function encryptAmount(amount, applicationContract = FISSION_ADDRESSES.market) {
  const { walletClient } = createClients();
  const handleClient = await createViemHandleClient(walletClient);
  return handleClient.encryptInput(parseUnits(cleanAmount(amount), 18), 'uint256', applicationContract);
}

export async function fissionSY(amount) {
  const { walletClient } = createClients();
  const [account] = await walletClient.getAddresses();
  const { handle, handleProof } = await encryptAmount(amount);
  const market = getMarketContract(walletClient);
  return market.write.fission([handle, handleProof], { account, ...(await gasOverrides()) });
}

export async function combinePTAndYT(amount) {
  const { walletClient } = createClients();
  const [account] = await walletClient.getAddresses();
  const { handle, handleProof } = await encryptAmount(amount);
  const market = getMarketContract(walletClient);
  return market.write.combine([handle, handleProof], { account, ...(await gasOverrides()) });
}

export async function redeemPT(amount) {
  const { walletClient } = createClients();
  const [account] = await walletClient.getAddresses();
  const { handle, handleProof } = await encryptAmount(amount);
  const market = getMarketContract(walletClient);
  return market.write.redeemPT([handle, handleProof], { account, ...(await gasOverrides()) });
}

/**
 * Request a USDC redemption against the user's encrypted SY balance.
 *
 * Privacy: a random salt is generated client-side; the `commit = keccak256(recipient, salt)`
 * is what hits the chain. Observers can't recover the recipient until the user (or their
 * relayer) submits settle. The salt is persisted to localStorage so the user can settle
 * after a refresh.
 */
export async function requestSYRedeem(clearUsdc, recipient = null) {
  const { publicClient, walletClient } = createClients();
  const [account] = await walletClient.getAddresses();
  const target = recipient ?? account;
  const salt = generateSalt();
  const commit = commitFor(target, salt);
  const market = getMarketContract(walletClient);
  const txHash = await market.write.requestSYRedeem(
    [parseUnits(cleanAmount(clearUsdc), 6), commit],
    { account }
  );
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== FISSION_ADDRESSES.market.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: fissionMarketAbi, data: log.data, topics: log.topics });
      if (decoded.eventName === 'RedeemRequested') {
        const ticket = {
          txHash,
          id: decoded.args.id,
          amountHandle: decoded.args.amountHandle,
          salt,
          recipient: target,
          clearUsdc
        };
        appendPending(account, ticket);
        return ticket;
      }
    } catch {}
  }
  throw new Error('Redeem request did not emit RedeemRequested');
}

export async function settleSYRedeem({ id, amountHandle, salt, recipient }) {
  const { walletClient } = createClients();
  const [account] = await walletClient.getAddresses();
  const handleClient = await createViemHandleClient(walletClient);
  const { decryptionProof } = await handleClient.publicDecrypt(amountHandle);
  const market = getMarketContract(walletClient);
  const txHash = await market.write.settleSYRedeem([id, recipient, salt, decryptionProof], { account, ...(await gasOverrides()) });
  removePending(account, id);
  return txHash;
}

export async function readMaturityYieldStatus() {
  const { publicClient } = createClients();
  const market = getContract({
    address: FISSION_ADDRESSES.market,
    abi: fissionMarketAbi,
    client: publicClient
  });
  const [taken, total] = await Promise.all([
    market.read.maturitySnapshotTaken(),
    market.read.maturityYieldUsdc()
  ]);
  return { taken, total };
}

export async function readMarketOwner() {
  const { publicClient } = createClients();
  const market = getContract({
    address: FISSION_ADDRESSES.market,
    abi: fissionMarketAbi,
    client: publicClient
  });
  return market.read.owner();
}

export async function readPrincipalDeposited() {
  const { publicClient } = createClients();
  const market = getContract({
    address: FISSION_ADDRESSES.market,
    abi: fissionMarketAbi,
    client: publicClient
  });
  return market.read.principalDeposited();
}

const VAULT_KIND_NUM = { sy: 0, pt: 1, yt: 2 };

export async function adminAddAmmLiquidity(reserveName, amount) {
  const reserve = VAULT_KIND_NUM[reserveName];
  if (reserve === undefined) throw new Error(`Unknown reserve: ${reserveName}`);
  const { walletClient } = createClients();
  const [account] = await walletClient.getAddresses();
  const { handle, handleProof } = await encryptAmount(amount);
  const market = getMarketContract(walletClient);
  return market.write.addAmmLiquidity([reserve, handle, handleProof], { account, ...(await gasOverrides()) });
}

export async function addLiquiditySYPT(syAmount, ptAmount) {
  const { walletClient } = createClients();
  const [account] = await walletClient.getAddresses();
  const sy = await encryptAmount(syAmount);
  const pt = await encryptAmount(ptAmount);
  const market = getMarketContract(walletClient);
  return market.write.addLiquiditySYPT([sy.handle, sy.handleProof, pt.handle, pt.handleProof], { account, ...(await gasOverrides()) });
}

export async function removeLiquiditySYPT(lpAmount) {
  const { walletClient } = createClients();
  const [account] = await walletClient.getAddresses();
  const lp = await encryptAmount(lpAmount);
  const market = getMarketContract(walletClient);
  return market.write.removeLiquiditySYPT([lp.handle, lp.handleProof], { account, ...(await gasOverrides()) });
}

export async function addLiquiditySYYT(syAmount, ytAmount) {
  const { walletClient } = createClients();
  const [account] = await walletClient.getAddresses();
  const sy = await encryptAmount(syAmount);
  const yt = await encryptAmount(ytAmount);
  const market = getMarketContract(walletClient);
  return market.write.addLiquiditySYYT([sy.handle, sy.handleProof, yt.handle, yt.handleProof], { account, ...(await gasOverrides()) });
}

export async function removeLiquiditySYYT(lpAmount) {
  const { walletClient } = createClients();
  const [account] = await walletClient.getAddresses();
  const lp = await encryptAmount(lpAmount);
  const market = getMarketContract(walletClient);
  return market.write.removeLiquiditySYYT([lp.handle, lp.handleProof], { account, ...(await gasOverrides()) });
}

export async function decryptLPSYPT(account) {
  const { publicClient, walletClient } = createClients();
  const vault = getContract({
    address: FISSION_ADDRESSES.vault,
    abi: vaultAbi,
    client: publicClient
  });
  const handle = await vault.read.confidentialBalanceOf([3, account]);
  const handleClient = await createViemHandleClient(walletClient);
  return handleClient.decrypt(handle);
}

export async function adminHarvestAaveYield(toAddress, amountUsdc) {
  const { walletClient } = createClients();
  const [account] = await walletClient.getAddresses();
  const market = getMarketContract(walletClient);
  return market.write.harvestAaveYield([toAddress, parseUnits(cleanAmount(amountUsdc), 6)], { account, ...(await gasOverrides()) });
}

export async function snapshotMaturity() {
  const { walletClient } = createClients();
  const [account] = await walletClient.getAddresses();
  const market = getMarketContract(walletClient);
  return market.write.snapshotMaturity({ account, ...(await gasOverrides()) });
}

/**
 * Single-step YT yield claim. Burns the user's YT and mints encrypted SY equal to their
 * pro-rata yield share. No public decryption — yield amount stays encrypted end-to-end.
 * The user later exits the SY via the standard 4-bucket `requestSYRedeem` path, blending
 * yield exits into the principal-redemption anonymity set.
 */
export async function redeemYTToSY(amount) {
  const { walletClient } = createClients();
  const [account] = await walletClient.getAddresses();
  const { handle, handleProof } = await encryptAmount(amount);
  const market = getMarketContract(walletClient);
  return market.write.redeemYTToSY([handle, handleProof], { account, ...(await gasOverrides()) });
}

export async function swapWithAmm(route, amount, minAmountOut = '0') {
  const { walletClient } = createClients();
  const [account] = await walletClient.getAddresses();
  const inEnc = await encryptAmount(amount);
  const minEnc = await encryptAmount(minAmountOut);
  const market = getMarketContract(walletClient);
  const method = {
    syToPt: 'swapSYForPT',
    syToYt: 'swapSYForYT',
    ptToSy: 'sellPTForSY',
    ytToSy: 'sellYTForSY'
  }[route];

  if (!method) {
    throw new Error(`Unknown AMM route: ${route}`);
  }

  return market.write[method](
    [inEnc.handle, inEnc.handleProof, minEnc.handle, minEnc.handleProof],
    { account }
  );
}

export const VAULT_KIND_LP_SY_PT = 3;
export const VAULT_KIND_LP_SY_YT = 4;

export async function decryptPortfolio(account) {
  const entries = await Promise.all([
    decryptKindBalance(VAULT_KIND.sy, account),
    decryptKindBalance(VAULT_KIND.pt, account),
    decryptKindBalance(VAULT_KIND.yt, account),
    decryptKindBalance(VAULT_KIND_LP_SY_PT, account),
    decryptKindBalance(VAULT_KIND_LP_SY_YT, account)
  ]);

  return {
    sy: entries[0],
    pt: entries[1],
    yt: entries[2],
    lpSyPt: entries[3],
    lpSyYt: entries[4]
  };
}

/**
 * Read the raw encrypted-balance handle for a given kind+account. Returns the bytes32 handle.
 * If the handle is 0x00...00 the user's balance has never been initialised (i.e. they have
 * literally zero of that kind), and any swap/burn would revert with `ZeroBalance` in the vault.
 */
export async function readKindBalanceHandle(kind, account) {
  const { publicClient } = createClients();
  const vault = getContract({
    address: FISSION_ADDRESSES.vault,
    abi: vaultAbi,
    client: publicClient
  });
  return vault.read.confidentialBalanceOf([kind, account]);
}

export function isUninitializedHandle(handle) {
  if (!handle) return true;
  return /^0x0+$/.test(handle);
}

export async function decryptKindBalance(kind, account) {
  const { publicClient, walletClient } = createClients();
  const vault = getContract({
    address: FISSION_ADDRESSES.vault,
    abi: vaultAbi,
    client: publicClient
  });
  const balanceHandle = await vault.read.confidentialBalanceOf([kind, account]);
  // Uninitialised handle = user has never been credited this kind. The Nox handle library
  // refuses to decrypt the all-zero handle (its embedded chainId is 0, doesn't match the
  // connected chain), so short-circuit to a clean zero balance instead of throwing.
  if (isUninitializedHandle(balanceHandle)) return 0n;
  const handleClient = await createViemHandleClient(walletClient);
  return handleClient.decrypt(balanceHandle);
}

function cleanAmount(amount) {
  return String(amount).replace(/,/g, '').trim();
}

const SWAP_ROUTE_INDEX = {
  syToPt: 1,
  syToYt: 2,
  ptToSy: 3,
  ytToSy: 4
};

async function readActorNonce(actor) {
  const { publicClient } = createClients();
  const market = getContract({
    address: FISSION_ADDRESSES.market,
    abi: fissionMarketAbi,
    client: publicClient
  });
  return market.read.nonces([actor]);
}

function defaultDeadline() {
  return BigInt(Math.floor(Date.now() / 1000) + RELAY_DEFAULT_DEADLINE_SECONDS);
}

async function signTypedIntent(primaryType, message) {
  const { walletClient } = createClients();
  const [actor] = await walletClient.getAddresses();
  return walletClient.signTypedData({
    account: actor,
    domain: EIP712_DOMAIN,
    types: { [primaryType]: RELAY_TYPES[primaryType] },
    primaryType,
    message
  });
}

/**
 * Build a signed intent that any third-party relayer can submit. The signing wallet authorises
 * the action; the submitting wallet pays gas and is the on-chain `msg.sender`. The two are
 * unlinkable in the contract's logs unless the relayer chooses to leak.
 */
export async function signRelayedFission(amount, deadline = defaultDeadline()) {
  const { walletClient } = createClients();
  const [actor] = await walletClient.getAddresses();
  const { handle, handleProof } = await encryptAmount(amount);
  const nonce = await readActorNonce(actor);
  const message = {
    actor,
    encryptedAmount: handle,
    proofHash: keccak256(handleProof),
    nonce,
    deadline
  };
  const signature = await signTypedIntent('Fission', message);
  return { actor, encryptedAmount: handle, proof: handleProof, nonce, deadline, signature };
}

export async function signRelayedCombine(amount, deadline = defaultDeadline()) {
  const { walletClient } = createClients();
  const [actor] = await walletClient.getAddresses();
  const { handle, handleProof } = await encryptAmount(amount);
  const nonce = await readActorNonce(actor);
  const message = {
    actor,
    encryptedAmount: handle,
    proofHash: keccak256(handleProof),
    nonce,
    deadline
  };
  const signature = await signTypedIntent('Combine', message);
  return { actor, encryptedAmount: handle, proof: handleProof, nonce, deadline, signature };
}

export async function signRelayedRedeemPT(amount, deadline = defaultDeadline()) {
  const { walletClient } = createClients();
  const [actor] = await walletClient.getAddresses();
  const { handle, handleProof } = await encryptAmount(amount);
  const nonce = await readActorNonce(actor);
  const message = {
    actor,
    encryptedAmount: handle,
    proofHash: keccak256(handleProof),
    nonce,
    deadline
  };
  const signature = await signTypedIntent('RedeemPT', message);
  return { actor, encryptedAmount: handle, proof: handleProof, nonce, deadline, signature };
}

export async function signRelayedSwap(route, amount, minAmountOut = '0', deadline = defaultDeadline()) {
  const routeIndex = SWAP_ROUTE_INDEX[route];
  if (!routeIndex) throw new Error(`Unknown AMM route: ${route}`);
  const { walletClient } = createClients();
  const [actor] = await walletClient.getAddresses();
  const inEnc = await encryptAmount(amount);
  const minEnc = await encryptAmount(minAmountOut);
  const nonce = await readActorNonce(actor);
  const message = {
    actor,
    route: routeIndex,
    encryptedAmountIn: inEnc.handle,
    proofInHash: keccak256(inEnc.handleProof),
    encryptedMinAmountOut: minEnc.handle,
    proofMinHash: keccak256(minEnc.handleProof),
    nonce,
    deadline
  };
  const signature = await signTypedIntent('Swap', message);
  return {
    actor,
    route: routeIndex,
    encryptedAmountIn: inEnc.handle,
    proofIn: inEnc.handleProof,
    encryptedMinAmountOut: minEnc.handle,
    proofMin: minEnc.handleProof,
    nonce,
    deadline,
    signature
  };
}

export async function signRelayedMintSY(clearAmount, deadline = defaultDeadline()) {
  const { walletClient } = createClients();
  const [actor] = await walletClient.getAddresses();
  const nonce = await readActorNonce(actor);
  const message = {
    actor,
    clearAmount: parseUnits(cleanAmount(clearAmount), 6),
    nonce,
    deadline
  };
  const signature = await signTypedIntent('MintSY', message);
  return { ...message, signature };
}

export async function signRelayedRedeemYTToSY(amount, deadline = defaultDeadline()) {
  const { walletClient } = createClients();
  const [actor] = await walletClient.getAddresses();
  const { handle, handleProof } = await encryptAmount(amount);
  const nonce = await readActorNonce(actor);
  const message = {
    actor,
    encryptedAmount: handle,
    proofHash: keccak256(handleProof),
    nonce,
    deadline
  };
  const signature = await signTypedIntent('RedeemYTToSY', message);
  return { actor, encryptedAmount: handle, proof: handleProof, nonce, deadline, signature };
}

export async function submitRelayedRedeemYTToSY(intent) {
  const { walletClient } = createClients();
  const [submitter] = await walletClient.getAddresses();
  const market = getMarketContract(walletClient);
  return market.write.relayedRedeemYTToSY(
    [intent.actor, intent.encryptedAmount, intent.proof, intent.nonce, intent.deadline, intent.signature],
    { account: submitter, ...(await gasOverrides()) }
  );
}

export async function signRelayedRequestSYRedeem(clearUsdc, recipient, deadline = defaultDeadline()) {
  const { walletClient } = createClients();
  const [actor] = await walletClient.getAddresses();
  const target = recipient ?? actor;
  const salt = generateSalt();
  const commit = commitFor(target, salt);
  const nonce = await readActorNonce(actor);
  const message = {
    actor,
    clearUsdc: parseUnits(cleanAmount(clearUsdc), 6),
    commit,
    nonce,
    deadline
  };
  const signature = await signTypedIntent('RequestSYRedeem', message);
  return { ...message, salt, recipient: target, signature };
}

/**
 * Submitters: any wallet (relayer or the signer themselves) can broadcast a signed intent. For
 * real privacy this submitter should be a wallet distinct from the signer.
 */
export async function submitRelayedFission(intent) {
  const market = getMarketContract(createClients().walletClient);
  const [submitter] = await createClients().walletClient.getAddresses();
  return market.write.relayedFission(
    [intent.actor, intent.encryptedAmount, intent.proof, intent.nonce, intent.deadline, intent.signature],
    { account: submitter, ...(await gasOverrides()) }
  );
}

export async function submitRelayedCombine(intent) {
  const market = getMarketContract(createClients().walletClient);
  const [submitter] = await createClients().walletClient.getAddresses();
  return market.write.relayedCombine(
    [intent.actor, intent.encryptedAmount, intent.proof, intent.nonce, intent.deadline, intent.signature],
    { account: submitter, ...(await gasOverrides()) }
  );
}

export async function submitRelayedRedeemPT(intent) {
  const market = getMarketContract(createClients().walletClient);
  const [submitter] = await createClients().walletClient.getAddresses();
  return market.write.relayedRedeemPT(
    [intent.actor, intent.encryptedAmount, intent.proof, intent.nonce, intent.deadline, intent.signature],
    { account: submitter, ...(await gasOverrides()) }
  );
}

export async function submitRelayedSwap(intent) {
  const market = getMarketContract(createClients().walletClient);
  const [submitter] = await createClients().walletClient.getAddresses();
  return market.write.relayedSwap(
    [
      intent.actor,
      intent.route,
      intent.encryptedAmountIn,
      intent.proofIn,
      intent.encryptedMinAmountOut,
      intent.proofMin,
      intent.nonce,
      intent.deadline,
      intent.signature
    ],
    { account: submitter, ...(await gasOverrides()) }
  );
}

export async function submitRelayedMintSY(intent) {
  const market = getMarketContract(createClients().walletClient);
  const [submitter] = await createClients().walletClient.getAddresses();
  return market.write.relayedMintSY(
    [intent.actor, intent.clearAmount, intent.nonce, intent.deadline, intent.signature],
    { account: submitter, ...(await gasOverrides()) }
  );
}

export async function submitRelayedRequestSYRedeem(intent) {
  const { publicClient, walletClient } = createClients();
  const [submitter] = await walletClient.getAddresses();
  const market = getMarketContract(walletClient);
  const txHash = await market.write.relayedRequestSYRedeem(
    [intent.actor, intent.clearUsdc, intent.commit, intent.nonce, intent.deadline, intent.signature],
    { account: submitter, ...(await gasOverrides()) }
  );
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== FISSION_ADDRESSES.market.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: fissionMarketAbi, data: log.data, topics: log.topics });
      if (decoded.eventName === 'RedeemRequested') {
        const ticket = {
          txHash,
          id: decoded.args.id,
          amountHandle: decoded.args.amountHandle,
          salt: intent.salt,
          recipient: intent.recipient,
          clearUsdc: intent.clearUsdc.toString()
        };
        appendPending(intent.actor, ticket);
        return ticket;
      }
    } catch {}
  }
  throw new Error('Relayed redeem request did not emit RedeemRequested');
}

export async function signRelayedSettleSYRedeem(ticket, deadline = defaultDeadline()) {
  const { walletClient } = createClients();
  const [actor] = await walletClient.getAddresses();
  const nonce = await readActorNonce(actor);
  const id = typeof ticket.id === 'bigint' ? ticket.id : BigInt(ticket.id);
  const message = {
    id,
    recipient: ticket.recipient,
    salt: ticket.salt,
    nonce,
    deadline
  };
  const signature = await signTypedIntent('SettleSYRedeem', message);
  const handleClient = await createViemHandleClient(walletClient);
  const { decryptionProof } = await handleClient.publicDecrypt(ticket.amountHandle);
  return { actor, ticket, message, signature, decryptionProof };
}

export async function submitRelayedSettleSYRedeem(payload) {
  const { walletClient } = createClients();
  const [submitter] = await walletClient.getAddresses();
  const market = getMarketContract(walletClient);
  const txHash = await market.write.relayedSettleSYRedeem(
    [
      payload.actor,
      payload.message.id,
      payload.message.recipient,
      payload.message.salt,
      payload.message.nonce,
      payload.message.deadline,
      payload.signature,
      payload.decryptionProof
    ],
    { account: submitter, ...(await gasOverrides()) }
  );
  removePending(payload.actor, payload.message.id);
  return txHash;
}

function getMarketContract(walletClient) {
  if (!FISSION_ADDRESSES.market) {
    throw new Error('Fission market address is not configured yet');
  }

  return getContract({
    address: FISSION_ADDRESSES.market,
    abi: fissionMarketAbi,
    client: walletClient
  });
}
