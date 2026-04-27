import fs from 'node:fs';
import { createViemHandleClient } from '@iexec-nox/handle';
import { createPublicClient, createWalletClient, http, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrumSepolia } from 'viem/chains';

const RESERVES = {
  sy: 0,
  pt: 1,
  yt: 2
};

const fissionMarketAbi = [
  {
    type: 'function',
    name: 'addAmmLiquidity',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'reserve', type: 'uint8' },
      { name: 'encryptedAmount', type: 'bytes32' },
      { name: 'proof', type: 'bytes' }
    ],
    outputs: []
  }
];

async function main() {
  const reserveName = process.argv[2]?.toLowerCase();
  const amount = process.argv[3];

  if (!(reserveName in RESERVES) || !amount) {
    throw new Error('Usage: npm run add:amm-liquidity -- <sy|pt|yt> <amount>');
  }

  const env = readEnv('.env');
  const deployment = JSON.parse(fs.readFileSync('deployments/arbitrum-sepolia.json', 'utf8'));
  const rpcUrl = env.ARBITRUM_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc';
  let privateKey = env.PRIVATE_KEY?.trim();

  if (!privateKey) {
    throw new Error('PRIVATE_KEY is missing in .env');
  }

  if (!privateKey.startsWith('0x')) {
    privateKey = `0x${privateKey}`;
  }

  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({
    account,
    chain: arbitrumSepolia,
    transport: http(rpcUrl)
  });
  const publicClient = createPublicClient({
    chain: arbitrumSepolia,
    transport: http(rpcUrl)
  });

  const handleClient = await createViemHandleClient(walletClient);
  const { handle, handleProof } = await handleClient.encryptInput(
    parseUnits(amount, 18),
    'uint256',
    deployment.market
  );

  const hash = await walletClient.writeContract({
    address: deployment.market,
    abi: fissionMarketAbi,
    functionName: 'addAmmLiquidity',
    args: [RESERVES[reserveName], handle, handleProof]
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  console.log(JSON.stringify({
    market: deployment.market,
    reserve: reserveName,
    amount,
    txHash: hash,
    status: receipt.status
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

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
