const mongoose = require("mongoose");

const TokenSchema = mongoose.Schema(
  {
    canteenId: {
      type: String,
      required: true,
      unique: true,
    },
    expoTokens: {
      type: [String],
      default: [],
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("CanteensExpoTokens", TokenSchema);
