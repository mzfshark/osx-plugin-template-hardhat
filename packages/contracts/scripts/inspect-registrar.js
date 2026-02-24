const hre = require('hardhat');

async function main() {
  const registrarAddr =
    process.env.REGISTRAR_ADDR || '0x35B62715459cB60bf6dC17fF8cfe138EA305E7Ee';
  const [signer] = await hre.ethers.getSigners();
  console.log('Using signer', signer.address);

  const code = await hre.ethers.provider.getCode(registrarAddr);
  console.log(
    'registrar code length:',
    code ? code.length : 0,
    'startsWith0x:',
    code === '0x'
  );

  // EIP-1967 implementation slot
  const implSlot =
    '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
  try {
    const implRaw = await hre.ethers.provider.getStorageAt(
      registrarAddr,
      implSlot
    );
    const impl = implRaw && implRaw !== '0x' ? '0x' + implRaw.slice(-40) : null;
    console.log('implementation slot raw:', implRaw);
    console.log('implementation address (EIP-1967):', impl);
    if (impl) {
      const implCode = await hre.ethers.provider.getCode(impl);
      console.log(
        'implementation code length:',
        implCode ? implCode.length : 0,
        implCode ? implCode.slice(0, 66) : implCode
      );
    }
  } catch (e) {
    console.warn(
      'Failed reading implementation slot:',
      e && e.message ? e.message : e
    );
  }

  // Try to use ABI from @aragon/osx-ethers if available
  try {
    const {
      PluginENSSubdomainRegistrar__factory,
    } = require('@aragon/osx-ethers');
    const abi =
      PluginENSSubdomainRegistrar__factory &&
      PluginENSSubdomainRegistrar__factory.abi
        ? PluginENSSubdomainRegistrar__factory.abi
        : null;
    if (abi) {
      const reg = await hre.ethers.getContractAt(abi, registrarAddr, signer);
      console.log('Connected to registrar via ABI at', registrarAddr);
      for (const fn of ['ens', 'owner', 'initialized']) {
        try {
          if (typeof reg[fn] === 'function') {
            const r = await reg[fn]();
            console.log(`${fn}():`, r);
          }
        } catch (e) {
          console.warn(`${fn}() reverted:`, e && e.message ? e.message : e);
        }
      }
    } else {
      console.warn('@aragon/osx-ethers ABI not available locally');
    }
  } catch (e) {
    console.warn(
      'Error using @aragon/osx-ethers ABI:',
      e && e.message ? e.message : e
    );
  }

  // Try a low-level eth_call for ens() selector (if ABI missing)
  try {
    const iface = new hre.ethers.Interface([
      'function ens() view returns (address)',
    ]);
    const data = iface.encodeFunctionData('ens', []);
    const call = await hre.ethers.provider.call({
      to: registrarAddr,
      data,
      from: signer.address,
    });
    console.log('low-level call ens() raw:', call);
    try {
      const decoded = iface.decodeFunctionResult('ens', call);
      console.log('low-level ens() decoded:', decoded);
    } catch (e) {
      console.warn('Failed to decode low-level ens() result');
    }
  } catch (e) {
    console.warn(
      'low-level ens() call failed:',
      e && e.message ? e.message : e
    );
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
