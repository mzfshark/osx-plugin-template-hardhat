// SPDX-License-Identifier: AGPL-3.0-or-later

pragma solidity ^0.8.17;

import {PluginUUPSUpgradeable} from "@aragon/osx/framework/plugin/setup/PluginSetupProcessor.sol";
import {IDAO} from "@aragon/osx/core/dao/DAO.sol";

/// @title HIPPluginAllowlist
/// @notice Registry that controls which DAOs are authorized to install the Harmony HIP Voting Plugin.
/// @dev Only the Management DAO can add or remove DAOs from the allowlist.
contract HIPPluginAllowlist is PluginUUPSUpgradeable {
    /// @notice The permission identifier to manage the allowlist.
    bytes32 public constant MANAGE_ALLOWLIST_PERMISSION_ID =
        keccak256("MANAGE_ALLOWLIST_PERMISSION");

    /// @notice Mapping of DAO addresses to their allowlist status.
    mapping(address => bool) public allowedDAOs;

    /// @notice Emitted when a DAO is added to the allowlist.
    /// @param dao The DAO address that was allowed.
    event DAOAllowed(address indexed dao);

    /// @notice Emitted when a DAO is removed from the allowlist.
    /// @param dao The DAO address that was disallowed.
    event DAODisallowed(address indexed dao);

    /// @notice Thrown when trying to check or modify an invalid DAO address.
    /// @param dao The invalid DAO address provided.
    error InvalidDAOAddress(address dao);

    /// @notice Initializes the allowlist with the Management DAO.
    /// @param _managementDao The Management DAO that controls this allowlist.
    function initialize(IDAO _managementDao) external initializer {
        __PluginUUPSUpgradeable_init(_managementDao);
    }

    /// @notice Checks if a DAO is allowed to install the HIP plugin.
    /// @param _dao The DAO address to check.
    /// @return True if the DAO is allowed, false otherwise.
    function isDAOAllowed(address _dao) external view returns (bool) {
        if (_dao == address(0)) {
            revert InvalidDAOAddress(_dao);
        }
        return allowedDAOs[_dao];
    }

    /// @notice Adds a DAO to the allowlist.
    /// @dev Only callable by addresses with MANAGE_ALLOWLIST_PERMISSION.
    /// @param _dao The DAO address to allow.
    function allowDAO(address _dao) external auth(MANAGE_ALLOWLIST_PERMISSION_ID) {
        if (_dao == address(0)) {
            revert InvalidDAOAddress(_dao);
        }
        allowedDAOs[_dao] = true;
        emit DAOAllowed(_dao);
    }

    /// @notice Removes a DAO from the allowlist.
    /// @dev Only callable by addresses with MANAGE_ALLOWLIST_PERMISSION.
    /// @param _dao The DAO address to disallow.
    function disallowDAO(address _dao) external auth(MANAGE_ALLOWLIST_PERMISSION_ID) {
        if (_dao == address(0)) {
            revert InvalidDAOAddress(_dao);
        }
        allowedDAOs[_dao] = false;
        emit DAODisallowed(_dao);
    }

    /// @notice Adds multiple DAOs to the allowlist in a single transaction.
    /// @dev Only callable by addresses with MANAGE_ALLOWLIST_PERMISSION.
    /// @param _daos Array of DAO addresses to allow.
    function allowDAOsBatch(address[] calldata _daos) external auth(MANAGE_ALLOWLIST_PERMISSION_ID) {
        for (uint256 i = 0; i < _daos.length; i++) {
            if (_daos[i] == address(0)) {
                revert InvalidDAOAddress(_daos[i]);
            }
            allowedDAOs[_daos[i]] = true;
            emit DAOAllowed(_daos[i]);
        }
    }

    /// @notice Removes multiple DAOs from the allowlist in a single transaction.
    /// @dev Only callable by addresses with MANAGE_ALLOWLIST_PERMISSION.
    /// @param _daos Array of DAO addresses to disallow.
    function disallowDAOsBatch(address[] calldata _daos) external auth(MANAGE_ALLOWLIST_PERMISSION_ID) {
        for (uint256 i = 0; i < _daos.length; i++) {
            if (_daos[i] == address(0)) {
                revert InvalidDAOAddress(_daos[i]);
            }
            allowedDAOs[_daos[i]] = false;
            emit DAODisallowed(_daos[i]);
        }
    }

    uint256[49] private __gap;
}
