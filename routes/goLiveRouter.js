const redis = require("redis");
const redisClient = redis.createClient({});

redisClient.connect().catch(console.error); // Ensure the client is connected
redisClient.on("error", (err) => {
  console.error("Redis error: ", err);
});

const router = require("express").Router();

router.post("/setStatus", async (req, res, next) => {
  const { canteenId, live } = req.body;
  //   console.log(canteenId, live);

  if (!canteenId) {
    console.log("canteenId not provided");
    return res.status(400).json({ message: "Canteen ID is required" });
  }

  try {
    const cacheKey = `live:${canteenId}`;

    // Store the live status with a TTL (time-to-live)
    await redisClient.set(cacheKey, JSON.stringify(live), {
      EX: 3600 * 7, // Expire after 7 hours
    });
    console.log("Live status cached");
    // Respond with success
    res.status(200).json({ message: "Live status updated successfully" });
  } catch (e) {
    console.log("Error saving/updating live status in Redis:", e);
    res.status(500).json({ message: "Error saving/updating live status" });
  }
});

router.post("/getStatus", async (req, res, next) => {
  try {
    const { canteenId } = req.body;

    if (!canteenId) {
      return res.status(400).send(null);
    }

    // Key for fetching the live status from Redis
    const cacheKey = `live:${canteenId}`;

    // Retrieve the live status from Redis
    const cachedStatus = await redisClient.get(cacheKey);

    if (cachedStatus) {
      console.log("Cache hit : Live status ");
      return res.status(200).json({ status: JSON.parse(cachedStatus) });
    } else {
      console.log("Cache miss : Live status");
      return res.status(404).send(null);
    }
  } catch (e) {
    console.log("Error retrieving canteen status:", e);
    res.status(500).send(null);
  }
});

module.exports = router;
