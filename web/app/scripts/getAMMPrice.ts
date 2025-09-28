import { createPublicClient, http, formatUnits, defineChain } from "viem";
import { getContracts, UNICHAIN_SEPOLIA } from "../../../examples/contracts";
import lighthouse from "@lighthouse-web3/sdk";


// Define Unichain Sepolia
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

// Latest pool ID from deployment
const LATEST_POOL_ID =
  "0x753a8de339a2044784e515d462cd00161f933567cb21463071fd85fac2b231e0" as `0x${string}`;

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

// Function to calculate pool ID (same as in other scripts)
function calculateUsdcVethPoolId(
  usdcAddress: string,
  vethAddress: string,
  hookAddress: string
): `0x${string}` {
  const currency0 =
    usdcAddress.toLowerCase() < vethAddress.toLowerCase()
      ? usdcAddress
      : vethAddress;
  const currency1 =
    usdcAddress.toLowerCase() < vethAddress.toLowerCase()
      ? vethAddress
      : usdcAddress;

  // Create pool key hash (simplified version)
  const poolKeyHash = `0x${currency0.slice(2)}${currency1.slice(
    2
  )}000bb8000000000000000000000000${hookAddress.slice(2)}`;
  return poolKeyHash as `0x${string}`;
}

async function getAMMPrice(poolId?: `0x${string}`) {
  try {
    console.log("🔍 Fetching AMM Price from PerpsHook Contract");

    const c = getContracts(UNICHAIN_SEPOLIA);

    // Use provided poolId or latest pool ID
    let targetPoolId: `0x${string}`;
    if (poolId) {
      targetPoolId = poolId;
      console.log("🆔 Using provided Pool ID:", targetPoolId);
    } else {
      targetPoolId = LATEST_POOL_ID;
      console.log("🆔 Using latest Pool ID:", targetPoolId);
    }

    // Get mark price (mean of vAMM and spot price)
    try {
      const markPrice = (await client.readContract({
        address: c.perpsHook.address,
        abi: perpsHookAbi,
        functionName: "getMarkPrice",
        args: [targetPoolId],
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
        address: c.perpsHook.address,
        abi: perpsHookAbi,
        functionName: "getPriceBreakdown",
        args: [targetPoolId],
      })) as [bigint, bigint, bigint];

      const [vammPrice, spotPrice, meanPrice] = priceBreakdown;

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
        console.log("  Price Deviation:", Number(priceDiff) / 100, "%");
      }
    } catch (error) {
      console.log("❌ Failed to get price breakdown:", error);
    }

    // Get market state for additional context
    try {
      const marketState = (await client.readContract({
        address: c.perpsHook.address,
        abi: perpsHookAbi,
        functionName: "getMarketState",
        args: [targetPoolId],
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
      console.log(
        "  Total Long OI:",
        formatUnits(marketState.totalLongOI, 6),
        "USDC"
      );
      console.log(
        "  Total Short OI:",
        formatUnits(marketState.totalShortOI, 6),
        "USDC"
      );
      console.log(
        "  Max OI Cap:",
        formatUnits(marketState.maxOICap, 6),
        "USDC"
      );
      console.log("  Spot Price Feed:", marketState.spotPriceFeed);

      // Calculate vAMM price manually for verification
      const manualVammPrice =
        (marketState.virtualQuote * BigInt(1e18)) / marketState.virtualBase;
      console.log(
        "  Manual vAMM Price:",
        formatUnits(manualVammPrice, 18),
        "USDC per VETH"
      );
    } catch (error) {
      console.log("❌ Failed to get market state:", error);
    }
  } catch (error) {
    console.error("❌ Error fetching AMM price:", error);
    throw error;
  }
}

// Main function for CLI usage
async function main() {
  const poolIdArg = process.argv[2];
  const poolId = poolIdArg ? (poolIdArg as `0x${string}`) : LATEST_POOL_ID;

  await getAMMPrice(poolId);
}

// Export for use in other modules
export { getAMMPrice, calculateUsdcVethPoolId };

// Run if called directly
if (import.meta.main) {
  main().catch(console.error);
}
