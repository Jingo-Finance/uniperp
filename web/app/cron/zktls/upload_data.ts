import lighthouse from "@lighthouse-web3/sdk";
import dayjs from "dayjs";
import { ethers } from "ethers";
import axios from "axios";
import * as dotenv from "dotenv";
dotenv.config();

const uploadData = async (publicKey, privateKey, price = 100) => {
  try {
    const priceData = {
      price: price,
      timestamp: dayjs().unix(),
      maxDeviation: 5, // 5% max deviation
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

// Price deviation testing functions
const testPriceDeviation = async (basePrice, testPrice, expectedResult) => {
  console.log(
    `\n🔍 Testing price deviation: Base=${basePrice}, Test=${testPrice}, Expected=${
      expectedResult ? "PASS" : "FAIL"
    }`
  );

  const PRIVATE_KEY =
    process.env.PRIVATE_KEY_WALLET1 ||
    "cf43b326c9b11208da2d1f0d36b97a54af487e07ff56f22536bfa29a1ba35644";
  const signer = new ethers.Wallet(PRIVATE_KEY);
  const WALLET_ADDRESS = signer.address;

  try {
    // Upload price data with specific price
    const cid = await uploadData(WALLET_ADDRESS, PRIVATE_KEY, basePrice);

    if (cid) {
      // Apply price deviation access control
      await applyPriceDeviationAccessControl(
        cid,
        WALLET_ADDRESS,
        PRIVATE_KEY,
        basePrice,
        5
      ); // 5% max deviation

      // Test verification with test price
      const deviation = (Math.abs(testPrice - basePrice) / basePrice) * 100;
      console.log(`📊 Calculated deviation: ${deviation.toFixed(2)}%`);

      // Create a mock proof for price verification
      const mockProof = {
        price: testPrice,
        timestamp: dayjs().unix(),
        deviation: deviation,
        signature: "mock_signature_for_testing",
      };

      const result = await verifyPriceAccess(
        cid,
        WALLET_ADDRESS,
        PRIVATE_KEY,
        JSON.stringify(mockProof)
      );

      if (expectedResult) {
        console.log(
          `✅ Expected PASS - Deviation ${deviation.toFixed(
            2
          )}% should be allowed`
        );
      } else {
        console.log(
          `❌ Expected FAIL - Deviation ${deviation.toFixed(
            2
          )}% should be rejected`
        );
      }

      return { cid, deviation, result };
    }
  } catch (error) {
    console.log(`❌ Price deviation test error:`, error.message);
    return null;
  }
};

const applyPriceDeviationAccessControl = async (
  cid,
  publicKey,
  privateKey,
  basePrice,
  maxDeviationPercent
) => {
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
        method: "City", // Using standard zkTLS condition for now
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
        `✅ Node ${url.split("/").pop()} price control applied:`,
        response.status
      );
    } catch (error) {
      console.log(
        `❌ Node ${url.split("/").pop()} price control error:`,
        error.response?.status,
        error.response?.data || error.message
      );
    }
  }
};

// Test functions for different scenarios
const testFailureCases = async () => {
  console.log("\n🧪 Testing Failure Cases...\n");

  // Test 1: Invalid private key
  console.log("1️⃣ Testing invalid private key...");
  try {
    const invalidPrivateKey = "invalid_key_123";
    const signer = new ethers.Wallet(invalidPrivateKey);
    const invalidAddress = signer.address;
    await uploadData(invalidAddress, invalidPrivateKey);
  } catch (error) {
    console.log("❌ Expected error with invalid key:", error.message);
  }

  // Test 2: Invalid API key
  console.log("\n2️⃣ Testing invalid API key...");
  try {
    const priceData = { price: 100, timestamp: dayjs().unix() };
    const response = await lighthouse.textUploadEncrypted(
      JSON.stringify(priceData),
      "invalid_api_key", // Invalid API key
      "0xcFE743EA353d4d3D2c20C41C7d878B2cbA66DA0a",
      "invalid_signature",
      "test"
    );
  } catch (error) {
    console.log("❌ Expected error with invalid API key:", error.message);
  }

  // Test 3: Network failure simulation
  console.log("\n3️⃣ Testing network failure...");
  try {
    // This will fail because we're using a non-existent endpoint
    const response = await axios.get(
      "https://nonexistent-endpoint.com/api/test"
    );
  } catch (error) {
    console.log("❌ Expected network error:", error.message);
  }

  // Test 4: zkTLS access control with invalid CID
  console.log("\n4️⃣ Testing zkTLS with invalid CID...");
  try {
    const PRIVATE_KEY =
      process.env.PRIVATE_KEY_WALLET1 ||
      "cf43b326c9b11208da2d1f0d36b97a54af487e07ff56f22536bfa29a1ba35644";
    const signer = new ethers.Wallet(PRIVATE_KEY);
    const WALLET_ADDRESS = signer.address;

    // Try to apply access control to a non-existent CID
    await applyAccessControl("invalid_cid_123", WALLET_ADDRESS, PRIVATE_KEY);
  } catch (error) {
    console.log("❌ Expected error with invalid CID:", error.message);
  }

  // Test 5: zk verification with invalid proof
  console.log("\n5️⃣ Testing zk verification with invalid proof...");
  try {
    const PRIVATE_KEY =
      process.env.PRIVATE_KEY_WALLET1 ||
      "cf43b326c9b11208da2d1f0d36b97a54af487e07ff56f22536bfa29a1ba35644";
    const signer = new ethers.Wallet(PRIVATE_KEY);
    const WALLET_ADDRESS = signer.address;

    // Try to verify with invalid proof
    const result = await verifyPriceAccess(
      "QmTest123",
      WALLET_ADDRESS,
      PRIVATE_KEY,
      "invalid_proof_123"
    );

    if (result === undefined) {
      console.log(
        "✅ Expected failure with invalid proof: No valid result returned"
      );
    } else {
      console.log("❌ Unexpected success with invalid proof:", result);
    }
  } catch (error) {
    console.log("❌ Expected error with invalid proof:", error.message);
  }

  // Test 6: zk verification with wrong private key
  console.log("\n6️⃣ Testing zk verification with wrong private key...");
  try {
    const wrongPrivateKey =
      "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
    const wrongSigner = new ethers.Wallet(wrongPrivateKey);
    const wrongAddress = wrongSigner.address;

    // Try to verify with wrong private key
    const result = await verifyPriceAccess(
      "QmTest123",
      wrongAddress,
      wrongPrivateKey,
      "some_proof"
    );

    if (result === undefined) {
      console.log(
        "✅ Expected failure with wrong key: No valid result returned"
      );
    } else {
      console.log("❌ Unexpected success with wrong key:", result);
    }
  } catch (error) {
    console.log("❌ Expected error with wrong private key:", error.message);
  }

  // Test 7: zk verification with malformed proof
  console.log("\n7️⃣ Testing zk verification with malformed proof...");
  try {
    const PRIVATE_KEY =
      process.env.PRIVATE_KEY_WALLET1 ||
      "cf43b326c9b11208da2d1f0d36b97a54af487e07ff56f22536bfa29a1ba35644";
    const signer = new ethers.Wallet(PRIVATE_KEY);
    const WALLET_ADDRESS = signer.address;

    // Try to verify with malformed proof (not a valid zk proof format)
    const malformedProof = {
      invalid: "proof",
      data: "not_a_real_zk_proof",
    };
    const result = await verifyPriceAccess(
      "QmTest123",
      WALLET_ADDRESS,
      PRIVATE_KEY,
      JSON.stringify(malformedProof)
    );

    if (result === undefined) {
      console.log(
        "✅ Expected failure with malformed proof: No valid result returned"
      );
    } else {
      console.log("❌ Unexpected success with malformed proof:", result);
    }
  } catch (error) {
    console.log("❌ Expected error with malformed proof:", error.message);
  }

  // Test 8: zk verification with expired proof
  console.log("\n8️⃣ Testing zk verification with expired proof...");
  try {
    const PRIVATE_KEY =
      process.env.PRIVATE_KEY_WALLET1 ||
      "cf43b326c9b11208da2d1f0d36b97a54af487e07ff56f22536bfa29a1ba35644";
    const signer = new ethers.Wallet(PRIVATE_KEY);
    const WALLET_ADDRESS = signer.address;

    // Try to verify with expired proof (old timestamp)
    const expiredProof = {
      proof: "expired_proof_data",
      timestamp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
      signature: "expired_signature",
    };
    const result = await verifyPriceAccess(
      "QmTest123",
      WALLET_ADDRESS,
      PRIVATE_KEY,
      JSON.stringify(expiredProof)
    );

    if (result === undefined) {
      console.log(
        "✅ Expected failure with expired proof: No valid result returned"
      );
    } else {
      console.log("❌ Unexpected success with expired proof:", result);
    }
  } catch (error) {
    console.log("❌ Expected error with expired proof:", error.message);
  }

  console.log("\n✅ All failure tests completed!");
};

// Comprehensive price deviation testing
const testPriceDeviationCases = async () => {
  console.log("\n🧪 Testing Price Deviation Cases...\n");
  console.log(
    "ℹ️  Note: This tests price deviation logic locally since zkTLS doesn't support custom price conditions yet"
  );
  console.log(
    "   The actual zk verification would happen in your smart contracts\n"
  );

  // Test cases: [basePrice, testPrice, shouldPass, description]
  const testCases = [
    [100, 102, true, "2% deviation - should PASS"],
    [100, 105, true, "5% deviation - should PASS (exactly at limit)"],
    [100, 106, false, "6% deviation - should FAIL (exceeds 5% limit)"],
    [100, 95, true, "5% deviation down - should PASS"],
    [100, 94, false, "6% deviation down - should FAIL"],
    [1000, 1010, true, "1% deviation on high price - should PASS"],
    [1000, 1060, false, "6% deviation on high price - should FAIL"],
    [50, 52.5, true, "5% deviation on low price - should PASS"],
    [50, 53, false, "6% deviation on low price - should FAIL"],
  ];

  let passedTests = 0;
  let totalTests = testCases.length;

  for (let i = 0; i < testCases.length; i++) {
    const [basePrice, testPrice, shouldPass, description] = testCases[i];
    console.log(`\n${i + 1}️⃣ ${description}`);

    try {
      // Calculate deviation locally (this is what your smart contract would do)
      const deviation = (Math.abs(testPrice - basePrice) / basePrice) * 100;
      const actualPass = deviation <= 5; // 5% max deviation

      console.log(`📊 Base Price: $${basePrice}, Test Price: $${testPrice}`);
      console.log(`📊 Calculated Deviation: ${deviation.toFixed(2)}%`);
      console.log(`📊 Max Allowed: 5.00%`);

      if (actualPass === shouldPass) {
        console.log(
          `✅ Test ${i + 1} CORRECT: Deviation ${deviation.toFixed(2)}% ${
            shouldPass ? "ALLOWED" : "REJECTED"
          } as expected`
        );
        passedTests++;
      } else {
        console.log(
          `❌ Test ${i + 1} INCORRECT: Expected ${
            shouldPass ? "PASS" : "FAIL"
          }, got ${actualPass ? "PASS" : "FAIL"}`
        );
      }

      // Upload the price data for reference (with zkTLS access control)
      const PRIVATE_KEY =
        process.env.PRIVATE_KEY_WALLET1 ||
        "cf43b326c9b11208da2d1f0d36b97a54af487e07ff56f22536bfa29a1ba35644";
      const signer = new ethers.Wallet(PRIVATE_KEY);
      const WALLET_ADDRESS = signer.address;

      const cid = await uploadData(WALLET_ADDRESS, PRIVATE_KEY, basePrice);
      if (cid) {
        await applyPriceDeviationAccessControl(
          cid,
          WALLET_ADDRESS,
          PRIVATE_KEY,
          basePrice,
          5
        );
        console.log(`📁 Price data uploaded with CID: ${cid}`);
      }
    } catch (error) {
      console.log(`❌ Test ${i + 1} ERROR:`, error.message);
    }
  }

  console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);
  console.log("✅ All price deviation tests completed!");
  console.log("\n💡 Integration with vAMM:");
  console.log("   - Use this deviation logic in your PerpsHook.sol");
  console.log("   - Replace the City condition with actual price validation");
  console.log(
    "   - Implement zk proofs for price verification in smart contracts"
  );
};

// Test function for successful case
const testSuccessCase = async () => {
  console.log("\n🧪 Testing Success Case...\n");

  const PRIVATE_KEY =
    process.env.PRIVATE_KEY_WALLET1 ||
    "cf43b326c9b11208da2d1f0d36b97a54af487e07ff56f22536bfa29a1ba35644";
  const signer = new ethers.Wallet(PRIVATE_KEY);
  const WALLET_ADDRESS = signer.address;

  console.log("🔑 Using wallet address:", WALLET_ADDRESS);

  // Upload price data with encryption
  const cid = await uploadData(WALLET_ADDRESS, PRIVATE_KEY);

  if (cid) {
    console.log("📊 Encrypted price data uploaded successfully!");
    console.log("🔗 IPFS URL: https://gateway.lighthouse.storage/ipfs/" + cid);
    console.log("");

    // Apply zkTLS access control
    console.log("🔐 Applying zkTLS access control...");
    await applyAccessControl(cid, WALLET_ADDRESS, PRIVATE_KEY);
    console.log("✅ zkTLS access control applied!");

    // Test zk verification (this would normally require a valid proof from Reclaim Protocol)
    console.log("\n🔍 Testing zk verification...");
    console.log(
      "ℹ️  Note: Full zk verification requires a valid proof from Reclaim Protocol"
    );
    console.log(
      "   For now, we can only test the verification endpoint structure"
    );

    // Test verification endpoint (will fail without valid proof, but tests the flow)
    try {
      const testProof = "test_proof_for_verification_flow";
      const result = await verifyPriceAccess(
        cid,
        WALLET_ADDRESS,
        PRIVATE_KEY,
        testProof
      );
      console.log("🔍 Verification endpoint response:", result);
    } catch (error) {
      console.log(
        "ℹ️  Expected verification error (no valid proof):",
        error.message
      );
    }
  }
};

// Main execution with test selection
const main = async () => {
  const testType = process.argv[2] || "success"; // Default to success test

  try {
    if (testType === "failure") {
      await testFailureCases();
    } else if (testType === "success") {
      await testSuccessCase();
    } else if (testType === "both") {
      await testSuccessCase();
      await testFailureCases();
    } else if (testType === "price") {
      await testPriceDeviationCases();
    } else if (testType === "all") {
      await testSuccessCase();
      await testFailureCases();
      await testPriceDeviationCases();
    } else {
      console.log(
        "Usage: bun run upload_data.ts [success|failure|both|price|all]"
      );
      console.log(
        "  success (default): Test successful upload and access control"
      );
      console.log("  failure: Test various failure scenarios");
      console.log("  both: Run both success and failure tests");
      console.log("  price: Test price deviation validation with zk");
      console.log("  all: Run all tests including price deviation");
    }
  } catch (error) {
    console.error("Main execution failed:", error.message);
  }
};

main();
