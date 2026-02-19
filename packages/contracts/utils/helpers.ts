import {PLUGIN_REPO_ENS_SUBDOMAIN_NAME} from '../plugin-settings';
import {
  SupportedNetworks,
  getLatestNetworkDeployment,
  getNetworkNameByAlias,
} from '@aragon/osx-commons-configs';
import {UnsupportedNetworkError, findEvent} from '@aragon/osx-commons-sdk';
import {
  ENSSubdomainRegistrar__factory,
  ENS__factory,
  IAddrResolver__factory,
  PluginRepo,
  PluginRepoEvents,
  PluginRepo__factory,
} from '@aragon/osx-ethers';
import {ContractTransaction, utils} from 'ethers';
import {ethers} from 'hardhat';
import {HardhatRuntimeEnvironment} from 'hardhat/types';

export function isLocal(hre: HardhatRuntimeEnvironment): boolean {
  return (
    hre.network.name === 'localhost' ||
    hre.network.name === 'hardhat' ||
    hre.network.name === 'coverage'
  );
}

export function getProductionNetworkName(
  hre: HardhatRuntimeEnvironment
): string {
  let productionNetworkName: string;
  if (isLocal(hre)) {
    if (process.env.NETWORK_NAME) {
      productionNetworkName = process.env.NETWORK_NAME;
    } else {
      console.log(
        `No network has been provided in the '.env' file. Defaulting to '${SupportedNetworks.SEPOLIA}' as the production network.`
      );
      productionNetworkName = SupportedNetworks.SEPOLIA;
    }
  } else {
    productionNetworkName = hre.network.name;
  }

  if (getNetworkNameByAlias(productionNetworkName) === null) {
    // Try common fallbacks for network naming used by Hardhat or users.
    const FALLBACK_MAP: {[key: string]: string} = {
      harmony: 'harmony-mainnet',
      harmonyTestnet: 'harmony-testnet',
      harmony_testnet: 'harmony-testnet',
      mainnet: 'ethereum-mainnet',
      sepolia: 'sepolia',
    };

    const mapped = FALLBACK_MAP[productionNetworkName];
    if (mapped) {
      // Accept the mapped canonical name even if `getNetworkNameByAlias`
      // doesn't recognise the original raw name. Downstream code will
      // attempt to resolve aliases again where needed.
      productionNetworkName = mapped;
    } else {
      throw new UnsupportedNetworkError(productionNetworkName);
    }
  }

  return productionNetworkName;
}

/**
 * Resolve a production network name (alias) into a canonical network key
 * understood by `getLatestNetworkDeployment` and related helpers.
 * Throws `UnsupportedNetworkError` if resolution fails.
 */
export function resolveNetworkName(productionNetworkName: string): string {
  const canonicalCandidates = new Set<string>([productionNetworkName]);
  canonicalCandidates.add(productionNetworkName.replace(/-mainnet$/, ''));
  canonicalCandidates.add(productionNetworkName.replace(/-testnet$/, ''));
  canonicalCandidates.add('harmony');
  canonicalCandidates.add('harmony-mainnet');
  canonicalCandidates.add('harmony-testnet');
  canonicalCandidates.add('ethereum-mainnet');
  canonicalCandidates.add('mainnet');
  canonicalCandidates.add('sepolia');

  for (const candidate of canonicalCandidates) {
    if (!candidate) continue;
    const alias = getNetworkNameByAlias(candidate);
    if (alias !== null) return alias;

    // Defensive: some versions of the deployments getter may throw or
    // return malformed objects for unknown candidates. Wrap the call
    // and validate the returned structure before accepting the candidate.
    try {
      const d = getLatestNetworkDeployment(candidate as any);
      if (d !== null && typeof d === 'object' && Object.keys(d).length > 0) {
        return candidate;
      }
    } catch (err) {
      // Ignore and try the next candidate
    }
  }

  throw new UnsupportedNetworkError(productionNetworkName);
}

export function pluginEnsDomain(hre: HardhatRuntimeEnvironment): string {
  const network = getProductionNetworkName(hre);
  if (network === SupportedNetworks.SEPOLIA) {
    return `${PLUGIN_REPO_ENS_SUBDOMAIN_NAME}.plugin.aragon-dao.eth`;
  } else {
    return `${PLUGIN_REPO_ENS_SUBDOMAIN_NAME}.plugin.dao.eth`;
  }
}

export async function findPluginRepo(
  hre: HardhatRuntimeEnvironment
): Promise<{pluginRepo: PluginRepo | null; ensDomain: string}> {
  const [deployer] = await hre.ethers.getSigners();
  const productionNetworkName: string = getProductionNetworkName(hre);
  const resolvedNetwork = resolveNetworkName(productionNetworkName);
  const networkDeployments = getLatestNetworkDeployment(resolvedNetwork);
  if (networkDeployments === null) {
    throw `Deployments are not available on network ${network}.`;
  }

  // Ensure expected keys exist on the resolved deployments object to
  // avoid downstream TypeErrors when accessing nested version data.
  if (
    typeof networkDeployments !== 'object' ||
    Object.keys(networkDeployments).length === 0 ||
    !('PluginENSSubdomainRegistrarProxy' in networkDeployments)
  ) {
    throw new Error(
      `Invalid deployments object for network ${resolvedNetwork}; expected PluginENSSubdomainRegistrarProxy to be present.`
    );
  }

  const registrar = await hre.ethers.getContractAt(
    ENSSubdomainRegistrar__factory.abi,
    networkDeployments.PluginENSSubdomainRegistrarProxy.address,
    deployer
  );

  // Check if the ens record exists already
  const ensDomain = pluginEnsDomain(hre);
  // Use ethers.utils.namehash when available, otherwise fall back to
  // the `eth-ens-namehash` package which provides a compatible hash.
  let namehashFn: (name: string) => string;
  try {
    namehashFn = utils && typeof (utils as any).namehash === 'function'
      ? (utils as any).namehash
      : require('eth-ens-namehash').hash;
  } catch (err) {
    // If requiring the fallback fails for any reason, rethrow with context.
    throw new Error(`Failed to resolve namehash function: ${err}`);
  }

  const node = namehashFn(ensDomain);

  let ensAddress: string;
  try {
    ensAddress = await registrar.ens();
  } catch (err: any) {
    // If the registrar contract is not initialized on this network
    // (INIT_NOT_INITIALIZED) or the call reverts for another reason,
    // treat the ENS as not present and continue without failing the
    // entire deployment flow.
    console.warn(
      `Registrar call failed for ${networkDeployments.PluginENSSubdomainRegistrarProxy.address}: ${
        err && err.message ? err.message : String(err)
      }`
    );
    return {pluginRepo: null, ensDomain};
  }

  const ens = await hre.ethers.getContractAt(ENS__factory.abi, ensAddress, deployer);
  const recordExists = await ens.recordExists(node);

  if (!recordExists) {
    return {pluginRepo: null, ensDomain};
  } else {
    const resolver = await hre.ethers.getContractAt(
      IAddrResolver__factory.abi,
      await ens.resolver(node),
      deployer
    );

    const pluginRepo = await hre.ethers.getContractAt(
      PluginRepo__factory.abi,
      await resolver.addr(node),
      deployer
    );
    return {
      pluginRepo,
      ensDomain,
    };
  }
}

export type EventWithBlockNumber = {
  event: utils.LogDescription;
  blockNumber: number;
};

export async function getPastVersionCreatedEvents(
  pluginRepo: PluginRepo
): Promise<EventWithBlockNumber[]> {
  const eventFilter = pluginRepo.filters['VersionCreated']();

  const logs = await pluginRepo.provider.getLogs({
    fromBlock: 0,
    toBlock: 'latest',
    address: pluginRepo.address,
    topics: eventFilter.topics,
  });

  return logs.map((log, index) => {
    return {
      event: pluginRepo.interface.parseLog(log),
      blockNumber: logs[index].blockNumber,
    };
  });
}

export type LatestVersion = {
  versionTag: PluginRepo.VersionStruct;
  pluginSetupContract: string;
  releaseMetadata: string;
  buildMetadata: string;
};

export async function createVersion(
  pluginRepoContract: string,
  pluginSetupContract: string,
  releaseNumber: number,
  releaseMetadata: string,
  buildMetadata: string
): Promise<ContractTransaction> {
  const signers = await ethers.getSigners();

  const PluginRepo = new PluginRepo__factory(signers[0]);
  const pluginRepo = PluginRepo.attach(pluginRepoContract);

  const tx = await pluginRepo.createVersion(
    releaseNumber,
    pluginSetupContract,
    buildMetadata,
    releaseMetadata
  );

  console.log(`Creating build for release ${releaseNumber} with tx ${tx.hash}`);

  await tx.wait();

  const versionCreatedEvent = findEvent<PluginRepoEvents.VersionCreatedEvent>(
    await tx.wait(),
    pluginRepo.interface.events['VersionCreated(uint8,uint16,address,bytes)']
      .name
  );

  // Check if versionCreatedEvent is not undefined
  if (versionCreatedEvent) {
    console.log(
      `Created build ${versionCreatedEvent.args.build} for release ${
        versionCreatedEvent.args.release
      } with setup address: ${
        versionCreatedEvent.args.pluginSetup
      }, with build metadata ${ethers.utils.toUtf8String(
        buildMetadata
      )} and release metadata ${ethers.utils.toUtf8String(releaseMetadata)}`
    );
  } else {
    // Handle the case where the event is not found
    throw new Error('Failed to get VersionCreatedEvent event log');
  }
  return tx;
}

export const AragonOSxAsciiArt =
  "                                          ____   _____      \n     /\\                                  / __ \\ / ____|     \n    /  \\   _ __ __ _  __ _  ___  _ __   | |  | | (_____  __ \n   / /\\ \\ | '__/ _` |/ _` |/ _ \\| '_ \\  | |  | |\\___ \\ \\/ / \n  / ____ \\| | | (_| | (_| | (_) | | | | | |__| |____) >  <  \n /_/    \\_\\_|  \\__,_|\\__, |\\___/|_| |_|  \\____/|_____/_/\\_\\ \n                      __/ |                                 \n                     |___/                                  \n";
