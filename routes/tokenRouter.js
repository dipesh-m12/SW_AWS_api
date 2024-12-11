const redis = require("redis");
const redisClient = redis.createClient({});
const { cacheHitCounter, cacheMissCounter } = require("../cacheMetrics");
redisClient.connect().catch(console.error); // Ensure the client is connected
redisClient.on("error", (err) => {
  console.error("Redis error: ", err);
});
const tokenModel = require("../models/notiTokenModel");

const router = require("express").Router();

router.post("/store", async (req, res) => {
  const { canteenId, expoToken } = req.body;

  if (!canteenId || !expoToken) {
    return res.status(400).json({
      status: "error",
      message: "canteenId and expoToken are required.",
    });
  }

  try {
    const redisKey = `canteen:${canteenId}`;
    let cachedTokens = await redisClient.get(redisKey);
    if (cachedTokens) {
      cachedTokens = JSON.parse(cachedTokens);

      if (!cachedTokens.includes(expoToken)) {
        cachedTokens.push(expoToken);

        await redisClient.set(redisKey, JSON.stringify(cachedTokens));
      }
    } else {
      const canteenData = await tokenModel.findOne({ canteenId });
      cachedTokens = canteenData?.expoTokens || [];

      if (!cachedTokens.includes(expoToken)) {
        cachedTokens.push(expoToken);
      }

      await redisClient.set(redisKey, JSON.stringify(cachedTokens));
    }

    await tokenModel.findOneAndUpdate(
      { canteenId },
      { $addToSet: { expoTokens: expoToken } }, // Ensures no duplicates in the array
      { upsert: true, new: true }
    );

    return res.status(200).json({
      status: "success",
      message: "Token stored successfully.",
    });
  } catch (error) {
    console.error("Error storing token: ", error);
    return res.status(500).json({
      status: "error",
      message: "An error occurred while storing the token.",
      error: error.message,
    });
  }
});

router.post("/sendNotification", async (req, res) => {
  const { canteenId, data } = req.body; // no need for expoToken, just use the stored tokens

  if (!canteenId || !data) {
    return res.status(400).json({
      status: "error",
      message: "canteenId and notification data are required.",
    });
  }

  try {
    const redisKey = `canteen:${canteenId}`;
    let cachedTokens = await redisClient.get(redisKey);

    if (cachedTokens) {
      cachedTokens = JSON.parse(cachedTokens);
      console.log(`Cache hit: ${cachedTokens.length} tokens found in Redis`);

      const notificationPayload = {
        to: cachedTokens,
        title: data.title || "New Notification", // Default title if not provided
        body: data.body || "You have a new notification.",
        data: data.data || {},
      };

      // Send notification through Expo API
      const response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(notificationPayload),
      });

      const result = await response.json();

      if (result.errors) {
        console.error("Error sending notifications:", result.errors);
        return res.status(500).json({
          status: "error",
          message: "Error sending notifications.",
          errors: result.errors,
        });
      }

      console.log("Notifications sent successfully.");
      return res.status(200).json({
        status: "success",
        message: "Notifications sent successfully.",
        result: result,
      });
    } else {
      // If cache miss, fetch tokens from the database
      const canteenData = await tokenModel.findOne({ canteenId });

      if (
        !canteenData ||
        !canteenData.expoTokens ||
        canteenData.expoTokens.length === 0
      ) {
        return res.status(404).json({
          status: "error",
          message: "No Expo Push Tokens found for the provided canteenId.",
        });
      }

      // Cache the tokens in Redis for future use
      console.log("Cache miss", canteenData);
      await redisClient.set(redisKey, JSON.stringify(canteenData.expoTokens));

      // Send notification to tokens
      const notificationPayload = {
        to: canteenData.expoTokens,
        title: data.title || "New Notification", // Default title if not provided
        body: data.body || "An order was confirmed",
        data: data.data || {},
      };

      // Send notification through Expo API
      const response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(notificationPayload),
      });

      const result = await response.json();

      if (result.errors) {
        console.error("Error sending notifications:", result.errors);
        return res.status(500).json({
          status: "error",
          message: "Error sending notifications.",
          errors: result.errors,
        });
      }

      console.log("Notifications sent successfully.");
      return res.status(200).json({
        status: "success",
        message: "Notifications sent successfully.",
        result: result,
      });
    }
  } catch (error) {
    console.error("Error during notification process:", error);
    return res.status(500).json({
      status: "error",
      message: "An error occurred during the notification process.",
      error: error.message,
    });
  }
});

module.exports = router;
