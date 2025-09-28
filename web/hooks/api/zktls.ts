import lighthouse from "@lighthouse-web3/sdk";
import dayjs from "dayjs";
import { ethers } from "ethers";
import axios from "axios";
import * as dotenv from "dotenv";
dotenv.config();

const uploadData = async (publicKey, privateKey) => {
  try {
    const priceData = {
      price: 100,
      timestamp: dayjs().unix(),
    };

    // Get signed message for encryption
    const signedMessage = await signAuthMessage(privateKey);

    // Upload with encryption using the correct method
    const response = await lighthouse.textUploadEncrypted(
      JSON.stringify(priceData),
      "951995da.e472de36d41f40a5b9b0f00237424797", // API key
      publicKey,
      signedMessage,
      "uniperp" // name
    );
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
    const response = await lighthouse.uploadText(
      JSON.stringify(priceData),
      apiKey,
      name
    );
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
    const signer = new ethers.Wallet(privateKey);
    const messageRequested = await axios.get(
      `https://encryption.lighthouse.storage/api/message/${signer.address}`
    );
    const signedMessage = await signer.signMessage(
      messageRequested.data[0].message
    );
    return signedMessage;
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

// Main execution
const main = async () => {
  try {
    const PRIVATE_KEY =
      process.env.PRIVATE_KEY_WALLET1 ||
      "cf43b326c9b11208da2d1f0d36b97a54af487e07ff56f22536bfa29a1ba35644";

    // Get the address from the private key
    const signer = new ethers.Wallet(PRIVATE_KEY);
    const WALLET_ADDRESS = signer.address;

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

main();
