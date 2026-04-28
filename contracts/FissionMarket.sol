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
    uint8 public constant KIND_LP_SY_PT = 3;
    uint8 public constant KIND_LP_SY_YT = 4;

    uint256 public immutable maturity;

    FissionPositionVault public immutable vault;
    AaveUSDCYieldAdapter public immutable adapter;
    address public immutable owner;

    euint256 private feeMultiplier;
    euint256 private bpsDenominator;

    /**
     * Anonymized SY redeem request. `commit = keccak256(recipient, salt)` hides the recipient
     * address until settle. `amountHandle` is an encrypted handle the public-decrypt oracle
     * resolves at settle time, so the cleartext USDC amount is not stored on-chain. `requestBlockTime`
     * gates settle behind a minimum delay to break tx-timing correlation between request and
     * settle.
     */
    struct RedeemRequest {
        bytes32 commit;
        euint256 amountHandle;
        uint64 requestBlockTime;
        bool settled;
    }

    mapping(uint256 => RedeemRequest) public redeemRequests;
    uint256 public nextRedeemId;

    /// Minimum delay between request and settle, in seconds. Trades latency for timing privacy.
    uint256 public constant REDEEM_MIN_DELAY = 5 minutes;

    mapping(address => uint256) public nonces;

    /**
     * Cumulative cleartext USDC principal currently sitting in the Aave adapter on behalf of
     * users. Increments on `mintSY`, decrements when `settleSYRedeem` actually withdraws.
     */
    uint256 public principalDeposited;

    /**
     * Maturity-time yield distribution. The cleartext maturity yield is folded into the
     * principal buffer at snapshot time so subsequent SY redemptions (via the 4-bucket exit)
     * draw against a unified pool. YT holders claim their share by minting *encrypted* SY
     * (`redeemYTToSY`) — no per-user decryption of the yield amount is required, removing the
     * pro-rata leak that the previous cleartext payout had.
     */
    bool public maturitySnapshotTaken;
    uint256 public maturityYieldUsdc;
    euint256 private maturityUserYTSupply;

    bytes32 private constant REDEEM_YT_TO_SY_TYPEHASH = keccak256(
        "RedeemYTToSY(address actor,bytes32 encryptedAmount,bytes32 proofHash,uint256 nonce,uint256 deadline)"
    );

    event AaveYieldHarvested(address to, uint256 amount);
    event MaturitySnapshot(uint256 yieldUsdc, bytes32 userYTSupplyHandle);
    event YieldRedeemed(bytes32 ytBurnedHandle, bytes32 syMintedHandle);
    event LiquidityAdded(uint8 pool, bytes32 lpHandle);
    event LiquidityRemoved(uint8 pool, bytes32 lpHandle);

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
        "RequestSYRedeem(address actor,uint256 clearUsdc,bytes32 commit,uint256 nonce,uint256 deadline)"
    );
    bytes32 private constant SETTLE_REDEEM_SY_TYPEHASH = keccak256(
        "SettleSYRedeem(uint256 id,address recipient,bytes32 salt,uint256 nonce,uint256 deadline)"
    );

    event PublicDeposit(uint256 amount);
    event ConfidentialAction(bytes32 handleA, bytes32 handleB);
    event ConfidentialAmmSeeded(bytes32 syReserve, bytes32 ptReserve, bytes32 ytReserve);
    event ConfidentialAmmLiquidityAdded(address provider, uint8 reserve, bytes32 encryptedAmount);
    event RedeemRequested(uint256 id, bytes32 commit, bytes32 amountHandle);
    event RedeemSettled(uint256 id, uint256 amount);

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
    error SnapshotNotTaken();
    error SnapshotAlreadyTaken();
    error CommitMismatch();
    error TooEarly();

    struct MarketConfig {
        uint256 maturity;
        address usdc;
        address aUsdc;
        address aavePool;
        uint256 syReserveSeed;
        uint256 ptReserveSeed;
        uint256 ytReserveSeed;
    }

    constructor(address owner_, MarketConfig memory cfg) EIP712("FissionMarket", "1") {
        owner = owner_;
        maturity = cfg.maturity;
        vault = new FissionPositionVault(address(this));
        adapter = new AaveUSDCYieldAdapter(address(this), cfg.usdc, cfg.aUsdc, cfg.aavePool);

        feeMultiplier = Nox.toEuint256(BPS_DENOMINATOR - FEE_BPS);
        bpsDenominator = Nox.toEuint256(BPS_DENOMINATOR);
        Nox.allowThis(feeMultiplier);
        Nox.allowThis(bpsDenominator);

        euint256 syReserve = Nox.toEuint256(cfg.syReserveSeed);
        euint256 ptReserve = Nox.toEuint256(cfg.ptReserveSeed);
        euint256 ytReserve = Nox.toEuint256(cfg.ytReserveSeed);

        vault.mintConfidential(KIND_SY, address(this), syReserve);
        vault.mintConfidential(KIND_PT, address(this), ptReserve);
        vault.mintConfidential(KIND_YT, address(this), ytReserve);

        // Initial LP supply for the SY/PT and SY/YT pools, locked to the market. Future LP
        // deposits dilute proportionally; the market's locked share captures the seed-time
        // backing.
        vault.mintConfidential(KIND_LP_SY_PT, address(this), syReserve);
        vault.mintConfidential(KIND_LP_SY_YT, address(this), syReserve);

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

    /**
     * Request a USDC redemption against an encrypted SY balance.
     * @param clearUsdc One of the allowed bucket denominations (see `_isAllowedDenomination`).
     * @param commit `keccak256(abi.encode(recipient, salt))` — hides the recipient until settle.
     */
    function requestSYRedeem(uint256 clearUsdc, bytes32 commit) external returns (uint256 id) {
        return _requestSYRedeem(msg.sender, clearUsdc, commit);
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

    /**
     * Settle a previously requested SY → USDC redemption. The caller proves recipient by
     * supplying the `(recipient, salt)` pair that hashes to the request's `commit`.
     * Must be called at least `REDEEM_MIN_DELAY` after the request, decoupling timing.
     *
     * Anyone may submit settle (with a valid salt) — typically the recipient or their relayer.
     */
    function settleSYRedeem(
        uint256 id,
        address recipient,
        bytes32 salt,
        bytes calldata decryptionProof
    ) external {
        RedeemRequest storage r = redeemRequests[id];
        if (r.commit == bytes32(0)) revert InvalidRedemption();
        if (r.settled) revert AlreadySettled();
        if (block.timestamp < uint256(r.requestBlockTime) + REDEEM_MIN_DELAY) revert TooEarly();
        if (keccak256(abi.encode(recipient, salt)) != r.commit) revert CommitMismatch();
        // The encrypted amount is the actually-burned SY (which was capped at the user's balance
        // by the vault). At 1e18 SY decimals → divide by USDC_TO_SY_SCALE to land in USDC base
        // units. Public-decrypt yields cleartext USDC ready for adapter withdrawal.
        uint256 transferredSy = Nox.publicDecrypt(r.amountHandle, decryptionProof);
        uint256 clearUsdc = transferredSy / USDC_TO_SY_SCALE;
        r.settled = true;
        // Defensive: clamp principalDeposited at zero rather than underflow.
        principalDeposited = principalDeposited > clearUsdc ? principalDeposited - clearUsdc : 0;
        if (clearUsdc > 0) {
            adapter.withdrawTo(recipient, clearUsdc);
        }
        emit RedeemSettled(id, clearUsdc);
    }

    /**
     * Sweep an unclaimed slice of the Aave-side surplus to `to`. Bounded so it cannot dip into
     * user principal. Post-snapshot the maturity yield has been folded into `principalDeposited`,
     * so a single counter is enough. Pre-snapshot, owner can sweep floating Aave yield freely.
     */
    function harvestAaveYield(address to, uint256 amount) external onlyOwner {
        uint256 reserveBalance = adapter.reserveBalance();
        if (reserveBalance < principalDeposited + amount) revert InsufficientYieldBuffer();
        adapter.withdrawTo(to, amount);
        emit AaveYieldHarvested(to, amount);
    }

    /**
     * Idempotent: lock cleartext maturity yield and encrypted user-held YT supply, and fold
     * the yield into `principalDeposited` so it backs YT-routed encrypted SY mints.
     *
     * Privacy upgrade: the per-claim cleartext payout is gone. Yield is claimed via
     * `redeemYTToSY`, which mints encrypted SY directly without a public decryption step.
     */
    function snapshotMaturity() external onlyAfterMaturity {
        if (maturitySnapshotTaken) revert SnapshotAlreadyTaken();
        uint256 reserveBalance = adapter.reserveBalance();
        // Defensive: if Aave returned less than principal (shouldn't happen with aTokens), zero
        // out the yield rather than underflow.
        maturityYieldUsdc = reserveBalance > principalDeposited ? reserveBalance - principalDeposited : 0;
        // Fold yield into principal buffer. From now on, all SY (principal-backed and yield-backed
        // via redeemYTToSY) draws against a single, unified pool — observers cannot tell which
        // bucket a redeemer is hitting.
        principalDeposited += maturityYieldUsdc;
        euint256 userHeld = vault.confidentialUserHeldSupply(KIND_YT);
        Nox.allowThis(userHeld);
        maturityUserYTSupply = userHeld;
        maturitySnapshotTaken = true;
        emit MaturitySnapshot(maturityYieldUsdc, euint256.unwrap(userHeld));
    }

    /**
     * Claim YT yield as encrypted SY. No public decryption: the yield amount stays encrypted
     * end-to-end. User exits via the standard 4-bucket `requestSYRedeem` path, blending into
     * the principal-redemption anonymity set.
     */
    function redeemYTToSY(externalEuint256 encryptedAmount, bytes calldata proof)
        external
        onlyAfterMaturity
    {
        _redeemYTToSY(msg.sender, encryptedAmount, proof);
    }

    function relayedRedeemYTToSY(
        address actor,
        externalEuint256 encryptedAmount,
        bytes calldata proof,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external onlyAfterMaturity {
        bytes32 structHash = keccak256(abi.encode(
            REDEEM_YT_TO_SY_TYPEHASH,
            actor,
            externalEuint256.unwrap(encryptedAmount),
            keccak256(proof),
            nonce,
            deadline
        ));
        _verifyAndConsume(structHash, actor, nonce, deadline, signature);
        _redeemYTToSY(actor, encryptedAmount, proof);
    }

    function _redeemYTToSY(address actor, externalEuint256 encryptedAmount, bytes calldata proof)
        internal
    {
        if (!maturitySnapshotTaken) revert SnapshotNotTaken();
        euint256 amount = _fromExternalAs(encryptedAmount, proof, actor);
        Nox.allow(amount, address(vault));
        euint256 burned = vault.burnConfidential(KIND_YT, actor, amount);
        // syOut = burned × maturityYieldUsdc × USDC_TO_SY_SCALE / maturityUserYTSupply.
        // burned and supply are both at 1e18; yield is at 1e6 USDC; USDC_TO_SY_SCALE = 1e12 lifts
        // the result to 1e18 SY decimals. No additional scaling needed.
        euint256 yieldUsdcEnc = Nox.toEuint256(maturityYieldUsdc * USDC_TO_SY_SCALE);
        euint256 numerator = Nox.mul(burned, yieldUsdcEnc);
        euint256 syOut = Nox.div(numerator, maturityUserYTSupply);
        Nox.allow(syOut, address(vault));
        vault.mintConfidential(KIND_SY, actor, syOut);
        emit YieldRedeemed(euint256.unwrap(burned), euint256.unwrap(syOut));
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

    /**
     * Permissionless LP add/remove for the SY/PT pool. Users supply both SY and PT in any
     * ratio; the contract burns both, mints LP tokens proportional to the limiting side, and
     * refunds the over-supplied side. LP tokens accrue swap-fee value as the pool reserves grow.
     *
     * The first LP deposit takes the constructor-locked LP supply as the totalLP denominator,
     * so seeders can never exit while preserving correct dilution math for new deposits.
     */
    function addLiquiditySYPT(
        externalEuint256 encryptedSy,
        bytes calldata syProof,
        externalEuint256 encryptedOther,
        bytes calldata otherProof
    ) external notMatured {
        _addLiquidity(msg.sender, KIND_PT, KIND_LP_SY_PT, encryptedSy, syProof, encryptedOther, otherProof);
    }

    function removeLiquiditySYPT(
        externalEuint256 encryptedLp,
        bytes calldata lpProof
    ) external notMatured {
        _removeLiquidity(msg.sender, KIND_PT, KIND_LP_SY_PT, encryptedLp, lpProof);
    }

    function addLiquiditySYYT(
        externalEuint256 encryptedSy,
        bytes calldata syProof,
        externalEuint256 encryptedOther,
        bytes calldata otherProof
    ) external notMatured {
        _addLiquidity(msg.sender, KIND_YT, KIND_LP_SY_YT, encryptedSy, syProof, encryptedOther, otherProof);
    }

    function removeLiquiditySYYT(
        externalEuint256 encryptedLp,
        bytes calldata lpProof
    ) external notMatured {
        _removeLiquidity(msg.sender, KIND_YT, KIND_LP_SY_YT, encryptedLp, lpProof);
    }

    function _addLiquidity(
        address actor,
        uint8 otherKind,
        uint8 lpKind,
        externalEuint256 encryptedSy,
        bytes calldata syProof,
        externalEuint256 encryptedOther,
        bytes calldata otherProof
    ) internal {
        euint256 syIn = _fromExternalAs(encryptedSy, syProof, actor);
        euint256 otherIn = _fromExternalAs(encryptedOther, otherProof, actor);

        Nox.allow(syIn, address(vault));
        Nox.allow(otherIn, address(vault));
        euint256 transferredSy = vault.transferConfidentialByMarket(KIND_SY, actor, address(this), syIn);
        euint256 transferredOther = vault.transferConfidentialByMarket(otherKind, actor, address(this), otherIn);

        euint256 totalLP = vault.confidentialTotalSupply(lpKind);
        Nox.allowThis(totalLP);
        euint256 syReserveAfter = vault.confidentialBalanceOf(KIND_SY, address(this));
        euint256 otherReserveAfter = vault.confidentialBalanceOf(otherKind, address(this));
        euint256 syReserveBefore = Nox.sub(syReserveAfter, transferredSy);
        euint256 otherReserveBefore = Nox.sub(otherReserveAfter, transferredOther);

        euint256 lpFromSy = Nox.div(Nox.mul(transferredSy, totalLP), syReserveBefore);
        euint256 lpFromOther = Nox.div(Nox.mul(transferredOther, totalLP), otherReserveBefore);
        ebool syIsLimit = Nox.le(lpFromSy, lpFromOther);
        euint256 lpMinted = Nox.select(syIsLimit, lpFromSy, lpFromOther);

        euint256 syUsed = Nox.div(Nox.mul(lpMinted, syReserveBefore), totalLP);
        euint256 otherUsed = Nox.div(Nox.mul(lpMinted, otherReserveBefore), totalLP);
        euint256 syRefund = Nox.sub(transferredSy, syUsed);
        euint256 otherRefund = Nox.sub(transferredOther, otherUsed);

        Nox.allow(syRefund, address(vault));
        Nox.allow(otherRefund, address(vault));
        vault.transferConfidentialByMarket(KIND_SY, address(this), actor, syRefund);
        vault.transferConfidentialByMarket(otherKind, address(this), actor, otherRefund);

        Nox.allow(lpMinted, address(vault));
        vault.mintConfidential(lpKind, actor, lpMinted);

        emit LiquidityAdded(lpKind, euint256.unwrap(lpMinted));
    }

    function _removeLiquidity(
        address actor,
        uint8 otherKind,
        uint8 lpKind,
        externalEuint256 encryptedLp,
        bytes calldata lpProof
    ) internal {
        euint256 lpAmount = _fromExternalAs(encryptedLp, lpProof, actor);
        Nox.allow(lpAmount, address(vault));
        euint256 burnedLp = vault.burnConfidential(lpKind, actor, lpAmount);

        euint256 totalLPAfter = vault.confidentialTotalSupply(lpKind);
        Nox.allowThis(totalLPAfter);
        euint256 totalLPBefore = Nox.add(totalLPAfter, burnedLp);

        euint256 syReserve = vault.confidentialBalanceOf(KIND_SY, address(this));
        euint256 otherReserve = vault.confidentialBalanceOf(otherKind, address(this));
        euint256 syOut = Nox.div(Nox.mul(burnedLp, syReserve), totalLPBefore);
        euint256 otherOut = Nox.div(Nox.mul(burnedLp, otherReserve), totalLPBefore);

        Nox.allow(syOut, address(vault));
        Nox.allow(otherOut, address(vault));
        vault.transferConfidentialByMarket(KIND_SY, address(this), actor, syOut);
        vault.transferConfidentialByMarket(otherKind, address(this), actor, otherOut);

        emit LiquidityRemoved(lpKind, euint256.unwrap(burnedLp));
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
        bytes32 commit,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external returns (uint256 id) {
        bytes32 structHash = keccak256(abi.encode(REQUEST_REDEEM_SY_TYPEHASH, actor, clearUsdc, commit, nonce, deadline));
        _verifyAndConsume(structHash, actor, nonce, deadline, signature);
        return _requestSYRedeem(actor, clearUsdc, commit);
    }

    function relayedSettleSYRedeem(
        address actor,
        uint256 id,
        address recipient,
        bytes32 salt,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature,
        bytes calldata decryptionProof
    ) external {
        bytes32 structHash = keccak256(abi.encode(SETTLE_REDEEM_SY_TYPEHASH, id, recipient, salt, nonce, deadline));
        _verifyAndConsume(structHash, actor, nonce, deadline, signature);
        // Recipient must match the commit; settle proceeds normally.
        RedeemRequest storage r = redeemRequests[id];
        if (r.commit == bytes32(0)) revert InvalidRedemption();
        if (r.settled) revert AlreadySettled();
        if (block.timestamp < uint256(r.requestBlockTime) + REDEEM_MIN_DELAY) revert TooEarly();
        if (keccak256(abi.encode(recipient, salt)) != r.commit) revert CommitMismatch();
        uint256 transferredSy = Nox.publicDecrypt(r.amountHandle, decryptionProof);
        uint256 clearUsdc = transferredSy / USDC_TO_SY_SCALE;
        r.settled = true;
        principalDeposited = principalDeposited > clearUsdc ? principalDeposited - clearUsdc : 0;
        if (clearUsdc > 0) {
            adapter.withdrawTo(recipient, clearUsdc);
        }
        emit RedeemSettled(id, clearUsdc);
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
        // PublicDeposit no longer carries the actor — the tx caller is visible on-chain
        // anyway, and dropping the field keeps protocol-level event indexing actor-free.
        emit PublicDeposit(clearAmount);
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

    function _requestSYRedeem(address actor, uint256 clearUsdc, bytes32 commit)
        internal
        returns (uint256 id)
    {
        if (!_isAllowedDenomination(clearUsdc)) revert InvalidDenomination();
        if (commit == bytes32(0)) revert CommitMismatch();
        id = ++nextRedeemId;
        euint256 requested = Nox.toEuint256(clearUsdc * USDC_TO_SY_SCALE);
        Nox.allow(requested, address(vault));
        // `transferred` is min(requested, balance). Public-decrypt at settle yields the actual
        // burned amount; if user had insufficient SY, transferred = 0 and the request settles
        // as a no-op (no USDC paid out, no principal decrement).
        euint256 transferred = vault.burnConfidential(KIND_SY, actor, requested);
        Nox.allowPublicDecryption(transferred);
        Nox.allowThis(transferred);
        redeemRequests[id] = RedeemRequest({
            commit: commit,
            amountHandle: transferred,
            requestBlockTime: uint64(block.timestamp),
            settled: false
        });
        emit RedeemRequested(id, commit, euint256.unwrap(transferred));
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

    /**
     * Denomination buckets. The 1-USDC bucket exists so that small YT-routed yield slices can
     * exit through `requestSYRedeem`. Wider set than the prior 4-bucket version trades per-
     * bucket anonymity-set size against precision; for prototype usage the wider set is the
     * better tradeoff because most redemptions cluster around 100 / 1k.
     */
    function _isAllowedDenomination(uint256 clearAmount) internal pure returns (bool) {
        return
            clearAmount == 1 * 1e6 ||
            clearAmount == 10 * 1e6 ||
            clearAmount == 100 * 1e6 ||
            clearAmount == 1_000 * 1e6 ||
            clearAmount == 10_000 * 1e6;
    }
}
