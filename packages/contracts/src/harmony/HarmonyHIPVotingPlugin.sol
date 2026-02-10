// SPDX-License-Identifier: AGPL-3.0-or-later

pragma solidity ^0.8.17;

import {HarmonyVotingBase} from "./HarmonyVotingBase.sol";
import {IDAO} from "@aragon/osx/core/dao/DAO.sol";
import {IHarmonyValidatorOptInRegistry, IHIPPluginAllowlist} from "./IHarmonyInterfaces.sol";

/// @notice HIP (protocol) voting: validators vote; weights come from a snapshot published via Merkle root.
contract HarmonyHIPVotingPlugin is HarmonyVotingBase {
    function initialize(
        IDAO _dao,
        IHarmonyValidatorOptInRegistry _optInRegistry,
        IHIPPluginAllowlist _hipAllowlist
    ) external initializer {
        __HarmonyVotingBase_init(_dao, _optInRegistry, _hipAllowlist);
    }

    uint256[50] private __gap;
}
