// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed6.sol";
import "@equilibria/perennial-v2/contracts/types/OracleVersion.sol";

struct KeeperOracleParameter {
    /// @dev The latest granularity setting in seconds
    uint256 latestGranularity;

    /// @dev The current granularity setting in seconds
    uint256 currentGranularity;

    /// @dev The timestamp at which the current granularity setting becomes effective
    uint256 effectiveAfter;

    /// @dev the fixed settlement fee of the request
    UFixed6 settlementFee;

    /// @dev The relative oracle fee percentage of the request
    UFixed6 oracleFee;

    /// @dev Seconds after version a committed price is valid
    uint256 validFrom;

    /// @dev Seconds after version a committed price is valid until
    uint256 validTo;
}
struct StoredKeeperOracleParameter {
    uint16 latestGranularity;
    uint16 currentGranularity;
    uint32 effectiveAfter;
    uint48 settlementFee;
    uint24 oracleFee;
    uint16 validFrom;
    uint16 validTo;
}
struct KeeperOracleParameterStorage { StoredKeeperOracleParameter value; }
using KeeperOracleParameterStorageLib for KeeperOracleParameterStorage global;

library KeeperOracleParameterStorageLib {
    // sig: 0xff590172
    error KeeperOracleParameterStorageInvalidError();

    function read(KeeperOracleParameterStorage storage self) internal view returns (KeeperOracleParameter memory) {
        StoredKeeperOracleParameter memory storedValue = self.value;
        return KeeperOracleParameter(
            uint256(storedValue.latestGranularity),
            uint256(storedValue.currentGranularity),
            uint256(storedValue.effectiveAfter),
            UFixed6.wrap(uint256(storedValue.settlementFee)),
            UFixed6.wrap(uint256(storedValue.oracleFee)),
            uint256(storedValue.validFrom),
            uint256(storedValue.validTo)
        );
    }

    function validate(KeeperOracleParameter memory newValue) private pure {
        if (newValue.latestGranularity < 1 && newValue.effectiveAfter != 0)
            revert KeeperOracleParameterStorageInvalidError();
        if (newValue.currentGranularity < 1) revert KeeperOracleParameterStorageInvalidError();
    }

    function store(KeeperOracleParameterStorage storage self, KeeperOracleParameter memory newValue) internal {
        validate(newValue);

        if (newValue.latestGranularity > type(uint16).max) revert KeeperOracleParameterStorageInvalidError();
        if (newValue.currentGranularity > type(uint16).max) revert KeeperOracleParameterStorageInvalidError();
        if (newValue.effectiveAfter > type(uint32).max) revert KeeperOracleParameterStorageInvalidError();
        if (newValue.settlementFee.gt(UFixed6.wrap(type(uint48).max))) revert KeeperOracleParameterStorageInvalidError();
        if (newValue.oracleFee.gt(UFixed6.wrap(type(uint24).max))) revert KeeperOracleParameterStorageInvalidError();
        if (newValue.validFrom > type(uint16).max) revert KeeperOracleParameterStorageInvalidError();
        if (newValue.validTo > type(uint16).max) revert KeeperOracleParameterStorageInvalidError();

        self.value = StoredKeeperOracleParameter(
            uint16(newValue.latestGranularity),
            uint16(newValue.currentGranularity),
            uint32(newValue.effectiveAfter),
            uint48(UFixed6.unwrap(newValue.settlementFee)),
            uint24(UFixed6.unwrap(newValue.oracleFee)),
            uint16(newValue.validFrom),
            uint16(newValue.validTo)
        );
    }
}
