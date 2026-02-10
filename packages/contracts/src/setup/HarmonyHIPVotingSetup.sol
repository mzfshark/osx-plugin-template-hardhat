// SPDX-License-Identifier: AGPL-3.0-or-later

pragma solidity ^0.8.17;

import {DAO, IDAO} from "@aragon/osx/core/dao/DAO.sol";
import {IPluginSetup, PluginSetup, PermissionLib} from "@aragon/osx/framework/plugin/setup/PluginSetupProcessor.sol";
import {ProxyLib} from "@aragon/osx-commons-contracts/src/utils/deployment/ProxyLib.sol";

import {HarmonyHIPVotingPlugin} from "../harmony/HarmonyHIPVotingPlugin.sol";
import {HIPPluginAllowlist} from "../harmony/HIPPluginAllowlist.sol";
import {IHarmonyValidatorOptInRegistry, IHIPPluginAllowlist} from "../harmony/IHarmonyInterfaces.sol";

contract HarmonyHIPVotingSetup is PluginSetup {
    address public immutable ORACLE;
    HIPPluginAllowlist public immutable ALLOWLIST;
    IHarmonyValidatorOptInRegistry public immutable OPT_IN_REGISTRY;

    /// @notice Thrown when a DAO is not authorized to install the HIP plugin.
    /// @param dao The DAO address that is not authorized.
    error DAONotAuthorized(address dao);

    constructor(
        address _oracle,
        HIPPluginAllowlist _allowlist,
        IHarmonyValidatorOptInRegistry _optInRegistry
    ) PluginSetup(address(new HarmonyHIPVotingPlugin())) {
        require(_oracle != address(0), "INVALID_ORACLE");
        require(address(_allowlist) != address(0), "INVALID_ALLOWLIST");
        require(address(_optInRegistry) != address(0), "INVALID_OPT_IN_REGISTRY");
        ORACLE = _oracle;
        ALLOWLIST = _allowlist;
        OPT_IN_REGISTRY = _optInRegistry;
    }

    function prepareInstallation(
        address _dao,
        bytes memory _installationParams
    ) external returns (address plugin, PreparedSetupData memory preparedSetupData) {
        // Check if DAO is allowed to install HIP plugin
        if (!ALLOWLIST.isDAOAllowed(_dao)) {
            revert DAONotAuthorized(_dao);
        }

        require(_installationParams.length == 0, "INSTALL_PARAMS_NOT_SUPPORTED");

        plugin = ProxyLib.deployUUPSProxy(
            implementation(),
            abi.encodeCall(
                HarmonyHIPVotingPlugin.initialize,
                (IDAO(_dao), OPT_IN_REGISTRY, IHIPPluginAllowlist(address(ALLOWLIST)))
            )
        );

        PermissionLib.MultiTargetPermission[] memory permissions = new PermissionLib.MultiTargetPermission[](2);

        // Grant ORACLE_PERMISSION to oracle
        permissions[0] = PermissionLib.MultiTargetPermission({
            operation: PermissionLib.Operation.Grant,
            where: plugin,
            who: ORACLE,
            condition: PermissionLib.NO_CONDITION,
            permissionId: HarmonyHIPVotingPlugin(implementation()).ORACLE_PERMISSION_ID()
        });

        // Grant EXECUTE_PERMISSION on DAO to plugin (so approved proposals can execute actions)
        permissions[1] = PermissionLib.MultiTargetPermission({
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
        permissions = new PermissionLib.MultiTargetPermission[](2);

        // Revoke ORACLE_PERMISSION from oracle
        permissions[0] = PermissionLib.MultiTargetPermission({
            operation: PermissionLib.Operation.Revoke,
            where: _payload.plugin,
            who: ORACLE,
            condition: PermissionLib.NO_CONDITION,
            permissionId: HarmonyHIPVotingPlugin(implementation()).ORACLE_PERMISSION_ID()
        });

        // Revoke EXECUTE_PERMISSION on DAO from plugin
        permissions[1] = PermissionLib.MultiTargetPermission({
            operation: PermissionLib.Operation.Revoke,
            where: _dao,
            who: _payload.plugin,
            condition: PermissionLib.NO_CONDITION,
            permissionId: keccak256("EXECUTE_PERMISSION")
        });
    }
}
