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
const client = require("prom-client");
const responseTime = require("response-time");
const { cacheHitCounter, cacheMissCounter } = require("./cacheMetrics");

const redisClient = redis.createClient({});
redisClient.connect().catch(console.error); // Ensure the client is connected
redisClient.on("error", (err) => {
  console.error("Redis error: ", err);
});

const { createLogger, transports } = require("winston");
const LokiTransport = require("winston-loki");
const options = {
  transports: [
    new LokiTransport({
      labels: { appName: "express" },
      host: "http://127.0.0.1:3100",
    }),
  ],
};
const logger = createLogger(options);

const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics({ register: client.register });

const reqResTime = new client.Histogram({
  name: "http_express_req_res_time",
  help: "This tells how much time is taken by req and res",
  labelNames: ["method", "route", "status_code"],
  buckets: [1, 50, 100, 200, 400, 500, 800, 1000, 2000],
});

const totalReqCounter = new client.Counter({
  name: "total_req",
  help: "Tells total req",
});

const rpsCounter = new client.Counter({
  name: "requests_per_second",
  help: "Requests handled per second",
  labelNames: ["method", "route", "status_code"],
});

// Middleware to track requests per second
app.use((req, res, next) => {
  rpsCounter.labels(req.method, req.path, res.statusCode).inc();
  next();
});

const errorCounter = new client.Counter({
  name: "http_errors_total",
  help: "Total number of HTTP errors",
  labelNames: ["method", "route", "status_code"],
});

app.use((req, res, next) => {
  res.on("finish", () => {
    if (res.statusCode >= 400) {
      errorCounter.labels(req.method, req.path, res.statusCode).inc();
    }
  });
  next();
});

const rateLimit = require("express-rate-limit");

// Create a rate limiter
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // Limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
  headers: true, // Include rate limit info in the response headers
});

// Apply the rate limiter to all requests
app.use(limiter);

app.use(
  responseTime((req, res, time) => {
    totalReqCounter.inc();
    reqResTime
      .labels({
        method: req.method,
        route: req.url,
        status_code: res.statusCode,
      })
      .observe(time);
  })
);

const activeConnectionsGauge = new client.Gauge({
  name: "active_connections",
  help: "Current number of active connections",
});

// const cacheHitCounter = new client.Counter({
//   name: "cache_hits_total",
//   help: "Total number of cache hits",
//   labelNames: ["route"],
// });

// const cacheMissCounter = new client.Counter({
//   name: "cache_misses_total",
//   help: "Total number of cache misses",
//   labelNames: ["route"],
// });

app.get("/metrics", async (req, res) => {
  res.setHeader("Content-Type", client.register.contentType);
  const metrics = await client.register.metrics();
  res.send(metrics);
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
    console.log("Received");
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
        cacheHitCounter.labels(req.path).inc(); // Increment cache hit counter
        console.log("keys Cache hit");
      } else {
        console.log("keys Cache miss");
        cacheMissCounter.labels(req.path).inc(); // Increment cache miss counter
        // Fetch from database if not in cache
        data = await keysModel.findOne({ canteenId });
        console.log("Cached key", data);
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
  transports: ["websocket"],
  pingInterval: 20000, // Consider a shorter interval for more frequent checks
  pingTimeout: 50000, // Adjust to a reasonable timeout (ensure it's longer than the interval)
});

io.on("connection", (socket) => {
  console.log("User connected with socket ID:", socket.id);
  activeConnectionsGauge.inc();
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
    activeConnectionsGauge.dec();
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
