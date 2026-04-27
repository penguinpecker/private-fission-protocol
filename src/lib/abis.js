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
      { name: 'encryptedAmount', type: 'bytes32' },
      { name: 'proof', type: 'bytes' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'swapSYForYT',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'encryptedAmount', type: 'bytes32' },
      { name: 'proof', type: 'bytes' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'sellPTForSY',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'encryptedAmount', type: 'bytes32' },
      { name: 'proof', type: 'bytes' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'sellYTForSY',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'encryptedAmount', type: 'bytes32' },
      { name: 'proof', type: 'bytes' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'sy',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }]
  },
  {
    type: 'function',
    name: 'pt',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }]
  },
  {
    type: 'function',
    name: 'yt',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }]
  }
];

export const confidentialTokenAbi = [
  {
    type: 'function',
    name: 'confidentialBalanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'bytes32' }]
  },
  {
    type: 'function',
    name: 'symbol',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }]
  }
];
