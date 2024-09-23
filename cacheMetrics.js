const client = require("prom-client");

// Define global cache hit and miss counters
const cacheHitCounter = new client.Counter({
  name: "cache_hits_total",
  help: "Total number of cache hits",
  labelNames: ["route"],
});

const cacheMissCounter = new client.Counter({
  name: "cache_misses_total",
  help: "Total number of cache misses",
  labelNames: ["route"],
});

// Export the counters to be reused
module.exports = { cacheHitCounter, cacheMissCounter };
