// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAavePool} from "./interfaces/IAavePool.sol";
import {IERC20Minimal} from "./interfaces/IERC20Minimal.sol";

/**
 * Generic Aave V3 single-asset yield adapter with a privacy-oriented USDC float buffer.
 *
 * Privacy property: `pullAndSupply` parks USDC in this contract instead of supplying directly
 * to Aave. Aave `Supply` / `Withdraw` events are batched by `rebalance()` (anyone can call) and
 * by the refill path inside `withdrawTo`, so individual user mints / redeems no longer 1:1 with
 * Aave events. Per-user linkage at the Aave layer is removed; only aggregate flows remain.
 *
 * Tradeoff: the float earns no yield. `floatTarget` controls the size of the idle buffer.
 */
contract AaveUSDCYieldAdapter {
    IERC20Minimal public immutable usdc;
    IERC20Minimal public immutable aUsdc;
    IAavePool public immutable pool;
    address public immutable market;

    uint256 public floatTarget;

    error OnlyMarket();
    error TransferFailed();
    error InvalidFloatTarget();
    error InsufficientReserves();

    event FloatTargetUpdated(uint256 newTarget);
    event Rebalanced(uint256 supplied);
    event FloatRefilled(uint256 withdrawn);

    constructor(address market_, address usdc_, address aUsdc_, address pool_) {
        market = market_;
        usdc = IERC20Minimal(usdc_);
        aUsdc = IERC20Minimal(aUsdc_);
        pool = IAavePool(pool_);
        floatTarget = 10_000 * 1e6;
        usdc.approve(pool_, type(uint256).max);
    }

    modifier onlyMarket() {
        if (msg.sender != market) revert OnlyMarket();
        _;
    }

    function setFloatTarget(uint256 newTarget) external onlyMarket {
        if (newTarget == 0) revert InvalidFloatTarget();
        floatTarget = newTarget;
        emit FloatTargetUpdated(newTarget);
    }

    function pullAndSupply(address from, uint256 amount) external onlyMarket {
        if (!usdc.transferFrom(from, address(this), amount)) revert TransferFailed();
        // No Aave supply here. `rebalance()` sweeps excess float into Aave so the resulting
        // Aave Supply event is decoupled from any individual mintSY call.
    }

    function withdrawTo(address to, uint256 amount) external onlyMarket returns (uint256) {
        uint256 currentFloat = usdc.balanceOf(address(this));
        if (currentFloat >= amount) {
            if (!usdc.transfer(to, amount)) revert TransferFailed();
            return amount;
        }
        uint256 needed = amount - currentFloat;
        uint256 desiredRefill = needed + floatTarget;
        uint256 aBalance = aUsdc.balanceOf(address(this));
        uint256 refill = desiredRefill > aBalance ? aBalance : desiredRefill;
        if (refill < needed) revert InsufficientReserves();
        uint256 actuallyPulled = pool.withdraw(address(usdc), refill, address(this));
        if (actuallyPulled < needed) revert InsufficientReserves();
        if (!usdc.transfer(to, amount)) revert TransferFailed();
        emit FloatRefilled(actuallyPulled);
        return amount;
    }

    /**
     * Sweep excess float into Aave. Permissionless: anyone (keeper, user, owner) can call.
     * Sweeping in one call across many user mints means observers can't recover per-user
     * amounts from the resulting Aave Supply event.
     */
    function rebalance() external {
        uint256 currentFloat = usdc.balanceOf(address(this));
        if (currentFloat > floatTarget) {
            uint256 toSupply = currentFloat - floatTarget;
            pool.supply(address(usdc), toSupply, address(this), 0);
            emit Rebalanced(toSupply);
        }
    }

    function reserveBalance() external view returns (uint256) {
        return aUsdc.balanceOf(address(this)) + usdc.balanceOf(address(this));
    }

    function aaveBalance() external view returns (uint256) {
        return aUsdc.balanceOf(address(this));
    }

    function floatBalance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }
}
