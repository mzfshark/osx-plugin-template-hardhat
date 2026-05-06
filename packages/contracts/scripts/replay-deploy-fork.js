const hre = require('hardhat');
const {ethers} = hre;

async function main() {
  const txHash = process.env.TX_HASH || process.argv[2];
  const rpc = process.env.HARMONY_RPC_URL || process.env.RPC_URL;
  const forkBlock = process.env.FORK_BLOCK
    ? Number(process.env.FORK_BLOCK)
    : undefined;

  if (!txHash) throw new Error('Missing TX_HASH (env or arg)');
  if (!rpc)
    throw new Error('Missing HARMONY_RPC_URL (set env HARMONY_RPC_URL)');

  console.log(
    `Forking from ${rpc}${forkBlock ? ' @ block ' + forkBlock : ''}...`
  );
  await hre.network.provider.request({
    method: 'hardhat_reset',
    params: [
      {
        forking: {
          jsonRpcUrl: rpc,
          ...(forkBlock ? {blockNumber: forkBlock} : {}),
        },
      },
    ],
  });

  const provider = ethers.provider;
  const origTx = await provider.getTransaction(txHash);
  if (!origTx) throw new Error(`Transaction ${txHash} not found`);

  console.log('Original tx:', {
    hash: origTx.hash,
    from: origTx.from,
    to: origTx.to,
    nonce: origTx.nonce && origTx.nonce.toString(),
    value: origTx.value && origTx.value.toString(),
    gasLimit: origTx.gasLimit && origTx.gasLimit.toString(),
    gasPrice: origTx.gasPrice && origTx.gasPrice.toString(),
  });

  // helper to produce hex for different value types
  function toHex(v) {
    if (!v && v !== 0) return undefined;
    try {
      // ethers.utils.hexValue accepts BigNumber, number, hex string
      return ethers.utils.hexValue(v);
    } catch (e) {
      // fallback for bigint or plain string numbers
      if (typeof v === 'bigint') return '0x' + v.toString(16);
      if (typeof v === 'string') {
        if (v.startsWith('0x')) return v;
        const n = Number(v);
        if (!Number.isNaN(n)) return ethers.utils.hexValue(n);
      }
      if (typeof v === 'number') return ethers.utils.hexValue(v);
      return undefined;
    }
  }

  const callTx = {
    from: origTx.from,
    to: origTx.to || undefined, // null for contract creation -> undefined
    data: origTx.data,
    value: origTx.value ? toHex(origTx.value) : undefined,
    gas: origTx.gasLimit ? toHex(origTx.gasLimit) : undefined,
  };

  // Impersonate and fund
  console.log(`Impersonating ${origTx.from} and topping balance`);
  await hre.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [origTx.from],
  });
  // give a lot of balance
  await hre.network.provider.request({
    method: 'hardhat_setBalance',
    params: [origTx.from, '0x3635C9ADC5DEA00000'],
  }); // 1000 ETH

  // Try eth_call to get revert reason (doesn't change chain)
  try {
    console.log('Trying provider.call (eth_call) to capture revert reason...');
    const callRes = await provider.call(callTx);
    console.log('eth_call returned (hex):', callRes);
    if (callRes && callRes !== '0x')
      console.log('Possible return data (decoded hex):', callRes);
  } catch (err) {
    console.error('eth_call error:', err && err.error ? err.error : err);
  }

  // Try estimateGas (will often surface revert reason)
  let estimatedGas;
  try {
    console.log('Trying estimateGas...');
    const est = await provider.estimateGas(callTx);
    console.log('estimateGas:', est.toString());
    estimatedGas = est;
  } catch (err) {
    console.error('estimateGas error:', err && err.error ? err.error : err);
  }

  // Optionally perform an actual send (will create contract if to==null). Use signer from impersonated account
  try {
    console.log(
      'Sending a real transaction from impersonated account (will be mined in fork)...'
    );
    const signer = await ethers.getSigner(origTx.from);

    // helpers
    const bnFrom = v => {
      if (v === undefined || v === null) return null;
      try {
        return ethers.BigNumber.from(v.toString());
      } catch (e) {
        console.error('bnFrom: failed to convert value to BigNumber', {
          value: v,
          type: typeof v,
          err: e && e.message,
        });
        return null;
      }
    };

    const origGasBN = bnFrom(origTx.gasLimit);
    const estGasBN = estimatedGas ? bnFrom(estimatedGas) : null;

    // choose gas: prefer original, but if estimate > original, use 1.25x estimate
    let gasToUse = origGasBN || estGasBN || null;
    if (origGasBN && estGasBN && estGasBN.gt(origGasBN)) {
      gasToUse = estGasBN.mul(125).div(100);
    } else if (!origGasBN && estGasBN) {
      gasToUse = estGasBN.mul(125).div(100);
    }

    const baseTxRequest = {
      to: origTx.to || undefined,
      data: origTx.data,
      value: origTx.value || undefined,
      gasPrice: origTx.gasPrice || undefined,
    };

    // attempt send; if out-of-gas, retry once with increased gas
    let attempts = 0;
    let lastErr = null;
    while (attempts < 2) {
      attempts++;
      const txRequest = Object.assign({}, baseTxRequest);
      if (gasToUse) txRequest.gasLimit = gasToUse.toHexString();
      try {
        const sent = await signer.sendTransaction(txRequest);
        console.log('sent tx hash:', sent.hash);
        const rec = await sent.wait();
        console.log('receipt:', rec);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err && err.error ? err.error : err;
        console.error(`sendTransaction error (attempt ${attempts}):`, lastErr);
        const msg =
          lastErr && lastErr.message ? lastErr.message.toLowerCase() : '';
        if (
          msg.includes('out of gas') ||
          msg.includes('run out of gas') ||
          msg.includes('out-of-gas') ||
          msg.includes('gas required exceeds allowance')
        ) {
          if (!gasToUse)
            gasToUse = estGasBN
              ? estGasBN.mul(2)
              : ethers.BigNumber.from(2000000);
          else gasToUse = gasToUse.mul(2);
          console.log('Increasing gas and retrying with', gasToUse.toString());
          continue;
        } else {
          break;
        }
      }
    }
    if (lastErr) throw lastErr;
  } catch (err) {
    console.error('sendTransaction error:', err && err.error ? err.error : err);
  }

  // stop impersonation
  await hre.network.provider.request({
    method: 'hardhat_stopImpersonatingAccount',
    params: [origTx.from],
  });
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
