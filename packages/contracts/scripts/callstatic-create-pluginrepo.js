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
  let pluginRepoFactoryAddress =
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

  // Check whether the address actually has code on the current RPC.
  const onChainCode = await hre.ethers.provider.getCode(
    pluginRepoFactoryAddress
  );
  console.log(
    'on-chain code at deployment address (first 66 chars):',
    onChainCode ? onChainCode.slice(0, 66) : onChainCode
  );
  if (!onChainCode || onChainCode === '0x') {
    // Possible mismatch: deployments point to a different network (e.g., mainnet) while user is connected to another RPC (e.g., harmony).
    console.warn(
      `No contract code found at ${pluginRepoFactoryAddress} on the current provider. Trying deployments for the current Hardhat network '${hre.network.name}' as a fallback.`
    );
    try {
      const fallbackNetwork = resolveNetworkName(
        hre.network.name || productionNetworkName
      );
      console.log('Fallback network to check:', fallbackNetwork);
      const fallbackDeployments = getLatestNetworkDeployment(fallbackNetwork);
      console.log(
        'Fallback deployments keys:',
        fallbackDeployments && Object.keys(fallbackDeployments)
      );
      const fallbackAddress =
        fallbackDeployments &&
        fallbackDeployments.PluginRepoFactory &&
        fallbackDeployments.PluginRepoFactory.address;
      if (fallbackAddress) {
        const fallbackCode = await hre.ethers.provider.getCode(fallbackAddress);
        console.log(
          'on-chain code at fallback address (first 66 chars):',
          fallbackCode ? fallbackCode.slice(0, 66) : fallbackCode
        );
        if (fallbackCode && fallbackCode !== '0x') {
          console.log(
            'Using fallback PluginRepoFactory address from network',
            fallbackNetwork,
            fallbackAddress
          );
          pluginRepoFactoryAddress = fallbackAddress;
        } else {
          console.warn(
            'Fallback address also has no code on this provider. Aborting.'
          );
          process.exit(1);
        }
      } else {
        console.warn(
          'No PluginRepoFactory deployment found for fallback network',
          fallbackNetwork
        );
        process.exit(1);
      }
    } catch (e) {
      console.error(
        'Error while trying fallback deployments:',
        e && e.message ? e.message : e
      );
      process.exit(1);
    }
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
        pluginRepoFactoryAddress ||
        factory.address ||
        networkDeployments.PluginRepoFactory.address;
      const callParams = {
        to,
        data,
        from: deployer.address,
        gasLimit: overrides.gasLimit,
      };
      // Include optional fee fields when present on overrides
      if (overrides.maxFeePerGas)
        callParams.maxFeePerGas = overrides.maxFeePerGas;
      if (overrides.maxPriorityFeePerGas)
        callParams.maxPriorityFeePerGas = overrides.maxPriorityFeePerGas;

      const callResult = await hre.ethers.provider.call(callParams);
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
