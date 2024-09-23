const { ok } = require("assert");
const redis = require("redis");
const redisClient = redis.createClient({});
const { cacheHitCounter, cacheMissCounter } = require("../cacheMetrics");

redisClient.connect().catch(console.error); // Ensure the client is connected
redisClient.on("error", (err) => {
  console.error("Redis error: ", err);
});

const router = require("express").Router();
router.post("/", async (req, res, next) => {
  const { canteenId, menuItems } = req.body;
  // console.log(canteenId, menuItems);
  if (!canteenId || !menuItems) {
    return res
      .status(400)
      .json({ message: "canteenId and menuItems are required" });
  }

  try {
    const cacheKey = `menu:${canteenId}`;

    const existingMenu = await redisClient.get(cacheKey);

    await redisClient.set(cacheKey, JSON.stringify(menuItems), {
      EX: 3600 * 7,
    });
    console.log("menu cached");
    res.status(200).json({
      message: existingMenu
        ? "Menu updated successfully"
        : "Menu created successfully",
    });
  } catch (error) {
    console.log("Error saving/updating menu in Redis:", error);
    res.status(500).json({ message: "Error saving/updating menu" });
  }
});

router.post("/getFromCanteenId", async (req, res, next) => {
  const { canteenId } = req.body;

  if (!canteenId) {
    return res.status(400).send(null);
  }

  try {
    // Try to get data from Redis cache
    const cachedData = await redisClient.get(`menu:${canteenId}`);

    if (cachedData) {
      console.log(`Cache hit for menu ${canteenId}`);
      cacheHitCounter.labels(req.path).inc(); // Increment cache hit counter
      return res.json({ data: JSON.parse(cachedData) });
    } else {
      console.log("Cache miss");
      cacheMissCounter.labels(req.path).inc(); // Increment cache miss counter
      return res.status(404).send(null);
    }
  } catch (error) {
    res.send(null).status(500);
    console.log("Error fetching data:", error);
  }
});
// redisClient.disconnect()
module.exports = router;
