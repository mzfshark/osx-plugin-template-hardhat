import {
  PLUGIN_SETUP_CONTRACT_NAME,
  PLUGIN_SETUP_CONTRACT_ARGS,
} from '../../plugin-settings';
import { getFeeOverrides } from '../../utils/helpers';
import {DeployFunction} from 'hardhat-deploy/types';
import {HardhatRuntimeEnvironment} from 'hardhat/types';
import path from 'path';

/**
 * Deploys the plugin setup contract with the plugin implementation inside.
 * @param {HardhatRuntimeEnvironment} hre
 */
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  console.log(`\n🏗️  ${path.basename(__filename)}:`);

  const {deployments, getNamedAccounts} = hre;
  const {deploy} = deployments;
  const {deployer} = await getNamedAccounts();

  const args = PLUGIN_SETUP_CONTRACT_ARGS[PLUGIN_SETUP_CONTRACT_NAME] || [];

  // Attempt deploy with retries on `transaction underpriced` by increasing fees.
  const baseOverrides = await getFeeOverrides(hre, 1_500_000);
  let res: any = null;
  const multipliers = [1, 1.5, 2, 3];
  for (let i = 0; i < multipliers.length; i++) {
    const m = multipliers[i];
    // clone and scale BN fields if present
    const attemptOverrides: any = { ...(baseOverrides as object) };
    try {
      const { BigNumber } = hre.ethers;
      for (const key of ['maxFeePerGas', 'maxPriorityFeePerGas', 'gasPrice']) {
        if (attemptOverrides[key]) {
          try {
            attemptOverrides[key] = BigNumber.from(attemptOverrides[key]).mul(Math.round(m * 100)).div(100);
          } catch (e) {
            // ignore if not BN-convertible
          }
        }
      }

      console.log(`Deploy attempt ${i + 1} with multiplier x${m}`, attemptOverrides.maxFeePerGas ? 'using EIP-1559' : 'using gasPrice');
      res = await deploy(PLUGIN_SETUP_CONTRACT_NAME, {
        from: deployer,
        args: args,
        log: true,
        ...attemptOverrides,
      });

      // success
      break;
    } catch (err: any) {
      const msg = err && (err.message || err.error || err.stack) ? (err.message || err.error || err.stack) : String(err);
      console.warn(`Deploy attempt ${i + 1} failed:`, msg);
      // If this was the last attempt, rethrow
      if (i === multipliers.length - 1) throw err;
      // Otherwise wait briefly and retry
      await new Promise(r => setTimeout(r, 1500 * (i + 1)));
    }
  }

  console.log(
    `Deployed '${PLUGIN_SETUP_CONTRACT_NAME}' contract at '${res.address}'`
  );
};

export default func;
func.tags = [PLUGIN_SETUP_CONTRACT_NAME, 'NewVersion', 'Deployment'];
