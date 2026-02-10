// SPDX-License-Identifier: AGPL-3.0-or-later

pragma solidity ^0.8.17;

import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {PluginUUPSUpgradeable} from "@aragon/osx/framework/plugin/setup/PluginSetupProcessor.sol";
import {IDAO} from "@aragon/osx/core/dao/DAO.sol";

/// @notice Global opt-in registry for Harmony validators.
/// @dev Minimal registry to support an opted-in set and optional alias (voting) address.
contract HarmonyValidatorOptInRegistry is PluginUUPSUpgradeable {
    using EnumerableSet for EnumerableSet.AddressSet;

    struct OptInStatus {
        bool optedIn;
        address votingAddress;
    }

    EnumerableSet.AddressSet private _operators;
    mapping(address => address) private _operatorByAlias;
    mapping(address => OptInStatus) private _statusByOperator;

    /// @notice Mapping of validator address to their consecutive missed votes.
    mapping(address => uint256) public missedVotes;

    /// @notice The limit of consecutive missed votes before auto opt-out.
    uint256 public constant MAX_MISSED_VOTES = 2;

    /// @notice The permission identifier to report participation.
    bytes32 public constant REPORT_PARTICIPATION_PERMISSION_ID =
        keccak256("REPORT_PARTICIPATION_PERMISSION");

    event OptedIn(address indexed operator, address indexed votingAddress);
    event OptedOut(address indexed operator);
    event ParticipationReported(address indexed validator, bool voted, uint256 missedCount);
    event AutoOptOut(address indexed validator);

    function initialize(IDAO _dao) external initializer {
        __PluginUUPSUpgradeable_init(_dao);
    }

    /// @notice Reports if a validator participated in a proposal.
    /// @dev If missedVotes reaches MAX_MISSED_VOTES, the validator is opted out.
    /// @param _validator The validator address.
    /// @param _voted Whether they voted or not.
    function reportParticipation(
        address _validator,
        bool _voted
    ) external auth(REPORT_PARTICIPATION_PERMISSION_ID) {
        if (!_operators.contains(_validator)) return;

        if (_voted) {
            missedVotes[_validator] = 0;
        } else {
            missedVotes[_validator]++;
            if (missedVotes[_validator] >= MAX_MISSED_VOTES) {
                _optOut(_validator);
                emit AutoOptOut(_validator);
            }
        }

        emit ParticipationReported(_validator, _voted, missedVotes[_validator]);
    }

    function optIn(address votingAddress) external {
        require(votingAddress != address(0), "INVALID_VOTING_ADDRESS");
        require(_isAllowedVotingAddress(votingAddress), "VOTING_ADDRESS_NOT_ALLOWED");
        address existingOperator = _operatorByAlias[votingAddress];
        require(existingOperator == address(0) || existingOperator == msg.sender, "ALIAS_IN_USE");

        OptInStatus memory current = _statusByOperator[msg.sender];
        if (current.optedIn && current.votingAddress != address(0)) {
            delete _operatorByAlias[current.votingAddress];
        }

        _operatorByAlias[votingAddress] = msg.sender;
        _statusByOperator[msg.sender] = OptInStatus({optedIn: true, votingAddress: votingAddress});
        _operators.add(msg.sender);
        missedVotes[msg.sender] = 0; // Reset misses on opt-in
        emit OptedIn(msg.sender, votingAddress);
    }

    function optOut() external {
        _optOut(msg.sender);
    }

    function _optOut(address operator) internal {
        OptInStatus memory current = _statusByOperator[operator];
        if (current.votingAddress != address(0)) {
            delete _operatorByAlias[current.votingAddress];
        }
        _operators.remove(operator);
        delete _statusByOperator[operator];
        delete missedVotes[operator];
        emit OptedOut(operator);
    }

    function isValidator(address operator) external view returns (bool) {
        return _statusByOperator[operator].optedIn;
    }

    function isOptedIn(address operator) external view returns (bool) {
        return _statusByOperator[operator].optedIn;
    }

    function getOperatorByAlias(address _alias) external view returns (address operator) {
        return _operatorByAlias[_alias];
    }

    function operatorByAlias(address _alias) external view returns (address operator) {
        return _operatorByAlias[_alias];
    }

    function votingAddressOf(address operator) external view returns (address votingAddress, bool optedIn) {
        OptInStatus memory s = _statusByOperator[operator];
        return (s.votingAddress, s.optedIn);
    }

    function isAlias(address _alias) external view returns (bool) {
        return _operatorByAlias[_alias] != address(0);
    }

    function operatorCount() external view returns (uint256) {
        return _operators.length();
    }

    function operatorAt(uint256 index) external view returns (address) {
        return _operators.at(index);
    }

    function getOperators() external view returns (address[] memory) {
        return _operators.values();
    }

    function _isAllowedVotingAddress(address votingAddress) internal view returns (bool) {
        if (votingAddress.code.length == 0) {
            return true;
        }

        // Allow Gnosis Safe-style multisig by probing common view methods.
        (bool ownersOk, bytes memory ownersData) = votingAddress.staticcall(
            abi.encodeWithSignature("getOwners()")
        );
        if (!ownersOk) {
            return false;
        }

        (bool thresholdOk, bytes memory thresholdData) = votingAddress.staticcall(
            abi.encodeWithSignature("getThreshold()")
        );
        if (!thresholdOk) {
            return false;
        }

        address[] memory owners = abi.decode(ownersData, (address[]));
        uint256 threshold = abi.decode(thresholdData, (uint256));
        return owners.length > 0 && threshold > 0 && threshold <= owners.length;
    }

    uint256[47] private __gap;
}
