// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {FissionMarket} from "./FissionMarket.sol";

/**
 * Multi-market registry. Markets are deployed independently (the FissionMarket creation
 * bytecode is too large to embed inside a deployer contract under the 24KB limit), then
 * registered here so the frontend can enumerate live markets without a manual index.
 *
 * Only the factory owner can register markets — prevents anyone from polluting the registry
 * with arbitrary contract addresses pretending to be markets.
 */
contract FissionMarketFactory {
    address[] public markets;
    mapping(address => bool) public isRegistered;
    address public immutable owner;

    event MarketRegistered(
        address indexed market,
        uint256 maturity,
        address usdc,
        address aavePool
    );
    event MarketUnregistered(address indexed market);

    error OnlyOwner();
    error AlreadyRegistered();
    error NotRegistered();

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    function registerMarket(address market) external onlyOwner {
        if (isRegistered[market]) revert AlreadyRegistered();
        FissionMarket m = FissionMarket(market);
        // Read maturity / adapter to sanity-check the address is actually a FissionMarket. If
        // the call reverts the registration reverts with it.
        uint256 mat = m.maturity();
        address adapterAddr = address(m.adapter());
        isRegistered[market] = true;
        markets.push(market);
        emit MarketRegistered(market, mat, adapterAddr, adapterAddr);
    }

    function unregisterMarket(address market) external onlyOwner {
        if (!isRegistered[market]) revert NotRegistered();
        isRegistered[market] = false;
        // Linear scan + swap-and-pop. Markets array is small (single-digit) so OK.
        for (uint256 i = 0; i < markets.length; i++) {
            if (markets[i] == market) {
                markets[i] = markets[markets.length - 1];
                markets.pop();
                break;
            }
        }
        emit MarketUnregistered(market);
    }

    function marketsCount() external view returns (uint256) {
        return markets.length;
    }

    function allMarkets() external view returns (address[] memory) {
        return markets;
    }
}
