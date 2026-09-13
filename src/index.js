require("dotenv").config();
const { createServer } = require("./ui/server");

const PORT = Number(process.env.PORT) || 3000;

console.log("==============================================");
console.log("       Shoriu Foundation — P2P FileShare");
console.log("==============================================");
console.log("Direct peer-to-peer file sharing");
console.log("WebRTC DataChannel");
console.log("Short connection codes");
console.log("License: https://license.shoriufoundation.org.az");
console.log("==============================================");

createServer(PORT);