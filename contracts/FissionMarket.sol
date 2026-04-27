// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {
    Nox,
    euint256,
    externalEuint256
} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";
import {FissionPositionToken} from "./FissionPositionToken.sol";
import {AaveUSDCYieldAdapter} from "./AaveUSDCYieldAdapter.sol";

contract FissionMarket {
    uint256 public constant PRICE_SCALE = 1e18;
    uint256 public immutable maturity;

    FissionPositionToken public immutable sy;
    FissionPositionToken public immutable pt;
    FissionPositionToken public immutable yt;
    AaveUSDCYieldAdapter public immutable adapter;

    uint256 public ptPrice = 0.974e18;
    uint256 public ytPrice = 0.082e18;

    event PublicDeposit(address indexed user, uint256 amount);
    event ConfidentialFission(address indexed user, bytes32 encryptedAmount);
    event ConfidentialCombine(address indexed user, bytes32 encryptedAmount);
    event ConfidentialSwap(address indexed user, uint8 indexed route, bytes32 encryptedAmountIn);

    constructor(uint256 maturity_) {
        maturity = maturity_;
        sy = new FissionPositionToken("Fission SY USDC", "SY-USDC", address(this));
        pt = new FissionPositionToken("Fission PT USDC 30D", "PT-USDC-30D", address(this));
        yt = new FissionPositionToken("Fission YT USDC 30D", "YT-USDC-30D", address(this));
        adapter = new AaveUSDCYieldAdapter(address(this));
    }

    function mintSY(uint256 clearAmount) external {
        adapter.pullAndSupply(msg.sender, clearAmount);
        euint256 amount = Nox.toEuint256(clearAmount);
        sy.mintConfidential(msg.sender, amount);
        emit PublicDeposit(msg.sender, clearAmount);
    }

    function fission(
        externalEuint256 encryptedAmount,
        bytes calldata proof
    ) external {
        euint256 amount = Nox.fromExternal(encryptedAmount, proof);
        sy.burnConfidential(msg.sender, amount);
        pt.mintConfidential(msg.sender, amount);
        yt.mintConfidential(msg.sender, amount);
        emit ConfidentialFission(msg.sender, euint256.unwrap(amount));
    }

    function combine(
        externalEuint256 encryptedAmount,
        bytes calldata proof
    ) external {
        euint256 amount = Nox.fromExternal(encryptedAmount, proof);
        pt.burnConfidential(msg.sender, amount);
        yt.burnConfidential(msg.sender, amount);
        sy.mintConfidential(msg.sender, amount);
        emit ConfidentialCombine(msg.sender, euint256.unwrap(amount));
    }

    function swapSYForPT(
        externalEuint256 encryptedAmount,
        bytes calldata proof
    ) external {
        euint256 amountIn = Nox.fromExternal(encryptedAmount, proof);
        euint256 amountOut = _quoteBuy(amountIn, ptPrice);
        sy.burnConfidential(msg.sender, amountIn);
        pt.mintConfidential(msg.sender, amountOut);
        emit ConfidentialSwap(msg.sender, 1, euint256.unwrap(amountIn));
    }

    function swapSYForYT(
        externalEuint256 encryptedAmount,
        bytes calldata proof
    ) external {
        euint256 amountIn = Nox.fromExternal(encryptedAmount, proof);
        euint256 amountOut = _quoteBuy(amountIn, ytPrice);
        sy.burnConfidential(msg.sender, amountIn);
        yt.mintConfidential(msg.sender, amountOut);
        emit ConfidentialSwap(msg.sender, 2, euint256.unwrap(amountIn));
    }

    function sellPTForSY(
        externalEuint256 encryptedAmount,
        bytes calldata proof
    ) external {
        euint256 amountIn = Nox.fromExternal(encryptedAmount, proof);
        euint256 amountOut = _quoteSell(amountIn, ptPrice);
        pt.burnConfidential(msg.sender, amountIn);
        sy.mintConfidential(msg.sender, amountOut);
        emit ConfidentialSwap(msg.sender, 3, euint256.unwrap(amountIn));
    }

    function sellYTForSY(
        externalEuint256 encryptedAmount,
        bytes calldata proof
    ) external {
        euint256 amountIn = Nox.fromExternal(encryptedAmount, proof);
        euint256 amountOut = _quoteSell(amountIn, ytPrice);
        yt.burnConfidential(msg.sender, amountIn);
        sy.mintConfidential(msg.sender, amountOut);
        emit ConfidentialSwap(msg.sender, 4, euint256.unwrap(amountIn));
    }

    function _quoteBuy(euint256 syAmount, uint256 price) internal returns (euint256) {
        return Nox.div(Nox.mul(syAmount, Nox.toEuint256(PRICE_SCALE)), Nox.toEuint256(price));
    }

    function _quoteSell(euint256 positionAmount, uint256 price) internal returns (euint256) {
        return Nox.div(Nox.mul(positionAmount, Nox.toEuint256(price)), Nox.toEuint256(PRICE_SCALE));
    }
}
