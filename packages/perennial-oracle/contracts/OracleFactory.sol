// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@equilibria/root-v2/contracts/XFactory.sol";
import "@equilibria/root/control/unstructured/UOwnable.sol";
import "./interfaces/IOracleFactory.sol";

/**
 * @title OracleFactory
 * @notice
 * @dev
 */
contract OracleFactory is IOracleFactory, XFactory, UOwnable {
    mapping(bytes32 => IOracleProvider) public oracles;
    mapping(IOracleProvider => bytes32) public ids;

    mapping(IOracleFactory => bool) public factories;

    constructor(address implementation_) XFactory(implementation_) { }

    /**
     * @notice Initializes the contract state
     */
    function initialize() external initializer(1) {
        __UOwnable__initialize();
    }

    function register(IOracleFactory factory) external onlyOwner {
        factories[factory] = true;
    }

    function create(bytes32 id, IOracleFactory factory) external onlyOwner returns (IOracle newOracle) {
        if (!factories[factory]) revert OracleFactoryNotRegisteredError();
        if (oracles[id] != IOracleProvider(address(0))) revert OracleFactoryAlreadyCreatedError();

        IOracleProvider oracleProvider = factory.oracles(id);
        if (oracleProvider == IOracleProvider(address(0))) revert OracleFactoryInvalidIdError();

        newOracle = IOracle(_create(abi.encodeCall(IOracle.initialize, (oracleProvider))));
        (oracles[id], ids[newOracle]) = (newOracle, id);

        emit OracleCreated(newOracle, id);
    }

    function update(bytes32 id, IOracleFactory factory) external onlyOwner {
        if (!factories[factory]) revert OracleFactoryNotRegisteredError();
        if (oracles[id] == IOracleProvider(address(0))) revert OracleFactoryNotCreatedError();

        IOracleProvider oracleProvider = factory.oracles(id);
        if (oracleProvider == IOracleProvider(address(0))) revert OracleFactoryInvalidIdError();

        IOracle oracle = IOracle(address(oracles[id]));
        oracle.update(oracleProvider);
    }
}
