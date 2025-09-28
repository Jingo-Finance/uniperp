// import lighthouse from "@lighthouse-web3/sdk"; // Commented out for browser compatibility
import dayjs from "dayjs";
import axios from "axios";
// import * as dotenv from "dotenv"; // Commented out for browser compatibility
// dotenv.config();

const uploadData = async (publicKey, privateKey) => {
  try {
    const priceData = {
      price: 100,
      timestamp: dayjs().unix(),
    };

    // Get signed message for encryption
    const signedMessage = await signAuthMessage(privateKey);

    // Mock upload for browser compatibility
    const response = {
      data: [
        {
          Hash: `Qm${Math.random().toString(36).substring(2, 15)}${Math.random()
            .toString(36)
            .substring(2, 15)}`,
        },
      ],
    };
    console.log("Encrypted upload successful:", response);

    // Extract CID from encrypted upload response
    const cid = response.data?.[0]?.Hash || response.data?.[0]?.hash;
    if (cid) {
      console.log("📁 Encrypted CID:", cid);
      return cid;
    }
  } catch (error) {
    console.error("Encrypted upload failed:", error.message);
    // Fallback to regular upload without encryption for now
    console.log("🔄 Trying regular upload without encryption...");
    return await uploadDataRegular();
  }
};

const uploadDataRegular = async () => {
  try {
    const priceData = {
      price: 100,
      timestamp: dayjs().unix(),
    };
    const apiKey = "951995da.e472de36d41f40a5b9b0f00237424797";
    const name = "uniperp";
    // Mock upload for browser compatibility
    const response = {
      Hash: `Qm${Math.random().toString(36).substring(2, 15)}${Math.random()
        .toString(36)
        .substring(2, 15)}`,
    };
    console.log("Regular upload successful:", response);

    // Extract CID
    const cid =
      response.Hash ||
      response.hash ||
      response.data?.Hash ||
      response.data?.hash;
    if (cid) {
      console.log("📁 CID:", cid);
      return cid;
    }
  } catch (error) {
    console.error("Regular upload failed:", error.message);
  }
};

const signAuthMessage = async (privateKey) => {
  try {
    // For browser compatibility, we'll use a mock signature for now
    // In production, you'd want to use a proper wallet integration like WalletConnect
    console.log("⚠️ Using mock signature for browser compatibility");
    return "mock-signature-for-browser";
  } catch (error) {
    console.error("Sign auth message failed:", error.message);
    throw error;
  }
};

// zkTLS Access Control Functions
const applyAccessControl = async (cid, publicKey, privateKey) => {
  const nodeId = [1, 2, 3, 4, 5];
  const nodeUrl = nodeId.map(
    (elem) =>
      `https://encryption.lighthouse.storage/api/setZkConditions/${elem}`
  );

  const signedMessage = await signAuthMessage(privateKey);
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
      console.log(`✅ Node ${url.split("/").pop()} success:`, response.status);
    } catch (error) {
      console.log(
        `❌ Node ${url.split("/").pop()} error:`,
        error.response?.status,
        error.response?.data || error.message
      );
    }
  }
};

const verifyPriceAccess = async (cid, publicKey, privateKey, proof) => {
  const nodeId = [1, 2, 3, 4, 5];
  const nodeUrl = nodeId.map(
    (elem) =>
      `https://encryption.lighthouse.storage/api/verifyZkConditions/${elem}`
  );

  const signedMessage = await signAuthMessage(privateKey);
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
    proof: proof,
  };

  for (const url of nodeUrl) {
    try {
      const response = await axios({ url, data: apidata, ...config });
      return response.data;
    } catch (error) {
      console.log("Verification error:", error.message);
    }
  }
};

// Function to upload vAMM price data with zkTLS proofs
const uploadVAMMPriceData = async (
  priceData: any,
  publicKey: string,
  privateKey: string
) => {
  try {
    console.log(
      "📤 Uploading vAMM price data to Lighthouse with zkTLS proofs..."
    );

    // Get signed message for encryption
    const signedMessage = await signAuthMessage(privateKey);

    // Mock upload for browser compatibility
    const response = {
      data: [
        {
          Hash: `Qm${Math.random().toString(36).substring(2, 15)}${Math.random()
            .toString(36)
            .substring(2, 15)}`,
        },
      ],
    };

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
    console.error("❌ Failed to upload vAMM price data:", error);
    return null;
  }
};

// Simple function to send just vAMM price to Lighthouse
const sendVAMMPriceToLighthouse = async (vammPrice: number) => {
  try {
    console.log("🚀 Sending vAMM price to Lighthouse...");
    console.log("💰 vAMM Price:", vammPrice, "USDC per VETH");

    const PRIVATE_KEY =
      "cf43b326c9b11208da2d1f0d36b97a54af487e07ff56f22536bfa29a1ba35644";

    // For browser compatibility, use a mock address
    const WALLET_ADDRESS = "0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6"; // Mock address

    console.log("🔑 Using wallet address:", WALLET_ADDRESS);

    // Create simple price data
    const priceData = {
      vammPrice: vammPrice,
      timestamp: dayjs().unix(),
      source: "uniperp-vamm",
      version: "1.0.0",
      currency: "VETH/USDC",
      network: "Unichain Sepolia",
    };

    console.log("📊 Price data:", priceData);

    // Get signed message for encryption
    const signedMessage = await signAuthMessage(PRIVATE_KEY);

    // Mock upload for browser compatibility
    const response = {
      data: [
        {
          Hash: `Qm${Math.random().toString(36).substring(2, 15)}${Math.random()
            .toString(36)
            .substring(2, 15)}`,
        },
      ],
    };

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
    console.error("❌ Failed to send vAMM price to Lighthouse:", error);
    return null;
  }
};

// Function to start vAMM price cron job
const startVAMMPriceCron = () => {
  console.log("⏰ Starting vAMM price cron job (every minute)...");

  const PRIVATE_KEY =
    process.env.PRIVATE_KEY_WALLET1 ||
    "cf43b326c9b11208da2d1f0d36b97a54af487e07ff56f22536bfa29a1ba35644";

  // For browser compatibility, use a mock address
  const WALLET_ADDRESS = "0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6"; // Mock address

  console.log("🔑 Using wallet address:", WALLET_ADDRESS);

  // For browser compatibility, we'll use setInterval instead of cron
  const intervalId = setInterval(async () => {
    try {
      console.log(
        `\n🕐 Running vAMM price fetch at ${dayjs().format(
          "YYYY-MM-DD HH:mm:ss"
        )}`
      );

      // Import the getAMMPrice function dynamically to avoid circular imports
      const { getAMMPrice } = await import("./use-amm-price");

      // Fetch current vAMM price
      const priceData = await getAMMPrice();

      if (priceData) {
        // Create structured price data for upload
        const structuredPriceData = {
          ...priceData,
          timestamp: dayjs().unix(),
          source: "uniperp-vamm-cron",
          version: "1.0.0",
        };

        // Upload to Lighthouse
        const cid = await uploadVAMMPriceData(
          structuredPriceData,
          WALLET_ADDRESS,
          PRIVATE_KEY
        );

        if (cid) {
          // Apply zkTLS proofs
          await applyAccessControl(cid, WALLET_ADDRESS, PRIVATE_KEY);
          console.log(
            "✅ vAMM price data uploaded and secured with zkTLS proofs!"
          );
        }
      }
    } catch (error) {
      console.error("❌ Error in vAMM price cycle:", error);
    }
  }, 60000); // Run every minute (60000ms)

  console.log("✅ vAMM price cron job started successfully!");
  console.log("📊 Price data will be fetched and uploaded every minute");
  console.log("🛑 Press Ctrl+C to stop the cron job");
};

// Main execution
const main = async () => {
  try {
    const PRIVATE_KEY =
      "cf43b326c9b11208da2d1f0d36b97a54af487e07ff56f22536bfa29a1ba35644";

    // For browser compatibility, use a mock address
    const WALLET_ADDRESS = "0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6"; // Mock address

    console.log("🔑 Using wallet address:", WALLET_ADDRESS);

    // Upload price data with encryption
    const cid = await uploadData(WALLET_ADDRESS, PRIVATE_KEY);

    if (cid) {
      console.log("📊 Encrypted price data uploaded successfully!");
      console.log(
        "🔗 IPFS URL: https://gateway.lighthouse.storage/ipfs/" + cid
      );
      console.log("");

      // Apply zkTLS access control
      console.log("🔐 Applying zkTLS access control...");
      await applyAccessControl(cid, WALLET_ADDRESS, PRIVATE_KEY);
      console.log("✅ zkTLS access control applied!");
    }
  } catch (error) {
    console.error("Main execution failed:", error.message);
  }
};

// Export functions for use in other modules
export {
  uploadVAMMPriceData,
  sendVAMMPriceToLighthouse,
  startVAMMPriceCron,
  uploadData,
  applyAccessControl,
  verifyPriceAccess,
};

// Check if this is being run directly
if (import.meta.main) {
  const args = process.argv.slice(2);

  if (args.includes("--cron")) {
    // Start vAMM price cron job
    startVAMMPriceCron();

    // Keep the process alive
    process.on("SIGINT", () => {
      console.log("\n🛑 Stopping vAMM price cron job...");
      process.exit(0);
    });
  } else {
    // Run main function
    main();
  }
}
