// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAavePool} from "./interfaces/IAavePool.sol";
import {IERC20Minimal} from "./interfaces/IERC20Minimal.sol";

/**
 * Generic Aave V3 single-asset yield adapter. Decoupled from network-specific addresses so the
 * market factory can spin up adapters for any (asset, pool, aToken) tuple.
 */
contract AaveUSDCYieldAdapter {
    IERC20Minimal public immutable usdc;
    IERC20Minimal public immutable aUsdc;
    IAavePool public immutable pool;
    address public immutable market;

    error OnlyMarket();
    error TransferFailed();

    constructor(address market_, address usdc_, address aUsdc_, address pool_) {
        market = market_;
        usdc = IERC20Minimal(usdc_);
        aUsdc = IERC20Minimal(aUsdc_);
        pool = IAavePool(pool_);
        usdc.approve(pool_, type(uint256).max);
    }

    modifier onlyMarket() {
        if (msg.sender != market) revert OnlyMarket();
        _;
    }

    function pullAndSupply(address from, uint256 amount) external onlyMarket {
        if (!usdc.transferFrom(from, address(this), amount)) revert TransferFailed();
        pool.supply(address(usdc), amount, address(this), 0);
    }

    function withdrawTo(address to, uint256 amount) external onlyMarket returns (uint256 withdrawn) {
        withdrawn = pool.withdraw(address(usdc), amount, to);
    }

    function reserveBalance() external view returns (uint256) {
        return aUsdc.balanceOf(address(this));
    }
}
