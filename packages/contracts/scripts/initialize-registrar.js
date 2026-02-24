const hre = require('hardhat');
const path = require('path');

// load repo .env if present
try {
  require('dotenv').config({path: path.resolve(__dirname, '../../..', '.env')});
} catch (e) {
  // noop
}

async function main() {
  const registrarAddr =
    process.env.REGISTRAR_ADDR ||
    process.env.PLUGIN_ENS_REGISTRAR ||
    process.env.PLUGIN_ENS_REGISTRAR_ADDRESS ||
    '0x35B62715459cB60bf6dC17fF8cfe138EA305E7Ee';
  const managingDao =
    process.env.MANAGEMENT_DAO_ADDRESS || process.env.MANAGING_DAO || null;
  const ensAddress =
    process.env.ENS_ADDRESS || process.env.ENS_REGISTRY_ADDRESS || null;
  const nodeHex = process.env.NODE || process.env.ENS_NODE || null;

  const [signer] = await hre.ethers.getSigners();
  console.log('Using signer', signer.address);
  console.log('Registrar address:', registrarAddr);

  // ABI source: try @aragon/osx-ethers first, then typechain factory
  let ENSSubdomainRegistrarFactory = null;
  try {
    ENSSubdomainRegistrarFactory =
      require('@aragon/osx-ethers').ENSSubdomainRegistrar__factory;
  } catch (e) {
    try {
      ENSSubdomainRegistrarFactory =
        require('../typechain/factories/@aragon/osx/framework/utils/ens/ENSSubdomainRegistrar__factory').ENSSubdomainRegistrar__factory;
    } catch (err) {
      // fallback: require typechain index
      try {
        ENSSubdomainRegistrarFactory = require('../typechain/factories/@aragon/osx/framework/utils/ens/ENSSubdomainRegistrar__factory');
      } catch (e2) {
        // ignore
      }
    }
  }

  const abi = ENSSubdomainRegistrarFactory
    ? ENSSubdomainRegistrarFactory.abi
    : null;
  if (!abi) {
    console.warn(
      'Could not load ENSSubdomainRegistrar ABI from packages; falling back to generic interface'
    );
  }

  const registrar = abi
    ? await hre.ethers.getContractAt(abi, registrarAddr, signer)
    : await hre.ethers.getContractAt(
        [
          'function ens() view returns (address)',
          'function initialized() view returns (bool)',
        ],
        registrarAddr,
        signer
      );

  // try reading ens()/initialized()/owner()
  try {
    const ens = await registrar.ens();
    console.log('registrar.ens():', ens);
  } catch (e) {
    console.warn(
      'registrar.ens() reverted or failed:',
      e && e.message ? e.message : e
    );
  }

  try {
    if (typeof registrar.initialized === 'function') {
      const init = await registrar.initialized();
      console.log('registrar.initialized():', init);
    }
  } catch (e) {
    console.warn(
      'registrar.initialized() call failed:',
      e && e.message ? e.message : e
    );
  }

  try {
    if (typeof registrar.owner === 'function') {
      const owner = await registrar.owner();
      console.log('registrar.owner():', owner);
    }
  } catch (e) {
    // not all registrars expose owner()
  }

  // If all required params are present, attempt initialize
  if (process.env.FORCE_INITIALIZE === 'true') {
    if (!managingDao || !ensAddress || !nodeHex) {
      console.error(
        'Missing parameters for initialize. Provide MANAGEMENT_DAO_ADDRESS, ENS_ADDRESS and NODE (bytes32).'
      );
      process.exit(1);
    }

    console.log('Attempting initialize(managingDao, ensAddress, node) with:');
    console.log('  managingDao=', managingDao);
    console.log('  ensAddress=', ensAddress);
    console.log('  node=', nodeHex);

    try {
      const tx = await registrar.initialize(managingDao, ensAddress, nodeHex, {
        gasLimit: 500000,
      });
      console.log('initialize tx hash:', tx.hash);
      const receipt = await tx.wait();
      console.log(
        'initialize receipt status:',
        receipt.status,
        'logs:',
        receipt.logs.length
      );
    } catch (e) {
      console.error('initialize() failed:', e && e.message ? e.message : e);
      process.exit(1);
    }
  } else {
    // print helpful instructions for running initialize in fork
    const pluginEnsDomain = (() => {
      try {
        const {PLUGIN_REPO_ENS_SUBDOMAIN_NAME} = require('../plugin-settings');
        const {utils} = require('ethers');
        const name =
          process.env.NETWORK_NAME === 'sepolia'
            ? `${PLUGIN_REPO_ENS_SUBDOMAIN_NAME}.plugin.aragon-dao.eth`
            : `${PLUGIN_REPO_ENS_SUBDOMAIN_NAME}.plugin.dao.eth`;
        const namehash = require('eth-ens-namehash').hash;
        return {name, node: namehash(name)};
      } catch (e) {
        return null;
      }
    })();

    console.log(
      '\nNo initialization will be performed unless you set FORCE_INITIALIZE=true and provide parameters.'
    );
    console.log('Example (run after starting a local fork):');
    console.log(
      '  MANAGEMENT_DAO_ADDRESS=0x... ENS_ADDRESS=0x... NODE=0x... FORCE_INITIALIZE=true npx hardhat run --network localhost packages/contracts/scripts/initialize-registrar.js'
    );
    if (pluginEnsDomain) {
      console.log('Suggested plugin ENS domain:', pluginEnsDomain.name);
      console.log('Suggested NODE (namehash):', pluginEnsDomain.node);
    }
  }
}

main().catch(err => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
