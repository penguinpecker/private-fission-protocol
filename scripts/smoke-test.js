// RPC-level smoke test: drives mintSY through the deployer wallet against the new
// privacy-hardened contracts, with explicit gas overrides matching the frontend's logic.
// If this passes, the on-chain ABI is consistent with the frontend and the gas-fee fix is
// effective at the RPC layer (independent of MetaMask).

import fs from 'node:fs';
import { JsonRpcProvider, Wallet, Contract, formatEther, formatUnits, parseUnits } from 'ethers';

const env = readEnv('.env');
const rpcUrl = env.ARBITRUM_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc';
const privateKey = env.PRIVATE_KEY?.trim().startsWith('0x')
  ? env.PRIVATE_KEY.trim()
  : `0x${env.PRIVATE_KEY?.trim()}`;
if (!env.PRIVATE_KEY) throw new Error('PRIVATE_KEY missing in .env');

const provider = new JsonRpcProvider(rpcUrl);
const wallet = new Wallet(privateKey, provider);

const deployment = JSON.parse(fs.readFileSync('deployments/arbitrum-sepolia.json', 'utf8'));
const USDC = deployment.config.usdc;
const ADAPTER = deployment.adapter;
const MARKET = deployment.market;

const ercAbi = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
  'function mint(address,uint256)' // testnet faucet, may or may not exist
];
const marketAbi = [
  'function mintSY(uint256 clearAmount)',
  'function principalDeposited() view returns (uint256)',
  'function maturity() view returns (uint256)',
  'function maturitySnapshotTaken() view returns (bool)',
  'function REDEEM_MIN_DELAY() view returns (uint256)',
  'function owner() view returns (address)'
];

const adapterAbi = [
  'function rebalance()',
  'function floatTarget() view returns (uint256)',
  'function floatBalance() view returns (uint256)',
  'function aaveBalance() view returns (uint256)',
  'function reserveBalance() view returns (uint256)'
];

async function gasOverrides() {
  const block = await provider.getBlock('latest');
  const baseFee = block.baseFeePerGas ?? 100_000_000n;
  const priority = 100_000_000n;
  return {
    maxPriorityFeePerGas: priority,
    maxFeePerGas: baseFee * 2n + priority
  };
}

async function main() {
  const usdc = new Contract(USDC, ercAbi, wallet);
  const market = new Contract(MARKET, marketAbi, wallet);

  console.log('Deployer:', wallet.address);
  console.log('Network:', (await provider.getNetwork()).chainId.toString());
  console.log('ETH balance:', formatEther(await provider.getBalance(wallet.address)));

  let usdcBalance = await usdc.balanceOf(wallet.address);
  console.log('USDC balance:', formatUnits(usdcBalance, 6));

  const ONE_USDC = parseUnits('1', 6);

  // Read-only ABI sanity check: prove every accessor referenced by the frontend is exposed.
  const adapter = new Contract(ADAPTER, adapterAbi, wallet);
  console.log('\n=== read-only ABI sanity ===');
  console.log('market.owner:           ', await market.owner());
  console.log('market.maturity:        ', new Date(Number(await market.maturity()) * 1000).toISOString());
  console.log('market.snapshotTaken:   ', await market.maturitySnapshotTaken());
  console.log('market.REDEEM_MIN_DELAY:', (await market.REDEEM_MIN_DELAY()).toString(), 'sec');
  console.log('market.principalDeposit:', formatUnits(await market.principalDeposited(), 6), 'USDC');
  console.log('adapter.floatTarget:    ', formatUnits(await adapter.floatTarget(), 6), 'USDC');
  console.log('adapter.floatBalance:   ', formatUnits(await adapter.floatBalance(), 6), 'USDC');
  console.log('adapter.aaveBalance:    ', formatUnits(await adapter.aaveBalance(), 6), 'USDC');
  console.log('adapter.reserveBalance: ', formatUnits(await adapter.reserveBalance(), 6), 'USDC');

  if (usdcBalance < ONE_USDC) {
    console.log('\n=== USDC unavailable — running gas-fix validation via permissionless rebalance() ===');
    try {
      const tx = await adapter.rebalance(await gasOverrides());
      console.log('  rebalance tx:', tx.hash);
      const receipt = await tx.wait();
      console.log('  block:', receipt.blockNumber, 'gasUsed:', receipt.gasUsed.toString());
      console.log('\n✓ Read-only ABI matches the deployed contract.');
      console.log('✓ Gas overrides accepted at the RPC layer (no "max fee per gas" error).');
      console.log('✓ Adapter exists and rebalance() is callable.');
      console.log('\nFull mintSY end-to-end requires the deployer to obtain test USDC.');
      console.log('Get test USDC from Aave testnet faucet at https://staging.aave.com/faucet/');
      console.log('(or transfer some from another wallet) and re-run this script to test mintSY.');
      return;
    } catch (err) {
      console.error('  rebalance failed:', err.shortMessage || err.message);
      process.exit(1);
    }
  }

  const allowance = await usdc.allowance(wallet.address, ADAPTER);
  console.log('USDC -> adapter allowance:', formatUnits(allowance, 6));
  if (allowance < ONE_USDC) {
    console.log('Approving adapter for max...');
    const tx = await usdc.approve(ADAPTER, (1n << 256n) - 1n, await gasOverrides());
    console.log('  approve tx:', tx.hash);
    await tx.wait();
  }

  const principalBefore = await market.principalDeposited();
  console.log('principalDeposited before:', formatUnits(principalBefore, 6));

  console.log('Calling mintSY(1 USDC) with explicit gas overrides...');
  const tx = await market.mintSY(ONE_USDC, await gasOverrides());
  console.log('  mintSY tx:', tx.hash);
  const receipt = await tx.wait();
  console.log('  block:', receipt.blockNumber, 'gasUsed:', receipt.gasUsed.toString());

  const principalAfter = await market.principalDeposited();
  console.log('principalDeposited after:', formatUnits(principalAfter, 6));
  console.log('delta:', formatUnits(principalAfter - principalBefore, 6), 'USDC');

  console.log('\n✓ ABI matches deployed contract; gas overrides land within base-fee bounds.');
}

function readEnv(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(
    fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i), l.slice(i + 1)];
      })
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
