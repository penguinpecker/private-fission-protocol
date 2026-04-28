import fs from 'node:fs';
import path from 'node:path';
import { ContractFactory, JsonRpcProvider, Wallet } from 'ethers';

async function main() {
  const env = readEnv('.env');
  const rpcUrl = env.ARBITRUM_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc';
  let privateKey = env.PRIVATE_KEY?.trim();

  if (!privateKey) {
    throw new Error('PRIVATE_KEY is missing in .env');
  }

  if (!privateKey.startsWith('0x')) {
    privateKey = `0x${privateKey}`;
  }

  const provider = new JsonRpcProvider(rpcUrl);
  const wallet = new Wallet(privateKey, provider);
  const maturity = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
  const artifact = JSON.parse(
    fs.readFileSync('artifacts/contracts/FissionMarket.sol/FissionMarket.json', 'utf8')
  );
  const factoryArtifact = JSON.parse(
    fs.readFileSync('artifacts/contracts/FissionMarketFactory.sol/FissionMarketFactory.json', 'utf8')
  );
  const Market = new ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const Factory = new ContractFactory(factoryArtifact.abi, factoryArtifact.bytecode, wallet);

  console.log('Deployer:', wallet.address);
  console.log('Network:', (await provider.getNetwork()).chainId.toString());
  console.log('Maturity:', maturity);

  // Pinned Aave V3 + USDC addresses on Arbitrum Sepolia.
  const cfg = {
    maturity,
    usdc: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    aUsdc: '0x460b97BD498E1157530AEb3086301d5225b91216',
    aavePool: '0xBfC91D59fdAA134A4ED45f7B584cAf96D7792Eff',
    syReserveSeed: 1_000_000n * 10n ** 18n,
    ptReserveSeed: 1_026_000n * 10n ** 18n,
    ytReserveSeed: 12_000_000n * 10n ** 18n
  };

  const market = await Market.deploy(wallet.address, cfg);
  await market.waitForDeployment();
  const marketAddress = await market.getAddress();

  let factoryAddress;
  try {
    const factory = await Factory.deploy();
    await factory.waitForDeployment();
    factoryAddress = await factory.getAddress();
    const tx = await factory.registerMarket(marketAddress);
    await tx.wait();
    console.log('Factory deployed and market registered.');
  } catch (err) {
    console.warn('Factory deploy or registration failed:', err.shortMessage || err.message);
    factoryAddress = null;
  }

  const deployment = {
    chainId: '421614',
    deployer: wallet.address,
    maturity,
    market: marketAddress,
    vault: await market.vault(),
    adapter: await market.adapter(),
    factory: factoryAddress,
    config: {
      usdc: cfg.usdc,
      aUsdc: cfg.aUsdc,
      aavePool: cfg.aavePool,
      syReserveSeed: cfg.syReserveSeed.toString(),
      ptReserveSeed: cfg.ptReserveSeed.toString(),
      ytReserveSeed: cfg.ytReserveSeed.toString()
    }
  };

  fs.mkdirSync('deployments', { recursive: true });
  fs.writeFileSync(
    path.join('deployments', 'arbitrum-sepolia.json'),
    `${JSON.stringify(deployment, null, 2)}\n`
  );

  console.log(JSON.stringify(deployment, null, 2));
  console.log('Saved deployment to deployments/arbitrum-sepolia.json');
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
