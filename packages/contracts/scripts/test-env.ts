
import { ethers } from "hardhat";

async function main() {
    console.log("Hardhat environment loaded");
    const [deployer] = await ethers.getSigners();
    console.log("Deployer:", deployer.address);
    const network = await ethers.provider.getNetwork();
    console.log("Network:", network.name, network.chainId);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
