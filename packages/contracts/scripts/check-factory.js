const hre = require('hardhat');
const {
  getProductionNetworkName,
  resolveNetworkName,
} = require('../utils/helpers');
const {getLatestNetworkDeployment} = require('@aragon/osx-commons-configs');

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const productionNetworkName = getProductionNetworkName(hre);
  const network = resolveNetworkName(productionNetworkName);
  console.log('Resolved network:', network);
  const networkDeployments = getLatestNetworkDeployment(network);
  console.log(
    'Network deployments keys:',
    networkDeployments && Object.keys(networkDeployments)
  );
  if (!networkDeployments) {
    console.error('No network deployments for', network);
    process.exit(1);
  }

  const addr =
    networkDeployments.PluginRepoFactory &&
    networkDeployments.PluginRepoFactory.address;
  console.log('PluginRepoFactory address:', addr);
  if (!addr) process.exit(1);

  const code = await hre.ethers.provider.getCode(addr);
  console.log('on-chain code length:', code ? code.length : 0);

  try {
    // Try getContractAt by name
    const cByName = await hre.ethers.getContractAt('PluginRepoFactory', addr);
    console.log(
      'getContractAt by name returned has address:',
      !!cByName.address
    );
  } catch (e) {
    console.warn(
      'getContractAt by name failed:',
      e && e.message ? e.message : e
    );
  }

  try {
    // Try to load ABI from @aragon/osx-ethers
    const {PluginRepoFactory__factory} = require('@aragon/osx-ethers');
    if (PluginRepoFactory__factory && PluginRepoFactory__factory.abi) {
      const cByAbi = await hre.ethers.getContractAt(
        PluginRepoFactory__factory.abi,
        addr
      );
      console.log(
        'getContractAt by ABI returned has address:',
        !!cByAbi.address
      );
    } else {
      console.log('No ABI found in @aragon/osx-ethers');
    }
  } catch (e) {
    console.warn(
      'Error loading @aragon/osx-ethers ABI or getContractAt by ABI failed:',
      e && e.message ? e.message : e
    );
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
