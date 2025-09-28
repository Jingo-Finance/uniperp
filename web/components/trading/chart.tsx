"use client";
import React, { useState, useRef, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronUp, RefreshCw } from "lucide-react";
import MarketSelectionDropdown from "./market-selection-modal";
import dynamic from "next/dynamic";
import { CandlestickSeries, createChart } from "lightweight-charts";
import { useMarket } from "@/context/market-context";
import { MarketList } from "@/data/market-list";
import { useSpotData } from "@/hooks/api/use-market-data";
import TimeframeSelector from "./timeframe-selector";
import Image from "next/image";
import { sendVAMMPriceToLighthouse } from "@/hooks/api/lighthouse-browser";
import { useAMMPrice } from "@/hooks/api/use-amm-price";

let tvScriptLoadingPromise: Promise<void> | undefined;

declare global {
  interface Window {
    TradingView: {
      widget: (options: any) => void;
    };
  }
}

export default function TradingChart() {
  const chartRef = useRef<HTMLDivElement>(null);
  const marketButtonRef = useRef<HTMLButtonElement>(null);
  const chartInstanceRef = useRef<any>(null);
  const seriesRef = useRef<any>(null);
  const onLoadScriptRef = useRef<any>();

  const { selectedMarket, setSelectedMarket } = useMarket();
  const availableMarkets = MarketList;
  const [isMarketModalOpen, setIsMarketModalOpen] = useState(false);
  const [chartType, setChartType] = useState<"spot" | "perp">("perp");
  const [lighthouseCid, setLighthouseCid] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Use the AMM price hook
  const {
    data: ammData,
    loading: ammLoading,
    error: ammError,
    fetchAMMPrice,
  } = useAMMPrice();

  // Debug: Log chart type changes
  useEffect(() => {
    console.log("Chart type changed to:", chartType);
  }, [chartType]);
  const [tradingViewLoading, setTradingViewLoading] = useState(false);

  // Use spot data hook - gets market from context
  const { prices, candlestickData, loading, error } = useSpotData();

  // Function to upload AMM data to Lighthouse
  const uploadAMMDataToLighthouse = useCallback(async () => {
    if (!ammData || !ammData.vammPrice) return;

    try {
      setIsUploading(true);
      console.log("🔄 Uploading AMM data to Lighthouse...");

      // Upload to Lighthouse
      const cid = await sendVAMMPriceToLighthouse(ammData.vammPrice);

      if (cid) {
        setLighthouseCid(cid);
        console.log("✅ Data uploaded to Lighthouse, CID:", cid);
      }
    } catch (error) {
      console.error("❌ Error uploading AMM data:", error);
    } finally {
      setIsUploading(false);
    }
  }, [ammData]);

  // Fetch AMM data when switching to perp chart
  useEffect(() => {
    if (chartType === "perp") {
      fetchAMMPrice();
    }
  }, [chartType, fetchAMMPrice]);

  // Upload to Lighthouse when AMM data is available
  useEffect(() => {
    if (ammData && ammData.vammPrice && !lighthouseCid) {
      uploadAMMDataToLighthouse();
    }
  }, [ammData, lighthouseCid, uploadAMMDataToLighthouse]);

  // Initialize perp chart
  useEffect(() => {
    if (chartType !== "perp" || !chartRef.current || chartInstanceRef.current)
      return;

    const chart = createChart(chartRef.current, {
      autoSize: true,
      layout: {
        background: { color: "oklch(0.2029 0.0037 345.62)" },
        textColor: "#ffffff",
      },
      grid: {
        vertLines: { color: "#444" },
        horzLines: { color: "#444" },
      },
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#26a69a",
      downColor: "#ef5350",
      borderVisible: false,
      wickUpColor: "#26a69a",
      wickDownColor: "#ef5350",
    });

    // Set initial data - will be updated with AMM data
    const initialData = [
      {
        time: (Math.floor(Date.now() / 1000) - 3600) as any,
        open: 4000,
        high: 4020,
        low: 3980,
        close: 4010,
      },
      {
        time: (Math.floor(Date.now() / 1000) - 1800) as any,
        open: 4010,
        high: 4025,
        low: 3995,
        close: 4015,
      },
      {
        time: Math.floor(Date.now() / 1000) as any,
        open: 4015,
        high: 4030,
        low: 4000,
        close: 4010,
      },
    ];
    candlestickSeries.setData(initialData);

    chartInstanceRef.current = chart;
    seriesRef.current = candlestickSeries;

    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.remove();
        chartInstanceRef.current = null;
        seriesRef.current = null;
      }
    };
  }, [chartType]);

  // Initialize TradingView widget
  useEffect(() => {
    if (chartType !== "spot") {
      setTradingViewLoading(false);
      return;
    }

    setTradingViewLoading(true);

    // Clear any existing widget
    const tradingViewContainer = document.getElementById("tradingview");
    if (tradingViewContainer) {
      tradingViewContainer.innerHTML = "";
    }

    onLoadScriptRef.current = createWidget;

    if (!tvScriptLoadingPromise) {
      tvScriptLoadingPromise = new Promise((resolve) => {
        const script = document.createElement("script");
        script.id = "tradingview-widget-loading-script";
        script.src = "https://s3.tradingview.com/tv.js";
        script.type = "text/javascript";
        script.onload = () => {
          console.log("TradingView script loaded");
          resolve();
        };
        script.onerror = () => {
          console.error("Failed to load TradingView script");
          resolve();
        };

        document.head.appendChild(script);
      });
    }

    tvScriptLoadingPromise.then(() => {
      console.log("TradingView script ready, creating widget...");
      onLoadScriptRef.current && onLoadScriptRef.current();
    });

    return () => {
      onLoadScriptRef.current = null;
    };

    function createWidget() {
      const container = document.getElementById("tradingview");
      console.log("Creating TradingView widget, container:", container);

      if (container && "TradingView" in window) {
        try {
          const containerRect = container.getBoundingClientRect();

          new (window as any).TradingView.widget({
            autosize: true,
            symbol: "BINANCE:ETHUSDC",
            interval: "1D",
            timezone: "Etc/UTC",
            theme: "dark",
            style: "1",
            locale: "en",
            toolbar_bg: "#1a1a1a",
            enable_publishing: false,
            allow_symbol_change: false,
            hide_side_toolbar: true,
            hide_top_toolbar: true,
            hide_legend: true,
            hide_volume: false,
            hide_date_ranges: true,
            hide_interval_tabs: true,
            hide_toolbar: true,
            hide_status_bar: true,
            container_id: "tradingview",
            width: containerRect?.width || "100%",
            height: containerRect?.height || "100%",
            overrides: {
              "paneProperties.background": "#9598A1",
              "paneProperties.backgroundType": "solid",
              "mainSeriesProperties.candleStyle.upColor": "#26a69a",
              "mainSeriesProperties.candleStyle.downColor": "#ef5350",
              "mainSeriesProperties.candleStyle.borderUpColor": "#26a69a",
              "mainSeriesProperties.candleStyle.borderDownColor": "#ef5350",
              "mainSeriesProperties.candleStyle.wickUpColor": "#26a69a",
              "mainSeriesProperties.candleStyle.wickDownColor": "#ef5350",
            },
            studies_overrides: {},
          });
          setTradingViewLoading(false);

          // Add resize observer to ensure widget stays contained
          const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
              const iframe = container.querySelector("iframe");
              if (iframe) {
                iframe.style.maxWidth = "100%";
                iframe.style.maxHeight = "100%";
                iframe.style.width = "100%";
                iframe.style.height = "100%";
                iframe.style.overflow = "hidden";
              }
            }
          });

          resizeObserver.observe(container);
        } catch (error) {
          console.error("Error creating TradingView widget:", error);
          setTradingViewLoading(false);
        }
      } else {
        console.error(
          "TradingView container not found or TradingView not available"
        );
        setTradingViewLoading(false);
      }
    }
  }, [chartType]);

  useEffect(() => {
    if (chartType !== "perp") return;

    // Use AMM data if available
    if (ammData && ammData.vammPrice && seriesRef.current) {
      const chartData = [
        {
          time: (Math.floor(Date.now() / 1000) - 3600) as any,
          open: ammData.vammPrice * 0.995,
          high: ammData.vammPrice * 1.005,
          low: ammData.vammPrice * 0.99,
          close: ammData.vammPrice * 0.998,
        },
        {
          time: (Math.floor(Date.now() / 1000) - 1800) as any,
          open: ammData.vammPrice * 0.998,
          high: ammData.vammPrice * 1.002,
          low: ammData.vammPrice * 0.996,
          close: ammData.vammPrice * 1.001,
        },
        {
          time: Math.floor(Date.now() / 1000) as any,
          open: ammData.vammPrice * 1.001,
          high: ammData.vammPrice * 1.003,
          low: ammData.vammPrice * 0.999,
          close: ammData.vammPrice,
        },
      ];

      console.log("Setting AMM data:", chartData);
      seriesRef.current.setData(chartData);
      chartInstanceRef.current.timeScale().fitContent();
    } else if (candlestickData.length > 0 && seriesRef.current) {
      console.log("Setting candlestick data:", candlestickData);
      seriesRef.current.setData(candlestickData);
      chartInstanceRef.current.timeScale().fitContent();
    } else if (prices.length > 0 && seriesRef.current) {
      const fallbackData = prices.map((price) => ({
        time: Math.floor(price.timestamp / 1000),
        open: price.price * 0.99,
        high: price.price * 1.01,
        low: price.price * 0.98,
        close: price.price,
      }));

      console.log("Setting fallback data:", fallbackData);
      seriesRef.current.setData(fallbackData);
      chartInstanceRef.current.timeScale().fitContent();
    }
  }, [candlestickData, prices, chartType, ammData]);

  const handleMarketSelect = (
    marketSymbol: string,
    chartType: "spot" | "perp"
  ) => {
    console.log("handleMarketSelect called:", marketSymbol, chartType);
    const market = availableMarkets.find((m) => m.symbol === marketSymbol);
    console.log("Found market:", market);
    if (market) {
      setSelectedMarket(market);
      setChartType(chartType);
      setIsMarketModalOpen(false);
      console.log("Market and chart type set");
    }
  };

  return (
    <div className="h-full flex flex-col">
      <Card className="h-full flex flex-col">
        <CardHeader className="pb-3 px-3 sm:px-6 flex-shrink-0">
          <div className="flex flex-col gap-3">
            {/* Market selector and chart type toggle */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="relative flex items-center gap-2">
                <button
                  ref={marketButtonRef}
                  className="flex items-center gap-2 hover:bg-accent/50 rounded px-2 py-1 transition-colors"
                  onClick={() => setIsMarketModalOpen(!isMarketModalOpen)}
                >
                  <div className="w-5 h-5 sm:w-6 sm:h-6 rounded-full flex items-center justify-center">
                    <Image
                      src="/ethlogo.jpg"
                      alt="ETH"
                      width={24}
                      height={24}
                      className="rounded-full"
                    />
                  </div>
                  <span className="text-base sm:text-lg font-display">
                    {selectedMarket?.symbol || "Select Market"}
                  </span>
                  <div
                    className={`transition-transform duration-200 ${
                      isMarketModalOpen ? "rotate-180" : ""
                    }`}
                  >
                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  </div>
                </button>
                <MarketSelectionDropdown
                  open={isMarketModalOpen}
                  onOpenChange={setIsMarketModalOpen}
                  onSelectMarket={handleMarketSelect}
                  currentMarket={selectedMarket?.symbol || ""}
                  currentChartType={chartType}
                  triggerRef={marketButtonRef}
                />
              </div>

              {/* AMM Data Status */}
              {chartType === "perp" && (
                <div className="flex items-center gap-2 text-xs">
                  {isUploading ? (
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                      <span>Uploading to Lighthouse...</span>
                    </div>
                  ) : lighthouseCid ? (
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                      <span className="text-green-500">Lighthouse:</span>
                      <code className="text-xs bg-muted px-1 py-0.5 rounded">
                        {lighthouseCid.slice(0, 8)}...
                      </code>
                    </div>
                  ) : ammData?.vammPrice ? (
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
                      <span className="text-yellow-500">
                        vAMM: ${ammData.vammPrice.toFixed(2)}
                      </span>
                    </div>
                  ) : ammLoading ? (
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                      <span>Loading AMM data...</span>
                    </div>
                  ) : ammError ? (
                    <div className="flex items-center gap-1 text-destructive">
                      <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                      <span>Error loading AMM data</span>
                    </div>
                  ) : null}

                  {/* Refresh Button */}
                  <button
                    onClick={() => {
                      fetchAMMPrice();
                      if (ammData?.vammPrice) {
                        uploadAMMDataToLighthouse();
                      }
                    }}
                    disabled={isUploading || ammLoading}
                    className="p-1 hover:bg-accent/50 rounded transition-colors disabled:opacity-50"
                    title="Refresh AMM Data"
                  >
                    <RefreshCw
                      className={`h-3 w-3 ${
                        isUploading || ammLoading ? "animate-spin" : ""
                      }`}
                    />
                  </button>
                </div>
              )}
            </div>

            {/* Timeframe selector */}
            <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto pb-1">
              <div className="flex items-center gap-1 sm:gap-2 min-w-max">
                <TimeframeSelector />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex-1 p-0 relative">
          {loading && chartType === "perp" && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
              <div className="text-sm text-muted-foreground">
                Loading chart data...
              </div>
            </div>
          )}
          {error && chartType === "perp" && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
              <div className="text-sm text-destructive">Error: {error}</div>
            </div>
          )}
          {tradingViewLoading && chartType === "spot" && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
              <div className="text-sm text-muted-foreground">
                Loading Spot ...
              </div>
            </div>
          )}

          {chartType === "spot" ? (
            <div
              className="w-full h-full overflow-hidden relative"
              style={{
                width: "100%",
                height: "100%",
                maxWidth: "100%",
                maxHeight: "100%",
                overflow: "hidden",
                position: "relative",
              }}
            >
              <div
                id="tradingview"
                className="w-full h-full"
                style={{
                  width: "100%",
                  height: "100%",
                  maxWidth: "100%",
                  maxHeight: "100%",
                  overflow: "hidden",
                  position: "relative",
                  boxSizing: "border-box",
                  display: "block",
                }}
              />
            </div>
          ) : (
            <div ref={chartRef} className="w-full h-full"></div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
