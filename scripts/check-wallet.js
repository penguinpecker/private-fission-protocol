import fs from 'node:fs';
import { JsonRpcProvider, Wallet, formatEther } from 'ethers';

const env = readEnv('.env');
const rpcUrl = env.ARBITRUM_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc';
const expectedAddress = process.argv[2]?.toLowerCase();
let privateKey = env.PRIVATE_KEY?.trim();

if (!privateKey) {
  throw new Error('PRIVATE_KEY is missing in .env');
}

if (!privateKey.startsWith('0x')) {
  privateKey = `0x${privateKey}`;
}

const wallet = new Wallet(privateKey);
const provider = new JsonRpcProvider(rpcUrl);
const [network, blockNumber, balance, nonce] = await Promise.all([
  provider.getNetwork(),
  provider.getBlockNumber(),
  provider.getBalance(wallet.address),
  provider.getTransactionCount(wallet.address)
]);

console.log(JSON.stringify({
  address: wallet.address,
  expectedAddressMatches: expectedAddress ? wallet.address.toLowerCase() === expectedAddress : undefined,
  chainId: network.chainId.toString(),
  latestBlock: blockNumber,
  balanceEth: formatEther(balance),
  nonce
}, null, 2));

function readEnv(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(
    fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const i = line.indexOf('=');
        return [line.slice(0, i), line.slice(i + 1)];
      })
  );
}
