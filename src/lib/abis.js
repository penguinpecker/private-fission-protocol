export const erc20Abi = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ type: 'bool' }]
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }]
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' }
    ],
    outputs: [{ type: 'uint256' }]
  }
];

export const fissionMarketAbi = [
  {
    type: 'function',
    name: 'mintSY',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'clearAmount', type: 'uint256' }],
    outputs: []
  },
  {
    type: 'function',
    name: 'fission',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'encryptedAmount', type: 'bytes32' },
      { name: 'proof', type: 'bytes' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'combine',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'encryptedAmount', type: 'bytes32' },
      { name: 'proof', type: 'bytes' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'redeemPT',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'encryptedAmount', type: 'bytes32' },
      { name: 'proof', type: 'bytes' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'requestSYRedeem',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'clearUsdc', type: 'uint256' }],
    outputs: [{ name: 'id', type: 'uint256' }]
  },
  {
    type: 'function',
    name: 'settleSYRedeem',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'id', type: 'uint256' },
      { name: 'decryptionProof', type: 'bytes' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'nextRedeemId',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }]
  },
  {
    type: 'function',
    name: 'principalDeposited',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }]
  },
  {
    type: 'function',
    name: 'maturitySnapshotTaken',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'bool' }]
  },
  {
    type: 'function',
    name: 'maturityYieldUsdc',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }]
  },
  {
    type: 'function',
    name: 'yieldDistributed',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }]
  },
  {
    type: 'function',
    name: 'snapshotMaturity',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: []
  },
  {
    type: 'function',
    name: 'redeemYT',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'encryptedAmount', type: 'bytes32' },
      { name: 'proof', type: 'bytes' }
    ],
    outputs: [{ name: 'id', type: 'uint256' }]
  },
  {
    type: 'function',
    name: 'settleYTRedeem',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'id', type: 'uint256' },
      { name: 'decryptionProof', type: 'bytes' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'ytRedeemRequests',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [
      { name: 'user', type: 'address' },
      { name: 'yieldHandle', type: 'bytes32' },
      { name: 'settled', type: 'bool' }
    ]
  },
  {
    type: 'function',
    name: 'nextYTRedeemId',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }]
  },
  {
    type: 'function',
    name: 'relayedRedeemYT',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'actor', type: 'address' },
      { name: 'encryptedAmount', type: 'bytes32' },
      { name: 'proof', type: 'bytes' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'signature', type: 'bytes' }
    ],
    outputs: [{ name: 'id', type: 'uint256' }]
  },
  {
    type: 'event',
    name: 'YTRedeemRequested',
    inputs: [
      { name: 'id', type: 'uint256', indexed: false },
      { name: 'user', type: 'address', indexed: false },
      { name: 'yieldHandle', type: 'bytes32', indexed: false }
    ]
  },
  {
    type: 'function',
    name: 'harvestAaveYield',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'redeemRequests',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [
      { name: 'user', type: 'address' },
      { name: 'clearUsdc', type: 'uint256' },
      { name: 'eqHandle', type: 'bytes32' },
      { name: 'settled', type: 'bool' }
    ]
  },
  {
    type: 'function',
    name: 'addAmmLiquidity',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'reserve', type: 'uint8' },
      { name: 'encryptedAmount', type: 'bytes32' },
      { name: 'proof', type: 'bytes' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'swapSYForPT',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'encryptedAmountIn', type: 'bytes32' },
      { name: 'proofIn', type: 'bytes' },
      { name: 'encryptedMinAmountOut', type: 'bytes32' },
      { name: 'proofMin', type: 'bytes' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'swapSYForYT',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'encryptedAmountIn', type: 'bytes32' },
      { name: 'proofIn', type: 'bytes' },
      { name: 'encryptedMinAmountOut', type: 'bytes32' },
      { name: 'proofMin', type: 'bytes' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'sellPTForSY',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'encryptedAmountIn', type: 'bytes32' },
      { name: 'proofIn', type: 'bytes' },
      { name: 'encryptedMinAmountOut', type: 'bytes32' },
      { name: 'proofMin', type: 'bytes' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'sellYTForSY',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'encryptedAmountIn', type: 'bytes32' },
      { name: 'proofIn', type: 'bytes' },
      { name: 'encryptedMinAmountOut', type: 'bytes32' },
      { name: 'proofMin', type: 'bytes' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'maturity',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }]
  },
  {
    type: 'function',
    name: 'nonces',
    stateMutability: 'view',
    inputs: [{ name: 'actor', type: 'address' }],
    outputs: [{ type: 'uint256' }]
  },
  {
    type: 'function',
    name: 'DOMAIN_SEPARATOR',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'bytes32' }]
  },
  {
    type: 'function',
    name: 'relayedMintSY',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'actor', type: 'address' },
      { name: 'clearAmount', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'signature', type: 'bytes' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'relayedFission',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'actor', type: 'address' },
      { name: 'encryptedAmount', type: 'bytes32' },
      { name: 'proof', type: 'bytes' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'signature', type: 'bytes' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'relayedCombine',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'actor', type: 'address' },
      { name: 'encryptedAmount', type: 'bytes32' },
      { name: 'proof', type: 'bytes' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'signature', type: 'bytes' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'relayedRedeemPT',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'actor', type: 'address' },
      { name: 'encryptedAmount', type: 'bytes32' },
      { name: 'proof', type: 'bytes' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'signature', type: 'bytes' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'relayedRequestSYRedeem',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'actor', type: 'address' },
      { name: 'clearUsdc', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'signature', type: 'bytes' }
    ],
    outputs: [{ name: 'id', type: 'uint256' }]
  },
  {
    type: 'function',
    name: 'relayedSwap',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'actor', type: 'address' },
      { name: 'route', type: 'uint8' },
      { name: 'encryptedAmountIn', type: 'bytes32' },
      { name: 'proofIn', type: 'bytes' },
      { name: 'encryptedMinAmountOut', type: 'bytes32' },
      { name: 'proofMin', type: 'bytes' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'signature', type: 'bytes' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'vault',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }]
  },
  {
    type: 'function',
    name: 'adapter',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }]
  },
  {
    type: 'event',
    name: 'RedeemRequested',
    inputs: [
      { name: 'id', type: 'uint256', indexed: false },
      { name: 'user', type: 'address', indexed: false },
      { name: 'clearUsdc', type: 'uint256', indexed: false },
      { name: 'eqHandle', type: 'bytes32', indexed: false }
    ]
  }
];

export const fissionFactoryAbi = [
  {
    type: 'function',
    name: 'allMarkets',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address[]' }]
  },
  {
    type: 'function',
    name: 'marketsCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }]
  },
  {
    type: 'function',
    name: 'isRegistered',
    stateMutability: 'view',
    inputs: [{ name: 'market', type: 'address' }],
    outputs: [{ type: 'bool' }]
  },
  {
    type: 'function',
    name: 'registerMarket',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'market', type: 'address' }],
    outputs: []
  },
  {
    type: 'function',
    name: 'unregisterMarket',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'market', type: 'address' }],
    outputs: []
  }
];

export const vaultAbi = [
  {
    type: 'function',
    name: 'confidentialBalanceOf',
    stateMutability: 'view',
    inputs: [
      { name: 'kind', type: 'uint8' },
      { name: 'account', type: 'address' }
    ],
    outputs: [{ type: 'bytes32' }]
  },
  {
    type: 'function',
    name: 'symbol',
    stateMutability: 'view',
    inputs: [{ name: 'kind', type: 'uint8' }],
    outputs: [{ type: 'string' }]
  },
  {
    type: 'function',
    name: 'name',
    stateMutability: 'view',
    inputs: [{ name: 'kind', type: 'uint8' }],
    outputs: [{ type: 'string' }]
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }]
  }
];
