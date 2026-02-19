import {PLUGIN_REPO_ENS_SUBDOMAIN_NAME} from '../../plugin-settings';
import {
  findPluginRepo,
  getProductionNetworkName,
  pluginEnsDomain,
  resolveNetworkName,
} from '../../utils/helpers';
import {
  getLatestNetworkDeployment,
  getNetworkNameByAlias,
} from '@aragon/osx-commons-configs';
import {
  UnsupportedNetworkError,
  findEventTopicLog,
} from '@aragon/osx-commons-sdk';
import {
  PluginRepoRegistryEvents,
  PluginRepoRegistry__factory,
  PluginRepo__factory,
  PluginRepoFactory__factory,
} from '@aragon/osx-ethers';
import {DeployFunction} from 'hardhat-deploy/types';
import {HardhatRuntimeEnvironment} from 'hardhat/types';
import path from 'path';

/**
 * Creates a plugin repo under Aragon's ENS base domain with subdomain requested in the `./plugin-settings.ts` file.
 * @param {HardhatRuntimeEnvironment} hre
 */
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  console.log(
    `Creating the '${pluginEnsDomain(
      hre
    )}' plugin repo through Aragon's 'PluginRepoFactory'...`
  );

  const [deployer] = await hre.ethers.getSigners();

  // Get the Aragon `PluginRepoFactory` from the `osx-commons-configs`
  const productionNetworkName = getProductionNetworkName(hre);
  const network = resolveNetworkName(productionNetworkName);
  const networkDeployments = getLatestNetworkDeployment(network);
  if (networkDeployments === null) {
    throw `Deployments are not available on network ${network}.`;
  }
  const pluginRepoFactory = await hre.ethers.getContractAt(
    PluginRepoFactory__factory.abi,
    networkDeployments.PluginRepoFactory.address,
    deployer
  );

  // Create the `PluginRepo` through the Aragon `PluginRepoFactory`
  // Some RPC providers do not implement `eth_estimateGas` properly
  // and/or require explicit fee fields. Query the provider fee data
  // and pass suitable overrides to avoid 'not implemented' or
  // 'transaction underpriced' errors.
  const feeData = await hre.ethers.provider.getFeeData();
  const overrides: any = { gasLimit: 5_000_000 };

  // Prefer EIP-1559 fields when available
  if (feeData.maxFeePerGas) {
    overrides.maxFeePerGas = feeData.maxFeePerGas;
  }
  if (feeData.maxPriorityFeePerGas) {
    overrides.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
  }

  // Fallback to legacy gasPrice if EIP-1559 is not supported
  if (!overrides.maxFeePerGas && feeData.gasPrice) {
    try {
      // add a small buffer (10%) to avoid underpriced errors
      overrides.gasPrice = feeData.gasPrice.mul(110).div(100);
    } catch (err) {
      overrides.gasPrice = feeData.gasPrice;
    }
  }

  const tx = await pluginRepoFactory.createPluginRepo(
    PLUGIN_REPO_ENS_SUBDOMAIN_NAME,
    deployer.address,
    overrides
  );

  console.log('createPluginRepo tx hash:', tx && (tx.hash || tx.transactionHash || 'unknown'));

  // Get the PluginRepo address and deployment block number from the txn and event therein
  const receipt = await tx.wait();
  if (!receipt) {
    console.error('Transaction receipt is undefined for createPluginRepo', tx);
    throw new Error('Transaction receipt is undefined for createPluginRepo');
  }

  // If transaction reverted (status === 0) provide detailed diagnostic info
  if (receipt.status === 0) {
    try {
      const txInfo = await hre.ethers.provider.getTransaction(tx.hash);
      console.error('createPluginRepo reverted', { txHash: tx.hash, receipt, txInfo });
      throw new Error(
        `createPluginRepo transaction reverted: hash=${tx.hash} status=0; see logs for receipt and txInfo`
      );
    } catch (err) {
      console.error('createPluginRepo reverted (failed to fetch tx info)', tx.hash, err);
      throw new Error(`createPluginRepo transaction reverted: hash=${tx.hash}`);
    }
  }

  let pluginRepoAddress: string | undefined;

  // First try: parse logs with the PluginRepoRegistry interface directly.
  try {
    const registryInterface = PluginRepoRegistry__factory.createInterface();
    for (const log of receipt.logs || []) {
      try {
        const parsed = registryInterface.parseLog(log as any);
        if (parsed && parsed.name === 'PluginRepoRegistered') {
          pluginRepoAddress = parsed.args.pluginRepo;
          break;
        }
      } catch (err) {
        // not a matching log for this interface
      }
    }
  } catch (err) {
    // ignore and fallback
  }

  if (!pluginRepoAddress) {
    console.warn('Event "PluginRepoRegistered" not found via interface parsing, attempting to resolve plugin repo via ENS...');
    const {pluginRepo} = await findPluginRepo(hre);
    if (pluginRepo) {
      pluginRepoAddress = pluginRepo.address;
    }
  }

  if (!pluginRepoAddress) {
    console.warn('Receipt logs:', receipt && (receipt.logs || receipt));

    // Best-effort: search receipt topics for any address that has contract code
    // on-chain. Some providers or cross-contract calls may produce logs where
    // the event parsing fails; detect likely contract addresses from topics
    // and validate by checking `getCode` on the provider.
    for (const log of receipt.logs || []) {
      const topics = log.topics || [];
      for (const t of topics) {
        try {
          // topic is 32 bytes hex; the lower 20 bytes may encode an address
          if (typeof t === 'string' && t.length >= 40) {
            const possible = '0x' + t.slice(-40);
            const code = await hre.ethers.provider.getCode(possible);
            if (code && code !== '0x') {
              pluginRepoAddress = possible;
              console.log(`Detected contract address from logs: ${possible}`);
              break;
            }
          }
        } catch (err) {
          // ignore and continue
        }
      }
      if (pluginRepoAddress) break;
    }

    if (!pluginRepoAddress) {
      throw new Error('Event "PluginRepoRegistered" could not be found and ENS lookup failed');
    }
  }

  const pluginRepo = await hre.ethers.getContractAt(
    PluginRepo__factory.abi,
    pluginRepoAddress,
    deployer
  );

  console.log(
    `PluginRepo '${pluginEnsDomain(hre)}' deployed at '${pluginRepo.address}'.`
  );

  hre.aragonToVerifyContracts.push({
    address: pluginRepo.address,
    args: [],
  });
};

export default func;
func.tags = ['CreateRepo'];

/**
 * Skips `PluginRepo` creation if the ENS name is claimed already
 * @param {HardhatRuntimeEnvironment} hre
 */
func.skip = async (hre: HardhatRuntimeEnvironment) => {
  console.log(`\n🏗️  ${path.basename(__filename)}:`);

  // Check if the ens record exists already
  const {pluginRepo, ensDomain} = await findPluginRepo(hre);

  if (pluginRepo !== null) {
    console.log(
      `ENS name '${ensDomain}' was claimed already at '${
        pluginRepo.address
      }' on network '${getProductionNetworkName(hre)}'. Skipping deployment...`
    );

    hre.aragonToVerifyContracts.push({
      address: pluginRepo.address,
      args: [],
    });

    return true;
  } else {
    console.log(`ENS name '${ensDomain}' is unclaimed. Deploying...`);

    return false;
  }
};
