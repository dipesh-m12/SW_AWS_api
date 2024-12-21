const mongoose = require("mongoose");

const KeySchema = mongoose.Schema(
  {
    canteenId: {
      type: String,
    },
    publicKey: {
      type: String,
    },
    privateKey: {
      type: String,
    },
    platform: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Key", KeySchema);
