import {
  createPublicClient,
  http,
  formatUnits,
  defineChain,
  encodeAbiParameters,
  keccak256,
} from "viem";
import { getContracts, UNICHAIN_SEPOLIA } from "../../../examples/contracts";
import lighthouse from "@lighthouse-web3/sdk";
import dayjs from "dayjs";
import cron from "node-cron";

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

    // Use provided poolId or calculate the correct pool ID
    let targetPoolId: `0x${string}`;
    if (poolId) {
      targetPoolId = poolId;
      console.log("🆔 Using provided Pool ID:", targetPoolId);
    } else {
      // Calculate the correct pool ID using the same method as working examples
      const fee = 3000; // 0.3%
      const tickSpacing = 60;
      const hooks = c.perpsHook.address;

      // Ensure proper currency ordering (currency0 < currency1)
      const currency0 =
        c.mockUSDC.address < c.mockVETH.address
          ? c.mockUSDC.address
          : c.mockVETH.address;
      const currency1 =
        c.mockUSDC.address < c.mockVETH.address
          ? c.mockVETH.address
          : c.mockUSDC.address;

      targetPoolId = calculatePoolId(
        currency0,
        currency1,
        fee,
        tickSpacing,
        hooks
      );
      console.log("🆔 Calculated Pool ID:", targetPoolId);
      console.log("💱 Pool Configuration:");
      console.log("  Currency0 (lower):", currency0);
      console.log("  Currency1 (higher):", currency1);
      console.log("  Fee:", fee, "bps");
      console.log("  Tick Spacing:", tickSpacing);
      console.log("  Hook:", hooks);
    }

    let markPrice: bigint | null = null;
    let vammPrice: bigint | null = null;
    let spotPrice: bigint | null = null;
    let meanPrice: bigint | null = null;
    let priceDeviation: number | null = null;
    let marketState: any = null;

    // Get mark price (mean of vAMM and spot price)
    try {
      markPrice = (await client.readContract({
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

      // Calculate vAMM price manually for verification (with safety check)
      if (marketState.virtualBase > BigInt(0)) {
        const manualVammPrice =
          (marketState.virtualQuote * BigInt(1e18)) / marketState.virtualBase;
        console.log(
          "  Manual vAMM Price:",
          formatUnits(manualVammPrice, 18),
          "USDC per VETH"
        );
      } else {
        console.log("  Manual vAMM Price: N/A (virtual base is zero)");
      }
    } catch (error) {
      console.log("❌ Failed to get market state:", error);
    }

    // Return structured data for cron job
    return {
      poolId: targetPoolId,
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
    throw error;
  }
}

// Main function for CLI usage
async function main() {
  const poolIdArg = process.argv[2];
  const poolId = poolIdArg ? (poolIdArg as `0x${string}`) : undefined;

  await getAMMPrice(poolId);
}

// Function to upload price data to Lighthouse with zkTLS proofs
async function uploadPriceToLighthouse(
  priceData: any,
  publicKey: string,
  privateKey: string
) {
  try {
    console.log("📤 Uploading price data to Lighthouse with zkTLS proofs...");

    // Get signed message for encryption
    const signAuthMessage = async (privateKey: string) => {
      const { ethers } = await import("ethers");
      const signer = new ethers.Wallet(privateKey);
      const axios = (await import("axios")).default;

      const messageRequested = await axios.get(
        `https://encryption.lighthouse.storage/api/message/${signer.address}`
      );
      const signedMessage = await signer.signMessage(
        messageRequested.data[0].message
      );
      return signedMessage;
    };

    const signedMessage = await signAuthMessage(privateKey);

    // Upload with encryption
    const response = await lighthouse.textUploadEncrypted(
      JSON.stringify(priceData),
      "951995da.e472de36d41f40a5b9b0f00237424797", // API key
      publicKey,
      signedMessage,
      "uniperp-vamm-price" // name
    );

    console.log("✅ Encrypted upload successful:", response);

    // Extract CID from encrypted upload response
    const cid = response.data?.[0]?.Hash || response.data?.[0]?.hash;
    if (cid) {
      console.log("📁 Encrypted CID:", cid);
      console.log(
        "🔗 IPFS URL: https://gateway.lighthouse.storage/ipfs/" + cid
      );
      return cid;
    }
  } catch (error) {
    console.error("❌ Failed to upload to Lighthouse:", error);
    return null;
  }
}

// Function to apply zkTLS access control
async function applyZkTLSProofs(
  cid: string,
  publicKey: string,
  privateKey: string
) {
  try {
    console.log("🔐 Applying zkTLS access control...");

    const signAuthMessage = async (privateKey: string) => {
      const { ethers } = await import("ethers");
      const signer = new ethers.Wallet(privateKey);
      const axios = (await import("axios")).default;

      const messageRequested = await axios.get(
        `https://encryption.lighthouse.storage/api/message/${signer.address}`
      );
      const signedMessage = await signer.signMessage(
        messageRequested.data[0].message
      );
      return signedMessage;
    };

    const nodeId = [1, 2, 3, 4, 5];
    const nodeUrl = nodeId.map(
      (elem) =>
        `https://encryption.lighthouse.storage/api/setZkConditions/${elem}`
    );

    const signedMessage = await signAuthMessage(privateKey);
    const axios = (await import("axios")).default;

    const config = {
      method: "post",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${signedMessage}`,
      },
    };

    const apidata = {
      address: publicKey,
      cid: cid,
      conditions: [
        {
          id: 1,
          method: "City",
          returnValueTest: {
            comparator: "==",
            value: "New York",
          },
        },
      ],
    };

    for (const url of nodeUrl) {
      try {
        const response = await axios({ url, data: apidata, ...config });
        console.log(
          `✅ Node ${url.split("/").pop()} success:`,
          response.status
        );
      } catch (error: any) {
        console.log(
          `❌ Node ${url.split("/").pop()} error:`,
          error.response?.status,
          error.response?.data || error.message
        );
      }
    }

    console.log("✅ zkTLS access control applied!");
  } catch (error) {
    console.error("❌ Failed to apply zkTLS proofs:", error);
  }
}

// Function to fetch and upload price data
async function fetchAndUploadPrice() {
  try {
    console.log("🔄 Starting price fetch and upload cycle...");

    // Get wallet credentials from environment
    const PRIVATE_KEY =
      process.env.PRIVATE_KEY_WALLET1 ||
      "cf43b326c9b11208da2d1f0d36b97a54af487e07ff56f22536bfa29a1ba35644";

    const { ethers } = await import("ethers");
    const signer = new ethers.Wallet(PRIVATE_KEY);
    const WALLET_ADDRESS = signer.address;

    console.log("🔑 Using wallet address:", WALLET_ADDRESS);

    // Fetch current vAMM price
    const priceData = await getAMMPrice();

    if (priceData) {
      // Create structured price data for upload
      const structuredPriceData = {
        vammPrice: priceData.vammPrice,
        spotPrice: priceData.spotPrice,
        meanPrice: priceData.meanPrice,
        virtualBase: priceData.virtualBase,
        virtualQuote: priceData.virtualQuote,
        timestamp: dayjs().unix(),
        poolId: priceData.poolId,
        priceDeviation: priceData.priceDeviation,
        isActive: priceData.isActive,
        totalLongOI: priceData.totalLongOI,
        totalShortOI: priceData.totalShortOI,
        maxOICap: priceData.maxOICap,
      };

      // Upload to Lighthouse
      const cid = await uploadPriceToLighthouse(
        structuredPriceData,
        WALLET_ADDRESS,
        PRIVATE_KEY
      );

      if (cid) {
        // Apply zkTLS proofs
        await applyZkTLSProofs(cid, WALLET_ADDRESS, PRIVATE_KEY);
        console.log("✅ Price data uploaded and secured with zkTLS proofs!");
      }
    }
  } catch (error) {
    console.error("❌ Error in price fetch and upload cycle:", error);
  }
}

// Simple function to send just vAMM price to Lighthouse
async function sendVAMMPriceOnly() {
  try {
    console.log("🚀 Sending vAMM price to Lighthouse...");

    // Get wallet credentials
    const PRIVATE_KEY =
      process.env.PRIVATE_KEY_WALLET1 ||
      "cf43b326c9b11208da2d1f0d36b97a54af487e07ff56f22536bfa29a1ba35644";

    const { ethers } = await import("ethers");
    const signer = new ethers.Wallet(PRIVATE_KEY);
    const WALLET_ADDRESS = signer.address;

    console.log("🔑 Using wallet address:", WALLET_ADDRESS);

    // Fetch current vAMM price
    const priceData = await getAMMPrice();

    if (priceData && priceData.vammPrice) {
      console.log("💰 vAMM Price:", priceData.vammPrice, "USDC per VETH");

      // Create simple price data with just vAMM price
      const simplePriceData = {
        vammPrice: priceData.vammPrice,
        timestamp: dayjs().unix(),
        source: "uniperp-vamm",
        version: "1.0.0",
        currency: "VETH/USDC",
        network: "Unichain Sepolia",
      };

      console.log("📊 Price data:", simplePriceData);

      // Upload to Lighthouse
      const cid = await uploadPriceToLighthouse(
        simplePriceData,
        WALLET_ADDRESS,
        PRIVATE_KEY
      );

      if (cid) {
        console.log("✅ vAMM price successfully uploaded to Lighthouse!");
        console.log(
          "🔗 Access URL: https://gateway.lighthouse.storage/ipfs/" + cid
        );
        return cid;
      } else {
        console.log("❌ Failed to upload vAMM price to Lighthouse");
        return null;
      }
    } else {
      console.log("❌ Failed to fetch vAMM price");
      return null;
    }
  } catch (error) {
    console.error("❌ Error sending vAMM price:", error);
    return null;
  }
}

// Function to start the cron job
function startPriceCron() {
  console.log("⏰ Starting vAMM price cron job (every minute)...");

  // Schedule the job to run every minute
  cron.schedule("* * * * *", () => {
    console.log(
      `\n🕐 Running price fetch at ${dayjs().format("YYYY-MM-DD HH:mm:ss")}`
    );
    fetchAndUploadPrice();
  });

  console.log("✅ Cron job started successfully!");
  console.log("📊 Price data will be fetched and uploaded every minute");
  console.log("🛑 Press Ctrl+C to stop the cron job");
}

// Export for use in other modules
export {
  getAMMPrice,
  calculateUsdcVethPoolId,
  fetchAndUploadPrice,
  startPriceCron,
  sendVAMMPriceOnly,
};

// Run if called directly
if (import.meta.main) {
  const args = process.argv.slice(2);

  if (args.includes("--cron")) {
    // Start cron job
    startPriceCron();

    // Keep the process alive
    process.on("SIGINT", () => {
      console.log("\n🛑 Stopping cron job...");
      process.exit(0);
    });
  } else if (args.includes("--send-vamm")) {
    // Send just vAMM price to Lighthouse
    sendVAMMPriceOnly().catch(console.error);
  } else {
    // Run once
    main().catch(console.error);
  }
}
