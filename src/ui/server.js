const express = require("express");
const path = require("path");
const crypto = require("crypto");

const {
    generateCode,
    normalizeCode
} = require("../p2p/signaling");

const SESSION_TTL =
    10 * 60 * 1000;

const MAX_BODY_SIZE =
    "256kb";

const TURN_CREDENTIAL_TTL =
    10 * 60;

const sessions =
    new Map();

const rateLimits =
    new Map();


/* =========================
   ENVIRONMENT
========================= */

const STUN_URLS =
    String(
        process.env.STUN_URLS ||
        "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302"
    )
        .split(",")
        .map(value => value.trim())
        .filter(Boolean);


const TURN_URLS =
    String(
        process.env.TURN_URLS ||
        ""
    )
        .split(",")
        .map(value => value.trim())
        .filter(Boolean);


const TURN_SHARED_SECRET =
    process.env.TURN_SHARED_SECRET ||
    "";


/* =========================
   TIME
========================= */

function now() {
    return Date.now();
}


/* =========================
   SESSION CLEANUP
========================= */

function cleanupSessions() {
    const timestamp =
        now();

    for (
        const [code, session]
        of sessions
    ) {
        if (
            timestamp -
            session.createdAt >
            SESSION_TTL
        ) {
            sessions.delete(code);
        }
    }
}


function cleanupRateLimits() {
    const timestamp =
        now();

    for (
        const [ip, data]
        of rateLimits
    ) {
        if (
            timestamp -
            data.startedAt >
            60_000
        ) {
            rateLimits.delete(ip);
        }
    }
}


/* =========================
   RATE LIMIT
========================= */

function rateLimit(
    req,
    res,
    next
) {
    const ip =
        req.ip ||
        req.socket.remoteAddress ||
        "unknown";

    const timestamp =
        now();

    let data =
        rateLimits.get(ip);

    if (
        !data ||
        timestamp -
        data.startedAt >
        60_000
    ) {
        data = {
            startedAt:
                timestamp,

            requests:
                0
        };

        rateLimits.set(
            ip,
            data
        );
    }

    data.requests++;

    if (
        data.requests >
        120
    ) {
        return res
            .status(429)
            .json({
                error:
                    "Too many requests."
            });
    }

    next();
}


/* =========================
   CONNECTION CODE
========================= */

function createUniqueCode() {
    for (
        let i = 0;
        i < 20;
        i++
    ) {
        const code =
            generateCode();

        if (
            !sessions.has(code)
        ) {
            return code;
        }
    }

    throw new Error(
        "Unable to generate a unique connection code."
    );
}


function getSession(code) {
    const normalized =
        normalizeCode(code);

    const session =
        sessions.get(
            normalized
        );

    if (!session) {
        return null;
    }

    if (
        now() -
        session.createdAt >
        SESSION_TTL
    ) {
        sessions.delete(
            normalized
        );

        return null;
    }

    return session;
}


/* =========================
   TURN CREDENTIALS
========================= */

/*
 * coturn shared-secret authentication.
 *
 * username:
 *     <unix-expiration>:p2p
 *
 * password:
 *     base64(HMAC-SHA1(secret, username))
 *
 * The browser only receives a temporary
 * credential valid for a few minutes.
 */

function createTurnCredentials() {
    if (
        !TURN_SHARED_SECRET ||
        !TURN_URLS.length
    ) {
        return null;
    }

    const expiration =
        Math.floor(
            Date.now() /
            1000
        ) +
        TURN_CREDENTIAL_TTL;

    const username =
        `${expiration}:p2p`;

    const password =
        crypto
            .createHmac(
                "sha1",
                TURN_SHARED_SECRET
            )
            .update(username)
            .digest("base64");

    return {
        urls:
            TURN_URLS,

        username,

        credential:
            password
    };
}


/* =========================
   ICE CONFIG
========================= */

function getIceConfig() {
    const iceServers = [];

    if (
        STUN_URLS.length
    ) {
        iceServers.push({
            urls:
                STUN_URLS
        });
    }

    const turn =
        createTurnCredentials();

    if (turn) {
        iceServers.push({
            urls:
                turn.urls,

            username:
                turn.username,

            credential:
                turn.credential
        });
    }

    return {
        iceServers
    };
}


/* =========================
   SERVER
========================= */

function createServer(port) {
    const app =
        express();

    const publicDir =
        path.join(
            __dirname,
            "../../public"
        );


    app.disable(
        "x-powered-by"
    );


    app.set(
        "trust proxy",
        false
    );


    app.use(
        express.json({
            limit:
                MAX_BODY_SIZE
        })
    );


    app.use(
        rateLimit
    );


    /*
     * Static files
     */

    app.use(
        express.static(
            publicDir,
            {
                extensions: [
                    "html"
                ]
            }
        )
    );


    /* =========================
       ICE CONFIG
    ========================= */

    app.get(
        "/api/ice-config",
        (req, res) => {
            res.set(
                "Cache-Control",
                "no-store"
            );

            res.json(
                getIceConfig()
            );
        }
    );


    /* =========================
       CREATE SESSION
    ========================= */

    app.post(
        "/api/session",
        (req, res) => {
            try {
                const code =
                    createUniqueCode();

                sessions.set(
                    code,
                    {
                        code,

                        createdAt:
                            now(),

                        offer:
                            null,

                        answer:
                            null
                    }
                );

                res
                    .status(201)
                    .json({
                        code,

                        expiresIn:
                            SESSION_TTL
                    });
            }
            catch (error) {
                console.error(
                    "[SIGNALING] Session creation failed:",
                    error
                );

                res
                    .status(500)
                    .json({
                        error:
                            "Unable to create session."
                    });
            }
        }
    );


    /* =========================
       POST OFFER
    ========================= */

    app.post(
        "/api/session/:code/offer",
        (req, res) => {
            const session =
                getSession(
                    req.params.code
                );

            if (!session) {
                return res
                    .status(404)
                    .json({
                        error:
                            "Session not found."
                    });
            }

            if (
                session.offer
            ) {
                return res
                    .status(409)
                    .json({
                        error:
                            "Offer already exists."
                    });
            }

            if (
                !req.body ||
                typeof req.body !==
                    "object"
            ) {
                return res
                    .status(400)
                    .json({
                        error:
                            "Invalid offer."
                    });
            }

            session.offer =
                req.body;

            res.json({
                success:
                    true
            });
        }
    );


    /* =========================
       GET OFFER
    ========================= */

    app.get(
        "/api/session/:code/offer",
        (req, res) => {
            const session =
                getSession(
                    req.params.code
                );

            if (!session) {
                return res
                    .status(404)
                    .json({
                        error:
                            "Session not found."
                    });
            }

            res.json({
                ready:
                    Boolean(
                        session.offer
                    ),

                offer:
                    session.offer ||
                    null
            });
        }
    );


    /* =========================
       POST ANSWER
    ========================= */

    app.post(
        "/api/session/:code/answer",
        (req, res) => {
            const session =
                getSession(
                    req.params.code
                );

            if (!session) {
                return res
                    .status(404)
                    .json({
                        error:
                            "Session not found."
                    });
            }

            if (
                session.answer
            ) {
                return res
                    .status(409)
                    .json({
                        error:
                            "Answer already exists."
                    });
            }

            if (
                !req.body ||
                typeof req.body !==
                    "object"
            ) {
                return res
                    .status(400)
                    .json({
                        error:
                            "Invalid answer."
                    });
            }

            session.answer =
                req.body;

            res.json({
                success:
                    true
            });
        }
    );


    /* =========================
       GET ANSWER
    ========================= */

    app.get(
        "/api/session/:code/answer",
        (req, res) => {
            const session =
                getSession(
                    req.params.code
                );

            if (!session) {
                return res
                    .status(404)
                    .json({
                        error:
                            "Session not found."
                    });
            }

            res.json({
                ready:
                    Boolean(
                        session.answer
                    ),

                answer:
                    session.answer ||
                    null
            });
        }
    );


    /* =========================
       DELETE SESSION
    ========================= */

    app.delete(
        "/api/session/:code",
        (req, res) => {
            const code =
                normalizeCode(
                    req.params.code
                );

            sessions.delete(
                code
            );

            res.json({
                success:
                    true
            });
        }
    );


    /* =========================
       HEALTH
    ========================= */

    app.get(
        "/health",
        (req, res) => {
            res.json({
                status:
                    "ok",

                service:
                    "p2p-fileshare",

                organization:
                    "Shoriu Foundation",

                transfer:
                    "WebRTC",

                signaling:
                    "HTTP polling",

                turn:
                    Boolean(
                        TURN_SHARED_SECRET &&
                        TURN_URLS.length
                    ),

                sessions:
                    sessions.size
            });
        }
    );


    /* =========================
       START
    ========================= */

    const server =
        app.listen(
            port,
            "0.0.0.0",
            () => {
                console.log(
                    "=============================================="
                );

                console.log(
                    "       Shoriu Foundation — P2P FileShare"
                );

                console.log(
                    "=============================================="
                );

                console.log(
                    `Listening on port ${port}`
                );

                console.log(
                    `STUN servers: ${STUN_URLS.length}`
                );

                console.log(
                    `TURN servers: ${TURN_URLS.length}`
                );

                console.log(
                    `TURN enabled: ${Boolean(
                        TURN_SHARED_SECRET &&
                        TURN_URLS.length
                    )}`
                );

                console.log(
                    "=============================================="
                );
            }
        );


    setInterval(
        cleanupSessions,
        60_000
    ).unref();


    setInterval(
        cleanupRateLimits,
        60_000
    ).unref();


    return server;
}


module.exports = {
    createServer
};