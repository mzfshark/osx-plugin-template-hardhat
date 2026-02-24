const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const txHash = process.env.TX_HASH || process.argv[2];
  const rpc = process.env.HARMONY_RPC_URL || process.env.RPC_URL;
  const forkBlock = process.env.FORK_BLOCK ? Number(process.env.FORK_BLOCK) : undefined;

  if (!txHash) throw new Error("Missing TX_HASH (env or arg)");
  if (!rpc) throw new Error("Missing HARMONY_RPC_URL (set env HARMONY_RPC_URL)");

  console.log(`Forking from ${rpc}${forkBlock ? ' @ block '+forkBlock : ''}...`);
  await hre.network.provider.request({
    method: "hardhat_reset",
    params: [{
      forking: {
        jsonRpcUrl: rpc,
        ...(forkBlock ? { blockNumber: forkBlock } : {}),
      },
    }],
  });

  const provider = ethers.provider;
  const origTx = await provider.getTransaction(txHash);
  if (!origTx) throw new Error(`Transaction ${txHash} not found`);

  console.log("Original tx:", {
    hash: origTx.hash,
    from: origTx.from,
    to: origTx.to,
    nonce: origTx.nonce && origTx.nonce.toString(),
    value: origTx.value && origTx.value.toString(),
    gasLimit: origTx.gasLimit && origTx.gasLimit.toString(),
    gasPrice: origTx.gasPrice && origTx.gasPrice.toString(),
  });

  const callTx = {
    from: origTx.from,
    to: origTx.to, // null for contract creation
    data: origTx.data,
    value: origTx.value ? origTx.value.toHexString() : undefined,
    gas: origTx.gasLimit ? origTx.gasLimit.toHexString() : undefined,
  };

  // Impersonate and fund
  console.log(`Impersonating ${origTx.from} and topping balance`);
  await hre.network.provider.request({ method: "hardhat_impersonateAccount", params: [origTx.from] });
  // give a lot of balance
  await hre.network.provider.request({ method: "hardhat_setBalance", params: [origTx.from, "0x3635C9ADC5DEA00000"] }); // 1000 ETH

  // Try eth_call to get revert reason (doesn't change chain)
  try {
    console.log("Trying provider.call (eth_call) to capture revert reason...");
    const callRes = await provider.call(callTx);
    console.log("eth_call returned (hex):", callRes);
    if (callRes && callRes !== '0x') console.log("Possible return data (decoded hex):", callRes);
  } catch (err) {
    console.error("eth_call error:", err && err.error ? err.error : err);
  }

  // Try estimateGas (will often surface revert reason)
  try {
    console.log("Trying estimateGas...");
    const est = await provider.estimateGas(callTx);
    console.log("estimateGas:", est.toString());
  } catch (err) {
    console.error("estimateGas error:", err && err.error ? err.error : err);
  }

  // Optionally perform an actual send (will create contract if to==null). Use signer from impersonated account
  try {
    console.log("Sending a real transaction from impersonated account (will be mined in fork)...");
    const signer = await ethers.getSigner(origTx.from);
    const txRequest = {
      to: origTx.to || undefined,
      data: origTx.data,
      value: origTx.value || undefined,
      gasLimit: origTx.gasLimit || undefined,
      gasPrice: origTx.gasPrice || undefined,
    };
    const sent = await signer.sendTransaction(txRequest);
    console.log("sent tx hash:", sent.hash);
    const rec = await sent.wait();
    console.log("receipt:", rec);
  } catch (err) {
    console.error("sendTransaction error:", err && err.error ? err.error : err);
  }

  // stop impersonation
  await hre.network.provider.request({ method: "hardhat_stopImpersonatingAccount", params: [origTx.from] });
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
