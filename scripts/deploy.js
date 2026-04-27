import hre from 'hardhat';

async function main() {
  const maturity = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
  const Market = await hre.ethers.getContractFactory('FissionMarket');
  const market = await Market.deploy(maturity);
  await market.waitForDeployment();

  const marketAddress = await market.getAddress();
  console.log('FissionMarket:', marketAddress);
  console.log('SY:', await market.sy());
  console.log('PT:', await market.pt());
  console.log('YT:', await market.yt());
  console.log('Adapter:', await market.adapter());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
