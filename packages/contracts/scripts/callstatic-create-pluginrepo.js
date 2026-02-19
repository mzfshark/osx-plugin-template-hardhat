const hre = require('hardhat');
const {PLUGIN_REPO_ENS_SUBDOMAIN_NAME} = require('../plugin-settings');
const {
  getProductionNetworkName,
  resolveNetworkName,
} = require('../utils/helpers');
const {getLatestNetworkDeployment} = require('@aragon/osx-commons-configs');

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const productionNetworkName = getProductionNetworkName(hre);
  const network = resolveNetworkName(productionNetworkName);
  const networkDeployments = getLatestNetworkDeployment(network);
  console.log('Resolved network:', network);
  console.log(
    'Network deployments snapshot keys:',
    networkDeployments && Object.keys(networkDeployments)
  );
  if (!networkDeployments) {
    console.error('No network deployments for', network);
    process.exit(1);
  }
  const pluginRepoFactoryAddress =
    networkDeployments.PluginRepoFactory &&
    networkDeployments.PluginRepoFactory.address;
  console.log(
    'PluginRepoFactory address from deployments:',
    pluginRepoFactoryAddress
  );
  if (!pluginRepoFactoryAddress) {
    console.error(
      'PluginRepoFactory address is missing in network deployments for',
      network
    );
    console.error(
      'Ensure the osx-commons-configs package has deployments for this network or run the deploy step first.'
    );
    process.exit(1);
  }

  // Prefer runtime ABI from the published ethers factories package if available
  let factoryAbi = null;
  try {
    const {PluginRepoFactory__factory} = require('@aragon/osx-ethers');
    if (PluginRepoFactory__factory && PluginRepoFactory__factory.abi) {
      factoryAbi = PluginRepoFactory__factory.abi;
    }
  } catch (e) {
    // ignore and fallback to trying local deploy file
  }
  if (!factoryAbi) {
    const maybeFactory =
      require('../deploy/10_create_repo/11_create_repo').PluginRepoFactory__factory;
    factoryAbi = maybeFactory && maybeFactory.abi ? maybeFactory.abi : null;
  }
  const factory = await hre.ethers.getContractAt(
    // Use ABI if available, otherwise pass the contract name so Hardhat reads the artifact
    factoryAbi || 'PluginRepoFactory',
    pluginRepoFactoryAddress,
    deployer
  );

  try {
    console.log('Simulating createPluginRepo via callStatic...');
    const overrides = {gasLimit: 5_000_000};

    // Diagnostic info for debugging
    console.log('Factory diagnostics:', {
      address: factory && factory.address,
      hasCallStatic: !!(factory && factory.callStatic),
      hasInterface: !!(factory && factory.interface),
    });

    // Some ethers/Hardhat combinations may not expose `contract.callStatic`.
    // Detect and fallback to a `provider.call` using the ABI if needed.
    if (
      factory.callStatic &&
      typeof factory.callStatic.createPluginRepo === 'function'
    ) {
      const res = await factory.callStatic.createPluginRepo(
        PLUGIN_REPO_ENS_SUBDOMAIN_NAME,
        deployer.address,
        overrides
      );
      console.log('callStatic result:', res);
    } else {
      console.log(
        'callStatic not available on contract object; using provider.call fallback.'
      );
      // Build or reuse an Interface instance for encoding/decoding
      let iface = factory.interface;
      if (!iface) {
        if (factoryAbi) {
          try {
            iface = new hre.ethers.Interface(factoryAbi);
          } catch (e) {
            console.warn(
              'Failed to construct Interface from ABI:',
              e && e.message ? e.message : e
            );
          }
        } else {
          console.warn(
            'No factory.interface and no factoryAbi available; cannot encode call data.'
          );
        }
      }
      if (!iface) {
        throw new Error(
          'No ABI/interface available to encode createPluginRepo call'
        );
      }
      const data = iface.encodeFunctionData('createPluginRepo', [
        PLUGIN_REPO_ENS_SUBDOMAIN_NAME,
        deployer.address,
      ]);
      const to =
        factory.address || networkDeployments.PluginRepoFactory.address;
      const callResult = await hre.ethers.provider.call({to, data});
      // decodeFunctionResult returns an array-like result for the function's outputs
      let decoded = null;
      try {
        decoded = iface.decodeFunctionResult('createPluginRepo', callResult);
      } catch (e) {
        // Some providers return empty or non-decodable data on revert; surface raw hex
        console.warn('Failed to decode call result, raw:', callResult);
      }
      console.log(
        'provider.call result (decoded):',
        decoded,
        'raw:',
        callResult
      );
    }
  } catch (err) {
    console.error(
      'callStatic error (likely revert reason):',
      err && err.message ? err.message : err
    );
    if (err && err.error && err.error.message)
      console.error('Nested:', err.error.message);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
