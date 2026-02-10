import buildMetadata from './src/build-metadata.json';
import releaseMetadata from './src/release-metadata.json';
import {VersionTag} from '@aragon/osx-commons-sdk';

export function generateRandomName(length: number): string {
  const allowedCharacters = 'abcdefghijklmnopqrstuvwxyz-0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += allowedCharacters.charAt(
      Math.floor(Math.random() * allowedCharacters.length)
    );
  }
  return result;
}

// Specify your plugin implementation and plugin setup contract name.
export const PLUGIN_CONTRACT_NAME = 'HarmonyHIPVotingPlugin'; // See `packages/contracts/src/harmony/HarmonyHIPVotingPlugin.sol`.
export const PLUGIN_SETUP_CONTRACT_NAME = 'HarmonyHIPVotingSetup'; // See `packages/contracts/src/setup/HarmonyHIPVotingSetup.sol`.

// Pick an ENS name for your plugin. E.g., 'my-cool-plugin'.
// For more details, visit https://devs.aragon.org/docs/osx/how-it-works/framework/ens-names.
export const PLUGIN_REPO_ENS_SUBDOMAIN_NAME = generateRandomName(8);

// Specify the version of your plugin that you are currently working on. The first version is v1.1.
// For more details, visit https://devs.aragon.org/docs/osx/how-it-works/framework/plugin-management/plugin-repo.
export const VERSION: VersionTag = {
  release: 1, // Increment this number ONLY if breaking/incompatible changes were made. Updates between releases are NOT possible.
  build: 1, // Increment this number if non-breaking/compatible changes were made. Updates to newer builds are possible.
};

// The metadata associated with the plugin version you are currently working on.
// For more details, visit https://devs.aragon.org/docs/osx/how-to-guides/plugin-development/publication/metadata.
// Don't change this unless you know what you are doing.
export const METADATA = {
  build: buildMetadata,
  release: releaseMetadata,
};

// Specify your plugin setup contract constructor arguments.
export const PLUGIN_SETUP_CONTRACT_ARGS: {[key: string]: any[]} = {
  HarmonyHIPVotingSetup: [
    process.env.ORACLE_ADDRESS || '0xA55d9ef16Af921b70Fed1421C1D298Ca5A3a18F1',
    process.env.ALLOWLIST_PROXY_ADDRESS ||
      '0xe7b0445369b7a653ad4f05f79b5797bc3fefcef7',
    process.env.OPT_IN_REGISTRY_ADDRESS ||
      '0xefd431a6c97bff60dd60eeadedee3ce38e561180',
  ],
  HarmonyDelegationVotingSetup: [
    process.env.ORACLE_ADDRESS || '0xA55d9ef16Af921b70Fed1421C1D298Ca5A3a18F1',
    process.env.OPT_IN_REGISTRY_ADDRESS ||
      '0xefd431a6c97bff60dd60eeadedee3ce38e561180',
    process.env.ALLOWLIST_PROXY_ADDRESS ||
      '0xe7b0445369b7a653ad4f05f79b5797bc3fefcef7',
  ],
};

