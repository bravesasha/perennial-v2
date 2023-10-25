// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "./MultiInvoker.sol";
import "./interfaces/IMultiInvokerRollup.sol";

contract MultiInvokerRollup is IMultiInvokerRollup, MultiInvoker {

    /// @dev Number of bytes in a uint256 type
    uint256 private constant UINT256_LENGTH = 32;

    /// @dev Number of bytes in a int256 type
    uint256 private constant INT256_LENGTH = 31;

    /// @dev Number of bytes in a address type
    uint256 private constant ADDRESS_LENGTH = 20;

    /// @dev Number of bytes in a uint8 type
    uint256 private constant UINT8_LENGTH = 1;

    /// @dev Number of bytes in a uint16 type
    uint256 private constant UINT16_LENGTH = 2;

    /// @dev Array of all stored addresses (users, products, vaults, etc) for calldata packing
    address[] public addressCache;

    /// @dev Index lookup of above array for constructing calldata
    mapping(address => uint256) public addressLookup;

    /// @dev magic byte to prepend to calldata for the fallback.
    /// Prevents public fns from being called by arbitrary fallback data
    uint8 public constant INVOKE_ID = 73;

    // /**
    //  * @notice Constructs the contract
    //  * @param usdc_ The USDC token contract address
    //  * @param reserve_ The DSU batcher contract address
    //  * @param reserve_ The DSU reserve contract address
    //  * @param controller_ The Perennial controller contract address
    //  */
    constructor(
        Token6 usdc_,
        Token18 dsu_,
        IFactory marketFactory_,
        IFactory vaultFactory_,
        IBatcher batcher_,
        IEmptySetReserve reserve_,
        UFixed6 keeperMultiplier_
    ) MultiInvoker(usdc_, dsu_, marketFactory_, vaultFactory_, batcher_, reserve_, keeperMultiplier_) {
        _cacheAddress(address(0)); // Cache 0-address to avoid 0-index lookup collision
    }


    /**
     * @notice This function serves exactly the same as invoke(Invocation[] memory invocations),
     *         but includes logic to handle the highly packed calldata
     * @dev   Fallback eliminates need for 4 byte sig. MUST prepend INVOKE_ID to calldata
     * @param input Packed data to pass to invoke logic
     * @return required no-op
     */
    fallback (bytes calldata input) external returns (bytes memory) {
        PTR memory ptr;
        if (_readUint8(input, ptr) != INVOKE_ID) revert MultiInvokerRollupMissingMagicByteError();

        _decodeFallbackAndInvoke(input, ptr);
        return "";
    }

    /**
     * @notice Processes invocation with highly packed data
     * @dev
     * Encoding Scheme:
     *   [0:1] => uint action
     *   [1:2] => uint length of current encoded type
     *   [2:length] => current encoded type (see individual type decoding functions)
     * @param input Packed data to pass to invoke logic
     */
    function _decodeFallbackAndInvoke(bytes calldata input, PTR memory ptr) internal {
        while (ptr.pos < input.length) {
            PerennialAction action = PerennialAction(_readUint8(input, ptr));

            if (action == PerennialAction.UPDATE_POSITION) {
                IMarket market = IMarket(_readAndCacheAddress(input, ptr));
                UFixed6 newMaker = _readUFixed6(input, ptr);
                UFixed6 newLong = _readUFixed6(input, ptr);
                UFixed6 newShort = _readUFixed6(input, ptr);
                Fixed6  collateral = _readFixed6(input, ptr);
                bool wrap = _readUint8(input, ptr) == 0 ? false : true;
                InterfaceFee memory interfaceFee = _readInterfaceFee(input, ptr);

                _update(msg.sender, market, newMaker, newLong, newShort, collateral, wrap, interfaceFee);
            } else if (action == PerennialAction.UPDATE_VAULT) {
                IVault vault = IVault(_readAndCacheAddress(input, ptr));
                UFixed6 depositAssets = _readUFixed6(input, ptr);
                UFixed6 redeemShares = _readUFixed6(input, ptr);
                UFixed6 claimAssets = _readUFixed6(input, ptr);
                bool wrap = _readUint8(input, ptr) == 0? false : true;

                _vaultUpdate(vault, depositAssets, redeemShares, claimAssets, wrap);
            } else if (action == PerennialAction.PLACE_ORDER) {
                IMarket market = IMarket(_readAndCacheAddress(input, ptr));
                TriggerOrder memory order = _readOrder(input, ptr);

                _placeOrder(msg.sender, market, order);
            } else if (action == PerennialAction.CANCEL_ORDER) {
                IMarket market = IMarket(_readAndCacheAddress(input, ptr));
                uint256 nonce = _readUint256(input, ptr);

                _cancelOrder(msg.sender, market, nonce);
            } else if (action == PerennialAction.EXEC_ORDER) {
                address account = _readAndCacheAddress(input, ptr);
                IMarket market = IMarket(_readAndCacheAddress(input, ptr));
                uint256 nonce = _readUint256(input, ptr);

                _executeOrder(account, market, nonce);
            } else if (action == PerennialAction.COMMIT_PRICE) {
                address oracleProviderFactory = _readAndCacheAddress(input, ptr);
                uint256 value = _readUint256(input, ptr);
                bytes32[] memory ids = _readBytes32Array(input, ptr);
                uint256 index = _readUint256(input, ptr);
                uint256 version = _readUint256(input, ptr);
                bytes memory data = _readBytes(input, ptr);
                bool revertOnFailure = _readUint8(input, ptr) == 0 ? false : true;

                _commitPrice(oracleProviderFactory, value, ids, version, data, revertOnFailure);
            } else if (action == PerennialAction.LIQUIDATE) {
                IMarket market = IMarket(_readAndCacheAddress(input, ptr));
                address account = _readAndCacheAddress(input, ptr);
                bool revertOnFailure = _readUint8(input, ptr) == 0 ? false : true;

                _liquidate(market, account, revertOnFailure);
            } else if (action == PerennialAction.APPROVE) {
                address target = _readAndCacheAddress(input, ptr);
                _approve(target);
            }
        }
    }

    /**
     * @notice Helper function to get address from calldata
     * @param input Full calldata payload
     * @param ptr Current index of input to start decoding
     * @return result The decoded address
     */
    function _readAndCacheAddress(bytes calldata input, PTR memory ptr) private returns (address result) {
        uint8 len = _readUint8(input, ptr);

        // user is new to registry, add next 20 bytes as address to registry and return address
        if (len == 0) {
            result = _bytesToAddress(input[ptr.pos:ptr.pos + ADDRESS_LENGTH]);
            ptr.pos += ADDRESS_LENGTH;

            _cacheAddress(result);
        } else {
            uint256 idx = _bytesToUint256(input, ptr.pos, len);
            ptr.pos += len;

            result = _lookupAddress(idx);
        }
    }

    /**
     * @notice Unchecked sets address in cache
     * @param value Address to add to cache
     */
    function _cacheAddress(address value) private {
        uint256 index = addressCache.length;
        addressCache.push(value);
        addressLookup[value] = index;

        emit AddressAddedToCache(value, index);
    }

    /**
     * @notice Checked gets the address in cache mapped to the cache index
     * @dev There is an issue with the calldata if a txn uses cache before caching address
     * @param index The cache index
     * @return result Address stored at cache index
     */
    function _lookupAddress(uint256 index) private view returns (address result) {
        result = addressCache[index];
        if (result == address(0)) revert MultiInvokerRollupAddressIndexOutOfBoundsError();
    }

    function _readOrder(bytes calldata input, PTR memory ptr) private pure returns (TriggerOrder memory order) {
        order.side = _readUint8(input, ptr);
        order.comparison = _readInt8(input, ptr);
        order.fee = _readUFixed6(input, ptr);
        order.price = _readFixed6(input, ptr);
        order.delta = _readFixed6(input, ptr);
    }

    function _readUFixed6(bytes calldata input, PTR memory ptr) private pure returns (UFixed6 result) {
        return UFixed6.wrap(_readUint256(input, ptr));
    }

    function _readFixed6(bytes calldata input, PTR memory ptr) private pure returns (Fixed6 result) {
        int8 sign = _readSign(input, ptr);
        result = Fixed6Lib.from(int256(sign), UFixed6Lib.from(_readUint256(input, ptr)));
    }

    /**
     * @notice Wraps next length of bytes as UFixed18
     * @param input Full calldata payload
     * @param ptr Current index of input to start decoding
     * @return result The decoded UFixed18
     */
    function _readUFixed18(bytes calldata input, PTR memory ptr) private pure returns (UFixed18 result) {
        result = UFixed18.wrap(_readUint256(input, ptr));
    }

    /**
     * @notice Helper function to get uint8 length from calldata
     * @param input Full calldata payload
     * @param ptr Current index of input to start decoding
     * @return result The decoded uint8 length
     */
    function _readUint8(bytes calldata input, PTR memory ptr) private pure returns (uint8 result) {
        result = _bytesToUint8(input, ptr.pos);
        ptr.pos += UINT8_LENGTH;
    }

    function _readInt8(bytes calldata input, PTR memory ptr) private pure returns (int8 result) {
        int8 sign = _readSign(input, ptr);
        result = sign * int8(_readUint8(input, ptr));
    }

    function _readUint16(bytes calldata input, PTR memory ptr) private pure returns (uint16 result) {
        result = _bytesToUint16(input, ptr.pos);
        ptr.pos += UINT16_LENGTH;
    }
    // TODO can pack sign into length byte
    function _readSign(bytes calldata input, PTR memory ptr) private pure returns (int8 sign) {
        uint8 val = _readUint8(input, ptr);
        if(val > 0) return -1;
        return 1;
    }

    function _readInt256(bytes calldata input, PTR memory ptr) private pure returns (int256 result) {
        uint8 len = _readUint8(input, ptr);
        if (len > INT256_LENGTH) revert MultiInvokerRollupInvalidInt256LengthError();

        result = int256(_bytesToUint256(input, ptr.pos, len));
        ptr.pos += len;
    }

    /**
     * @notice Helper function to get uint256 from calldata
     * @param input Full calldata payload
     * @param ptr Current index of input to start decoding
     * @return result The decoded uint256
     */
    function _readUint256(bytes calldata input, PTR memory ptr) private pure returns (uint256 result) {
        uint8 len = _readUint8(input, ptr);
        if (len > UINT256_LENGTH) revert MultiInvokerRollupInvalidUint256LengthError();

        result = _bytesToUint256(input, ptr.pos, len);
        ptr.pos += len;
    }

    function _readBytes(bytes calldata input, PTR memory ptr) private pure returns (bytes memory result) {
        uint16 len = _readUint16(input, ptr);

        result = input[ptr.pos:ptr.pos+len];
        ptr.pos += len;
    }

    function _readBytes32Array(bytes calldata input, PTR memory ptr) private pure returns (bytes32[] memory result) {
        return result;
    }
    function _readInterfaceFee(bytes calldata input, PTR memory ptr) private pure returns (InterfaceFee memory result) {
        return result;
    }
    /**
     * @notice Implementation of GNSPS' standard BytesLib.sol
     * @param input 1 byte slice to convert to uint8 to decode lengths
     * @return result The uint8 representation of input
     */
    function _bytesToUint8(bytes calldata input, uint256 pos) private pure returns (uint8 result) {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            // 1) load calldata into temp starting at ptr position
            let temp := calldataload(add(input.offset, pos))
            // 2) shifts the calldata such that only the first byte is stored in result
            result := shr(mul(8, sub(UINT256_LENGTH, UINT8_LENGTH)), temp)
        }
    }

    function _bytesToUint16(bytes calldata input, uint256 pos) private pure returns (uint16 result) {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            // 1) load calldata into temp starting at ptr position
            let temp := calldataload(add(input.offset, pos))
            // 2) shifts the calldata such that only the first 2 bytes are stores in result
            result := shr(mul(8, sub(UINT256_LENGTH, UINT8_LENGTH)), temp)
        }
    }

    /**
     * @dev This is called in decodeAccount and decodeProduct which both only pass 20 byte slices
     * @notice Unchecked force of 20 bytes into address
     * @param input The 20 bytes to be converted to address
     * @return result Address representation of `input`
    */
    function _bytesToAddress(bytes memory input) private pure returns (address result) {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            result := mload(add(input, ADDRESS_LENGTH))
        }
    }

    /**
     * @notice Unchecked loads arbitrarily-sized bytes into a uint
     * @dev Bytes length enforced as < max word size
     * @param input The bytes to convert to uint256
     * @return result The resulting uint256
     */
    function _bytesToUint256(bytes calldata input, uint256 pos, uint256 len) private pure returns (uint256 result) {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            // 1) load the calldata into result starting at the ptr position
            result := calldataload(add(input.offset, pos))
            // 2) shifts the calldata such that only the next length of bytes specified by `len` populates the uint256 result
            result := shr(mul(8, sub(UINT256_LENGTH, len)), result)
        }
    }
}