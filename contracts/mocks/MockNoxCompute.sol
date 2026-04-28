// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {INoxCompute} from "@iexec-nox/nox-protocol-contracts/contracts/interfaces/INoxCompute.sol";
import {TEEType} from "@iexec-nox/nox-protocol-contracts/contracts/shared/TypeUtils.sol";

/**
 * Test-only mock of the iExec Nox compute precompile. Stores cleartext values keyed by handle
 * and runs plaintext arithmetic. Permissive ACL — every account is "allowed" everything.
 *
 * NOT a faithful re-implementation of FHE semantics. Used purely to drive contract-level tests
 * for access control, maturity gating, denomination checks, EIP-712 signature verification, and
 * state transitions. Encrypted-math correctness is verified end-to-end on the live testnet.
 */
contract MockNoxCompute is INoxCompute {
    mapping(bytes32 => uint256) public values;
    mapping(bytes32 => bool) public exists;
    mapping(bytes32 => bool) public publicHandles;
    uint256 private _nonce;

    function _store(uint256 v) internal returns (bytes32 h) {
        unchecked { _nonce++; }
        h = keccak256(abi.encode("nox-mock", _nonce, v));
        values[h] = v;
        exists[h] = true;
    }

    function _read(bytes32 h) internal view returns (uint256) {
        return values[h];
    }

    // ---------- ACL ----------
    function allow(bytes32, address) external pure {}
    function allowTransient(bytes32, address) external pure {}
    function disallowTransient(bytes32, address) external pure {}
    function isAllowed(bytes32, address) external pure returns (bool) { return true; }
    function validateAllowedForAll(address, bytes32[] calldata) external pure {}
    function addViewer(bytes32, address) external pure {}
    function isViewer(bytes32, address) external pure returns (bool) { return true; }
    function allowPublicDecryption(bytes32 h) external { publicHandles[h] = true; }
    function isPubliclyDecryptable(bytes32 h) external view returns (bool) { return publicHandles[h]; }

    // ---------- Wrap / proofs ----------
    function wrapAsPublicHandle(bytes32 value, TEEType) external returns (bytes32 h) {
        h = _store(uint256(value));
        publicHandles[h] = true;
        return h;
    }

    function validateInputProof(bytes32 handle, address, bytes calldata proof, TEEType) external {
        // Tests pass the cleartext value via `proof` (abi-encoded uint256) so the contract can
        // compute on it. If `exists[handle]` is already set we keep the prior value.
        if (!exists[handle]) {
            uint256 v = abi.decode(proof, (uint256));
            values[handle] = v;
            exists[handle] = true;
        }
    }

    function validateDecryptionProof(bytes32 handle, bytes calldata) external view returns (bytes memory) {
        return abi.encode(values[handle]);
    }

    // ---------- Arithmetic ----------
    function add(bytes32 a, bytes32 b) external returns (bytes32) {
        return _store(_read(a) + _read(b));
    }
    function sub(bytes32 a, bytes32 b) external returns (bytes32) {
        uint256 av = _read(a); uint256 bv = _read(b);
        return _store(av >= bv ? av - bv : 0);
    }
    function mul(bytes32 a, bytes32 b) external returns (bytes32) {
        return _store(_read(a) * _read(b));
    }
    function div(bytes32 a, bytes32 b) external returns (bytes32) {
        uint256 bv = _read(b);
        return _store(bv == 0 ? type(uint256).max : _read(a) / bv);
    }
    function safeAdd(bytes32 a, bytes32 b) external returns (bytes32 success, bytes32 result) {
        unchecked {
            uint256 sum = _read(a) + _read(b);
            bool ok = sum >= _read(a);
            success = _store(ok ? 1 : 0);
            result = _store(ok ? sum : 0);
        }
    }
    function safeSub(bytes32 a, bytes32 b) external returns (bytes32 success, bytes32 result) {
        uint256 av = _read(a); uint256 bv = _read(b);
        bool ok = av >= bv;
        success = _store(ok ? 1 : 0);
        result = _store(ok ? av - bv : 0);
    }
    function safeMul(bytes32 a, bytes32 b) external returns (bytes32 success, bytes32 result) {
        unchecked {
            uint256 av = _read(a); uint256 bv = _read(b);
            uint256 prod = av * bv;
            bool ok = (av == 0 || prod / av == bv);
            success = _store(ok ? 1 : 0);
            result = _store(ok ? prod : 0);
        }
    }
    function safeDiv(bytes32 a, bytes32 b) external returns (bytes32 success, bytes32 result) {
        uint256 bv = _read(b);
        bool ok = bv != 0;
        success = _store(ok ? 1 : 0);
        result = _store(ok ? _read(a) / bv : 0);
    }
    function select(bytes32 c, bytes32 t, bytes32 f) external returns (bytes32) {
        return _store(_read(c) != 0 ? _read(t) : _read(f));
    }
    function eq(bytes32 a, bytes32 b) external returns (bytes32) {
        return _store(_read(a) == _read(b) ? 1 : 0);
    }
    function ne(bytes32 a, bytes32 b) external returns (bytes32) {
        return _store(_read(a) != _read(b) ? 1 : 0);
    }
    function lt(bytes32 a, bytes32 b) external returns (bytes32) {
        return _store(_read(a) < _read(b) ? 1 : 0);
    }
    function le(bytes32 a, bytes32 b) external returns (bytes32) {
        return _store(_read(a) <= _read(b) ? 1 : 0);
    }
    function gt(bytes32 a, bytes32 b) external returns (bytes32) {
        return _store(_read(a) > _read(b) ? 1 : 0);
    }
    function ge(bytes32 a, bytes32 b) external returns (bytes32) {
        return _store(_read(a) >= _read(b) ? 1 : 0);
    }
    function transfer(bytes32 from_, bytes32 to_, bytes32 amount)
        external returns (bytes32 success, bytes32 newFrom, bytes32 newTo)
    {
        uint256 fv = _read(from_); uint256 tv = _read(to_); uint256 av = _read(amount);
        bool ok = fv >= av;
        success = _store(ok ? 1 : 0);
        newFrom = _store(ok ? fv - av : fv);
        newTo = _store(ok ? tv + av : tv);
    }
    function mint(bytes32 to_, bytes32 amount, bytes32 totalSupply)
        external returns (bytes32 success, bytes32 newTo, bytes32 newTotal)
    {
        unchecked {
            uint256 tv = _read(to_); uint256 av = _read(amount); uint256 sv = _read(totalSupply);
            uint256 newTotalV = sv + av;
            bool ok = newTotalV >= sv;
            success = _store(ok ? 1 : 0);
            newTo = _store(ok ? tv + av : tv);
            newTotal = _store(ok ? newTotalV : sv);
        }
    }
    function burn(bytes32 from_, bytes32 amount, bytes32 totalSupply)
        external returns (bytes32 success, bytes32 newFrom, bytes32 newTotal)
    {
        uint256 fv = _read(from_); uint256 av = _read(amount); uint256 sv = _read(totalSupply);
        bool ok = fv >= av;
        success = _store(ok ? 1 : 0);
        newFrom = _store(ok ? fv - av : fv);
        newTotal = _store(ok ? sv - av : sv);
    }

    // Admin no-ops
    function setKmsPublicKey(bytes calldata) external pure {}
    function setGateway(address) external pure {}
    function setProofExpirationDuration(uint256) external pure {}
    function kmsPublicKey() external pure returns (bytes memory) { return ""; }
    function gateway() external pure returns (address) { return address(0); }
    function proofExpirationDuration() external pure returns (uint256) { return 0; }
}
