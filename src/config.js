const path = require("node:path");

module.exports = {
  port: Number(process.env.PORT) || 3000,
  sessionSecret:
    process.env.SESSION_SECRET || "everyones-art-development-secret",
  dataDirectory: path.join(__dirname, "..", "data"),
  usersFile: path.join(__dirname, "..", "data", "users.json"),
  uploadsDirectory: path.join(__dirname, "..", "uploads"),
};
