import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { createPublicClient, http, defineChain } from "viem";
import { parseUnits, formatUnits, encodeAbiParameters, keccak256 } from "viem";
import { getContracts, UNICHAIN_SEPOLIA } from "@/lib/contracts-frontend";

// Types
export interface Position {
  tokenId: string;
  owner: string;
  margin: number; // in USDC
  marketId: string;
  sizeBase: number; // in VETH
  entryPrice: number; // in USDC
  openedAt: string;
  isLong: boolean;
  currentPrice: number;
  notionalValue: number;
  currentNotional: number;
  leverage: number;
  unrealizedPnL: number;
  pnlPercentage: number;
  liquidationPrice: number;
  distanceToLiquidation: number;
}

export interface AccountBalance {
  walletUSDC: number;
  freeMargin: number;
  lockedMargin: number;
  totalMargin: number;
}

export interface PositionsWithBalance {
  positions: Position[];
  accountBalance: AccountBalance;
  currentMarkPrice: number;
}

export interface CreatePositionParams {
  marketId: string;
  size: number; // Size in base asset (e.g., ETH)
  leverage: number;
  margin: number; // Margin in USDC
  isLong: boolean;
}

export interface ClosePositionParams {
  tokenId: string;
  exitPrice?: number; // Optional, will fetch current price if not provided
  percentage?: number; // Optional, percentage to close (1-100), defaults to 100
}

export interface MarginOperationParams {
  tokenId: string;
  amount: number; // Amount in USDC
}

// Query Keys
export const positionKeys = {
  all: ["positions"] as const,
  withBalance: (address: string) =>
    [...positionKeys.all, "withBalance", address] as const,
  open: () => [...positionKeys.all, "open"] as const,
  detail: (tokenId: string) =>
    [...positionKeys.all, "detail", tokenId] as const,
  markPrice: (poolId: string) =>
    [...positionKeys.all, "markPrice", poolId] as const,
};

// Pyth ETH/USD price feed ID
const PYTH_ETH_USD_FEED_ID =
  "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";

// Function to fetch real-time ETH price from Pyth
async function fetchPythPrice(): Promise<number> {
  try {
    const response = await fetch(
      `https://hermes.pyth.network/api/latest_price_feeds?ids[]=${PYTH_ETH_USD_FEED_ID}`
    );
    const data = await response.json();

    if (data && data.length > 0) {
      const priceData = data[0].price;
      const price = parseInt(priceData.price);
      const expo = priceData.expo;
      const actualPrice = price * Math.pow(10, expo);

      console.log("📡 Pyth Network Price Feed:");
      console.log("  Raw Price:", price);
      console.log("  Exponent:", expo);
      console.log("  Actual ETH Price:", actualPrice.toFixed(2), "USD");
      console.log(
        "  Confidence:",
        parseInt(data[0].price.conf) * Math.pow(10, expo)
      );
      console.log(
        "  Publish Time:",
        new Date(data[0].price.publish_time * 1000).toISOString()
      );

      return actualPrice;
    } else {
      throw new Error("No price data received from Pyth");
    }
  } catch (error) {
    console.error("❌ Failed to fetch Pyth price:", error);
    console.log("🔄 Falling back to default price of $2000");
    return 2000; // Fallback price
  }
}

// Utility functions
export function calculatePositionSize(
  margin: number,
  leverage: number,
  price: number
): number {
  const notionalValue = margin * leverage;
  return notionalValue / price;
}

// Main hook for positions with balance (most commonly used)
export function usePositionsWithBalance() {
  const { address } = useAccount();

  const query = useQuery({
    queryKey: positionKeys.withBalance(address || ""),
    queryFn: async (): Promise<PositionsWithBalance> => {
      if (!address) {
        return {
          positions: [],
          accountBalance: {
            walletUSDC: 0,
            freeMargin: 0,
            lockedMargin: 0,
            totalMargin: 0,
          },
          currentMarkPrice: 0,
        };
      }

      try {
        // Setup blockchain connection
        const RPC_URL =
          process.env.NEXT_PUBLIC_UNICHAIN_SEPOLIA_RPC_URL ||
          "https://sepolia.unichain.org";

        const chain = defineChain({
          id: UNICHAIN_SEPOLIA,
          name: "UnichainSepolia",
          nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
          rpcUrls: {
            default: { http: [RPC_URL] },
            public: { http: [RPC_URL] },
          },
        });

        const transport = http(RPC_URL);
        const publicClient = createPublicClient({ transport, chain });
        const contracts = getContracts(UNICHAIN_SEPOLIA);

        // Get user positions
        const userPositions = (await publicClient.readContract({
          address: contracts.positionManager.address,
          abi: contracts.positionManager.abi as any,
          functionName: "getUserPositions",
          args: [address as `0x${string}`],
        })) as bigint[];

        console.log(`🔍 Found ${userPositions.length} position(s)`);

        // Use hardcoded pool ID that we know works
        const poolId =
          "0xb065747fa15a0575f95f40d2073b9e402f9964fbb57bdd2eb549b540fe197ac4";

        // Get current mark price
        const markPrice = (await publicClient.readContract({
          address: contracts.fundingOracle.address,
          abi: contracts.fundingOracle.abi as any,
          functionName: "getMarkPrice",
          args: [poolId],
        })) as bigint;

        const currentMarkPrice = Number(markPrice) / 1e18;
        console.log(`📊 Current Mark Price: ${currentMarkPrice} USDC per VETH`);

        const positions: Position[] = [];

        // Process each position
        for (let i = 0; i < userPositions.length; i++) {
          const tokenId = userPositions[i];

          try {
            // Get position details
            const position = (await publicClient.readContract({
              address: contracts.positionManager.address,
              abi: contracts.positionManager.abi as any,
              functionName: "getPosition",
              args: [tokenId],
            })) as any;

            const sizeBase = Number(position.sizeBase) / 1e18;
            const entryPrice = Number(position.entryPrice) / 1e18;
            const margin = Number(position.margin) / 1e6;
            const isLong = Number(position.sizeBase) > 0;

            // Filter out empty positions (owner is 0x0000...)
            if (
              position.owner === "0x0000000000000000000000000000000000000000"
            ) {
              continue;
            }

            // Calculate metrics
            const notionalValue = Math.abs(sizeBase) * entryPrice;
            const currentNotional = Math.abs(sizeBase) * currentMarkPrice;
            const leverage = notionalValue / margin;

            // Calculate PnL
            let unrealizedPnL = 0;
            if (isLong) {
              unrealizedPnL =
                Math.abs(sizeBase) * (currentMarkPrice - entryPrice);
            } else {
              unrealizedPnL =
                Math.abs(sizeBase) * (entryPrice - currentMarkPrice);
            }
            const pnlPercentage = (unrealizedPnL / margin) * 100;

            // Calculate liquidation price
            const liquidationThreshold = margin * 0.8; // 80% maintenance margin
            let liquidationPrice = 0;
            if (isLong) {
              liquidationPrice =
                entryPrice - liquidationThreshold / Math.abs(sizeBase);
            } else {
              liquidationPrice =
                entryPrice + liquidationThreshold / Math.abs(sizeBase);
            }

            positions.push({
              tokenId: tokenId.toString(),
              owner: position.owner,
              margin,
              marketId: position.marketId,
              sizeBase: Math.abs(sizeBase),
              entryPrice,
              openedAt: new Date(
                Number(position.openedAt) * 1000
              ).toISOString(),
              isLong,
              currentPrice: currentMarkPrice,
              notionalValue,
              currentNotional,
              leverage,
              unrealizedPnL,
              pnlPercentage,
              liquidationPrice,
              distanceToLiquidation: Math.abs(
                currentMarkPrice - liquidationPrice
              ),
            });
          } catch (error) {
            console.error(`Error processing position ${tokenId}:`, error);
            // Skip invalid positions
            continue;
          }
        }

        // Get account balance info
        const usdcBalance = (await publicClient.readContract({
          address: contracts.mockUSDC.address,
          abi: contracts.mockUSDC.abi as any,
          functionName: "balanceOf",
          args: [address as `0x${string}`],
        })) as bigint;

        const freeBalance = (await publicClient.readContract({
          address: contracts.marginAccount.address,
          abi: contracts.marginAccount.abi as any,
          functionName: "freeBalance",
          args: [address as `0x${string}`],
        })) as bigint;

        const lockedBalance = (await publicClient.readContract({
          address: contracts.marginAccount.address,
          abi: contracts.marginAccount.abi as any,
          functionName: "lockedBalance",
          args: [address as `0x${string}`],
        })) as bigint;

        const accountBalance: AccountBalance = {
          walletUSDC: Number(usdcBalance) / 1e6,
          freeMargin: Number(freeBalance) / 1e6,
          lockedMargin: Number(lockedBalance) / 1e6,
          totalMargin: Number(freeBalance + lockedBalance) / 1e6,
        };

        console.log(`💰 Wallet USDC: ${accountBalance.walletUSDC} USDC`);
        console.log(`🆓 Free Margin: ${accountBalance.freeMargin} USDC`);
        console.log(`🔒 Locked Margin: ${accountBalance.lockedMargin} USDC`);
        console.log(`💯 Total Margin: ${accountBalance.totalMargin} USDC`);

        return {
          positions,
          accountBalance,
          currentMarkPrice,
        };
      } catch (error) {
        console.error("Error fetching positions with balance:", error);
        return {
          positions: [],
          accountBalance: {
            walletUSDC: 0,
            freeMargin: 0,
            lockedMargin: 0,
            totalMargin: 0,
          },
          currentMarkPrice: 0,
        };
      }
    },
    enabled: !!address,
    refetchInterval: false, // No automatic polling - only refetch on invalidation
    staleTime: 30 * 1000, // Consider data stale after 30 seconds
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
    refetchOnWindowFocus: false, // Don't refetch on window focus
    refetchOnMount: true, // Refetch when component mounts
    retry: 3, // Retry failed requests 3 times
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000), // Exponential backoff
  });

  return {
    ...query,
    refetchPositions: query.refetch, // Expose manual refetch function
  };
}

// Position management hooks
export function useOpenPosition() {
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();
  const { address } = useAccount();

  return useMutation({
    mutationFn: async (params: CreatePositionParams) => {
      console.log("📝 Position management hook called with params:", params);

      if (!address) throw new Error("Wallet not connected");

      const contracts = getContracts(UNICHAIN_SEPOLIA);
      console.log("📋 Contract addresses:", contracts);

      // Create public client for reading contract data (same as working script)
      const RPC_URL =
        process.env.NEXT_PUBLIC_UNICHAIN_SEPOLIA_RPC_URL ||
        "https://sepolia.unichain.org";
      const chain = defineChain({
        id: UNICHAIN_SEPOLIA,
        name: "UnichainSepolia",
        nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
        rpcUrls: {
          default: { http: [RPC_URL] },
          public: { http: [RPC_URL] },
        },
      });
      const transport = http(RPC_URL);
      const publicClient = createPublicClient({ transport, chain });

      // Calculate pool ID based on position type (same as working scripts)
      let poolId: string;
      if (params.isLong) {
        // For LONG positions: USDC as currency0, VETH as currency1
        poolId =
          "0xb065747fa15a0575f95f40d2073b9e402f9964fbb57bdd2eb549b540fe197ac4";
      } else {
        // For SHORT positions: VETH as currency0, USDC as currency1
        const poolKey = encodeAbiParameters(
          [
            { name: "currency0", type: "address" },
            { name: "currency1", type: "address" },
            { name: "fee", type: "uint24" },
            { name: "tickSpacing", type: "int24" },
            { name: "hooks", type: "address" },
          ],
          [
            contracts.mockVETH.address,
            contracts.mockUSDC.address,
            3000,
            60,
            contracts.perpsHook.address,
          ]
        );
        poolId = keccak256(poolKey);
      }
      console.log("🆔 Using pool ID:", poolId);
      console.log("📊 Position Type:", params.isLong ? "LONG" : "SHORT");

      // Get current mark price from oracle
      const markPrice = (await publicClient.readContract({
        address: contracts.fundingOracle.address,
        abi: contracts.fundingOracle.abi as any,
        functionName: "getMarkPrice",
        args: [poolId],
      })) as bigint;

      const priceUSDCPerVETH = Number(formatUnits(markPrice, 18));
      console.log("📊 Current Mark Price:", priceUSDCPerVETH, "USDC per VETH");

      // Calculate position size using the same method as working script
      const notionalValueUSDC = params.margin * params.leverage;
      const positionSizeVETH = notionalValueUSDC / priceUSDCPerVETH;

      // Convert to contract units (same as working script)
      // For SHORT: negative sizeBase indicates short position
      const positionSizeWei = params.isLong
        ? BigInt(Math.floor(positionSizeVETH * 1e18)) // Positive for LONG
        : -BigInt(Math.floor(positionSizeVETH * 1e18)); // Negative for SHORT
      const marginAmountWei = parseUnits(params.margin.toString(), 6); // USDC has 6 decimals

      console.log(
        "📈 Expected Position Size:",
        Math.abs(positionSizeVETH),
        "VETH",
        params.isLong ? "(LONG)" : "(SHORT)"
      );
      console.log("💵 Expected Notional Value:", notionalValueUSDC, "USDC");
      console.log(
        "🔢 Position Size Wei:",
        positionSizeWei.toString(),
        params.isLong ? "(positive = LONG)" : "(negative = SHORT)"
      );
      console.log("🔢 Margin Wei:", marginAmountWei.toString());

      // Check USDC balance before proceeding
      const usdcBalance = (await publicClient.readContract({
        address: contracts.mockUSDC.address,
        abi: contracts.mockUSDC.abi as any,
        functionName: "balanceOf",
        args: [address as `0x${string}`],
      })) as bigint;

      console.log("💳 Current USDC Balance:", Number(usdcBalance) / 1e6);

      if (usdcBalance < marginAmountWei) {
        throw new Error(
          `Insufficient USDC balance. Need ${params.margin} but have ${
            Number(usdcBalance) / 1e6
          }`
        );
      }

      // Step 1: Approve USDC for MarginAccount
      console.log("💰 Approving USDC for MarginAccount...");
      const approveTx = await writeContractAsync({
        address: contracts.mockUSDC.address,
        abi: contracts.mockUSDC.abi as any,
        functionName: "approve",
        args: [contracts.marginAccount.address, marginAmountWei],
      });
      console.log("✅ USDC approved for MarginAccount");

      // Step 2: Deposit USDC to MarginAccount
      console.log("💰 Depositing margin to MarginAccount...");
      const depositTx = await writeContractAsync({
        address: contracts.marginAccount.address,
        abi: contracts.marginAccount.abi as any,
        functionName: "deposit",
        args: [marginAmountWei],
      });
      console.log("✅ Margin deposited to MarginAccount");

      // Step 3: Open position via PositionManager
      console.log(
        "🔄 Opening",
        params.isLong ? "LONG" : "SHORT",
        "position via PositionManager..."
      );
      const marketId = poolId;
      const sizeBase = positionSizeWei; // Already has correct sign (+ for LONG, - for SHORT)
      const entryPrice = markPrice;
      const margin = marginAmountWei;

      console.log("📋 Position Manager Parameters:");
      console.log("  Market ID:", marketId);
      console.log(
        "  Size Base:",
        sizeBase.toString(),
        params.isLong ? "(positive = LONG)" : "(negative = SHORT)"
      );
      console.log("  Entry Price:", entryPrice.toString());
      console.log("  Margin:", margin.toString());
      console.log("  Position Type:", params.isLong ? "LONG" : "SHORT");

      const openPositionTx = await writeContractAsync({
        address: contracts.positionManager.address,
        abi: contracts.positionManager.abi as any,
        functionName: "openPosition",
        args: [marketId, sizeBase, entryPrice, margin],
      });

      console.log(
        "✅",
        params.isLong ? "LONG" : "SHORT",
        "position opened successfully! Transaction hash:",
        openPositionTx
      );

      // Step 4: Optional pool rebalancing with Pyth price
      try {
        console.log(
          "⚖️ Attempting pool rebalancing with Pyth price after",
          params.isLong ? "LONG" : "SHORT",
          "position..."
        );

        // Fetch real-time ETH price from Pyth
        const pythPrice = await fetchPythPrice();

        // Get current virtual reserves
        const marketStateBefore = (await publicClient.readContract({
          address: contracts.perpsHook.address,
          abi: contracts.perpsHook.abi as any,
          functionName: "getMarketState",
          args: [poolId],
        })) as any;

        console.log("📊 Virtual reserves before rebalancing:");
        console.log(
          "  Virtual Base:",
          Number(marketStateBefore.virtualBase) / 1e18,
          "VETH"
        );
        console.log(
          "  Virtual Quote:",
          Number(marketStateBefore.virtualQuote) / 1e6,
          "USDC"
        );

        // Rebalance to match real Pyth price with increased liquidity
        const targetPrice = pythPrice;
        const newVirtualQuote = 1200000000000n; // 1.2M USDC (increased liquidity)
        const newVirtualBase =
          (newVirtualQuote * 1000000000000000000n) /
          BigInt(Math.floor(targetPrice * 1e6));

        console.log(
          "🎯 Target rebalancing (",
          params.isLong ? "LONG" : "SHORT",
          "position using Pyth price):"
        );
        console.log(
          "  New Virtual Base:",
          Number(newVirtualBase) / 1e18,
          "VETH"
        );
        console.log(
          "  New Virtual Quote:",
          Number(newVirtualQuote) / 1e6,
          "USDC"
        );
        console.log(
          "  Target Price:",
          targetPrice.toFixed(2),
          "USD/VETH (from Pyth)"
        );

        const rebalanceTx = await writeContractAsync({
          address: contracts.perpsHook.address,
          abi: contracts.perpsHook.abi as any,
          functionName: "emergencyRebalanceVAMM",
          args: [poolId, newVirtualBase, newVirtualQuote],
        });

        console.log(
          "✅ Virtual reserves rebalanced successfully after",
          params.isLong ? "LONG" : "SHORT",
          "position!"
        );
        console.log("📋 Rebalance Transaction Hash:", rebalanceTx);
      } catch (rebalanceError) {
        console.error("⚠️ Rebalancing failed:", rebalanceError);
        console.log(
          "ℹ️",
          params.isLong ? "LONG" : "SHORT",
          "position was opened successfully, but rebalancing encountered an issue"
        );
      }

      return {
        txHash: openPositionTx,
        poolId,
        positionSize: Math.abs(positionSizeVETH), // Always return positive size
        notionalValue: notionalValueUSDC,
        entryPrice: priceUSDCPerVETH,
        positionType: params.isLong ? "LONG" : "SHORT",
        isLong: params.isLong,
      };
    },
    onSuccess: () => {
      // Invalidate position queries to trigger refetch
      queryClient.invalidateQueries({
        queryKey: positionKeys.withBalance(address || ""),
        exact: true,
      });
      console.log("🔄 Position data invalidated after position open");
    },
  });
}

// Convenience hook for opening short positions
export function useOpenShortPosition() {
  const openPosition = useOpenPosition();

  return {
    ...openPosition,
    mutate: (params: Omit<CreatePositionParams, "isLong">) => {
      return openPosition.mutate({
        ...params,
        isLong: false, // Always set to false for short positions
      });
    },
    mutateAsync: (params: Omit<CreatePositionParams, "isLong">) => {
      return openPosition.mutateAsync({
        ...params,
        isLong: false, // Always set to false for short positions
      });
    },
  };
}

// Convenience hook for opening long positions
export function useOpenLongPosition() {
  const openPosition = useOpenPosition();

  return {
    ...openPosition,
    mutate: (params: Omit<CreatePositionParams, "isLong">) => {
      return openPosition.mutate({
        ...params,
        isLong: true, // Always set to true for long positions
      });
    },
    mutateAsync: (params: Omit<CreatePositionParams, "isLong">) => {
      return openPosition.mutateAsync({
        ...params,
        isLong: true, // Always set to true for long positions
      });
    },
  };
}

export function useClosePosition() {
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();
  const { address } = useAccount();

  // Create public client for reading contract data
  const publicClient = createPublicClient({
    chain: {
      id: UNICHAIN_SEPOLIA,
      name: "UnichainSepolia",
      nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
      rpcUrls: {
        default: { http: ["https://sepolia.unichain.org"] },
        public: { http: ["https://sepolia.unichain.org"] },
      },
    },
    transport: http("https://sepolia.unichain.org"),
  });

  return useMutation({
    mutationFn: async (params: ClosePositionParams) => {
      if (!address) throw new Error("Wallet not connected");

      const contracts = getContracts(UNICHAIN_SEPOLIA);
      const percentage = params.percentage || 100; // Default to 100% if not provided

      // Validate percentage
      if (percentage <= 0 || percentage > 100) {
        throw new Error("Close percentage must be between 1 and 100");
      }

      console.log("🔄 Closing Position with Real-Time Pyth Pricing");
      console.log("📊 Position ID:", params.tokenId);
      console.log("📈 Percentage to close:", percentage + "%");

      // Generate pool ID (same as in script)
      const poolId = keccak256(
        encodeAbiParameters(
          [
            { name: "currency0", type: "address" },
            { name: "currency1", type: "address" },
            { name: "fee", type: "uint24" },
            { name: "tickSpacing", type: "int24" },
            { name: "hooks", type: "address" },
          ],
          [
            contracts.mockVETH.address as `0x${string}`,
            contracts.mockUSDC.address as `0x${string}`,
            3000,
            60,
            contracts.perpsHook.address as `0x${string}`,
          ]
        )
      );

      console.log("🆔 Pool ID:", poolId);

      // Fetch real-time ETH price from Pyth
      const pythPrice = await fetchPythPrice();

      // Get current position details
      console.log("📊 Fetching position details...");
      const position = (await publicClient.readContract({
        address: contracts.positionManager.address,
        abi: contracts.positionManager.abi as any,
        functionName: "getPosition",
        args: [BigInt(params.tokenId)],
      })) as any;

      if (!position || position.sizeBase === 0n) {
        throw new Error("Position not found or already closed");
      }

      const isLong = position.sizeBase > 0n;
      const positionSize = isLong ? position.sizeBase : -position.sizeBase;
      const entryPrice = Number(position.entryPrice) / 1e18;
      const margin = Number(position.margin) / 1e6;

      console.log("📋 Position Details:");
      console.log("  Type:", isLong ? "LONG" : "SHORT");
      console.log("  Size:", Number(positionSize) / 1e18, "VETH");
      console.log("  Entry Price:", entryPrice.toFixed(2), "USD");
      console.log("  Margin:", margin, "USDC");
      console.log("  Current Price:", pythPrice.toFixed(2), "USD (from Pyth)");

      // Calculate PnL
      const notionalValue = (Number(positionSize) / 1e18) * pythPrice;
      const entryNotional = (Number(positionSize) / 1e18) * entryPrice;
      const unrealizedPnL = isLong
        ? notionalValue - entryNotional
        : entryNotional - notionalValue;
      const pnlPercent = (unrealizedPnL / margin) * 100;

      console.log("💰 Current PnL:");
      console.log("  Unrealized PnL:", unrealizedPnL.toFixed(2), "USDC");
      console.log("  PnL Percentage:", pnlPercent.toFixed(2) + "%");
      console.log("  Current Notional:", notionalValue.toFixed(2), "USDC");

      // Calculate size to close
      const sizeToClose =
        percentage === 100
          ? positionSize
          : (positionSize * BigInt(Math.floor(percentage * 100))) / 10000n;

      const partialPnL =
        percentage === 100 ? unrealizedPnL : (unrealizedPnL * percentage) / 100;

      console.log("📊 Closing Details:");
      console.log("  Size to close:", Number(sizeToClose) / 1e18, "VETH");
      console.log(
        "  Expected PnL from closure:",
        partialPnL.toFixed(2),
        "USDC"
      );

      // Get current mark price from hook
      const currentMarkPrice = (await publicClient.readContract({
        address: contracts.perpsHook.address,
        abi: contracts.perpsHook.abi as any,
        functionName: "getMarkPrice",
        args: [poolId],
      })) as bigint;

      console.log(
        "📊 Current Mark Price:",
        Number(currentMarkPrice) / 1e18,
        "USD"
      );

      // Close the position
      console.log("🔄 Closing position...");

      let closeTx: `0x${string}`;
      if (percentage === 100) {
        // Close entire position
        closeTx = await writeContractAsync({
          address: contracts.positionManager.address,
          abi: contracts.positionManager.abi as any,
          functionName: "closePosition",
          args: [BigInt(params.tokenId), currentMarkPrice],
        });
      } else {
        // Partial close - reduce position size using updatePosition
        const newSize = positionSize - sizeToClose;
        const adjustedSize = isLong ? newSize : -newSize;
        const currentMargin = Number(position.margin); // Keep current margin

        closeTx = await writeContractAsync({
          address: contracts.positionManager.address,
          abi: contracts.positionManager.abi as any,
          functionName: "updatePosition",
          args: [BigInt(params.tokenId), adjustedSize, currentMargin],
        });
      }

      console.log("🎉 Position closed successfully!");
      console.log("📋 Transaction Hash:", closeTx);

      // Rebalance the pool using the hook after closing the position
      console.log(
        "⚖️ Rebalancing virtual reserves using real-time Pyth price after closure..."
      );

      try {
        // Get current virtual reserves
        const marketStateBefore = (await publicClient.readContract({
          address: contracts.perpsHook.address,
          abi: contracts.perpsHook.abi as any,
          functionName: "getMarketState",
          args: [poolId],
        })) as any;

        console.log("📊 Virtual reserves before rebalancing:");
        console.log(
          "  Virtual Base:",
          Number(marketStateBefore.virtualBase) / 1e18,
          "VETH"
        );
        console.log(
          "  Virtual Quote:",
          Number(marketStateBefore.virtualQuote) / 1e6,
          "USDC"
        );
        console.log(
          "  Current Mark Price:",
          (Number(marketStateBefore.virtualQuote) * 1e30) /
            Number(marketStateBefore.virtualBase) /
            1e18,
          "USD/VETH"
        );

        // Rebalance to match real Pyth price with optimal liquidity
        const targetPrice = pythPrice; // Use real Pyth price
        const newVirtualQuote = 1200000000000n; // 1.2M USDC (optimal liquidity)
        const newVirtualBase =
          (newVirtualQuote * 1000000000000000000n) /
          BigInt(Math.floor(targetPrice * 1e6)); // Calculate base for real price

        console.log("🎯 Target rebalancing (using Pyth price after closure):");
        console.log(
          "  New Virtual Base:",
          Number(newVirtualBase) / 1e18,
          "VETH"
        );
        console.log(
          "  New Virtual Quote:",
          Number(newVirtualQuote) / 1e6,
          "USDC"
        );
        console.log(
          "  Target Price:",
          targetPrice.toFixed(2),
          "USD/VETH (from Pyth)"
        );

        const rebalanceTx = await writeContractAsync({
          address: contracts.perpsHook.address,
          abi: contracts.perpsHook.abi as any,
          functionName: "emergencyRebalanceVAMM",
          args: [poolId, newVirtualBase, newVirtualQuote],
        });

        console.log(
          "✅ Virtual reserves rebalanced successfully after closure!"
        );
        console.log("📋 Rebalance Transaction Hash:", rebalanceTx);

        // Verify the rebalancing
        const marketStateAfter = (await publicClient.readContract({
          address: contracts.perpsHook.address,
          abi: contracts.perpsHook.abi as any,
          functionName: "getMarketState",
          args: [poolId],
        })) as any;

        console.log("📊 Virtual reserves after rebalancing:");
        console.log(
          "  Virtual Base:",
          Number(marketStateAfter.virtualBase) / 1e18,
          "VETH"
        );
        console.log(
          "  Virtual Quote:",
          Number(marketStateAfter.virtualQuote) / 1e6,
          "USDC"
        );
        console.log(
          "  New Mark Price:",
          (Number(marketStateAfter.virtualQuote) * 1e30) /
            Number(marketStateAfter.virtualBase) /
            1e18,
          "USD/VETH"
        );
      } catch (rebalanceError) {
        console.error(
          "⚠️ Rebalancing failed (position still closed successfully):",
          rebalanceError
        );
      }

      console.log("📊 Closure Summary:");
      console.log("  Position ID:", params.tokenId);
      console.log("  Type:", isLong ? "LONG" : "SHORT");
      console.log("  Percentage Closed:", percentage + "%");
      console.log("  Size Closed:", Number(sizeToClose) / 1e18, "VETH");
      console.log("  Entry Price:", entryPrice.toFixed(2), "USD");
      console.log("  Exit Price:", pythPrice.toFixed(2), "USD (Pyth)");
      console.log("  Realized PnL:", partialPnL.toFixed(2), "USDC");

      return {
        txHash: closeTx,
        percentage,
        pythPrice,
        realizedPnL: partialPnL,
        sizeClosed: Number(sizeToClose) / 1e18,
        positionType: isLong ? "LONG" : "SHORT",
      };
    },
    onSuccess: () => {
      // Invalidate position queries to trigger refetch
      queryClient.invalidateQueries({
        queryKey: positionKeys.withBalance(address || ""),
        exact: true,
      });
      console.log("🔄 Position data invalidated after position close");
    },
  });
}

// Margin operations for positions
export function useAddMargin() {
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();
  const { address } = useAccount();

  return useMutation({
    mutationFn: async (params: MarginOperationParams) => {
      if (!address) throw new Error("Wallet not connected");

      const contracts = getContracts(UNICHAIN_SEPOLIA);
      const amount = parseUnits(params.amount.toString(), 6); // USDC has 6 decimals

      console.log("💰 Adding margin to position:", {
        tokenId: params.tokenId,
        amount: params.amount,
      });

      // Call positionManager.addMargin instead of marginAccount.deposit
      const txHash = await writeContractAsync({
        address: contracts.positionManager.address,
        abi: [
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
        ],
        functionName: "addMargin",
        args: [BigInt(params.tokenId), amount],
      });

      console.log("✅ Margin added to position! Transaction hash:", txHash);
      return { txHash, amount: params.amount };
    },
    onSuccess: () => {
      // Invalidate position queries to trigger refetch
      queryClient.invalidateQueries({
        queryKey: positionKeys.withBalance(address || ""),
        exact: true,
      });
      console.log("🔄 Position data invalidated after margin add");
    },
  });
}

export function useRemoveMargin() {
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();
  const { address } = useAccount();

  return useMutation({
    mutationFn: async (params: MarginOperationParams) => {
      if (!address) throw new Error("Wallet not connected");

      const contracts = getContracts(UNICHAIN_SEPOLIA);
      const amount = parseUnits(params.amount.toString(), 6); // USDC has 6 decimals

      console.log("💰 Removing margin from position:", {
        tokenId: params.tokenId,
        amount: params.amount,
      });

      // Call positionManager.removeMargin instead of marginAccount.withdraw
      const txHash = await writeContractAsync({
        address: contracts.positionManager.address,
        abi: [
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
        ],
        functionName: "removeMargin",
        args: [BigInt(params.tokenId), amount],
      });

      console.log("✅ Margin removed from position! Transaction hash:", txHash);
      return { txHash, amount: params.amount };
    },
    onSuccess: () => {
      // Invalidate position queries to trigger refetch
      queryClient.invalidateQueries({
        queryKey: positionKeys.withBalance(address || ""),
        exact: true,
      });
      console.log("🔄 Position data invalidated after margin remove");
    },
  });
}

// Combined hook for all position operations
export function usePositionManagement() {
  const openPosition = useOpenPosition();
  const openLongPosition = useOpenLongPosition();
  const openShortPosition = useOpenShortPosition();
  const closePosition = useClosePosition();
  const addMargin = useAddMargin();
  const removeMargin = useRemoveMargin();
  const positionsData = usePositionsWithBalance();

  return {
    positions: positionsData.data?.positions || [],
    accountBalance: positionsData.data?.accountBalance,
    currentMarkPrice: positionsData.data?.currentMarkPrice,
    isLoading: positionsData.isLoading,
    error: positionsData.error,
    openPosition,
    openLongPosition,
    openShortPosition,
    closePosition,
    addMargin,
    removeMargin,
    refetch: positionsData.refetch,
  };
}
