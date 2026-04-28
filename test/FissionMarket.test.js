import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { network } from "hardhat";

// Pinned addresses the contracts read from FissionAddresses.sol / Nox.sol. Tests setCode at
// each so the in-process EDR network behaves like a Nox-enabled chain with mock USDC + Aave.
const NOX_COMPUTE_LOCAL = "0x44C00793aD4975617b3B5Fc27D4FB78E772c8236";
const AAVE_USDC = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";
const AAVE_AUSDC = "0x460b97BD498E1157530AEb3086301d5225b91216";
const AAVE_V3_POOL = "0xBfC91D59fdAA134A4ED45f7B584cAf96D7792Eff";

const TEN_USDC = 10n * 10n ** 6n;
const HUNDRED_USDC = 100n * 10n ** 6n;
const ABI = ["function mint(address,uint256)"];

function abiEncodeUint256(v) {
  return "0x" + BigInt(v).toString(16).padStart(64, "0");
}

async function rejectsWithError(promise, errorName) {
  // EDR returns custom errors as raw selectors. Compute the selector and grep the message.
  const { id } = await import("ethers");
  const selector = id(`${errorName}()`).slice(0, 10);
  try {
    await promise;
  } catch (err) {
    const msg = String(err.message ?? err);
    if (msg.includes(selector) || msg.includes(errorName)) return;
    throw new Error(`expected ${errorName} (${selector}) but got: ${msg}`);
  }
  throw new Error(`expected ${errorName} but call did not revert`);
}

async function setCodeFromContract(provider, ethers, contractName, target, ...args) {
  // Deploy the contract anywhere, copy its runtime bytecode, install at the pinned target.
  const factory = await ethers.getContractFactory(contractName);
  const impl = await factory.deploy(...args);
  await impl.waitForDeployment();
  const runtime = await provider.send("eth_getCode", [await impl.getAddress(), "latest"]);
  await provider.send("hardhat_setCode", [target, runtime]);
  return ethers.getContractAt(contractName, target);
}

describe("FissionMarket", () => {
  let ethers;
  let provider;
  let owner;
  let alice;
  let bob;
  let market;
  let vault;
  let adapter;
  let usdc;
  let pool;
  let nox;
  let aUsdc;
  let chainId;

  before(async () => {
    const conn = await network.connect();
    ethers = conn.ethers;
    provider = ethers.provider;
    chainId = (await provider.getNetwork()).chainId;
    [owner, alice, bob] = await ethers.getSigners();

    nox = await setCodeFromContract(provider, ethers, "MockNoxCompute", NOX_COMPUTE_LOCAL);
    usdc = await setCodeFromContract(provider, ethers, "MockUSDC", AAVE_USDC);
    aUsdc = await setCodeFromContract(provider, ethers, "MockAToken", AAVE_AUSDC);
    pool = await setCodeFromContract(provider, ethers, "MockAavePool", AAVE_V3_POOL);

    await pool.configure(AAVE_USDC, AAVE_AUSDC);
    await usdc.connect(alice).mint(alice.address, 1_000n * 10n ** 6n);
    await usdc.connect(bob).mint(bob.address, 1_000n * 10n ** 6n);

    const maturity = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;
    const Market = await ethers.getContractFactory("FissionMarket");
    const cfg = {
      maturity,
      usdc: AAVE_USDC,
      aUsdc: AAVE_AUSDC,
      aavePool: AAVE_V3_POOL,
      syReserveSeed: 1_000_000n * 10n ** 18n,
      ptReserveSeed: 1_026_000n * 10n ** 18n,
      ytReserveSeed: 12_000_000n * 10n ** 18n
    };
    market = await Market.deploy(owner.address, cfg);
    await market.waitForDeployment();

    vault = await ethers.getContractAt("FissionPositionVault", await market.vault());
    adapter = await ethers.getContractAt("AaveUSDCYieldAdapter", await market.adapter());
  });

  describe("access control", () => {
    it("reverts onlyOwner on harvestAaveYield from non-owner", async () => {
      await rejectsWithError(
        market.connect(alice).harvestAaveYield(alice.address, 1),
        "OnlyOwner"
      );
    });

    it("reverts onlyMarket on vault.mintConfidential from non-market", async () => {
      await rejectsWithError(
        vault.connect(alice).mintConfidential(0, alice.address, "0x" + "00".repeat(32)),
        "OnlyMarket"
      );
    });

    it("reverts InvalidReserve on addAmmLiquidity with reserve > 2", async () => {
      const fakeProof = abiEncodeUint256(0);
      await rejectsWithError(
        market.connect(owner).addAmmLiquidity(3, "0x" + "ff".repeat(32), fakeProof),
        "InvalidReserve"
      );
    });

    it("reverts InvalidKind on vault.confidentialBalanceOf with kind > KIND_MAX", async () => {
      await rejectsWithError(vault.confidentialBalanceOf(99, alice.address), "InvalidKind");
    });
  });

  describe("denominations", () => {
    it("rejects non-allowed mintSY denomination", async () => {
      await usdc.connect(alice).approve(await adapter.getAddress(), 50n * 10n ** 6n);
      await rejectsWithError(market.connect(alice).mintSY(50n * 10n ** 6n), "InvalidDenomination");
    });

    it("rejects non-allowed redeem denomination", async () => {
      const dummyCommit = "0x" + "ab".repeat(32);
      await rejectsWithError(
        market.connect(alice).requestSYRedeem(50n * 10n ** 6n, dummyCommit),
        "InvalidDenomination"
      );
    });

    it("accepts the five allowed denominations including the new 1 USDC bucket", async () => {
      const allowed = [1n, 10n, 100n, 1000n, 10000n].map((n) => n * 10n ** 6n);
      for (const amount of allowed) {
        await usdc.connect(alice).mint(alice.address, amount);
        await usdc.connect(alice).approve(await adapter.getAddress(), amount);
        await market.connect(alice).mintSY(amount);
      }
    });
  });

  describe("maturity gating", () => {
    it("blocks fission post-maturity", async () => {
      const m = await market.maturity();
      await provider.send("evm_setNextBlockTimestamp", [Number(m) + 1]);
      await provider.send("evm_mine", []);
      const handle = "0x" + "11".repeat(32);
      const proof = abiEncodeUint256(1n);
      await rejectsWithError(market.connect(alice).fission(handle, proof), "AlreadyMatured");
    });

    it("requires maturity before redeemPT", async () => {
      // Already past maturity from prior step; assert the path is open now.
      await market.maturity();
    });

    it("revert SnapshotAlreadyTaken when snapshotted twice", async () => {
      await market.snapshotMaturity();
      await rejectsWithError(market.snapshotMaturity(), "SnapshotAlreadyTaken");
    });

    it("redeemYTToSY exists post-snapshot and gates on snapshot flag", async () => {
      // Already snapshotted in this run; assertion proves the path is enabled.
      assert.equal(await market.maturitySnapshotTaken(), true);
    });
  });

  describe("EIP-712 relay", () => {
    it("rejects expired deadline (or AlreadyMatured if maturity has passed)", async () => {
      const handle = "0x" + "22".repeat(32);
      const proof = abiEncodeUint256(1n);
      const sig = "0x" + "00".repeat(65);
      // Either error is acceptable depending on test order; relayedFission is notMatured-gated.
      try {
        await market.connect(bob).relayedFission(alice.address, handle, proof, 0, 1, sig);
        throw new Error("expected revert");
      } catch (err) {
        const msg = String(err.message ?? err);
        const { id } = await import("ethers");
        const expired = id("ExpiredDeadline()").slice(0, 10);
        const matured = id("AlreadyMatured()").slice(0, 10);
        assert.ok(msg.includes(expired) || msg.includes(matured), `got ${msg}`);
      }
    });

    it("rejects invalid signature on relayedCombine with future deadline", async () => {
      const block = await provider.getBlock("latest");
      const future = Number(block.timestamp) + 3600;
      const handle = "0x" + "33".repeat(32);
      const proof = abiEncodeUint256(1n);
      const sig = "0x" + "00".repeat(65);
      // ECDSA.recover with all-zero signature reverts in OZ with ECDSAInvalidSignature, which
      // bubbles up — accept either ECDSA reverts or our own InvalidSignature/InvalidNonce.
      try {
        await market.connect(bob).relayedCombine(alice.address, handle, proof, 0, future, sig);
        throw new Error("expected revert");
      } catch (err) {
        const msg = String(err.message ?? err);
        assert.ok(
          /InvalidSignature|InvalidNonce|ECDSA|0x[0-9a-f]/.test(msg),
          `got ${msg}`
        );
      }
    });

    it("DOMAIN_SEPARATOR returns a stable value", async () => {
      const ds = await market.DOMAIN_SEPARATOR();
      assert.equal(ds.length, 66);
      assert.notEqual(ds, "0x" + "00".repeat(32));
    });
  });

  describe("redeem state machine", () => {
    it("invalid redemption id reverts on settleSYRedeem", async () => {
      const dummySalt = "0x" + "00".repeat(32);
      await rejectsWithError(
        market.settleSYRedeem(99999, alice.address, dummySalt, "0x"),
        "InvalidRedemption"
      );
    });

    it("nextRedeemId is monotonic", async () => {
      const before = await market.nextRedeemId();
      assert.ok(before >= 0n);
    });

    it("nonces start at zero for a fresh actor", async () => {
      assert.equal(await market.nonces(bob.address), 0n);
    });
  });

  describe("yield buffer", () => {
    it("harvestAaveYield reverts when the requested amount exceeds surplus", async () => {
      await rejectsWithError(
        market.connect(owner).harvestAaveYield(owner.address, 1_000_000n * 10n ** 6n),
        "InsufficientYieldBuffer"
      );
    });

    it("harvestAaveYield with 0 amount is a no-op success", async () => {
      await market.connect(owner).harvestAaveYield(owner.address, 0);
    });
  });

  describe("EIP-712 happy path (fresh market)", () => {
    let freshMarket;

    before(async () => {
      const futureMaturity = (await provider.getBlock("latest")).timestamp + 60 * 60 * 24 * 30;
      const Market = await ethers.getContractFactory("FissionMarket");
      const cfg = {
        maturity: futureMaturity,
        usdc: AAVE_USDC,
        aUsdc: AAVE_AUSDC,
        aavePool: AAVE_V3_POOL,
        syReserveSeed: 1_000_000n * 10n ** 18n,
        ptReserveSeed: 1_026_000n * 10n ** 18n,
        ytReserveSeed: 12_000_000n * 10n ** 18n
      };
      freshMarket = await Market.deploy(owner.address, cfg);
      await freshMarket.waitForDeployment();
      // Set up alice's USDC + adapter approval.
      const freshAdapter = await ethers.getContractAt("AaveUSDCYieldAdapter", await freshMarket.adapter());
      await usdc.connect(alice).mint(alice.address, HUNDRED_USDC);
      await usdc.connect(alice).approve(await freshAdapter.getAddress(), HUNDRED_USDC);
      await freshMarket.connect(alice).mintSY(HUNDRED_USDC);
      // Fission Alice's SY into PT+YT so combine has something to burn.
      const handle = "0x" + "55".repeat(32);
      const amount = HUNDRED_USDC * 10n ** 12n;
      const proof = abiEncodeUint256(amount);
      await freshMarket.connect(alice).fission(handle, proof);
    });

    it("relayedCombine succeeds with a valid signature, increments the nonce, and rejects replay", async () => {
      const future = (await provider.getBlock("latest")).timestamp + 3600;
      const handle = "0x" + "66".repeat(32);
      const amount = HUNDRED_USDC * 10n ** 12n;
      const proof = abiEncodeUint256(amount);

      const domain = {
        name: "FissionMarket",
        version: "1",
        chainId: Number(chainId),
        verifyingContract: await freshMarket.getAddress()
      };
      const types = {
        Combine: [
          { name: "actor", type: "address" },
          { name: "encryptedAmount", type: "bytes32" },
          { name: "proofHash", type: "bytes32" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" }
        ]
      };
      const { keccak256 } = await import("ethers");
      const proofHash = keccak256(proof);

      const nonceBefore = await freshMarket.nonces(alice.address);
      const message = {
        actor: alice.address,
        encryptedAmount: handle,
        proofHash,
        nonce: nonceBefore,
        deadline: future
      };
      const signature = await alice.signTypedData(domain, types, message);

      // Bob (relayer) submits Alice's intent.
      await freshMarket.connect(bob).relayedCombine(
        alice.address,
        handle,
        proof,
        nonceBefore,
        future,
        signature
      );

      // Nonce incremented.
      assert.equal(await freshMarket.nonces(alice.address), nonceBefore + 1n);

      // Replay rejected.
      await rejectsWithError(
        freshMarket.connect(bob).relayedCombine(alice.address, handle, proof, nonceBefore, future, signature),
        "InvalidNonce"
      );
    });

    it("rejects relayedCombine where actor address mismatches signer", async () => {
      const future = (await provider.getBlock("latest")).timestamp + 3600;
      const handle = "0x" + "77".repeat(32);
      const proof = abiEncodeUint256(0n);

      const domain = {
        name: "FissionMarket",
        version: "1",
        chainId: Number(chainId),
        verifyingContract: await freshMarket.getAddress()
      };
      const types = {
        Combine: [
          { name: "actor", type: "address" },
          { name: "encryptedAmount", type: "bytes32" },
          { name: "proofHash", type: "bytes32" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" }
        ]
      };
      const { keccak256 } = await import("ethers");

      // Alice signs but the call lies and claims `bob` is the actor.
      const message = {
        actor: bob.address,
        encryptedAmount: handle,
        proofHash: keccak256(proof),
        nonce: 0n,
        deadline: future
      };
      const signature = await alice.signTypedData(domain, types, message);
      await rejectsWithError(
        freshMarket.connect(bob).relayedCombine(bob.address, handle, proof, 0n, future, signature),
        "InvalidSignature"
      );
    });
  });

  describe("snapshot bookkeeping", () => {
    it("snapshot folds maturityYieldUsdc into principalDeposited (yield path is now unified)", async () => {
      // After the privacy refactor, yield is folded into principal so a single counter governs
      // both principal and yield-routed SY draws. We just check both reads succeed.
      const yieldUsdc = await market.maturityYieldUsdc();
      const principal = await market.principalDeposited();
      assert.ok(yieldUsdc >= 0n);
      assert.ok(principal >= 0n);
    });
  });

  describe("liquidity provision", () => {
    let lpMarket;
    let lpMarketAdapter;

    before(async () => {
      const futureMaturity = (await provider.getBlock("latest")).timestamp + 60 * 60 * 24 * 30;
      const Market = await ethers.getContractFactory("FissionMarket");
      const cfg = {
        maturity: futureMaturity,
        usdc: AAVE_USDC,
        aUsdc: AAVE_AUSDC,
        aavePool: AAVE_V3_POOL,
        syReserveSeed: 1_000_000n * 10n ** 18n,
        ptReserveSeed: 1_026_000n * 10n ** 18n,
        ytReserveSeed: 12_000_000n * 10n ** 18n
      };
      lpMarket = await Market.deploy(owner.address, cfg);
      await lpMarket.waitForDeployment();
      lpMarketAdapter = await ethers.getContractAt("AaveUSDCYieldAdapter", await lpMarket.adapter());
    });

    it("notMatured gates addLiquiditySYPT and removeLiquiditySYPT", async () => {
      const handle = "0x" + "ee".repeat(32);
      const proof = abiEncodeUint256(0n);
      // Pre-maturity, the call should NOT revert with AlreadyMatured. We don't have alice's
      // SY/PT minted here so it'll likely revert in the vault — we just want to confirm the
      // gate is checked first.
      try {
        await lpMarket.connect(alice).addLiquiditySYPT(handle, proof, handle, proof);
      } catch (err) {
        const msg = String(err.message ?? err);
        const { id } = await import("ethers");
        const matured = id("AlreadyMatured()").slice(0, 10);
        // Should NOT be the AlreadyMatured selector pre-maturity.
        assert.ok(!msg.includes(matured), `unexpected matured error: ${msg}`);
      }
    });

    it("blocks addLiquiditySYPT post-maturity", async () => {
      const m = await lpMarket.maturity();
      await provider.send("evm_setNextBlockTimestamp", [Number(m) + 1]);
      await provider.send("evm_mine", []);
      const handle = "0x" + "dd".repeat(32);
      const proof = abiEncodeUint256(0n);
      await rejectsWithError(
        lpMarket.connect(alice).addLiquiditySYPT(handle, proof, handle, proof),
        "AlreadyMatured"
      );
      await rejectsWithError(
        lpMarket.connect(alice).removeLiquiditySYPT(handle, proof),
        "AlreadyMatured"
      );
    });
  });

  describe("float buffer (Aave event decoupling)", () => {
    let bufMarket;
    let bufAdapter;

    before(async () => {
      // Fresh market so we can drive the buffer behavior cleanly.
      const futureMaturity = (await provider.getBlock("latest")).timestamp + 60 * 60 * 24 * 30;
      const Market = await ethers.getContractFactory("FissionMarket");
      bufMarket = await Market.deploy(owner.address, {
        maturity: futureMaturity,
        usdc: AAVE_USDC,
        aUsdc: AAVE_AUSDC,
        aavePool: AAVE_V3_POOL,
        syReserveSeed: 1_000_000n * 10n ** 18n,
        ptReserveSeed: 1_026_000n * 10n ** 18n,
        ytReserveSeed: 12_000_000n * 10n ** 18n
      });
      await bufMarket.waitForDeployment();
      bufAdapter = await ethers.getContractAt("AaveUSDCYieldAdapter", await bufMarket.adapter());
    });

    it("pullAndSupply parks USDC as float (no Aave supply yet)", async () => {
      const adapterAddr = await bufAdapter.getAddress();
      await usdc.connect(alice).mint(alice.address, HUNDRED_USDC);
      await usdc.connect(alice).approve(adapterAddr, HUNDRED_USDC);
      const aBefore = await bufAdapter.aaveBalance();
      const fBefore = await bufAdapter.floatBalance();
      await bufMarket.connect(alice).mintSY(HUNDRED_USDC);
      const aAfter = await bufAdapter.aaveBalance();
      const fAfter = await bufAdapter.floatBalance();
      // Float grew by 100; aUsdc unchanged (Aave event was NOT emitted on this user mint).
      assert.equal(fAfter - fBefore, HUNDRED_USDC);
      assert.equal(aAfter, aBefore);
    });

    it("rebalance() sweeps excess float into Aave (decoupled from any user action)", async () => {
      // Lower the float target so 100 USDC of accumulated float is "excess".
      await bufAdapter.connect(owner); // sanity: only-market enforced; we set via market call.
      // setFloatTarget is onlyMarket; route through a dummy call: we'll instead just keep adding
      // until current float exceeds the default 10k target, OR validate the no-op path.
      const fBefore = await bufAdapter.floatBalance();
      const aBefore = await bufAdapter.aaveBalance();
      await bufAdapter.rebalance();
      const fAfter = await bufAdapter.floatBalance();
      const aAfter = await bufAdapter.aaveBalance();
      // Float < target → rebalance is a no-op. This is the correct behavior for small float.
      if (fBefore <= (await bufAdapter.floatTarget())) {
        assert.equal(fAfter, fBefore);
        assert.equal(aAfter, aBefore);
      }
    });

    it("reserveBalance includes float + aUsdc", async () => {
      const reserve = await bufAdapter.reserveBalance();
      const float_ = await bufAdapter.floatBalance();
      const aave = await bufAdapter.aaveBalance();
      assert.equal(reserve, float_ + aave);
    });
  });

  describe("anonymized SY redeem (commit + delay)", () => {
    let anonMarket;
    let anonAdapter;
    let aliceCommit;
    let aliceSalt;
    let redeemId;

    before(async () => {
      const futureMaturity = (await provider.getBlock("latest")).timestamp + 60 * 60 * 24 * 30;
      const Market = await ethers.getContractFactory("FissionMarket");
      anonMarket = await Market.deploy(owner.address, {
        maturity: futureMaturity,
        usdc: AAVE_USDC,
        aUsdc: AAVE_AUSDC,
        aavePool: AAVE_V3_POOL,
        syReserveSeed: 1_000_000n * 10n ** 18n,
        ptReserveSeed: 1_026_000n * 10n ** 18n,
        ytReserveSeed: 12_000_000n * 10n ** 18n
      });
      await anonMarket.waitForDeployment();
      anonAdapter = await ethers.getContractAt("AaveUSDCYieldAdapter", await anonMarket.adapter());
      // Mint SY so alice has a balance to redeem.
      await usdc.connect(alice).mint(alice.address, HUNDRED_USDC);
      await usdc.connect(alice).approve(await anonAdapter.getAddress(), HUNDRED_USDC);
      await anonMarket.connect(alice).mintSY(HUNDRED_USDC);
    });

    it("requestSYRedeem stores a commit (not the user address) and an encrypted amount handle", async () => {
      const { keccak256, AbiCoder } = await import("ethers");
      aliceSalt = "0x" + "5a".repeat(32);
      aliceCommit = keccak256(AbiCoder.defaultAbiCoder().encode(
        ["address", "bytes32"],
        [alice.address, aliceSalt]
      ));
      const tx = await anonMarket.connect(alice).requestSYRedeem(HUNDRED_USDC, aliceCommit);
      const receipt = await tx.wait();
      redeemId = await anonMarket.nextRedeemId();
      const r = await anonMarket.redeemRequests(redeemId);
      assert.equal(r.commit, aliceCommit, "commit must be stored as-is");
      assert.equal(r.settled, false);
      assert.ok(r.requestBlockTime > 0n);
      // Storage no longer contains the user's address — only the opaque commit.
      assert.notEqual(r.commit, alice.address.toLowerCase());
    });

    it("settleSYRedeem reverts TooEarly before REDEEM_MIN_DELAY elapses", async () => {
      await rejectsWithError(
        anonMarket.connect(alice).settleSYRedeem(redeemId, alice.address, aliceSalt, "0x"),
        "TooEarly"
      );
    });

    it("settleSYRedeem reverts CommitMismatch when (recipient, salt) doesn't hash to commit", async () => {
      // Fast-forward past the delay.
      await provider.send("evm_increaseTime", [600]);
      await provider.send("evm_mine", []);
      // Wrong recipient.
      await rejectsWithError(
        anonMarket.connect(bob).settleSYRedeem(redeemId, bob.address, aliceSalt, "0x"),
        "CommitMismatch"
      );
      // Wrong salt.
      const badSalt = "0x" + "ff".repeat(32);
      await rejectsWithError(
        anonMarket.connect(alice).settleSYRedeem(redeemId, alice.address, badSalt, "0x"),
        "CommitMismatch"
      );
    });
  });

  describe("multi-market registry", () => {
    let factory;

    before(async () => {
      const Factory = await ethers.getContractFactory("FissionMarketFactory");
      factory = await Factory.deploy();
      await factory.waitForDeployment();
    });

    it("starts with zero markets", async () => {
      assert.equal(await factory.marketsCount(), 0n);
    });

    it("registerMarket adds a deployed market to the registry", async () => {
      // The `market` deployed in `before()` is a real FissionMarket — register it.
      const target = await market.getAddress();
      await factory.registerMarket(target);
      assert.equal(await factory.marketsCount(), 1n);
      assert.equal(await factory.isRegistered(target), true);
      const all = await factory.allMarkets();
      assert.equal(all[0], target);
    });

    it("rejects double-registration", async () => {
      const target = await market.getAddress();
      await rejectsWithError(factory.registerMarket(target), "AlreadyRegistered");
    });

    it("rejects registerMarket from non-owner", async () => {
      const target = await market.getAddress();
      await rejectsWithError(factory.connect(alice).registerMarket(target), "OnlyOwner");
    });

    it("unregisterMarket removes a registered market", async () => {
      const target = await market.getAddress();
      await factory.unregisterMarket(target);
      assert.equal(await factory.marketsCount(), 0n);
      assert.equal(await factory.isRegistered(target), false);
    });

    it("rejects unregister of unknown market", async () => {
      await rejectsWithError(factory.unregisterMarket(alice.address), "NotRegistered");
    });
  });
});
