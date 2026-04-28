// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IMockToken {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

interface IMockAToken {
    function mint(address to, uint256 amount) external;
    function burn(address from, uint256 amount) external;
    function setMinter(address m) external;
}

/**
 * Bare-bones Aave V3 pool stand-in for tests. supply() escrows USDC and mints matching aUSDC
 * 1:1 to the supplier (via setCode on the configured aUSDC address). withdraw() does the inverse.
 *
 * Yield accrual is simulated by an external `accrueYield(account, amount)` call which mints
 * extra aUSDC and tops up the pool's USDC balance.
 */
contract MockAavePool {
    address public usdc;
    address public aUsdc;

    function configure(address usdc_, address aUsdc_) external {
        usdc = usdc_;
        aUsdc = aUsdc_;
        IMockAToken(aUsdc_).setMinter(address(this));
    }

    function supply(address asset, uint256 amount, address onBehalfOf, uint16) external {
        require(asset == usdc, "asset");
        IMockToken(usdc).transferFrom(msg.sender, address(this), amount);
        IMockAToken(aUsdc).mint(onBehalfOf, amount);
    }

    function withdraw(address asset, uint256 amount, address to) external returns (uint256) {
        require(asset == usdc, "asset");
        IMockAToken(aUsdc).burn(msg.sender, amount);
        IMockToken(usdc).transfer(to, amount);
        return amount;
    }

    /// @notice Test helper: simulate yield accrual to `account`'s aUSDC, backed by mock USDC.
    function accrueYield(address account, uint256 amount) external {
        IMockAToken(aUsdc).mint(account, amount);
        (bool ok, ) = usdc.call(abi.encodeWithSignature("mint(address,uint256)", address(this), amount));
        require(ok, "yield mint");
    }
}
