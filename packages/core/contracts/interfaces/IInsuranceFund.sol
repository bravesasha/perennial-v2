// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import { IOwnable } from "@equilibria/root/attribute/interfaces/IOwnable.sol";
import { Token18 } from "@equilibria/root/token/types/Token18.sol";
import { UFixed18 } from "@equilibria/root/number/types/UFixed18.sol";
import { IFactory } from "@equilibria/root/attribute/interfaces/IFactory.sol";

import { IMarket } from "./IMarket.sol";

/// @notice This contract manages the protocol fee and shortfalls for markets.
interface IInsuranceFund is IOwnable {
     
    /// @custom:error Thrown when an invalid address is provided.
    error InsuranceFundInvalidInstanceError();

    /// @notice Initializes the InsuranceFund contract.
    function initialize() external;

    /// @notice Claims fees from a market.
    /// @param market The address of the market from which to claim protocol fees.
    function claim(address market) external;

    /// @notice Resolves any shortfall in a market.
    /// @param market The address of the market for which to resolve the shortfall.
    function resolve(address market) external;
}