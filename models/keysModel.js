const mongoose = require("mongoose");

const KeySchema = mongoose.Schema(
  {
    canteenId: {
      type: String,
    },
    pulicKey: {
      type: String,
    },
    privateKey: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Key", KeySchema);
