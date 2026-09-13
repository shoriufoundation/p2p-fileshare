const crypto = require("crypto");

function randomId(bytes = 16) {
    return crypto
        .randomBytes(bytes)
        .toString("hex");
}

function constantTimeEqual(a, b) {
    if (!Buffer.isBuffer(a)) {
        a = Buffer.from(String(a));
    }

    if (!Buffer.isBuffer(b)) {
        b = Buffer.from(String(b));
    }

    if (a.length !== b.length) {
        return false;
    }

    return crypto.timingSafeEqual(a, b);
}

module.exports = {
    randomId,
    constantTimeEqual
};