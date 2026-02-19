const hre = require('hardhat');

async function main() {
  const txHash = process.env.TX_HASH || process.argv[2];
  if (!txHash) {
    console.error(
      'Usage: TX_HASH=<hash> node inspect-tx.js OR pass hash as first arg'
    );
    process.exit(1);
  }

  const provider = hre.ethers.provider;
  console.log('Inspecting tx', txHash);

  const tx = await provider.getTransaction(txHash);
  const receipt = await provider.getTransactionReceipt(txHash);
  console.log('TX:', tx);
  console.log('RECEIPT:', receipt);

  if (receipt && receipt.logs && receipt.logs.length) {
    console.log('Logs count:', receipt.logs.length);
  } else {
    console.log('No logs in receipt');
  }

  if (tx) {
    try {
      const callResult = await provider.call(
        {
          to: tx.to,
          data: tx.data,
          from: tx.from,
          value: tx.value || 0,
        },
        receipt ? receipt.blockNumber : 'latest'
      );
      console.log('Call result (may be revert data):', callResult);
    } catch (err) {
      console.log(
        'provider.call error (likely revert reason):',
        err && err.message ? err.message : err
      );
      // Try to extract revert reason from error message
      if (err && err.error && err.error.message) {
        console.log('Nested error:', err.error.message);
      }
    }
  }

  // For each log print address and code size
  if (receipt && receipt.logs) {
    for (const log of receipt.logs) {
      try {
        const addr = log.address;
        const code = await provider.getCode(addr);
        console.log(
          `Log address ${addr} code length: ${code ? code.length : 0}`
        );
      } catch (e) {
        // ignore
      }
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
