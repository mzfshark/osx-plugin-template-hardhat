import { ethers } from 'hardhat';

const GRANT_PERMISSION_NAME = 'MANAGE_ALLOWLIST_PERMISSION';

function getArgValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function requireAddress(label: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${label} is required.`);
  }
  if (!ethers.utils.isAddress(value)) {
    throw new Error(`${label} is not a valid address: ${value}`);
  }
  return value;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const allowlistAddress = requireAddress(
    'Allowlist address (--allowlist)',
    getArgValue(args, '--allowlist') || process.env.HIP_PLUGIN_ALLOWLIST_ADDRESS
  );

  const executorAddress = requireAddress(
    'Executor address (--executor)',
    getArgValue(args, '--executor') || process.env.GLOBAL_EXECUTOR_ADDRESS
  );

  const managementDaoAddress = requireAddress(
    'Management DAO address (--dao)',
    getArgValue(args, '--dao') ||
      process.env.MANAGEMENT_DAO_PROXY_ADDRESS ||
      process.env.MANAGEMENT_DAO_ADDRESS
  );

  const signer = (await ethers.getSigners())[0];
  if (!signer) {
    throw new Error('No signer available. Check PRIVATE_KEY in .env.');
  }

  const daoAbi = [
    'function grant(address where, address who, bytes32 permissionId) external',
  ];

  const permissionId = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes(GRANT_PERMISSION_NAME)
  );

  const dao = new ethers.Contract(managementDaoAddress, daoAbi, signer);

  console.log('Granting allowlist permission...');
  console.log('Management DAO:', managementDaoAddress);
  console.log('Allowlist:', allowlistAddress);
  console.log('Executor:', executorAddress);
  console.log('Permission:', GRANT_PERMISSION_NAME, permissionId);

  const tx = await dao.grant(allowlistAddress, executorAddress, permissionId);
  console.log('Transaction sent:', tx.hash);

  const receipt = await tx.wait();
  console.log('Grant confirmed in block:', receipt.blockNumber);
}

main().catch((error) => {
  console.error('Grant failed:', error);
  process.exitCode = 1;
});
