const express = require("express");
const app = express();
const cors = require("cors");
const Razorpay = require("razorpay");
const socket = require("socket.io");
const PORT = 5000;
const mongoose = require("mongoose");
const keysModel = require("./models/keysModel");
const menuRouter = require("./routes/menuCacheRouter");
const statusCacheRouter = require("./routes/goLiveRouter");
const redis = require("redis");
const redisClient = redis.createClient({});
redisClient.connect().catch(console.error); // Ensure the client is connected
redisClient.on("error", (err) => {
  console.error("Redis error: ", err);
});

mongoose
  .connect(
    "mongodb+srv://mavinash422:XKBJiE7kgqVro3hJ@cluster0.bwsy1.mongodb.net/swiftcanteen?retryWrites=true&w=majority&appName=Cluster0"
  )
  .then(() => {
    console.log("DB connection Successful!");
  })
  .catch((e) => {
    console.log(e.message);
  });

app.use(cors());
app.use(express.json());
app.use("/api/cacheMenu", menuRouter);
app.use("/api/cacheStatus", statusCacheRouter);

app.get("/", async (req, res) => {
  // console.log("Dipesh");
  try {
    // const res = await redisClient.get("cache");
    const result = await redisClient.get("user-session:123");
    res.send("Done").status(200);
  } catch (e) {
    res.send("error").status(500);
    console.log(e);
  }
});

app.post("/create-order", async (req, res) => {
  try {
    const { amount, canteenId } = req.body;
    const key = `keys:${canteenId}`;
    let data;

    // Check cache first
    try {
      const cachedData = await redisClient.get(key);
      if (cachedData) {
        data = JSON.parse(cachedData);
        console.log("Cache hit");
      } else {
        console.log("Cache miss");
        // Fetch from database if not in cache
        data = await keysModel.findOne({ canteenId });
        // Cache the data for 2 hours
        await redisClient.setEx(key, 7 * 3600, JSON.stringify(data));
      }
    } catch (redisError) {
      console.error("Redis error:", redisError);
      // Fallback to DB fetch if cache operation fails
      data = await keysModel.findOne({ canteenId });
    }

    if (!data) {
      return res.status(404).send("Canteen not found");
    }

    // Initialize Razorpay
    const razorpay = new Razorpay({
      key_id: data.pulicKey,
      key_secret: data.privateKey,
    });

    // Create an order
    const order = await razorpay.orders.create({
      amount: amount * 100, // Amount in paise
      currency: "INR",
      receipt: `order_${Math.random()}`,
    });

    // Send response
    res.json({
      id: order.id,
      currency: order.currency,
      amount: order.amount,
      publicKey: data.pulicKey,
    });
  } catch (error) {
    console.error("Error creating order:", error);
    res.status(500).send("Error creating order");
  }
});

const server = app.listen(PORT, () => {
  console.log(`Listening on PORT ${PORT}`);
});

const io = socket(server, {
  cors: {
    origin: "*", //all
    credentials: true,
  },
});

io.on("connection", (socket) => {
  console.log("User connected with socket ID:", socket.id);

  // Add or update user with new socket ID
  socket.on("add-user", async (userId) => {
    try {
      // Store the socket ID with a TTL
      await redisClient.setEx(`sockets:${userId}`, 3600 * 7, socket.id); // Store userId to socket mapping
      await redisClient.setEx(`socket-to-user:${socket.id}`, 3600 * 7, userId); // Store socketId to user mapping
      console.log(`User ${userId} connected with socket ${socket.id}`);
    } catch (error) {
      console.error("Error adding user to Redis:", error);
    }
  });

  // Listen for the 'new-order' event emitted by the client
  socket.on("new-order", async ({ canteenId, order }) => {
    try {
      // Retrieve the socket ID for the canteen from Redis
      const canteenSocketId = await redisClient.get(`sockets:${canteenId}`);
      if (canteenSocketId) {
        // Emit the new order to the canteen's socket ID
        socket.to(canteenSocketId).emit("order-received", order);
        console.log(`Order sent to canteen with socket ID: ${canteenSocketId}`);
      } else {
        console.log("No socket found for the canteen ID:", canteenId);
      }
    } catch (error) {
      console.error("Error sending new order to canteen:", error);
    }
  });

  socket.on("cus", async ({ canteenId, data }) => {
    try {
      console.log(canteenId, data);
      let id = await redisClient.get(`sockets:${canteenId}`);
      socket.to(id).emit("rec", data);
    } catch (e) {
      console.log(e);
    }
  });

  // Handle user disconnection
  socket.on("disconnect", async () => {
    console.log("A user disconnected with socket ID:", socket.id);
    try {
      // Find user ID associated with the socket ID
      const userId = await redisClient.get(`socket-to-user:${socket.id}`);
      if (userId) {
        // Remove the user's mapping from Redis
        await redisClient.del(`sockets:${userId}`);
        await redisClient.del(`socket-to-user:${socket.id}`);
        console.log(`Socket ${socket.id} removed for user ${userId}`);
      }
    } catch (error) {
      console.error("Error removing socket ID from Redis:", error);
    }
  });
});
