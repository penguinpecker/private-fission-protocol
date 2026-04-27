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
    uint256 public constant USDC_TO_SY_SCALE = 1e12;
    uint256 public immutable maturity;

    FissionPositionToken public immutable sy;
    FissionPositionToken public immutable pt;
    FissionPositionToken public immutable yt;
    AaveUSDCYieldAdapter public immutable adapter;

    event PublicDeposit(address indexed user, uint256 amount);
    event ConfidentialFission(address indexed user, bytes32 encryptedAmount);
    event ConfidentialCombine(address indexed user, bytes32 encryptedAmount);
    event ConfidentialSwap(address indexed user, uint8 indexed route, bytes32 encryptedAmountIn);
    event ConfidentialAmmSeeded(bytes32 syReserve, bytes32 ptReserve, bytes32 ytReserve);

    constructor(uint256 maturity_) {
        maturity = maturity_;
        sy = new FissionPositionToken("Fission SY USDC", "SY-USDC", address(this));
        pt = new FissionPositionToken("Fission PT USDC 30D", "PT-USDC-30D", address(this));
        yt = new FissionPositionToken("Fission YT USDC 30D", "YT-USDC-30D", address(this));
        adapter = new AaveUSDCYieldAdapter(address(this));

        euint256 syReserve = Nox.toEuint256(1_000_000e18);
        euint256 ptReserve = Nox.toEuint256(1_026_000e18);
        euint256 ytReserve = Nox.toEuint256(12_000_000e18);

        sy.mintConfidential(address(this), syReserve);
        pt.mintConfidential(address(this), ptReserve);
        yt.mintConfidential(address(this), ytReserve);

        emit ConfidentialAmmSeeded(
            euint256.unwrap(syReserve),
            euint256.unwrap(ptReserve),
            euint256.unwrap(ytReserve)
        );
    }

    function mintSY(uint256 clearAmount) external {
        adapter.pullAndSupply(msg.sender, clearAmount);
        euint256 amount = Nox.toEuint256(clearAmount * USDC_TO_SY_SCALE);
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
        euint256 transferredIn = sy.transferConfidentialByMarket(msg.sender, address(this), amountIn);
        euint256 amountOut = _constantProductOut(
            transferredIn,
            sy.confidentialBalanceOf(address(this)),
            pt.confidentialBalanceOf(address(this))
        );
        pt.transferConfidentialByMarket(address(this), msg.sender, amountOut);
        emit ConfidentialSwap(msg.sender, 1, euint256.unwrap(transferredIn));
    }

    function swapSYForYT(
        externalEuint256 encryptedAmount,
        bytes calldata proof
    ) external {
        euint256 amountIn = Nox.fromExternal(encryptedAmount, proof);
        euint256 transferredIn = sy.transferConfidentialByMarket(msg.sender, address(this), amountIn);
        euint256 amountOut = _constantProductOut(
            transferredIn,
            sy.confidentialBalanceOf(address(this)),
            yt.confidentialBalanceOf(address(this))
        );
        yt.transferConfidentialByMarket(address(this), msg.sender, amountOut);
        emit ConfidentialSwap(msg.sender, 2, euint256.unwrap(transferredIn));
    }

    function sellPTForSY(
        externalEuint256 encryptedAmount,
        bytes calldata proof
    ) external {
        euint256 amountIn = Nox.fromExternal(encryptedAmount, proof);
        euint256 transferredIn = pt.transferConfidentialByMarket(msg.sender, address(this), amountIn);
        euint256 amountOut = _constantProductOut(
            transferredIn,
            pt.confidentialBalanceOf(address(this)),
            sy.confidentialBalanceOf(address(this))
        );
        sy.transferConfidentialByMarket(address(this), msg.sender, amountOut);
        emit ConfidentialSwap(msg.sender, 3, euint256.unwrap(transferredIn));
    }

    function sellYTForSY(
        externalEuint256 encryptedAmount,
        bytes calldata proof
    ) external {
        euint256 amountIn = Nox.fromExternal(encryptedAmount, proof);
        euint256 transferredIn = yt.transferConfidentialByMarket(msg.sender, address(this), amountIn);
        euint256 amountOut = _constantProductOut(
            transferredIn,
            yt.confidentialBalanceOf(address(this)),
            sy.confidentialBalanceOf(address(this))
        );
        sy.transferConfidentialByMarket(address(this), msg.sender, amountOut);
        emit ConfidentialSwap(msg.sender, 4, euint256.unwrap(transferredIn));
    }

    function _constantProductOut(
        euint256 amountIn,
        euint256 reserveInAfterTransfer,
        euint256 reserveOut
    ) internal returns (euint256) {
        euint256 reserveInBeforeTransfer = Nox.sub(reserveInAfterTransfer, amountIn);
        euint256 invariant = Nox.mul(reserveInBeforeTransfer, reserveOut);
        euint256 newReserveOut = Nox.div(invariant, reserveInAfterTransfer);
        return Nox.sub(reserveOut, newReserveOut);
    }
}
