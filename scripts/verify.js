import fs from 'node:fs';
import path from 'node:path';
import { AbiCoder } from 'ethers';

const ENDPOINT = 'https://api.etherscan.io/v2/api';
const CHAIN_ID = 421614;
const POLL_INTERVAL_MS = 4000;
const POLL_TIMEOUT_MS = 90000;

async function main() {
  const env = readEnv('.env');
  const apiKey = env.ETHERSCAN_API_KEY?.trim();
  if (!apiKey) throw new Error('ETHERSCAN_API_KEY is missing in .env');

  const deployment = JSON.parse(fs.readFileSync('deployments/arbitrum-sepolia.json', 'utf8'));
  const buildInfo = loadBuildInfo();
  const sourceJson = JSON.stringify(buildInfo.input);
  const abi = new AbiCoder();

  const targets = [
    {
      address: deployment.market,
      contractName: 'contracts/FissionMarket.sol:FissionMarket',
      args: abi.encode(['uint256'], [deployment.maturity]).slice(2)
    },
    {
      address: deployment.vault,
      contractName: 'contracts/FissionPositionVault.sol:FissionPositionVault',
      args: abi.encode(['address'], [deployment.market]).slice(2)
    },
    {
      address: deployment.adapter,
      contractName: 'contracts/AaveUSDCYieldAdapter.sol:AaveUSDCYieldAdapter',
      args: abi.encode(['address'], [deployment.market]).slice(2)
    }
  ];

  for (const target of targets) {
    console.log(`\n→ ${target.contractName} @ ${target.address}`);
    try {
      const guid = await submitVerification({
        apiKey,
        sourceJson,
        compilerVersion: `v${buildInfo.solcLongVersion}`,
        ...target
      });
      console.log(`  guid: ${guid}`);
      const result = await pollStatus({ apiKey, guid });
      console.log(`  ${result}`);
    } catch (error) {
      console.error(`  failed: ${error.message}`);
    }
  }
}

async function submitVerification({ apiKey, address, contractName, args, sourceJson, compilerVersion }) {
  const body = new URLSearchParams({
    apikey: apiKey,
    module: 'contract',
    action: 'verifysourcecode',
    contractaddress: address,
    sourceCode: sourceJson,
    codeformat: 'solidity-standard-json-input',
    contractname: contractName,
    compilerversion: compilerVersion,
    constructorArguements: args
  });

  const response = await fetch(`${ENDPOINT}?chainid=${CHAIN_ID}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });
  const json = await response.json();
  if (json.status !== '1') {
    if (typeof json.result === 'string' && json.result.toLowerCase().includes('already verified')) {
      return null;
    }
    throw new Error(json.result || json.message || 'verification submission failed');
  }
  return json.result;
}

async function pollStatus({ apiKey, guid }) {
  if (!guid) return 'already verified';
  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const params = new URLSearchParams({
      apikey: apiKey,
      module: 'contract',
      action: 'checkverifystatus',
      guid
    });
    const response = await fetch(`${ENDPOINT}?chainid=${CHAIN_ID}&${params}`);
    const json = await response.json();
    if (json.status === '1') return json.result || 'verified';
    if (typeof json.result === 'string' && json.result.toLowerCase().includes('pending')) continue;
    throw new Error(json.result || json.message || 'verification check failed');
  }
  throw new Error('timed out polling verification status');
}

function loadBuildInfo() {
  const dir = 'artifacts/build-info';
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.endsWith('.output.json'));
  if (!files.length) throw new Error('no build-info found; run `npm run compile`');
  files.sort((a, b) => fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs);
  return JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8'));
}

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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
