const crypto = require("crypto");

const CODE_ALPHABET =
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateCode() {
    let first = "";
    let second = "";

    for (let i = 0; i < 4; i++) {
        first +=
            CODE_ALPHABET[
                crypto.randomInt(
                    0,
                    CODE_ALPHABET.length
                )
            ];

        second +=
            CODE_ALPHABET[
                crypto.randomInt(
                    0,
                    CODE_ALPHABET.length
                )
            ];
    }

    return `${first}-${second}`;
}

function normalizeCode(code) {
    const value =
        String(code || "")
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, "")
            .slice(0, 8);

    if (value.length <= 4) {
        return value;
    }

    return `${value.slice(0, 4)}-${value.slice(4)}`;
}

function codeToKey(code) {
    return crypto
        .createHash("sha256")
        .update(
            `shoriu-p2p:${normalizeCode(code)}`
        )
        .digest();
}

module.exports = {
    generateCode,
    normalizeCode,
    codeToKey
};