// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.17;

interface IHarmonyValidatorOptInRegistry {
    function isValidator(address _account) external view returns (bool);
    function getOperatorByAlias(address _alias) external view returns (address);
    function reportParticipation(address _validator, bool _voted) external;
    function operatorCount() external view returns (uint256);
    function operatorAt(uint256 index) external view returns (address);
}

interface IHIPPluginAllowlist {
    function isDAOAllowed(address _dao) external view returns (bool);
}
