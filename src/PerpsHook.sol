// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseHook} from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager, SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary, toBeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {SafeCast} from "@uniswap/v4-core/src/libraries/SafeCast.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {PositionLib} from "./libraries/PositionLib.sol";
import {PositionManager} from "./PositionManagerV2.sol";
import {PositionFactory} from "./PositionFactory.sol";
import {MarginAccount} from "./MarginAccount.sol";
import {FundingOracle} from "./FundingOracle.sol";

interface IOracle {
    function getPrice(address asset) external view returns (uint256);
}

contract PerpsHook is BaseHook {
    using PoolIdLibrary for PoolKey;
    using SafeERC20 for IERC20;
    using SafeCast for uint256;
    using SafeCast for int256;
    using CurrencyLibrary for Currency;

    /*//////////////////////////////////////////////////////////////
                                ERRORS
    //////////////////////////////////////////////////////////////*/

    error PriceBandExceeded();
    error OpenInterestCapExceeded();
    error InsufficientMargin();
    error InvalidOperation();
    error LiquidityOperationsDisabled();
    error UnauthorizedCaller();

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    event MarketInitialized(PoolId indexed poolId, uint256 virtualBase, uint256 virtualQuote, uint256 k);
    event VirtualReservesUpdated(PoolId indexed poolId, uint256 virtualBase, uint256 virtualQuote);
    event FundingIndexUpdated(PoolId indexed poolId, int256 fundingIndex);
    event PositionOpened(PoolId indexed poolId, address indexed trader, uint256 tokenId, int256 size, uint256 margin);
    event PositionClosed(PoolId indexed poolId, address indexed trader, uint256 tokenId, int256 pnl);

    /*//////////////////////////////////////////////////////////////
                                STRUCTS
    //////////////////////////////////////////////////////////////*/

    struct MarketState {
        uint256 virtualBase;      // Virtual base reserve (e.g., ETH in wei)
        uint256 virtualQuote;     // Virtual quote reserve (USDC in 6 decimals)
        uint256 k;                // Constant product K = virtualBase * virtualQuote
        int256 globalFundingIndex; // Global funding index for this market
        uint256 totalLongOI;      // Total long open interest (in quote terms)
        uint256 totalShortOI;     // Total short open interest (in quote terms)
        uint256 maxOICap;         // Maximum open interest cap
        uint256 lastFundingTime;  // Last time funding was updated
        address spotPriceFeed;    // External spot price oracle (if any)
        bool isActive;            // Market active status
    }

    struct TradeParams {
        uint8 operation;          // 0=open_long, 1=open_short, 2=close_long, 3=close_short, 4=add_margin, 5=remove_margin
        uint256 tokenId;          // Position NFT token ID (0 for new positions)
        uint256 size;             // Trade size in base asset terms (18 decimals)
        uint256 margin;           // Margin amount (6 decimals for USDC)
        uint256 maxSlippage;      // Maximum acceptable slippage (basis points)
        address trader;           // Trader address
    }

    /*//////////////////////////////////////////////////////////////
                            STATE VARIABLES
    //////////////////////////////////////////////////////////////*/

    PositionManager public immutable positionManager;
    PositionFactory public immutable positionFactory;
    MarginAccount public immutable marginAccount;
    FundingOracle public immutable fundingOracle;
    IERC20 public immutable USDC;
    
    // Market configurations
    mapping(PoolId => MarketState) public markets;
    
    // Risk parameters
    uint256 public constant MAX_LEVERAGE = 20e18;              // 20x leverage (18 decimals)
    uint256 public constant MIN_MARGIN = 10e6;                 // $10 minimum margin (6 decimals)
    uint256 public constant MAX_DEVIATION_BPS = 500;           // 5% max price deviation
    uint256 public constant TRADE_FEE_BPS = 30;               // 0.3% base trade fee
    uint256 public constant FUNDING_RATE_PRECISION = 1e18;     // Funding rate precision
    uint256 public constant FUNDING_INTERVAL = 1 hours;        // Funding update interval
    uint256 public constant INITIAL_ETH_PRICE = 2000e18;       // $2000 initial ETH price

    // Owner for administrative functions
    address public owner;

    /*//////////////////////////////////////////////////////////////
                               MODIFIERS
    //////////////////////////////////////////////////////////////*/

    modifier onlyOwner() {
        if (msg.sender != owner) revert UnauthorizedCaller();
        _;
    }

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor(IPoolManager _poolManager, PositionManager _positionManager, PositionFactory _positionFactory, MarginAccount _marginAccount, FundingOracle _fundingOracle, IERC20 _usdc, address _initialOwner) BaseHook(_poolManager) {
        positionManager = _positionManager;
        positionFactory = _positionFactory;
        marginAccount = _marginAccount;
        fundingOracle = _fundingOracle;
        USDC = _usdc;
        owner = _initialOwner != address(0) ? _initialOwner : msg.sender;
    }

    /*//////////////////////////////////////////////////////////////
                            HOOK PERMISSIONS
    //////////////////////////////////////////////////////////////*/

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: true,
            beforeAddLiquidity: true,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: true,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: true,  // Critical: Enable custom delta returns for vAMM pricing
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    /*//////////////////////////////////////////////////////////////
                            HOOK CALLBACKS
    //////////////////////////////////////////////////////////////*/

    function _afterInitialize(address, PoolKey calldata key, uint160, int24)
        internal
        override
        returns (bytes4)
    {
        PoolId poolId = key.toId();
        
        // Try to get actual price from Pyth oracle, fallback to default if not available
        uint256 initialPrice = _getInitialPrice(poolId);
        uint256 virtualLiquidity = 1000000e6; // 1M USDC
        uint256 maxOICap = 10000000e6; // 10M USDC
        address spotPriceFeed = address(0);
        
        // Calculate virtual reserves based on initial price and liquidity
        // For ETH/USDC: virtualQuote = 1M USDC (in 6 decimals), virtualBase = liquidity/price (in 18 decimals)
        uint256 virtualQuote = virtualLiquidity; // e.g., 1M USDC (1e12 in 6 decimals)
        uint256 virtualBase = (virtualLiquidity * 1e30) / initialPrice; // Convert USDC to 18 decimals then divide by price
        uint256 k = virtualBase * virtualQuote;
        
        markets[poolId] = MarketState({
            virtualBase: virtualBase,
            virtualQuote: virtualQuote,
            k: k,
            globalFundingIndex: 0,
            totalLongOI: 0,
            totalShortOI: 0,
            maxOICap: maxOICap,
            lastFundingTime: block.timestamp,
            spotPriceFeed: spotPriceFeed,
            isActive: true
        });

        emit MarketInitialized(poolId, virtualBase, virtualQuote, k);
        return BaseHook.afterInitialize.selector;
    }

    /// @notice Get initial price for market initialization
    /// @param poolId Pool identifier 
    /// @return price Initial price in 18 decimals
    function _getInitialPrice(PoolId poolId) internal view returns (uint256 price) {
        try fundingOracle.getSpotPrice(poolId) returns (uint256 spotPrice) {
            // Successfully got price from oracle
            if (spotPrice > 0) {
                return spotPrice;
            }
        } catch {
            // Oracle call failed, will use fallback
        }
        
        // Fallback to reasonable default price for ETH/USDC
        // This should be updated based on the specific asset pair
        return INITIAL_ETH_PRICE; // $2000 for ETH
    }

    function _beforeSwap(address /* sender */, PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        PoolId poolId = key.toId();
        MarketState storage market = markets[poolId];
        
        if (!market.isActive) revert InvalidOperation();
        
        // If no hookData, allow regular swap
        if (hookData.length == 0) {
            return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }
        
        // Decode trade parameters
        TradeParams memory trade = abi.decode(hookData, (TradeParams));
        
        // Update funding if enough time has passed
        _updateFundingIfNeeded(poolId);
        
        // Perform validations and calculations
        _validateTrade(poolId, trade, params);
        
        // For position operations, we need to implement custom vAMM pricing curve
        if (trade.operation <= 3) { // Position operations
            return _executeVAMMPricing(poolId, key, params, trade);
        }
        
        // For non-position operations (margin adjustments), allow normal processing
        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    function _afterSwap(address /* sender */, PoolKey calldata key, SwapParams calldata params, BalanceDelta /* delta */, bytes calldata hookData)
        internal
        override
        returns (bytes4, int128)
    {
        PoolId poolId = key.toId();
        
        // If no hookData, this was a regular swap - no perp logic needed
        if (hookData.length == 0) {
            return (BaseHook.afterSwap.selector, 0);
        }
        
        // Decode trade parameters
        TradeParams memory trade = abi.decode(hookData, (TradeParams));
        
        // Execute perp-specific logic based on operation type
        if (trade.operation == 0 || trade.operation == 1) { // Open long/short
            _executeOpenPosition(poolId, trade, params);
        } else if (trade.operation == 2 || trade.operation == 3) { // Close long/short
            _executeClosePosition(poolId, trade, params);
        } else if (trade.operation == 4) { // Add margin
            _executeAddMargin(trade);
        } else if (trade.operation == 5) { // Remove margin
            _executeRemoveMargin(trade);
        }
        
        return (BaseHook.afterSwap.selector, 0);
    }

    function _beforeAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        internal
        pure
        override
        returns (bytes4)
    {
        // Disable all liquidity operations
        revert LiquidityOperationsDisabled();
    }

    function _beforeRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        internal
        pure
        override
        returns (bytes4)
    {
        // Disable all liquidity operations
        revert LiquidityOperationsDisabled();
    }

    /*//////////////////////////////////////////////////////////////
                        PUBLIC VAMM BALANCING FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Emergency function to rebalance vAMM reserves
    /// @dev This is a temporary function to fix vAMM initialization issues
    /// @param poolId The pool to rebalance
    /// @param newVirtualBase New virtual base reserve (in wei)
    /// @param newVirtualQuote New virtual quote reserve (in USDC 6 decimals)
    function emergencyRebalanceVAMM(PoolId poolId, uint256 newVirtualBase, uint256 newVirtualQuote) external onlyOwner {
        MarketState storage market = markets[poolId];
        require(market.isActive, "Market not active");
        
        // Validate reasonable ranges to prevent abuse
        require(newVirtualBase >= 1e15, "Virtual base too low"); // At least 0.001 ETH
        require(newVirtualBase <= 1000e18, "Virtual base too high"); // At most 1000 ETH
        require(newVirtualQuote >= 1e9, "Virtual quote too low"); // At least 1000 USDC
        require(newVirtualQuote <= 1e15, "Virtual quote too high"); // At most 1B USDC
        
        // Calculate new K
        uint256 newK = newVirtualBase * newVirtualQuote;
        
        // Update market state
        market.virtualBase = newVirtualBase;
        market.virtualQuote = newVirtualQuote;
        market.k = newK;
        
        emit VirtualReservesUpdated(poolId, newVirtualBase, newVirtualQuote);
    }

    /// @notice Function to add virtual liquidity to balance vAMM
    /// @dev Allows owner to improve vAMM balance by adding proportional virtual reserves
    /// @param poolId The pool to add virtual liquidity to
    /// @param additionalBase Additional virtual base to add (in wei)
    /// @param additionalQuote Additional virtual quote to add (in USDC 6 decimals)
    function addVirtualLiquidity(PoolId poolId, uint256 additionalBase, uint256 additionalQuote) external onlyOwner {
        MarketState storage market = markets[poolId];
        require(market.isActive, "Market not active");
        require(additionalBase > 0 && additionalQuote > 0, "Invalid amounts");
        
        // Validate proportional addition to maintain price stability
        uint256 currentPrice = (market.virtualQuote * 1e30) / market.virtualBase;
        uint256 addedPrice = (additionalQuote * 1e30) / additionalBase;
        
        // Allow some price deviation but prevent extreme changes
        uint256 priceDeviation = currentPrice > addedPrice 
            ? ((currentPrice - addedPrice) * 10000) / currentPrice
            : ((addedPrice - currentPrice) * 10000) / currentPrice;
            
        require(priceDeviation <= 1000, "Price deviation too high"); // Max 10% deviation
        
        // Update virtual reserves
        market.virtualBase += additionalBase;
        market.virtualQuote += additionalQuote;
        market.k = market.virtualBase * market.virtualQuote;
        
        emit VirtualReservesUpdated(poolId, market.virtualBase, market.virtualQuote);
    }

    /*//////////////////////////////////////////////////////////////
                        VAMM PRICING IMPLEMENTATION
    //////////////////////////////////////////////////////////////*/

    /// @notice Execute vAMM pricing curve for perp trades
    /// @param poolId Pool identifier
    /// @param key Pool key
    /// @param params Swap parameters
    /// @param trade Trade parameters
    /// @return Selector, delta, and dynamic fee
    function _executeVAMMPricing(PoolId poolId, PoolKey calldata key, SwapParams calldata params, TradeParams memory trade)
        internal
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        // Get mark price (mean of vAMM and spot price) 
        uint256 markPrice = _getMarkPrice(poolId);
        
        // Calculate dynamic fee including funding adjustment
        bool isLong = (trade.operation == 0 || trade.operation == 2);
        int256 fundingAdjustment = _calculateFundingFeeAdjustment(poolId, isLong);
        int256 feeSum = int256(TRADE_FEE_BPS) + fundingAdjustment;
        
        // Ensure fee is within valid range for uint24
        if (feeSum < 0) feeSum = 0;
        if (feeSum > 16777215) feeSum = 16777215; // type(uint24).max
        uint24 dynamicFee = uint24(uint256(feeSum));
        
        // Execute the custom vAMM swap with proper currency settlement
        BeforeSwapDelta delta = _executeVAMMSwap(key, params, markPrice);
        
        return (BaseHook.beforeSwap.selector, delta, dynamicFee);
    }

    /// @notice Execute vAMM swap with proper currency settlement
    /// @param key Pool key
    /// @param params Swap parameters  
    /// @param markPrice Current mark price
    /// @return BeforeSwapDelta for the executed swap
    function _executeVAMMSwap(PoolKey calldata key, SwapParams calldata params, uint256 markPrice)
        internal
        returns (BeforeSwapDelta)
    {
        bool exactInput = params.amountSpecified < 0;
        bool zeroForOne = params.zeroForOne;
        
        // Determine input and output currencies
        (Currency inputCurrency, Currency outputCurrency) = zeroForOne 
            ? (key.currency0, key.currency1)
            : (key.currency1, key.currency0);
            
        if (exactInput) {
            uint256 inputAmount = uint256(-params.amountSpecified);
            uint256 outputAmount;
            
            if (zeroForOne) {
                // Selling currency0 (ETH) for currency1 (USDC)
                outputAmount = (inputAmount * markPrice) / 1e30;
            } else {
                // Buying currency0 (ETH) with currency1 (USDC)
                outputAmount = (inputAmount * 1e30) / markPrice;
            }
            
            // Execute the currency movements
            poolManager.take(inputCurrency, address(this), inputAmount);
            _settleCurrency(outputCurrency, outputAmount);
            
            // Return delta to cancel pool's swap and reflect our custom amounts
            return toBeforeSwapDelta(int128(-params.amountSpecified), int128(int256(outputAmount)));
        } else {
            uint256 outputAmount = uint256(params.amountSpecified);
            uint256 inputAmount;
            
            if (zeroForOne) {
                // User wants specific USDC, calculate ETH input
                inputAmount = (outputAmount * 1e30) / markPrice;
            } else {
                // User wants specific ETH, calculate USDC input
                inputAmount = (outputAmount * markPrice) / 1e30;
            }
            
            // Execute the currency movements
            poolManager.take(inputCurrency, address(this), inputAmount);
            _settleCurrency(outputCurrency, outputAmount);
            
            // Return delta to cancel pool's swap and reflect our custom amounts
            return toBeforeSwapDelta(-int128(int256(inputAmount)), int128(params.amountSpecified));
        }
    }

    /// @notice Settle a currency to the PoolManager
    /// @param currency Currency to settle
    /// @param amount Amount to settle
    function _settleCurrency(Currency currency, uint256 amount) internal {
        if (amount == 0) return;
        
        if (currency.isAddressZero()) {
            poolManager.settle{value: amount}();
        } else {
            poolManager.sync(currency);
            IERC20(Currency.unwrap(currency)).safeTransfer(address(poolManager), amount);
            poolManager.settle();
        }
    }

    /*//////////////////////////////////////////////////////////////
                            INTERNAL FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function _validateTrade(PoolId poolId, TradeParams memory trade, SwapParams calldata /* params */) internal view {
        MarketState storage market = markets[poolId];
        
        // Price band check
        uint256 currentMarkPrice = _getMarkPrice(poolId);
        
        if (market.spotPriceFeed != address(0)) {
            uint256 spotPrice = _getSpotPrice(market.spotPriceFeed);
            uint256 deviation = currentMarkPrice > spotPrice ? 
                ((currentMarkPrice - spotPrice) * 10000) / spotPrice :
                ((spotPrice - currentMarkPrice) * 10000) / spotPrice;
            
            if (deviation > MAX_DEVIATION_BPS) {
                revert PriceBandExceeded();
            }
        }
        
        // Open interest cap check for new positions
        if (trade.operation <= 1) { // Opening positions
            uint256 notionalSize = (trade.size * currentMarkPrice) / 1e18;  // This gives us USDC in 18 decimals
            notionalSize = notionalSize / 1e12;  // Convert to 6 decimals to match USDC
            
            if (trade.operation == 0) { // Long
                if (market.totalLongOI + notionalSize > market.maxOICap) {
                    revert OpenInterestCapExceeded();
                }
            } else { // Short
                if (market.totalShortOI + notionalSize > market.maxOICap) {
                    revert OpenInterestCapExceeded();
                }
            }
        }
        
        // Margin requirement check for position operations
        if (trade.operation <= 1 && trade.margin > 0) {
            uint256 requiredMargin = _calculateRequiredMargin(trade.size, currentMarkPrice);
            
            if (trade.margin < requiredMargin) {
                revert InsufficientMargin();
            }
        }
    }


    function _executeOpenPosition(PoolId poolId, TradeParams memory trade, SwapParams calldata /* params */) internal {
        MarketState storage market = markets[poolId];
        
        // Calculate entry price and update virtual reserves
        uint256 entryPrice = _getMarkPrice(poolId);
        bool isLong = (trade.operation == 0);
        
        // Update virtual reserves
        if (isLong) {
            uint256 quoteIn = (trade.size * entryPrice) / 1e18;
            market.virtualQuote += quoteIn;
            market.virtualBase = market.k / market.virtualQuote;
            market.totalLongOI += quoteIn / 1e12;  // Convert to 6 decimals
        } else {
            market.virtualBase += trade.size;
            market.virtualQuote = market.k / market.virtualBase;
            uint256 shortNotional = (trade.size * entryPrice) / 1e18;
            market.totalShortOI += shortNotional / 1e12;  // Convert to 6 decimals
        }
        
        // Create or update position via PositionManager
        bytes32 marketId = bytes32(PoolId.unwrap(poolId));
        
        if (trade.tokenId == 0) {
            // New position - Margin should already be deposited by the caller
            // The hook assumes margin is already in the MarginAccount
            
            // Create position using the hook-specific function
            // PositionManager will lock the margin from the user's free balance
            uint256 tokenId = positionManager.openPositionFor(
                trade.trader, // The actual user
                marketId,
                isLong ? int256(trade.size) : -int256(trade.size),
                entryPrice,
                trade.margin
            );
            
            emit PositionOpened(poolId, trade.trader, tokenId, 
                isLong ? int256(trade.size) : -int256(trade.size), trade.margin);
        } else {
            // Add to existing position - would need additional PositionManager function
            // For now, assume separate function exists
        }
        
        emit VirtualReservesUpdated(poolId, market.virtualBase, market.virtualQuote);
    }

    function _executeClosePosition(PoolId poolId, TradeParams memory trade, SwapParams calldata /* params */) internal {
        MarketState storage market = markets[poolId];
        
        // Get position details
        PositionLib.Position memory position = positionManager.getPosition(trade.tokenId);
        
        // Calculate exit price and PnL
        uint256 exitPrice = _getMarkPrice(poolId);
        bool wasLong = position.sizeBase > 0;
        uint256 positionSize = uint256(wasLong ? position.sizeBase : -position.sizeBase);
        
        // Update virtual reserves (opposite of opening)
        if (wasLong) {
            uint256 quoteOut = (positionSize * exitPrice) / 1e18;
            market.virtualQuote -= quoteOut;
            market.virtualBase = market.k / market.virtualQuote;
            market.totalLongOI -= quoteOut / 1e12;  // Convert to 6 decimals
        } else {
            market.virtualBase -= positionSize;
            market.virtualQuote = market.k / market.virtualBase;
            uint256 shortNotional = (positionSize * exitPrice) / 1e18;
            market.totalShortOI -= shortNotional / 1e12;  // Convert to 6 decimals
        }
        
        // Close position via PositionManager
        positionManager.closePosition(trade.tokenId, exitPrice);
        
        emit PositionClosed(poolId, trade.trader, trade.tokenId, 0); // PnL calculated in PositionManager
        emit VirtualReservesUpdated(poolId, market.virtualBase, market.virtualQuote);
    }

    function _executeAddMargin(TradeParams memory trade) internal {
        // Margin should already be deposited by the caller
        // Add margin to position (PositionManager will lock it from free balance)
        positionManager.addMargin(trade.tokenId, trade.margin);
    }

    function _executeRemoveMargin(TradeParams memory trade) internal {
        // Remove margin from position (PositionManager will unlock it to free balance)
        positionManager.removeMargin(trade.tokenId, trade.margin);
    }

    function _updateFundingIfNeeded(PoolId poolId) internal {
        MarketState storage market = markets[poolId];
        
        if (block.timestamp >= market.lastFundingTime + FUNDING_INTERVAL) {
            int256 fundingRate = _calculateFundingRate(poolId);
            market.globalFundingIndex += fundingRate;
            market.lastFundingTime = block.timestamp;
            
            emit FundingIndexUpdated(poolId, market.globalFundingIndex);
        }
    }

    function _calculateFundingRate(PoolId poolId) internal view returns (int256) {
        MarketState storage market = markets[poolId];
        
        // Simple funding rate: premium * time_factor
        uint256 markPrice = _getMarkPrice(poolId);
        uint256 spotPrice = market.spotPriceFeed != address(0) ? 
            _getSpotPrice(market.spotPriceFeed) : markPrice;
        
        int256 premium = int256(markPrice) - int256(spotPrice);
        int256 fundingRate = (premium * int256(FUNDING_RATE_PRECISION)) / int256(spotPrice);
        
        // Apply time factor (8 hours = 8/8760 of year for 0.01% annual rate)
        return fundingRate / 8760; // Simplified for hourly funding
    }

    function _calculateFundingFeeAdjustment(PoolId poolId, bool isLong) internal view returns (int256) {
        // If funding rate is positive (perp > spot), longs pay more, shorts pay less
        int256 fundingRate = _calculateFundingRate(poolId);
        int256 adjustment = isLong ? fundingRate / 100 : -fundingRate / 100; // Convert to basis points
        
        return adjustment;
    }

    function _calculateRequiredMargin(uint256 size, uint256 price) internal pure returns (uint256) {
        uint256 notional = (size * price) / 1e18;  // This gives USDC in 18 decimals
        notional = notional / 1e12;  // Convert to 6 decimals to match USDC
        uint256 marginRequired = notional / (MAX_LEVERAGE / 1e18);
        return marginRequired < MIN_MARGIN ? MIN_MARGIN : marginRequired;
    }

    /*//////////////////////////////////////////////////////////////
                                VIEW FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Calculate mean price between vAMM and spot price
    /// @param vammPrice Virtual AMM price
    /// @param spotPrice Spot price from external oracle
    /// @return Mean price, or vAMM price if spot price is invalid
    function _calculateMeanPrice(uint256 vammPrice, uint256 spotPrice) internal pure returns (uint256) {
        // Sanity check: ensure prices are reasonable (between $1 and $100,000)
        if (spotPrice < 1e18 || spotPrice > 100000e18) {
            return vammPrice; // Use vAMM price if spot price seems invalid
        }
        
        // Check for extreme deviation (more than 50% difference)
        uint256 maxPrice = vammPrice > spotPrice ? vammPrice : spotPrice;
        uint256 minPrice = vammPrice > spotPrice ? spotPrice : vammPrice;
        
        // If prices differ by more than 50%, use vAMM price (potential oracle manipulation)
        if ((maxPrice - minPrice) * 100 / minPrice > 50) {
            return vammPrice;
        }
        
        // Return arithmetic mean
        return (vammPrice + spotPrice) / 2;
    }

    function _getMarkPrice(PoolId poolId) internal view returns (uint256) {
        MarketState storage market = markets[poolId];
        
        // Get vAMM virtual price
        // virtualQuote is in 6 decimals (USDC), virtualBase is in 18 decimals (ETH)
        // Price should be in 18 decimals: (virtualQuote * 1e30) / virtualBase
        // We multiply by 1e30 = 1e12 (convert USDC 6->18 decimals) * 1e18 (price precision)
        
        // Debug: Check for zero values
        if (market.virtualBase == 0) {
            return INITIAL_ETH_PRICE; // Fallback if virtualBase is 0
        }
        
        uint256 vammPrice = (market.virtualQuote * 1e30) / market.virtualBase;
        
        // Try to get spot price from FundingOracle
        try fundingOracle.getSpotPrice(poolId) returns (uint256 spotPrice) {
            if (spotPrice > 0) {
                // Return mean of vAMM price and spot price with safety checks
                return _calculateMeanPrice(vammPrice, spotPrice);
            }
        } catch {
            // If oracle fails, fall back to vAMM price only
        }
        
        // Fallback to pure vAMM price
        return vammPrice;
    }

    function _getSpotPrice(address spotPriceFeed) internal view returns (uint256) {
        if (spotPriceFeed == address(0)) {
            return INITIAL_ETH_PRICE; // Default fallback price
        }
        
        try IOracle(spotPriceFeed).getPrice(address(0)) returns (uint256 price) {
            return price;
        } catch {
            return INITIAL_ETH_PRICE; // Fallback price if oracle fails
        }
    }

    function getMarkPrice(PoolId poolId) external view returns (uint256) {
        return _getMarkPrice(poolId);
    }

    /// @notice Get both vAMM price and spot price for transparency
    /// @param poolId Pool identifier
    /// @return vammPrice Current vAMM virtual price
    /// @return spotPrice Current spot price from oracle (0 if unavailable)
    /// @return meanPrice Current mean price used for trading
    function getPriceBreakdown(PoolId poolId) external view returns (uint256 vammPrice, uint256 spotPrice, uint256 meanPrice) {
        MarketState storage market = markets[poolId];
        vammPrice = (market.virtualQuote * 1e30) / market.virtualBase;
        
        try fundingOracle.getSpotPrice(poolId) returns (uint256 oraclePrice) {
            if (oraclePrice > 0) {
                spotPrice = oraclePrice;
                meanPrice = _calculateMeanPrice(vammPrice, spotPrice);
            } else {
                spotPrice = 0;
                meanPrice = vammPrice;
            }
        } catch {
            spotPrice = 0;
            meanPrice = vammPrice;
        }
    }

    function getMarketState(PoolId poolId) external view returns (MarketState memory) {
        return markets[poolId];
    }

    /*//////////////////////////////////////////////////////////////
                            ADMIN FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function pokeFunding(PoolId poolId) external {
        _updateFundingIfNeeded(poolId);
    }

    function setMarketStatus(PoolId poolId, bool isActive) external onlyOwner {
        markets[poolId].isActive = isActive;
    }

    function setOwner(address newOwner) external onlyOwner {
        owner = newOwner;
    }
}

