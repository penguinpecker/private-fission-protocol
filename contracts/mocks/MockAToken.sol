// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockAToken {
    string public name = "Mock aUSDC";
    string public symbol = "aUSDC";
    uint8 public constant decimals = 6;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;

    address public minter;

    function setMinter(address m) external {
        if (minter == address(0)) minter = m;
    }

    modifier onlyMinter() {
        require(msg.sender == minter, "minter");
        _;
    }

    function mint(address to, uint256 amount) external onlyMinter {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function burn(address from, uint256 amount) external onlyMinter {
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        totalSupply -= amount;
    }
}
