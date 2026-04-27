// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {FissionAddresses} from "./FissionAddresses.sol";
import {IAavePool} from "./interfaces/IAavePool.sol";
import {IERC20Minimal} from "./interfaces/IERC20Minimal.sol";

contract AaveUSDCYieldAdapter {
    IERC20Minimal public immutable usdc = IERC20Minimal(FissionAddresses.AAVE_USDC);
    IERC20Minimal public immutable aUsdc = IERC20Minimal(FissionAddresses.AAVE_AUSDC);
    IAavePool public immutable pool = IAavePool(FissionAddresses.AAVE_V3_POOL);
    address public immutable market;

    error OnlyMarket();
    error TransferFailed();

    constructor(address market_) {
        market = market_;
        usdc.approve(address(pool), type(uint256).max);
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
