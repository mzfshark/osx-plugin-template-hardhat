// SPDX-License-Identifier: AGPL-3.0-or-later

pragma solidity ^0.8.17;

import {IPluginSetup, PluginSetup, PermissionLib} from "@aragon/osx/framework/plugin/setup/PluginSetupProcessor.sol";
import {ProxyLib} from "@aragon/osx-commons-contracts/src/utils/deployment/ProxyLib.sol";
import {IDAO} from "@aragon/osx/core/dao/DAO.sol";

import {HarmonyDelegationVotingPlugin} from "../harmony/HarmonyDelegationVotingPlugin.sol";
import {IHarmonyValidatorOptInRegistry, IHIPPluginAllowlist} from "../harmony/IHarmonyInterfaces.sol";

contract HarmonyDelegationVotingSetup is PluginSetup {
    address public immutable ORACLE;
    IHarmonyValidatorOptInRegistry public immutable OPT_IN_REGISTRY;
    IHIPPluginAllowlist public immutable HIP_ALLOWLIST;

    constructor(
        address _oracle,
        IHarmonyValidatorOptInRegistry _optInRegistry,
        IHIPPluginAllowlist _hipAllowlist
    ) PluginSetup(address(new HarmonyDelegationVotingPlugin())) {
        require(_oracle != address(0), "INVALID_ORACLE");
        ORACLE = _oracle;
        OPT_IN_REGISTRY = _optInRegistry;
        HIP_ALLOWLIST = _hipAllowlist;
    }

    function prepareInstallation(
        address _dao,
        bytes memory _installationParams
    ) external returns (address plugin, PreparedSetupData memory preparedSetupData) {
        // Decode (validatorAddress, processKey) from the installation parameters
        (address validatorAddress, bytes32 processKey) = abi.decode(_installationParams, (address, bytes32));
        require(validatorAddress != address(0), "INVALID_VALIDATOR_ADDRESS");

        plugin = ProxyLib.deployUUPSProxy(
            implementation(),
            abi.encodeCall(
                HarmonyDelegationVotingPlugin.initialize,
                (IDAO(_dao), OPT_IN_REGISTRY, HIP_ALLOWLIST, validatorAddress, processKey)
            )
        );

        PermissionLib.MultiTargetPermission[] memory permissions = new PermissionLib.MultiTargetPermission[](3);

        // Grant ORACLE_PERMISSION to oracle
        permissions[0] = PermissionLib.MultiTargetPermission({
            operation: PermissionLib.Operation.Grant,
            where: plugin,
            who: ORACLE,
            condition: PermissionLib.NO_CONDITION,
            permissionId: HarmonyDelegationVotingPlugin(implementation()).ORACLE_PERMISSION_ID()
        });

        // Grant UPDATE_VALIDATOR_PERMISSION to DAO (so it can be updated via proposal)
        permissions[1] = PermissionLib.MultiTargetPermission({
            operation: PermissionLib.Operation.Grant,
            where: plugin,
            who: _dao,
            condition: PermissionLib.NO_CONDITION,
            permissionId: HarmonyDelegationVotingPlugin(implementation()).UPDATE_VALIDATOR_PERMISSION_ID()
        });

        // Grant EXECUTE_PERMISSION on DAO to plugin (so approved proposals can execute actions)
        permissions[2] = PermissionLib.MultiTargetPermission({
            operation: PermissionLib.Operation.Grant,
            where: _dao,
            who: plugin,
            condition: PermissionLib.NO_CONDITION,
            permissionId: keccak256("EXECUTE_PERMISSION")
        });

        preparedSetupData.permissions = permissions;
    }

    function prepareUninstallation(
        address _dao,
        SetupPayload calldata _payload
    ) external view returns (PermissionLib.MultiTargetPermission[] memory permissions) {
        permissions = new PermissionLib.MultiTargetPermission[](3);

        // Revoke ORACLE_PERMISSION from oracle
        permissions[0] = PermissionLib.MultiTargetPermission({
            operation: PermissionLib.Operation.Revoke,
            where: _payload.plugin,
            who: ORACLE,
            condition: PermissionLib.NO_CONDITION,
            permissionId: HarmonyDelegationVotingPlugin(implementation()).ORACLE_PERMISSION_ID()
        });

        // Revoke UPDATE_VALIDATOR_PERMISSION from DAO
        permissions[1] = PermissionLib.MultiTargetPermission({
            operation: PermissionLib.Operation.Revoke,
            where: _payload.plugin,
            who: _dao,
            condition: PermissionLib.NO_CONDITION,
            permissionId: HarmonyDelegationVotingPlugin(implementation()).UPDATE_VALIDATOR_PERMISSION_ID()
        });

        // Revoke EXECUTE_PERMISSION on DAO from plugin
        permissions[2] = PermissionLib.MultiTargetPermission({
            operation: PermissionLib.Operation.Revoke,
            where: _dao,
            who: _payload.plugin,
            condition: PermissionLib.NO_CONDITION,
            permissionId: keccak256("EXECUTE_PERMISSION")
        });
    }
}
