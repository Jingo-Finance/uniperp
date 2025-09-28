import { useState, useCallback } from "react";
import {
  createPublicClient,
  http,
  formatUnits,
  defineChain,
  encodeAbiParameters,
  keccak256,
} from "viem";

// Define Unichain Sepolia
const UNICHAIN_SEPOLIA = 1301;

const unichainSepolia = defineChain({
  id: UNICHAIN_SEPOLIA,
  name: "Unichain Sepolia",
  network: "unichain-sepolia",
  nativeCurrency: {
    decimals: 18,
    name: "Ethereum",
    symbol: "ETH",
  },
  rpcUrls: {
    default: { http: ["https://sepolia.unichain.org"] },
    public: { http: ["https://sepolia.unichain.org"] },
  },
});

const client = createPublicClient({
  chain: unichainSepolia,
  transport: http("https://sepolia.unichain.org"),
});

// Contract addresses (hardcoded for browser compatibility)
const CONTRACTS = {
  perpsHook: "0xFe66Ae40cec317ec314cD6865fe23D79281e9Ac8",
  mockUSDC: "0x898d058e8f64D4e744b6B19f9967EdF1BAd9e111",
  mockVETH: "0x03AFC3714cFB3B49CC8fe1CE23De2B24751D5d97",
};

// Function to calculate the correct pool ID
function calculatePoolId(
  currency0: string,
  currency1: string,
  fee: number,
  tickSpacing: number,
  hooks: string
): `0x${string}` {
  const encoded = encodeAbiParameters(
    [
      { type: "address", name: "currency0" },
      { type: "address", name: "currency1" },
      { type: "uint24", name: "fee" },
      { type: "int24", name: "tickSpacing" },
      { type: "address", name: "hooks" },
    ],
    [
      currency0 as `0x${string}`,
      currency1 as `0x${string}`,
      fee,
      tickSpacing,
      hooks as `0x${string}`,
    ]
  );

  return keccak256(encoded);
}

// PerpsHook ABI for price-related functions
const perpsHookAbi = [
  {
    inputs: [{ name: "poolId", type: "bytes32" }],
    name: "getMarkPrice",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "poolId", type: "bytes32" }],
    name: "getPriceBreakdown",
    outputs: [
      { name: "vammPrice", type: "uint256" },
      { name: "spotPrice", type: "uint256" },
      { name: "meanPrice", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "poolId", type: "bytes32" }],
    name: "getMarketState",
    outputs: [
      {
        name: "",
        type: "tuple",
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
      },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

// Function to get AMM price (browser-compatible)
async function getAMMPrice(): Promise<{
  poolId: string;
  markPrice: number | null;
  vammPrice: number | null;
  spotPrice: number | null;
  meanPrice: number | null;
  priceDeviation: number | null;
  virtualBase: number | null;
  virtualQuote: number | null;
  k: string | null;
  isActive: boolean | null;
  totalLongOI: number | null;
  totalShortOI: number | null;
  maxOICap: number | null;
  spotPriceFeed: string | null;
} | null> {
  try {
    console.log("🔍 Fetching AMM Price from PerpsHook Contract");

    // Calculate the correct pool ID
    const fee = 3000; // 0.3%
    const tickSpacing = 60;
    const hooks = CONTRACTS.perpsHook;

    // Ensure proper currency ordering (currency0 < currency1)
    const currency0 =
      CONTRACTS.mockUSDC < CONTRACTS.mockVETH
        ? CONTRACTS.mockUSDC
        : CONTRACTS.mockVETH;
    const currency1 =
      CONTRACTS.mockUSDC < CONTRACTS.mockVETH
        ? CONTRACTS.mockVETH
        : CONTRACTS.mockUSDC;

    const poolId = calculatePoolId(
      currency0,
      currency1,
      fee,
      tickSpacing,
      hooks
    );

    console.log("🆔 Pool ID:", poolId);

    let markPrice: bigint | null = null;
    let vammPrice: bigint | null = null;
    let spotPrice: bigint | null = null;
    let meanPrice: bigint | null = null;
    let priceDeviation: number | null = null;
    let marketState: any = null;

    // Get mark price (mean of vAMM and spot price)
    try {
      markPrice = (await client.readContract({
        address: CONTRACTS.perpsHook as `0x${string}`,
        abi: perpsHookAbi,
        functionName: "getMarkPrice",
        args: [poolId],
      })) as bigint;

      console.log(
        "💰 Mark Price (Mean):",
        formatUnits(markPrice, 18),
        "USDC per VETH"
      );
    } catch (error) {
      console.log("❌ Failed to get mark price:", error);
    }

    // Get detailed price breakdown
    try {
      const priceBreakdown = (await client.readContract({
        address: CONTRACTS.perpsHook as `0x${string}`,
        abi: perpsHookAbi,
        functionName: "getPriceBreakdown",
        args: [poolId],
      })) as [bigint, bigint, bigint];

      [vammPrice, spotPrice, meanPrice] = priceBreakdown;

      console.log("\n📊 Price Breakdown:");
      console.log("  vAMM Price:", formatUnits(vammPrice, 18), "USDC per VETH");
      console.log(
        "  Spot Price:",
        spotPrice > BigInt(0)
          ? formatUnits(spotPrice, 18)
          : "N/A (Oracle unavailable)",
        "USDC per VETH"
      );
      console.log("  Mean Price:", formatUnits(meanPrice, 18), "USDC per VETH");

      // Calculate price difference if spot price is available
      if (spotPrice > BigInt(0)) {
        const priceDiff =
          vammPrice > spotPrice
            ? ((vammPrice - spotPrice) * BigInt(10000)) / spotPrice
            : ((spotPrice - vammPrice) * BigInt(10000)) / spotPrice;
        priceDeviation = Number(priceDiff) / 100;
        console.log("  Price Deviation:", priceDeviation, "%");
      }
    } catch (error) {
      console.log("❌ Failed to get price breakdown:", error);
    }

    // Get market state for additional context
    try {
      marketState = (await client.readContract({
        address: CONTRACTS.perpsHook as `0x${string}`,
        abi: perpsHookAbi,
        functionName: "getMarketState",
        args: [poolId],
      })) as any;

      console.log("\n🏪 Market State:");
      console.log(
        "  Virtual Base Reserve:",
        formatUnits(marketState.virtualBase, 18),
        "VETH"
      );
      console.log(
        "  Virtual Quote Reserve:",
        formatUnits(marketState.virtualQuote, 6),
        "USDC"
      );
      console.log("  K Constant:", marketState.k.toString());
      console.log("  Is Active:", marketState.isActive);
    } catch (error) {
      console.log("❌ Failed to get market state:", error);
    }

    // Return structured data
    return {
      poolId: poolId,
      markPrice: markPrice ? Number(formatUnits(markPrice, 18)) : null,
      vammPrice: vammPrice ? Number(formatUnits(vammPrice, 18)) : null,
      spotPrice: spotPrice ? Number(formatUnits(spotPrice, 18)) : null,
      meanPrice: meanPrice ? Number(formatUnits(meanPrice, 18)) : null,
      priceDeviation,
      virtualBase: marketState
        ? Number(formatUnits(marketState.virtualBase, 18))
        : null,
      virtualQuote: marketState
        ? Number(formatUnits(marketState.virtualQuote, 6))
        : null,
      k: marketState ? marketState.k.toString() : null,
      isActive: marketState ? marketState.isActive : null,
      totalLongOI: marketState
        ? Number(formatUnits(marketState.totalLongOI, 6))
        : null,
      totalShortOI: marketState
        ? Number(formatUnits(marketState.totalShortOI, 6))
        : null,
      maxOICap: marketState
        ? Number(formatUnits(marketState.maxOICap, 6))
        : null,
      spotPriceFeed: marketState ? marketState.spotPriceFeed : null,
    };
  } catch (error) {
    console.error("❌ Error fetching AMM price:", error);
    return null;
  }
}

// Custom hook for AMM price data
export function useAMMPrice() {
  const [data, setData] = useState<{
    poolId: string;
    markPrice: number | null;
    vammPrice: number | null;
    spotPrice: number | null;
    meanPrice: number | null;
    priceDeviation: number | null;
    virtualBase: number | null;
    virtualQuote: number | null;
    k: string | null;
    isActive: boolean | null;
    totalLongOI: number | null;
    totalShortOI: number | null;
    maxOICap: number | null;
    spotPriceFeed: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAMMPrice = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await getAMMPrice();
      setData(result);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to fetch AMM price"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    data,
    loading,
    error,
    fetchAMMPrice,
  };
}

// Export the function for direct use
export { getAMMPrice };
