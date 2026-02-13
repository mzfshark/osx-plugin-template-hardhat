import fs from 'fs';
import path from 'path';

import { ethers, upgrades } from 'hardhat';
import {
  PluginRepo__factory,
  PluginRepoFactory__factory,
  PluginRepoRegistry__factory,
} from '@aragon/osx-ethers';

const HARMONY_CHAIN_ID = 1666600000;

const DEFAULTS = {
  PLUGIN_REPO_FACTORY_ADDRESS: '0x753e32a799F319d25aCf138b343003ce0A5171eB',
  PLUGIN_REPO_REGISTRY_ADDRESS: '0x24416Fcd035314C952A16549b47E8251aCdd844E',
  MANAGEMENT_DAO_ADDRESS: '0x8f9a805603B6fd5df7e8d284CA66CcaF77C3BeF6',
  ORACLE_ADDRESS: '0xA55d9ef16Af921b70Fed1421C1D298Ca5A3a18F1',
  OPT_IN_REGISTRY_ADDRESS: '0xefd431a6c97bff60dd60eeadedee3ce38e561180',
};

function requireAddress(name: string, value: string | undefined, fallback?: string): string {
  const resolved = (value ?? fallback ?? '').trim();
  if (!ethers.utils.isAddress(resolved)) {
    throw new Error(`${name} is missing or not a valid address: '${resolved}'`);
  }
  return ethers.utils.getAddress(resolved);
}

function randomSuffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function toBytes(value: string): string {
  return ethers.utils.hexlify(ethers.utils.toUtf8Bytes(value));
}

async function createPluginRepo(params: {
  repoFactoryAddress: string;
  repoRegistryAddress: string;
  subdomain: string;
  maintainer: string;
}) {
  const [deployer] = await ethers.getSigners();
  const factory = PluginRepoFactory__factory.connect(params.repoFactoryAddress, deployer);

  const tx = await factory.createPluginRepo(params.subdomain, params.maintainer);
  const receipt = await tx.wait();

  const iface = PluginRepoRegistry__factory.createInterface();

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== params.repoRegistryAddress.toLowerCase()) continue;
    try {
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed.name === 'PluginRepoRegistered') {
        const pluginRepoAddress = parsed.args.pluginRepo as string;
        return {
          address: ethers.utils.getAddress(pluginRepoAddress),
          txHash: receipt.transactionHash,
          blockNumber: receipt.blockNumber,
        };
      }
    } catch {
      // ignore non-matching logs
    }
  }

  throw new Error('PluginRepoRegistered event not found in transaction receipt');
}

async function publishVersion(params: {
  repoAddress: string;
  setupAddress: string;
  release: number;
  build: number;
  buildMetadataUri: string;
  releaseMetadataUri: string;
}) {
  const [deployer] = await ethers.getSigners();
  const repo = PluginRepo__factory.connect(params.repoAddress, deployer);

  const tx = await repo.createVersion(
    params.release,
    params.setupAddress,
    toBytes(params.buildMetadataUri),
    toBytes(params.releaseMetadataUri)
  );
  const receipt = await tx.wait();
  return {
    txHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber,
  };
}

async function main() {
  const network = await ethers.provider.getNetwork();
  if (Number(network.chainId) !== HARMONY_CHAIN_ID) {
    throw new Error(`Wrong network. Expected chainId=${HARMONY_CHAIN_ID}, got chainId=${network.chainId}`);
  }

  const [deployer] = await ethers.getSigners();

  const repoFactoryAddress = requireAddress(
    'PLUGIN_REPO_FACTORY_ADDRESS',
    process.env.PLUGIN_REPO_FACTORY_ADDRESS,
    DEFAULTS.PLUGIN_REPO_FACTORY_ADDRESS
  );
  const repoRegistryAddress = requireAddress(
    'PLUGIN_REPO_REGISTRY_ADDRESS',
    process.env.PLUGIN_REPO_REGISTRY_ADDRESS,
    DEFAULTS.PLUGIN_REPO_REGISTRY_ADDRESS
  );
  const managementDaoAddress = requireAddress(
    'MANAGEMENT_DAO_ADDRESS',
    process.env.MANAGEMENT_DAO_ADDRESS,
    DEFAULTS.MANAGEMENT_DAO_ADDRESS
  );
  const oracleAddress = requireAddress('ORACLE_ADDRESS', process.env.ORACLE_ADDRESS, DEFAULTS.ORACLE_ADDRESS);
  const optInRegistryAddress = requireAddress(
    'OPT_IN_REGISTRY_ADDRESS',
    process.env.OPT_IN_REGISTRY_ADDRESS,
    DEFAULTS.OPT_IN_REGISTRY_ADDRESS
  );

  const hipRepoSubdomain = (process.env.HARMONY_HIP_REPO_SUBDOMAIN || `harmony-hip-${randomSuffix()}`).trim();
  const delegationRepoSubdomain = (
    process.env.HARMONY_DELEGATION_REPO_SUBDOMAIN || `harmony-delegation-${randomSuffix()}`
  ).trim();

  const buildMetadataUri = (process.env.BUILD_METADATA_URI || '').trim();
  const releaseMetadataUri = (process.env.RELEASE_METADATA_URI || '').trim();

  console.log('Network:', network);
  console.log('Deployer:', deployer.address);
  console.log('PluginRepoFactory:', repoFactoryAddress);
  console.log('PluginRepoRegistry:', repoRegistryAddress);
  console.log('Management DAO:', managementDaoAddress);

  // 1) Deploy allowlist implementation + proxy (UUPS)
  const Allowlist = await ethers.getContractFactory('HIPPluginAllowlist');
  const allowlistProxy = await upgrades.deployProxy(Allowlist, [managementDaoAddress], { kind: 'uups' });
  await allowlistProxy.deployed();

  const allowlistProxyAddress = allowlistProxy.address;
  const allowlistImplementationAddress = await upgrades.erc1967.getImplementationAddress(allowlistProxyAddress);

  console.log('HIPPluginAllowlist proxy:', allowlistProxyAddress);
  console.log('HIPPluginAllowlist implementation:', allowlistImplementationAddress);

  // 2) Deploy setup contracts
  const HipSetup = await ethers.getContractFactory('HarmonyHIPVotingSetup');
  const hipSetup = await HipSetup.deploy(oracleAddress, allowlistProxyAddress, optInRegistryAddress);
  await hipSetup.deployed();

  const DelegationSetup = await ethers.getContractFactory('HarmonyDelegationVotingSetup');
  const delegationSetup = await DelegationSetup.deploy(oracleAddress, optInRegistryAddress, allowlistProxyAddress);
  await delegationSetup.deployed();

  console.log('HarmonyHIPVotingSetup:', hipSetup.address);
  console.log('HarmonyDelegationVotingSetup:', delegationSetup.address);

  // 3) Create plugin repos
  const hipRepo = await createPluginRepo({
    repoFactoryAddress,
    repoRegistryAddress,
    subdomain: hipRepoSubdomain,
    maintainer: deployer.address,
  });

  const delegationRepo = await createPluginRepo({
    repoFactoryAddress,
    repoRegistryAddress,
    subdomain: delegationRepoSubdomain,
    maintainer: deployer.address,
  });

  console.log('Harmony HIP PluginRepo:', hipRepo.address, 'subdomain:', hipRepoSubdomain);
  console.log('Harmony Delegation PluginRepo:', delegationRepo.address, 'subdomain:', delegationRepoSubdomain);

  // 4) Publish v1.1 for each repo
  const hipPublish = await publishVersion({
    repoAddress: hipRepo.address,
    setupAddress: hipSetup.address,
    release: 1,
    build: 1,
    buildMetadataUri,
    releaseMetadataUri,
  });

  const delegationPublish = await publishVersion({
    repoAddress: delegationRepo.address,
    setupAddress: delegationSetup.address,
    release: 1,
    build: 1,
    buildMetadataUri,
    releaseMetadataUri,
  });

  const output = {
    network: 'harmony',
    chainId: HARMONY_CHAIN_ID,
    generatedAt: new Date().toISOString(),
    inputs: {
      pluginRepoFactory: repoFactoryAddress,
      pluginRepoRegistry: repoRegistryAddress,
      managementDao: managementDaoAddress,
      oracle: oracleAddress,
      optInRegistry: optInRegistryAddress,
      hipRepoSubdomain,
      delegationRepoSubdomain,
    },
    contracts: {
      HIPPluginAllowlist: {
        implementation: allowlistImplementationAddress,
        proxy: allowlistProxyAddress,
      },
      HarmonyHIPVotingSetup: {
        address: hipSetup.address,
      },
      HarmonyDelegationVotingSetup: {
        address: delegationSetup.address,
      },
      HarmonyHIPVotingPluginRepo: {
        address: hipRepo.address,
        createTxHash: hipRepo.txHash,
        createBlockNumber: hipRepo.blockNumber,
        publishTxHash: hipPublish.txHash,
        publishBlockNumber: hipPublish.blockNumber,
      },
      HarmonyDelegationVotingPluginRepo: {
        address: delegationRepo.address,
        createTxHash: delegationRepo.txHash,
        createBlockNumber: delegationRepo.blockNumber,
        publishTxHash: delegationPublish.txHash,
        publishBlockNumber: delegationPublish.blockNumber,
      },
    },
  };

  const outDir = path.resolve(process.cwd(), 'tmp');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `harmony-redeploy-output-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log('---');
  console.log('Wrote deployment output to:', outPath);
  console.log(JSON.stringify(output, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
