// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {
    Nox,
    ebool,
    euint256,
    externalEuint256
} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";
import {INoxCompute} from "@iexec-nox/nox-protocol-contracts/contracts/interfaces/INoxCompute.sol";
import {TEEType} from "@iexec-nox/nox-protocol-contracts/contracts/shared/TypeUtils.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {FissionPositionVault} from "./FissionPositionVault.sol";
import {AaveUSDCYieldAdapter} from "./AaveUSDCYieldAdapter.sol";

contract FissionMarket is EIP712 {
    uint256 public constant USDC_TO_SY_SCALE = 1e12;
    uint256 public constant FEE_BPS = 30;
    uint256 public constant BPS_DENOMINATOR = 10_000;

    uint8 public constant KIND_SY = 0;
    uint8 public constant KIND_PT = 1;
    uint8 public constant KIND_YT = 2;

    uint256 public immutable maturity;

    FissionPositionVault public immutable vault;
    AaveUSDCYieldAdapter public immutable adapter;
    address public immutable owner;

    euint256 private feeMultiplier;
    euint256 private bpsDenominator;

    struct RedeemRequest {
        address user;
        uint256 clearUsdc;
        ebool eqHandle;
        bool settled;
    }

    mapping(uint256 => RedeemRequest) public redeemRequests;
    uint256 public nextRedeemId;

    mapping(address => uint256) public nonces;

    /**
     * Cumulative cleartext USDC principal currently sitting in the Aave adapter on behalf of
     * users. Increments on `mintSY`, decrements when `settleSYRedeem` actually withdraws. The
     * Aave adapter accrues yield above this balance; the surplus is what the owner is allowed
     * to harvest via `harvestAaveYield`. A real per-YT yield distribution would replace this
     * single-buffer accounting with a yield-index model — out of scope for this iteration.
     */
    uint256 public principalDeposited;

    event AaveYieldHarvested(address to, uint256 amount);

    bytes32 private constant MINT_SY_TYPEHASH = keccak256(
        "MintSY(address actor,uint256 clearAmount,uint256 nonce,uint256 deadline)"
    );
    bytes32 private constant FISSION_TYPEHASH = keccak256(
        "Fission(address actor,bytes32 encryptedAmount,bytes32 proofHash,uint256 nonce,uint256 deadline)"
    );
    bytes32 private constant COMBINE_TYPEHASH = keccak256(
        "Combine(address actor,bytes32 encryptedAmount,bytes32 proofHash,uint256 nonce,uint256 deadline)"
    );
    bytes32 private constant REDEEM_PT_TYPEHASH = keccak256(
        "RedeemPT(address actor,bytes32 encryptedAmount,bytes32 proofHash,uint256 nonce,uint256 deadline)"
    );
    bytes32 private constant SWAP_TYPEHASH = keccak256(
        "Swap(address actor,uint8 route,bytes32 encryptedAmountIn,bytes32 proofInHash,bytes32 encryptedMinAmountOut,bytes32 proofMinHash,uint256 nonce,uint256 deadline)"
    );
    bytes32 private constant REQUEST_REDEEM_SY_TYPEHASH = keccak256(
        "RequestSYRedeem(address actor,uint256 clearUsdc,uint256 nonce,uint256 deadline)"
    );

    event PublicDeposit(address user, uint256 amount);
    event PublicRedemption(address user, uint256 amount);
    event ConfidentialAction(bytes32 handleA, bytes32 handleB);
    event ConfidentialAmmSeeded(bytes32 syReserve, bytes32 ptReserve, bytes32 ytReserve);
    event ConfidentialAmmLiquidityAdded(address provider, uint8 reserve, bytes32 encryptedAmount);
    event RedeemRequested(uint256 id, address user, uint256 clearUsdc, bytes32 eqHandle);
    event RedeemSettled(uint256 id, address user, uint256 clearUsdc);

    error OnlyOwner();
    error InvalidReserve();
    error NotMatured();
    error AlreadyMatured();
    error InvalidRedemption();
    error AlreadySettled();
    error InsufficientBalance();
    error InvalidDenomination();
    error InvalidSignature();
    error InvalidNonce();
    error ExpiredDeadline();
    error InvalidRoute();
    error InsufficientYieldBuffer();

    constructor(uint256 maturity_) EIP712("FissionMarket", "1") {
        owner = msg.sender;
        maturity = maturity_;
        vault = new FissionPositionVault(address(this));
        adapter = new AaveUSDCYieldAdapter(address(this));

        feeMultiplier = Nox.toEuint256(BPS_DENOMINATOR - FEE_BPS);
        bpsDenominator = Nox.toEuint256(BPS_DENOMINATOR);
        Nox.allowThis(feeMultiplier);
        Nox.allowThis(bpsDenominator);

        euint256 syReserve = Nox.toEuint256(1_000_000e18);
        euint256 ptReserve = Nox.toEuint256(1_026_000e18);
        euint256 ytReserve = Nox.toEuint256(12_000_000e18);

        vault.mintConfidential(KIND_SY, address(this), syReserve);
        vault.mintConfidential(KIND_PT, address(this), ptReserve);
        vault.mintConfidential(KIND_YT, address(this), ytReserve);

        emit ConfidentialAmmSeeded(
            euint256.unwrap(syReserve),
            euint256.unwrap(ptReserve),
            euint256.unwrap(ytReserve)
        );
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    modifier notMatured() {
        if (block.timestamp >= maturity) revert AlreadyMatured();
        _;
    }

    modifier onlyAfterMaturity() {
        if (block.timestamp < maturity) revert NotMatured();
        _;
    }

    // ───────── Direct entry points ─────────

    function mintSY(uint256 clearAmount) external notMatured {
        _mintSY(msg.sender, clearAmount);
    }

    function fission(externalEuint256 encryptedAmount, bytes calldata proof) external notMatured {
        _fission(msg.sender, encryptedAmount, proof);
    }

    function combine(externalEuint256 encryptedAmount, bytes calldata proof) external {
        _combine(msg.sender, encryptedAmount, proof);
    }

    function redeemPT(externalEuint256 encryptedAmount, bytes calldata proof) external onlyAfterMaturity {
        _redeemPT(msg.sender, encryptedAmount, proof);
    }

    function requestSYRedeem(uint256 clearUsdc) external returns (uint256 id) {
        return _requestSYRedeem(msg.sender, clearUsdc);
    }

    function swapSYForPT(
        externalEuint256 encryptedAmountIn,
        bytes calldata proofIn,
        externalEuint256 encryptedMinAmountOut,
        bytes calldata proofMin
    ) external notMatured {
        _swap(msg.sender, KIND_SY, KIND_PT, encryptedAmountIn, proofIn, encryptedMinAmountOut, proofMin);
    }

    function swapSYForYT(
        externalEuint256 encryptedAmountIn,
        bytes calldata proofIn,
        externalEuint256 encryptedMinAmountOut,
        bytes calldata proofMin
    ) external notMatured {
        _swap(msg.sender, KIND_SY, KIND_YT, encryptedAmountIn, proofIn, encryptedMinAmountOut, proofMin);
    }

    function sellPTForSY(
        externalEuint256 encryptedAmountIn,
        bytes calldata proofIn,
        externalEuint256 encryptedMinAmountOut,
        bytes calldata proofMin
    ) external notMatured {
        _swap(msg.sender, KIND_PT, KIND_SY, encryptedAmountIn, proofIn, encryptedMinAmountOut, proofMin);
    }

    function sellYTForSY(
        externalEuint256 encryptedAmountIn,
        bytes calldata proofIn,
        externalEuint256 encryptedMinAmountOut,
        bytes calldata proofMin
    ) external notMatured {
        _swap(msg.sender, KIND_YT, KIND_SY, encryptedAmountIn, proofIn, encryptedMinAmountOut, proofMin);
    }

    function settleSYRedeem(uint256 id, bytes calldata decryptionProof) external {
        RedeemRequest storage r = redeemRequests[id];
        if (r.user == address(0)) revert InvalidRedemption();
        if (r.settled) revert AlreadySettled();
        bool ok = Nox.publicDecrypt(r.eqHandle, decryptionProof);
        if (!ok) revert InsufficientBalance();
        r.settled = true;
        principalDeposited -= r.clearUsdc;
        adapter.withdrawTo(r.user, r.clearUsdc);
        emit RedeemSettled(id, r.user, r.clearUsdc);
    }

    /**
     * Sweep the Aave-side surplus (aUSDC.balanceOf(adapter) − principalDeposited) to `to`.
     * This is the yield generated by user deposits that no other contract path claims today.
     * It is owner-extractive in this prototype; a production version should distribute pro
     * rata to YT holders via an encrypted yield-index claim path.
     */
    function harvestAaveYield(address to, uint256 amount) external onlyOwner {
        uint256 reserveBalance = adapter.reserveBalance();
        if (reserveBalance < principalDeposited + amount) revert InsufficientYieldBuffer();
        adapter.withdrawTo(to, amount);
        emit AaveYieldHarvested(to, amount);
    }

    function addAmmLiquidity(
        uint8 reserve,
        externalEuint256 encryptedAmount,
        bytes calldata proof
    ) external onlyOwner {
        if (reserve > KIND_YT) revert InvalidReserve();
        euint256 amount = Nox.fromExternal(encryptedAmount, proof);
        Nox.allow(amount, address(vault));
        vault.mintConfidential(reserve, address(this), amount);
        emit ConfidentialAmmLiquidityAdded(msg.sender, reserve, euint256.unwrap(amount));
    }

    // ───────── Relayed (meta-tx) entry points ─────────

    function relayedMintSY(
        address actor,
        uint256 clearAmount,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external notMatured {
        bytes32 structHash = keccak256(abi.encode(MINT_SY_TYPEHASH, actor, clearAmount, nonce, deadline));
        _verifyAndConsume(structHash, actor, nonce, deadline, signature);
        _mintSY(actor, clearAmount);
    }

    function relayedFission(
        address actor,
        externalEuint256 encryptedAmount,
        bytes calldata proof,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external notMatured {
        bytes32 structHash = keccak256(abi.encode(
            FISSION_TYPEHASH,
            actor,
            externalEuint256.unwrap(encryptedAmount),
            keccak256(proof),
            nonce,
            deadline
        ));
        _verifyAndConsume(structHash, actor, nonce, deadline, signature);
        _fission(actor, encryptedAmount, proof);
    }

    function relayedCombine(
        address actor,
        externalEuint256 encryptedAmount,
        bytes calldata proof,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external {
        bytes32 structHash = keccak256(abi.encode(
            COMBINE_TYPEHASH,
            actor,
            externalEuint256.unwrap(encryptedAmount),
            keccak256(proof),
            nonce,
            deadline
        ));
        _verifyAndConsume(structHash, actor, nonce, deadline, signature);
        _combine(actor, encryptedAmount, proof);
    }

    function relayedRedeemPT(
        address actor,
        externalEuint256 encryptedAmount,
        bytes calldata proof,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external onlyAfterMaturity {
        bytes32 structHash = keccak256(abi.encode(
            REDEEM_PT_TYPEHASH,
            actor,
            externalEuint256.unwrap(encryptedAmount),
            keccak256(proof),
            nonce,
            deadline
        ));
        _verifyAndConsume(structHash, actor, nonce, deadline, signature);
        _redeemPT(actor, encryptedAmount, proof);
    }

    function relayedRequestSYRedeem(
        address actor,
        uint256 clearUsdc,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external returns (uint256 id) {
        bytes32 structHash = keccak256(abi.encode(REQUEST_REDEEM_SY_TYPEHASH, actor, clearUsdc, nonce, deadline));
        _verifyAndConsume(structHash, actor, nonce, deadline, signature);
        return _requestSYRedeem(actor, clearUsdc);
    }

    function relayedSwap(
        address actor,
        uint8 route,
        externalEuint256 encryptedAmountIn,
        bytes calldata proofIn,
        externalEuint256 encryptedMinAmountOut,
        bytes calldata proofMin,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external notMatured {
        bytes32 structHash = keccak256(abi.encode(
            SWAP_TYPEHASH,
            actor,
            route,
            externalEuint256.unwrap(encryptedAmountIn),
            keccak256(proofIn),
            externalEuint256.unwrap(encryptedMinAmountOut),
            keccak256(proofMin),
            nonce,
            deadline
        ));
        _verifyAndConsume(structHash, actor, nonce, deadline, signature);
        (uint8 kindIn, uint8 kindOut) = _routeKinds(route);
        _swap(actor, kindIn, kindOut, encryptedAmountIn, proofIn, encryptedMinAmountOut, proofMin);
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ───────── Internals ─────────

    function _verifyAndConsume(
        bytes32 structHash,
        address actor,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) internal {
        if (block.timestamp > deadline) revert ExpiredDeadline();
        if (nonces[actor] != nonce) revert InvalidNonce();
        address recovered = ECDSA.recover(_hashTypedDataV4(structHash), signature);
        if (recovered != actor) revert InvalidSignature();
        nonces[actor] = nonce + 1;
    }

    function _routeKinds(uint8 route) internal pure returns (uint8 kindIn, uint8 kindOut) {
        if (route == 1) return (KIND_SY, KIND_PT);
        if (route == 2) return (KIND_SY, KIND_YT);
        if (route == 3) return (KIND_PT, KIND_SY);
        if (route == 4) return (KIND_YT, KIND_SY);
        revert InvalidRoute();
    }

    function _fromExternalAs(
        externalEuint256 externalHandle,
        bytes calldata proof,
        address actor
    ) internal returns (euint256) {
        bytes32 handle = externalEuint256.unwrap(externalHandle);
        INoxCompute(Nox.noxComputeContract()).validateInputProof(handle, actor, proof, TEEType.Uint256);
        return euint256.wrap(handle);
    }

    function _mintSY(address actor, uint256 clearAmount) internal {
        if (!_isAllowedDenomination(clearAmount)) revert InvalidDenomination();
        adapter.pullAndSupply(actor, clearAmount);
        euint256 amount = Nox.toEuint256(clearAmount * USDC_TO_SY_SCALE);
        vault.mintConfidential(KIND_SY, actor, amount);
        principalDeposited += clearAmount;
        emit PublicDeposit(actor, clearAmount);
    }

    function _fission(address actor, externalEuint256 encryptedAmount, bytes calldata proof) internal {
        euint256 amount = _fromExternalAs(encryptedAmount, proof, actor);
        Nox.allow(amount, address(vault));
        vault.burnConfidential(KIND_SY, actor, amount);
        vault.mintConfidential(KIND_PT, actor, amount);
        vault.mintConfidential(KIND_YT, actor, amount);
        emit ConfidentialAction(euint256.unwrap(amount), bytes32(0));
    }

    function _combine(address actor, externalEuint256 encryptedAmount, bytes calldata proof) internal {
        euint256 amount = _fromExternalAs(encryptedAmount, proof, actor);
        Nox.allow(amount, address(vault));
        vault.burnConfidential(KIND_PT, actor, amount);
        vault.burnConfidential(KIND_YT, actor, amount);
        vault.mintConfidential(KIND_SY, actor, amount);
        emit ConfidentialAction(euint256.unwrap(amount), bytes32(0));
    }

    function _redeemPT(address actor, externalEuint256 encryptedAmount, bytes calldata proof) internal {
        euint256 amount = _fromExternalAs(encryptedAmount, proof, actor);
        Nox.allow(amount, address(vault));
        vault.burnConfidential(KIND_PT, actor, amount);
        vault.mintConfidential(KIND_SY, actor, amount);
        emit ConfidentialAction(euint256.unwrap(amount), bytes32(0));
    }

    function _requestSYRedeem(address actor, uint256 clearUsdc) internal returns (uint256 id) {
        if (!_isAllowedDenomination(clearUsdc)) revert InvalidDenomination();
        id = ++nextRedeemId;
        euint256 requested = Nox.toEuint256(clearUsdc * USDC_TO_SY_SCALE);
        Nox.allow(requested, address(vault));
        euint256 transferred = vault.burnConfidential(KIND_SY, actor, requested);
        ebool ok = Nox.eq(transferred, requested);
        Nox.allowPublicDecryption(ok);
        Nox.allowThis(ok);
        redeemRequests[id] = RedeemRequest({
            user: actor,
            clearUsdc: clearUsdc,
            eqHandle: ok,
            settled: false
        });
        emit RedeemRequested(id, actor, clearUsdc, ebool.unwrap(ok));
    }

    function _swap(
        address actor,
        uint8 kindIn,
        uint8 kindOut,
        externalEuint256 encryptedAmountIn,
        bytes calldata proofIn,
        externalEuint256 encryptedMinAmountOut,
        bytes calldata proofMin
    ) internal {
        euint256 amountIn = _fromExternalAs(encryptedAmountIn, proofIn, actor);
        euint256 minAmountOut = _fromExternalAs(encryptedMinAmountOut, proofMin, actor);
        Nox.allow(amountIn, address(vault));

        euint256 transferredIn = vault.transferConfidentialByMarket(kindIn, actor, address(this), amountIn);

        euint256 reserveInAfter = vault.confidentialBalanceOf(kindIn, address(this));
        euint256 reserveOut = vault.confidentialBalanceOf(kindOut, address(this));
        euint256 reserveInBefore = Nox.sub(reserveInAfter, transferredIn);

        euint256 amountInWithFee = Nox.mul(transferredIn, feeMultiplier);
        euint256 numerator = Nox.mul(amountInWithFee, reserveOut);
        euint256 denominator = Nox.add(Nox.mul(reserveInBefore, bpsDenominator), amountInWithFee);
        euint256 amountOut = Nox.div(numerator, denominator);

        ebool ok = Nox.ge(amountOut, minAmountOut);
        euint256 zero = Nox.toEuint256(0);
        euint256 effectiveOut = Nox.select(ok, amountOut, zero);
        euint256 refundIn = Nox.select(ok, zero, transferredIn);

        Nox.allow(effectiveOut, address(vault));
        vault.transferConfidentialByMarket(kindOut, address(this), actor, effectiveOut);

        Nox.allow(refundIn, address(vault));
        vault.transferConfidentialByMarket(kindIn, address(this), actor, refundIn);

        emit ConfidentialAction(euint256.unwrap(transferredIn), euint256.unwrap(effectiveOut));
    }

    function _isAllowedDenomination(uint256 clearAmount) internal pure returns (bool) {
        return
            clearAmount == 10 * 1e6 ||
            clearAmount == 100 * 1e6 ||
            clearAmount == 1_000 * 1e6 ||
            clearAmount == 10_000 * 1e6;
    }
}
