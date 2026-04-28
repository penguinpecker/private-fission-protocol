import { createViemHandleClient } from '@iexec-nox/handle';
import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeEventLog,
  getContract,
  http,
  keccak256,
  parseUnits
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
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' }
  ],
  RedeemYT: [
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
 * Walk every redeem request slot and collect the open ones that belong to `account`. Used to
 * restore in-flight 2-step redemptions across page refreshes — `state.pendingRedeem` was
 * in-memory only.
 */
export async function listPendingRedeemsForAccount(account) {
  const { publicClient } = createClients();
  const market = getContract({
    address: FISSION_ADDRESSES.market,
    abi: fissionMarketAbi,
    client: publicClient
  });
  const total = await market.read.nextRedeemId();
  const open = [];
  for (let i = 1n; i <= total; i++) {
    const r = await market.read.redeemRequests([i]);
    const [user, clearUsdc, eqHandle, settled] = r;
    if (settled) continue;
    if (user.toLowerCase() !== account.toLowerCase()) continue;
    open.push({ id: i, clearUsdc, eqHandle });
  }
  return open;
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
  return usdc.write.approve([FISSION_ADDRESSES.adapter, MAX_UINT256], { account });
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
  return market.write.mintSY([parseUnits(cleanAmount(amount), 6)], { account });
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
  return market.write.fission([handle, handleProof], { account });
}

export async function combinePTAndYT(amount) {
  const { walletClient } = createClients();
  const [account] = await walletClient.getAddresses();
  const { handle, handleProof } = await encryptAmount(amount);
  const market = getMarketContract(walletClient);
  return market.write.combine([handle, handleProof], { account });
}

export async function redeemPT(amount) {
  const { walletClient } = createClients();
  const [account] = await walletClient.getAddresses();
  const { handle, handleProof } = await encryptAmount(amount);
  const market = getMarketContract(walletClient);
  return market.write.redeemPT([handle, handleProof], { account });
}

export async function requestSYRedeem(clearUsdc) {
  const { publicClient, walletClient } = createClients();
  const [account] = await walletClient.getAddresses();
  const market = getMarketContract(walletClient);
  const txHash = await market.write.requestSYRedeem([parseUnits(cleanAmount(clearUsdc), 6)], { account });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== FISSION_ADDRESSES.market.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: fissionMarketAbi, data: log.data, topics: log.topics });
      if (decoded.eventName === 'RedeemRequested') {
        return { txHash, id: decoded.args.id, eqHandle: decoded.args.eqHandle, clearUsdc };
      }
    } catch {}
  }
  throw new Error('Redeem request did not emit RedeemRequested');
}

export async function settleSYRedeem({ id, eqHandle }) {
  const { walletClient } = createClients();
  const [account] = await walletClient.getAddresses();
  const handleClient = await createViemHandleClient(walletClient);
  const { decryptionProof } = await handleClient.publicDecrypt(eqHandle);
  const market = getMarketContract(walletClient);
  return market.write.settleSYRedeem([id, decryptionProof], { account });
}

export async function readMaturityYieldStatus() {
  const { publicClient } = createClients();
  const market = getContract({
    address: FISSION_ADDRESSES.market,
    abi: fissionMarketAbi,
    client: publicClient
  });
  const [taken, total, distributed] = await Promise.all([
    market.read.maturitySnapshotTaken(),
    market.read.maturityYieldUsdc(),
    market.read.yieldDistributed()
  ]);
  return { taken, total, distributed };
}

export async function snapshotMaturity() {
  const { walletClient } = createClients();
  const [account] = await walletClient.getAddresses();
  const market = getMarketContract(walletClient);
  return market.write.snapshotMaturity({ account });
}

export async function redeemYT(amount) {
  const { publicClient, walletClient } = createClients();
  const [account] = await walletClient.getAddresses();
  const { handle, handleProof } = await encryptAmount(amount);
  const market = getMarketContract(walletClient);
  const txHash = await market.write.redeemYT([handle, handleProof], { account });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  return parseYTRedeemTicket(receipt, txHash);
}

export async function settleYTRedeem({ id, yieldHandle }) {
  const { walletClient } = createClients();
  const [account] = await walletClient.getAddresses();
  const handleClient = await createViemHandleClient(walletClient);
  const { decryptionProof } = await handleClient.publicDecrypt(yieldHandle);
  const market = getMarketContract(walletClient);
  return market.write.settleYTRedeem([id, decryptionProof], { account });
}

export async function listPendingYTRedeemsForAccount(account) {
  const { publicClient } = createClients();
  const market = getContract({
    address: FISSION_ADDRESSES.market,
    abi: fissionMarketAbi,
    client: publicClient
  });
  const total = await market.read.nextYTRedeemId();
  const open = [];
  for (let i = 1n; i <= total; i++) {
    const r = await market.read.ytRedeemRequests([i]);
    const [user, yieldHandle, settled] = r;
    if (settled) continue;
    if (user.toLowerCase() !== account.toLowerCase()) continue;
    open.push({ id: i, yieldHandle });
  }
  return open;
}

function parseYTRedeemTicket(receipt, txHash) {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== FISSION_ADDRESSES.market.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: fissionMarketAbi, data: log.data, topics: log.topics });
      if (decoded.eventName === 'YTRedeemRequested') {
        return { txHash, id: decoded.args.id, yieldHandle: decoded.args.yieldHandle };
      }
    } catch {}
  }
  throw new Error('YT redeem did not emit YTRedeemRequested');
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

export async function decryptPortfolio(account) {
  const entries = await Promise.all([
    decryptKindBalance(VAULT_KIND.sy, account),
    decryptKindBalance(VAULT_KIND.pt, account),
    decryptKindBalance(VAULT_KIND.yt, account)
  ]);

  return {
    sy: entries[0],
    pt: entries[1],
    yt: entries[2]
  };
}

export async function decryptKindBalance(kind, account) {
  const { publicClient, walletClient } = createClients();
  const vault = getContract({
    address: FISSION_ADDRESSES.vault,
    abi: vaultAbi,
    client: publicClient
  });
  const balanceHandle = await vault.read.confidentialBalanceOf([kind, account]);
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

export async function signRelayedRedeemYT(amount, deadline = defaultDeadline()) {
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
  const signature = await signTypedIntent('RedeemYT', message);
  return { actor, encryptedAmount: handle, proof: handleProof, nonce, deadline, signature };
}

export async function submitRelayedRedeemYT(intent) {
  const { publicClient, walletClient } = createClients();
  const [submitter] = await walletClient.getAddresses();
  const market = getMarketContract(walletClient);
  const txHash = await market.write.relayedRedeemYT(
    [intent.actor, intent.encryptedAmount, intent.proof, intent.nonce, intent.deadline, intent.signature],
    { account: submitter }
  );
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  return parseYTRedeemTicket(receipt, txHash);
}

export async function signRelayedRequestSYRedeem(clearUsdc, deadline = defaultDeadline()) {
  const { walletClient } = createClients();
  const [actor] = await walletClient.getAddresses();
  const nonce = await readActorNonce(actor);
  const message = {
    actor,
    clearUsdc: parseUnits(cleanAmount(clearUsdc), 6),
    nonce,
    deadline
  };
  const signature = await signTypedIntent('RequestSYRedeem', message);
  return { ...message, signature };
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
    { account: submitter }
  );
}

export async function submitRelayedCombine(intent) {
  const market = getMarketContract(createClients().walletClient);
  const [submitter] = await createClients().walletClient.getAddresses();
  return market.write.relayedCombine(
    [intent.actor, intent.encryptedAmount, intent.proof, intent.nonce, intent.deadline, intent.signature],
    { account: submitter }
  );
}

export async function submitRelayedRedeemPT(intent) {
  const market = getMarketContract(createClients().walletClient);
  const [submitter] = await createClients().walletClient.getAddresses();
  return market.write.relayedRedeemPT(
    [intent.actor, intent.encryptedAmount, intent.proof, intent.nonce, intent.deadline, intent.signature],
    { account: submitter }
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
    { account: submitter }
  );
}

export async function submitRelayedMintSY(intent) {
  const market = getMarketContract(createClients().walletClient);
  const [submitter] = await createClients().walletClient.getAddresses();
  return market.write.relayedMintSY(
    [intent.actor, intent.clearAmount, intent.nonce, intent.deadline, intent.signature],
    { account: submitter }
  );
}

export async function submitRelayedRequestSYRedeem(intent) {
  const market = getMarketContract(createClients().walletClient);
  const [submitter] = await createClients().walletClient.getAddresses();
  return market.write.relayedRequestSYRedeem(
    [intent.actor, intent.clearUsdc, intent.nonce, intent.deadline, intent.signature],
    { account: submitter }
  );
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
