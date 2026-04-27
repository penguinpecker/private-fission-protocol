// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC7984} from "@iexec-nox/nox-confidential-contracts/contracts/token/ERC7984.sol";
import {Nox, euint256} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";

contract FissionPositionToken is ERC7984 {
    address public immutable market;

    error OnlyMarket();

    constructor(
        string memory name_,
        string memory symbol_,
        address market_
    ) ERC7984(name_, symbol_, "") {
        market = market_;
    }

    modifier onlyMarket() {
        if (msg.sender != market) revert OnlyMarket();
        _;
    }

    function mintConfidential(address to, euint256 amount) external onlyMarket returns (euint256) {
        euint256 minted = _mint(to, amount);
        Nox.allow(minted, to);
        Nox.allow(minted, market);
        Nox.allowThis(minted);
        return minted;
    }

    function burnConfidential(address from, euint256 amount) external onlyMarket returns (euint256) {
        euint256 burned = _burn(from, amount);
        Nox.allow(burned, market);
        Nox.allowThis(burned);
        return burned;
    }

    function transferConfidentialByMarket(
        address from,
        address to,
        euint256 amount
    ) external onlyMarket returns (euint256) {
        euint256 transferred = _transfer(from, to, amount);
        Nox.allowThis(transferred);
        Nox.allow(transferred, market);
        Nox.allow(transferred, to);
        return transferred;
    }
}
