// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Nox, ebool, euint256} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";

/**
 * Single confidential vault that holds SY, PT, and YT balances under one contract address.
 *
 * The previous design used three separate FissionPositionToken contracts. Even with their
 * `ConfidentialTransfer` events suppressed, the underlying contract address still leaks which
 * leg was touched: an observer doing `eth_getLogs(address: ptContract)` knew when PT had any
 * activity at all. Folding all three legs into a single contract removes that signal — every
 * leg's transfers now appear at the same address and the per-leg activity timeline blends.
 *
 * No `ConfidentialTransfer` event is emitted by design. The market is the only canonical activity
 * log via its uniform `ConfidentialAction` event. ERC-7984 standard event compliance is broken
 * intentionally; balance discovery happens via direct `confidentialBalanceOf(kind, account)`.
 */
contract FissionPositionVault {
    uint8 public constant KIND_SY = 0;
    uint8 public constant KIND_PT = 1;
    uint8 public constant KIND_YT = 2;
    uint8 public constant KIND_LP_SY_PT = 3;
    uint8 public constant KIND_LP_SY_YT = 4;
    uint8 public constant KIND_MAX = KIND_LP_SY_YT;

    address public immutable market;

    mapping(uint8 => mapping(address => euint256)) private _balances;
    mapping(uint8 => euint256) private _totalSupplies;

    string[5] private _names;
    string[5] private _symbols;

    error OnlyMarket();
    error InvalidKind();
    error ZeroBalance(address holder);

    constructor(address market_) {
        market = market_;
        _names[KIND_SY] = "Fission SY USDC";
        _names[KIND_PT] = "Fission PT USDC 30D";
        _names[KIND_YT] = "Fission YT USDC 30D";
        _names[KIND_LP_SY_PT] = "Fission LP SY/PT 30D";
        _names[KIND_LP_SY_YT] = "Fission LP SY/YT 30D";
        _symbols[KIND_SY] = "SY-USDC";
        _symbols[KIND_PT] = "PT-USDC-30D";
        _symbols[KIND_YT] = "YT-USDC-30D";
        _symbols[KIND_LP_SY_PT] = "LP-SY-PT-30D";
        _symbols[KIND_LP_SY_YT] = "LP-SY-YT-30D";
    }

    modifier onlyMarket() {
        if (msg.sender != market) revert OnlyMarket();
        _;
    }

    modifier validKind(uint8 kind) {
        if (kind > KIND_MAX) revert InvalidKind();
        _;
    }

    function name(uint8 kind) external view validKind(kind) returns (string memory) {
        return _names[kind];
    }

    function symbol(uint8 kind) external view validKind(kind) returns (string memory) {
        return _symbols[kind];
    }

    function decimals() external pure returns (uint8) {
        return 18;
    }

    function confidentialBalanceOf(uint8 kind, address account)
        external
        view
        validKind(kind)
        returns (euint256)
    {
        return _balances[kind][account];
    }

    function confidentialTotalSupply(uint8 kind) external view validKind(kind) returns (euint256) {
        return _totalSupplies[kind];
    }

    /**
     * Returns `totalSupply(kind) - balanceOf(kind, market)`. Used by the market at maturity to
     * snapshot the encrypted user-held supply (everything that isn't AMM reserve). The market
     * gets `Nox.allow` on the resulting handle so it can compute on it later.
     */
    function confidentialUserHeldSupply(uint8 kind)
        external
        onlyMarket
        validKind(kind)
        returns (euint256 userHeld)
    {
        userHeld = Nox.sub(_totalSupplies[kind], _balances[kind][market]);
        Nox.allowThis(userHeld);
        Nox.allow(userHeld, market);
    }

    function mintConfidential(uint8 kind, address to, euint256 amount)
        external
        onlyMarket
        validKind(kind)
        returns (euint256)
    {
        return _update(kind, address(0), to, amount);
    }

    function burnConfidential(uint8 kind, address from, euint256 amount)
        external
        onlyMarket
        validKind(kind)
        returns (euint256 burned)
    {
        burned = _update(kind, from, address(0), amount);
        Nox.allow(burned, market);
    }

    function transferConfidentialByMarket(uint8 kind, address from, address to, euint256 amount)
        external
        onlyMarket
        validKind(kind)
        returns (euint256)
    {
        return _update(kind, from, to, amount);
    }

    function _update(uint8 kind, address from, address to, euint256 amount)
        internal
        returns (euint256 transferred)
    {
        ebool success;
        euint256 ptr;

        if (from == address(0)) {
            (success, ptr) = Nox.safeAdd(_totalSupplies[kind], amount);
            ptr = Nox.select(success, ptr, _totalSupplies[kind]);
            Nox.allowThis(ptr);
            _totalSupplies[kind] = ptr;
        } else {
            euint256 fromBalance = _balances[kind][from];
            require(Nox.isInitialized(fromBalance), ZeroBalance(from));
            (success, ptr) = Nox.safeSub(fromBalance, amount);
            ptr = Nox.select(success, ptr, fromBalance);
            Nox.allowThis(ptr);
            Nox.allow(ptr, from);
            _balances[kind][from] = ptr;
        }

        transferred = Nox.select(success, amount, Nox.toEuint256(0));

        if (to == address(0)) {
            ptr = Nox.sub(_totalSupplies[kind], transferred);
            Nox.allowThis(ptr);
            _totalSupplies[kind] = ptr;
        } else {
            ptr = Nox.add(_balances[kind][to], transferred);
            Nox.allowThis(ptr);
            Nox.allow(ptr, to);
            _balances[kind][to] = ptr;
        }

        if (from != address(0)) {
            Nox.allow(transferred, from);
        }
        if (to != address(0)) {
            Nox.allow(transferred, to);
        }
        Nox.allowThis(transferred);
    }
}
