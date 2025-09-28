// Unichain Sepolia chain id
export const UNICHAIN_SEPOLIA = 1301;

// Minimal ABIs for the contracts we need
const marginAccountABI = [
  {
    inputs: [{ name: "user", type: "address" }],
    name: "getTotalBalance",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "user", type: "address" }],
    name: "freeBalance",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "user", type: "address" }],
    name: "lockedBalance",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "amount", type: "uint256" }],
    name: "deposit",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "amount", type: "uint256" }],
    name: "withdraw",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

const mockUSDCABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const positionManagerABI = [
  {
    inputs: [
      { name: "marketId", type: "bytes32" },
      { name: "sizeBase", type: "int256" },
      { name: "entryPrice", type: "uint256" },
      { name: "margin", type: "uint256" },
    ],
    name: "openPosition",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "user", type: "address" },
      { name: "marketId", type: "bytes32" },
      { name: "sizeBase", type: "int256" },
      { name: "entryPrice", type: "uint256" },
      { name: "margin", type: "uint256" },
    ],
    name: "openPositionFor",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "exitPrice", type: "uint256" },
    ],
    name: "closePosition",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "newSizeBase", type: "int256" },
      { name: "newMargin", type: "uint256" },
    ],
    name: "updatePosition",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "tokenId", type: "uint256" }],
    name: "getPosition",
    outputs: [
      {
        components: [
          { name: "owner", type: "address" },
          { name: "margin", type: "uint96" },
          { name: "marketId", type: "bytes32" },
          { name: "sizeBase", type: "int256" },
          { name: "entryPrice", type: "uint256" },
          { name: "lastFundingIndex", type: "uint256" },
          { name: "openedAt", type: "uint64" },
          { name: "fundingPaid", type: "int256" },
        ],
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "currentPrice", type: "uint256" },
    ],
    name: "getUnrealizedPnL",
    outputs: [{ name: "", type: "int256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "user", type: "address" }],
    name: "getUserPositions",
    outputs: [{ name: "", type: "uint256[]" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    name: "addMargin",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    name: "removeMargin",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

const fundingOracleABI = [
  {
    inputs: [{ name: "poolId", type: "bytes32" }],
    name: "getMarkPrice",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const perpsHookABI = [
  {
    inputs: [{ name: "poolId", type: "bytes32" }],
    name: "getMarkPrice",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "poolId", type: "bytes32" }],
    name: "getMarketState",
    outputs: [
      {
        components: [
          { name: "virtualBase", type: "uint256" },
          { name: "virtualQuote", type: "uint256" },
          { name: "k", type: "uint256" },
          { name: "globalFundingIndex", type: "int256" },
          { name: "totalLongOI", type: "uint256" },
          { name: "totalShortOI", type: "uint256" },
          { name: "maxOICap", type: "uint256" },
          { name: "lastFundingTime", type: "uint256" },
          { name: "spotPriceFeed", type: "address" },
          { name: "isActive", type: "bool" },
        ],
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "poolId", type: "bytes32" },
      { name: "newVirtualBase", type: "uint256" },
      { name: "newVirtualQuote", type: "uint256" },
    ],
    name: "emergencyRebalanceVAMM",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

type MarginAccountAbi = typeof marginAccountABI;
type MockUSDCAbi = typeof mockUSDCABI;

interface ContractInfo<A = MarginAccountAbi> {
  address: `0x${string}`;
  abi: A;
}

interface ExternalContracts {
  [chainId: number]: {
    perpsRouter: ContractInfo;
    positionManager: ContractInfo;
    marginAccount: ContractInfo<MarginAccountAbi>;
    marketManager: ContractInfo;
    fundingOracle: ContractInfo;
    perpsHook: ContractInfo;
    mockUSDC: ContractInfo<MockUSDCAbi>;
    mockVETH: ContractInfo;
    insuranceFund: ContractInfo;
    liquidationEngine: ContractInfo;
    positionFactory: ContractInfo;
    positionNFT: ContractInfo;
    poolManager: ContractInfo;
    uniswapPositionManager: ContractInfo;
    poolSwapTest: ContractInfo;
    poolModifyLiquidityTest: ContractInfo;
  };
}

export const externalContracts: ExternalContracts = {
  [UNICHAIN_SEPOLIA]: {
    perpsRouter: {
      address: "0x683d4203587827F5658E0D09A832dCe374343553",
      abi: [],
    },
    positionManager: {
      address: "0x5c5e20e9c600443040A770ce6A83840fdD1e4E22",
      abi: positionManagerABI,
    },
    marginAccount: {
      address: "0x7A191127944E3f5cC1C5D10B3991B03A82cAE791",
      abi: marginAccountABI,
    },
    marketManager: {
      address: "0x2a98c921688eD538833509772dd5E33e43a6215b",
      abi: [],
    },
    fundingOracle: {
      address: "0x8B262Ed4d0A11326f201D6ef41539825cb89B35a",
      abi: fundingOracleABI,
    },
    perpsHook: {
      address: "0xFe66Ae40cec317ec314cD6865fe23D79281e9Ac8",
      abi: perpsHookABI,
    },
    mockUSDC: {
      address: "0x898d058e8f64D4e744b6B19f9967EdF1BAd9e111",
      abi: mockUSDCABI,
    },
    mockVETH: {
      address: "0x03AFC3714cFB3B49CC8fe1CE23De2B24751D5d97",
      abi: [],
    },
    insuranceFund: {
      address: "0x2754BA7d581c9B1135Bb595baa030fEc47a06810",
      abi: [],
    },
    liquidationEngine: {
      address: "0x4A18FDa1A6F757Bbea5513A0fe56371FFb613b29",
      abi: [],
    },
    positionFactory: {
      address: "0x3113ABFbb24e5c24764BA720130021aF34497706",
      abi: [],
    },
    positionNFT: {
      address: "0x6C2689A59C9089ee2e9c915ab08EcD52e4F489aB",
      abi: [],
    },
    poolManager: {
      address: "0x00B036B58a818B1BC34d502D3fE730Db729e62AC",
      abi: [],
    },
    uniswapPositionManager: {
      address: "0xf969aee60879c54baaed9f3ed26147db216fd664",
      abi: [],
    },
    poolSwapTest: {
      address: "0x9140a78c1a137c7ff1c151ec8231272af78a99a4",
      abi: [],
    },
    poolModifyLiquidityTest: {
      address: "0x5fa728c0a5cfd51bee4b060773f50554c0c8a7ab",
      abi: [],
    },
  },
};

export function getContracts(chainId: number = UNICHAIN_SEPOLIA) {
  const c = externalContracts[chainId];
  if (!c) throw new Error(`No contracts mapping for chain ${chainId}`);
  return c;
}
