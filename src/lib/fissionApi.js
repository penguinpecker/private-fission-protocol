import { createViemHandleClient } from '@iexec-nox/handle';
import { createPublicClient, createWalletClient, custom, getContract, http, parseUnits } from 'viem';
import { arbitrumSepolia } from 'viem/chains';
import { CHAIN, EXTERNAL_ADDRESSES, FISSION_ADDRESSES } from './addresses.js';
import { confidentialTokenAbi, erc20Abi, fissionMarketAbi } from './abis.js';

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

export async function approveUSDC(amount) {
  const { walletClient } = createClients();
  const [account] = await walletClient.getAddresses();
  const usdc = getContract({
    address: EXTERNAL_ADDRESSES.usdc,
    abi: erc20Abi,
    client: walletClient
  });

  return usdc.write.approve([FISSION_ADDRESSES.market, parseUnits(amount, 6)], { account });
}

export async function mintSY(amount) {
  const { walletClient } = createClients();
  const [account] = await walletClient.getAddresses();
  const market = getMarketContract(walletClient);
  return market.write.mintSY([parseUnits(amount, 6)], { account });
}

export async function encryptAmount(amount, applicationContract = FISSION_ADDRESSES.market) {
  const { walletClient } = createClients();
  const handleClient = await createViemHandleClient(walletClient);
  return handleClient.encryptInput(parseUnits(amount, 18), 'uint256', applicationContract);
}

export async function fissionSY(amount) {
  const { walletClient } = createClients();
  const [account] = await walletClient.getAddresses();
  const { handle, handleProof } = await encryptAmount(amount);
  const market = getMarketContract(walletClient);
  return market.write.fission([handle, handleProof], { account });
}

export async function swapWithAmm(route, amount) {
  const { walletClient } = createClients();
  const [account] = await walletClient.getAddresses();
  const { handle, handleProof } = await encryptAmount(amount);
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

  return market.write[method]([handle, handleProof], { account });
}

export async function decryptConfidentialBalance(tokenAddress, account) {
  const { publicClient, walletClient } = createClients();
  const token = getContract({
    address: tokenAddress,
    abi: confidentialTokenAbi,
    client: publicClient
  });
  const balanceHandle = await token.read.confidentialBalanceOf([account]);
  const handleClient = await createViemHandleClient(walletClient);
  return handleClient.decrypt(balanceHandle);
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
