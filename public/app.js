const home = document.getElementById("home");
const createPanel = document.getElementById("createPanel");
const joinPanel = document.getElementById("joinPanel");
const transferPanel = document.getElementById("transferPanel");

const createBtn = document.getElementById("createBtn");
const joinBtn = document.getElementById("joinBtn");

const offerCode = document.getElementById("offerCode");
const copyOfferBtn = document.getElementById("copyOfferBtn");

const offerInput = document.getElementById("offerInput");
const connectBtn = document.getElementById("connectBtn");

const answerContainer = document.getElementById("answerContainer");
const answerCode = document.getElementById("answerCode");

const createStatus = document.getElementById("createStatus");

const selectBtn = document.getElementById("selectBtn");
const fileInput = document.getElementById("fileInput");
const dropZone = document.getElementById("dropZone");
const fileList = document.getElementById("fileList");


/* =========================================================
   STATE
========================================================= */

let peer = null;
let channel = null;

let sessionCode = null;

let receivedFile = null;

let pollingTimer = null;
let connectionTimeout = null;
let iceGatheringTimeout = null;

let sendQueue = Promise.resolve();

let RTC_CONFIG = {
    iceServers: []
};

let isCleaningUp = false;


/* =========================================================
   CONSTANTS
========================================================= */

const SESSION_TIMEOUT = 10 * 60 * 1000;

const ICE_TIMEOUT = 15 * 1000;
const ICE_CONFIG_TIMEOUT = 10 * 1000;
const CONNECTION_TIMEOUT = 120 * 1000;

const BUFFER_HIGH = 8 * 1024 * 1024;
const BUFFER_LOW = 2 * 1024 * 1024;

const CHUNK_SIZE = 64 * 1024;


/* =========================================================
   API
========================================================= */

async function api(url, options = {}) {
    const response = await fetch(url, {
        ...options,

        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
        },

        cache: "no-store"
    });

    const data = await response
        .json()
        .catch(() => ({}));

    if (!response.ok) {
        throw new Error(
            data.error || `HTTP ${response.status}`
        );
    }

    return data;
}


/* =========================================================
   ICE CONFIG
========================================================= */

async function loadIceConfig() {
    console.log("[WEBRTC] Loading ICE configuration...");

    const controller = new AbortController();

    const timeout = setTimeout(() => {
        controller.abort();
    }, ICE_CONFIG_TIMEOUT);

    try {
        const response = await fetch(
            `/api/ice-config?t=${Date.now()}`,
            {
                method: "GET",
                cache: "no-store",
                signal: controller.signal
            }
        );

        const data = await response
            .json()
            .catch(() => ({}));

        if (!response.ok) {
            throw new Error(
                data.error || `HTTP ${response.status}`
            );
        }

        if (
            !data ||
            !Array.isArray(data.iceServers)
        ) {
            throw new Error(
                "Invalid ICE configuration received from server."
            );
        }

        RTC_CONFIG = {
            iceServers: data.iceServers,

            iceTransportPolicy:
                data.iceTransportPolicy || "all",

            bundlePolicy:
                data.bundlePolicy || "max-bundle",

            rtcpMuxPolicy:
                data.rtcpMuxPolicy || "require",

            iceCandidatePoolSize:
                Number.isInteger(data.iceCandidatePoolSize)
                    ? data.iceCandidatePoolSize
                    : 10
        };

        console.log(
            "[WEBRTC] ICE configuration loaded:",
            RTC_CONFIG
        );

        return RTC_CONFIG;
    }
    catch (error) {
        console.error(
            "[WEBRTC] Failed to load ICE configuration:",
            error
        );

        /*
         * Fallback.
         *
         * This allows direct WebRTC connections to continue
         * working even if /api/ice-config is unavailable.
         */
        RTC_CONFIG = {
            iceServers: [
                {
                    urls: [
                        "stun:stun.l.google.com:19302",
                        "stun:stun1.l.google.com:19302",
                        "stun:stun.cloudflare.com:3478"
                    ]
                }
            ],

            iceTransportPolicy: "all",
            bundlePolicy: "max-bundle",
            rtcpMuxPolicy: "require",
            iceCandidatePoolSize: 10
        };

        console.warn(
            "[WEBRTC] Using public STUN fallback."
        );

        return RTC_CONFIG;
    }
    finally {
        clearTimeout(timeout);
    }
}


/* =========================================================
   CREATE TRANSFER
========================================================= */

if (createBtn) {
    createBtn.addEventListener(
        "click",
        createTransfer
    );
}


async function createTransfer() {
    try {
        resetConnection();

        isCleaningUp = false;

        if (home) {
            home.classList.add("hidden");
        }

        if (createPanel) {
            createPanel.classList.remove("hidden");
        }

        if (createStatus) {
            createStatus.textContent =
                "Preparing network connection...";
        }

        /*
         * Load self-hosted STUN/TURN configuration.
         */
        await loadIceConfig();

        if (createStatus) {
            createStatus.textContent =
                "Creating secure connection...";
        }

        /*
         * Create signaling session.
         */
        const session = await api(
            "/api/session",
            {
                method: "POST"
            }
        );

        sessionCode = session.code;

        if (offerCode) {
            offerCode.textContent = sessionCode;
        }

        if (createStatus) {
            createStatus.textContent =
                "Creating peer connection...";
        }

        /*
         * Create WebRTC peer.
         */
        peer = createPeer();

        /*
         * Create DataChannel.
         */
        channel = peer.createDataChannel(
            "files",
            {
                ordered: true
            }
        );

        setupChannel();

        /*
         * Create SDP offer.
         */
        if (createStatus) {
            createStatus.textContent =
                "Creating connection offer...";
        }

        const offer = await peer.createOffer();

        await peer.setLocalDescription(offer);

        /*
         * Wait until ICE gathering is complete.
         */
        if (createStatus) {
            createStatus.textContent =
                "Preparing network connection...";
        }

        await waitForIceGathering();

        /*
         * Publish complete SDP.
         */
        await api(
            `/api/session/${encodeURIComponent(sessionCode)}/offer`,
            {
                method: "POST",

                body: JSON.stringify(
                    peer.localDescription
                )
            }
        );

        console.log(
            "[SIGNALING] Offer published."
        );

        if (createStatus) {
            createStatus.textContent =
                "Waiting for the other device...";
        }

        startConnectionTimeout();

        /*
         * Poll for answer.
         */
        pollForAnswer();
    }
    catch (error) {
        console.error(
            "[CREATE]",
            error
        );

        showConnectionError(
            error.message ||
            "Failed to create connection."
        );

        alert(
            error.message ||
            "Failed to create connection."
        );
    }
}


/* =========================================================
   JOIN BUTTON
========================================================= */

if (joinBtn) {
    joinBtn.addEventListener(
        "click",
        () => {
            if (home) {
                home.classList.add("hidden");
            }

            if (joinPanel) {
                joinPanel.classList.remove("hidden");
            }

            if (offerInput) {
                setTimeout(() => {
                    offerInput.focus();
                }, 50);
            }
        }
    );
}


/* =========================================================
   CONNECT BUTTON
========================================================= */

if (connectBtn) {
    connectBtn.addEventListener(
        "click",
        joinTransfer
    );
}


/* =========================================================
   CODE INPUT
========================================================= */

if (offerInput) {
    offerInput.addEventListener(
        "input",
        () => {
            offerInput.value =
                normalizeCode(
                    offerInput.value
                );
        }
    );

    offerInput.addEventListener(
        "keydown",
        event => {
            if (event.key === "Enter") {
                joinTransfer();
            }
        }
    );
}


/* =========================================================
   JOIN TRANSFER
========================================================= */

async function joinTransfer() {
    const code = normalizeCode(
        offerInput
            ? offerInput.value
            : ""
    );

    if (!isValidCode(code)) {
        alert(
            "Invalid connection code.\n\nExample: ABCD-7X9P"
        );

        return;
    }

    try {
        if (connectBtn) {
            connectBtn.disabled = true;
            connectBtn.textContent = "Connecting...";
        }

        /*
         * Load self-hosted STUN/TURN.
         */
        await loadIceConfig();

        /*
         * Wait for the sender's offer.
         */
        const session = await waitForOffer(code);

        if (!session.offer) {
            throw new Error(
                "This connection is not ready yet."
            );
        }

        sessionCode = code;

        /*
         * Create peer.
         */
        peer = createPeer();

        /*
         * Sender created the DataChannel.
         */
        peer.ondatachannel = event => {
            console.log(
                "[DATA] Remote DataChannel received."
            );

            channel = event.channel;

            setupChannel();
        };

        /*
         * Apply sender offer.
         */
        await peer.setRemoteDescription(
            session.offer
        );

        /*
         * Create answer.
         */
        const answer = await peer.createAnswer();

        await peer.setLocalDescription(answer);

        /*
         * Wait for ICE.
         */
        await waitForIceGathering();

        /*
         * Send answer.
         */
        await api(
            `/api/session/${encodeURIComponent(sessionCode)}/answer`,
            {
                method: "POST",

                body: JSON.stringify(
                    peer.localDescription
                )
            }
        );

        console.log(
            "[SIGNALING] Answer published."
        );

        if (answerContainer) {
            answerContainer.classList.remove(
                "hidden"
            );
        }

        if (answerCode) {
            answerCode.textContent =
                "Connection information sent automatically.";
        }

        const status =
            answerContainer
                ? answerContainer.querySelector(".status")
                : null;

        if (status) {
            status.textContent =
                "Connection information sent automatically. Waiting for peer...";
        }

        startConnectionTimeout();
    }
    catch (error) {
        console.error(
            "[JOIN]",
            error
        );

        showConnectionError(
            error.message ||
            "Unable to join transfer."
        );

        alert(
            error.message ||
            "Unable to join transfer."
        );
    }
    finally {
        if (connectBtn) {
            connectBtn.disabled = false;
            connectBtn.textContent = "Connect";
        }
    }
}


/* =========================================================
   WAIT FOR OFFER
========================================================= */

async function waitForOffer(code) {
    const started = Date.now();

    while (
        Date.now() - started <
        CONNECTION_TIMEOUT
    ) {
        try {
            const result = await api(
                `/api/session/${encodeURIComponent(code)}/offer`
            );

            if (result.offer) {
                return result;
            }
        }
        catch (error) {
            console.warn(
                "[SIGNALING] Offer polling:",
                error
            );

            /*
             * If the server explicitly says the session
             * does not exist, stop immediately.
             */
            if (
                error.message &&
                (
                    error.message.includes("not found") ||
                    error.message.includes("expired")
                )
            ) {
                throw error;
            }
        }

        await new Promise(resolve => {
            setTimeout(resolve, 1000);
        });
    }

    throw new Error(
        "Timed out while waiting for the connection offer."
    );
}


/* =========================================================
   CREATE PEER
========================================================= */

function createPeer() {
    console.log(
        "[WEBRTC] Creating RTCPeerConnection..."
    );

    console.log(
        "[WEBRTC] Using ICE servers:",
        RTC_CONFIG.iceServers
    );

    const connection =
        new RTCPeerConnection(
            RTC_CONFIG
        );

    connection.onconnectionstatechange =
        () => {
            const state =
                connection.connectionState;

            console.log(
                "[WEBRTC] Connection:",
                state
            );

            if (state === "connected") {
                clearConnectionTimeout();

                console.log(
                    "[WEBRTC] Connected."
                );

                showConnectedUI();
            }

            if (state === "failed") {
                showConnectionError(
                    "Peer connection failed. Check your STUN/TURN configuration."
                );
            }

            if (state === "disconnected") {
                console.warn(
                    "[WEBRTC] Peer temporarily disconnected."
                );

                /*
                 * Give WebRTC some time to recover.
                 */
                setTimeout(() => {
                    if (connection !== peer) {
                        return;
                    }

                    if (
                        connection.connectionState ===
                        "disconnected"
                    ) {
                        showConnectionError(
                            "Peer disconnected."
                        );
                    }
                }, 5000);
            }

            if (state === "closed") {
                console.log(
                    "[WEBRTC] Connection closed."
                );
            }
        };


    connection.oniceconnectionstatechange =
        () => {
            const state =
                connection.iceConnectionState;

            console.log(
                "[WEBRTC] ICE:",
                state
            );

            if (state === "failed") {
                console.error(
                    "[WEBRTC] ICE failed. TURN relay may be required."
                );
            }

            if (
                state === "connected" ||
                state === "completed"
            ) {
                console.log(
                    "[WEBRTC] ICE path established."
                );
            }
        };


    connection.onicegatheringstatechange =
        () => {
            console.log(
                "[WEBRTC] ICE gathering:",
                connection.iceGatheringState
            );
        };


    connection.onicecandidate =
        event => {
            if (event.candidate) {
                console.log(
                    "[WEBRTC] ICE candidate:",
                    event.candidate.candidate
                );
            }
        };


    connection.onsignalingstatechange =
        () => {
            console.log(
                "[WEBRTC] Signaling state:",
                connection.signalingState
            );
        };


    connection.onicecandidateerror =
        event => {
            console.warn(
                "[WEBRTC] ICE candidate error:",
                {
                    url: event.url,
                    errorCode: event.errorCode,
                    errorText: event.errorText
                }
            );
        };


    return connection;
}


/* =========================================================
   ICE GATHERING
========================================================= */

function waitForIceGathering() {
    return new Promise(resolve => {
        if (!peer) {
            resolve();
            return;
        }

        if (
            peer.iceGatheringState ===
            "complete"
        ) {
            resolve();
            return;
        }

        let finished = false;

        const cleanup = () => {
            if (!peer) {
                return;
            }

            peer.removeEventListener(
                "icegatheringstatechange",
                checkState
            );

            if (iceGatheringTimeout) {
                clearTimeout(
                    iceGatheringTimeout
                );

                iceGatheringTimeout = null;
            }
        };

        const finish = () => {
            if (finished) {
                return;
            }

            finished = true;

            cleanup();

            resolve();
        };

        const checkState = () => {
            if (!peer) {
                finish();
                return;
            }

            if (
                peer.iceGatheringState ===
                "complete"
            ) {
                finish();
            }
        };

        peer.addEventListener(
            "icegatheringstatechange",
            checkState
        );

        iceGatheringTimeout =
            setTimeout(() => {
                console.warn(
                    "[WEBRTC] ICE gathering timeout. Continuing with available candidates."
                );

                finish();
            }, ICE_TIMEOUT);

        checkState();
    });
}


/* =========================================================
   ANSWER POLLING
========================================================= */

async function pollForAnswer() {
    const started = Date.now();

    const check = async () => {
        if (
            !sessionCode ||
            !peer
        ) {
            return;
        }

        if (
            Date.now() - started >
            SESSION_TIMEOUT
        ) {
            showConnectionError(
                "Connection session expired."
            );

            return;
        }

        if (
            peer.connectionState ===
            "connected"
        ) {
            return;
        }

        try {
            const result =
                await api(
                    `/api/session/${encodeURIComponent(sessionCode)}/answer`
                );

            if (result.answer) {
                console.log(
                    "[SIGNALING] Answer received."
                );

                await peer.setRemoteDescription(
                    result.answer
                );

                if (createStatus) {
                    createStatus.textContent =
                        "Answer received. Connecting...";
                }

                return;
            }
        }
        catch (error) {
            console.warn(
                "[SIGNALING] Answer polling:",
                error
            );
        }

        pollingTimer =
            setTimeout(
                check,
                1000
            );
    };

    check();
}


/* =========================================================
   DATA CHANNEL
========================================================= */

function setupChannel() {
    if (!channel) {
        return;
    }

    /*
     * Prevent incorrect Blob handling.
     */
    channel.binaryType = "arraybuffer";

    channel.bufferedAmountLowThreshold =
        BUFFER_LOW;


    channel.onopen = () => {
        console.log(
            "[DATA] Channel opened."
        );

        clearConnectionTimeout();

        if (pollingTimer) {
            clearTimeout(
                pollingTimer
            );

            pollingTimer = null;
        }

        showConnectedUI();
    };


    channel.onclose = () => {
        console.log(
            "[DATA] Channel closed."
        );

        if (!isCleaningUp) {
            showConnectionError(
                "Peer disconnected."
            );
        }
    };


    channel.onerror = error => {
        console.error(
            "[DATA] Channel error:",
            error
        );
    };


    channel.onmessage =
        handleIncomingData;
}


/* =========================================================
   CONNECTED UI
========================================================= */

function showConnectedUI() {
    if (createPanel) {
        createPanel.classList.add(
            "hidden"
        );
    }

    if (joinPanel) {
        joinPanel.classList.add(
            "hidden"
        );
    }

    if (transferPanel) {
        transferPanel.classList.remove(
            "hidden"
        );
    }
}


/* =========================================================
   FILE INPUT
========================================================= */

if (selectBtn) {
    selectBtn.addEventListener(
        "click",
        () => {
            if (fileInput) {
                fileInput.click();
            }
        }
    );
}


if (fileInput) {
    fileInput.addEventListener(
        "change",
        () => {
            const files =
                Array.from(
                    fileInput.files || []
                );

            queueFiles(files);

            fileInput.value = "";
        }
    );
}


/* =========================================================
   DRAG & DROP
========================================================= */

if (dropZone) {
    dropZone.addEventListener(
        "dragover",
        event => {
            event.preventDefault();

            dropZone.classList.add(
                "dragover"
            );
        }
    );


    dropZone.addEventListener(
        "dragleave",
        () => {
            dropZone.classList.remove(
                "dragover"
            );
        }
    );


    dropZone.addEventListener(
        "drop",
        event => {
            event.preventDefault();

            dropZone.classList.remove(
                "dragover"
            );

            const files =
                Array.from(
                    event.dataTransfer.files || []
                );

            queueFiles(files);
        }
    );
}


/* =========================================================
   FILE QUEUE
========================================================= */

function queueFiles(files) {
    if (
        !files ||
        !files.length
    ) {
        return;
    }

    for (
        const file of files
    ) {
        sendQueue =
            sendQueue
                .then(
                    () => sendFile(file)
                )
                .catch(
                    error => {
                        console.error(
                            "[FILE]",
                            error
                        );

                        alert(
                            `Failed to send ${file.name}: ${error.message}`
                        );
                    }
                );
    }
}


/* =========================================================
   SEND FILE
========================================================= */

async function sendFile(file) {
    if (
        !channel ||
        channel.readyState !== "open"
    ) {
        throw new Error(
            "Peer is not connected."
        );
    }

    const safeName =
        sanitizeFileName(
            file.name
        );

    addFileToList(
        safeName,
        file.size,
        "Preparing..."
    );


    /*
     * Send metadata.
     */
    channel.send(
        JSON.stringify({
            type: "file-start",

            name: safeName,

            size: file.size,

            mime:
                file.type ||
                "application/octet-stream"
        })
    );


    let offset = 0;


    while (
        offset <
        file.size
    ) {
        if (
            !channel ||
            channel.readyState !== "open"
        ) {
            throw new Error(
                "Connection closed during transfer."
            );
        }

        await waitForBuffer();


        const chunk =
            await file
                .slice(
                    offset,
                    offset + CHUNK_SIZE
                )
                .arrayBuffer();


        channel.send(chunk);

        offset +=
            chunk.byteLength;


        updateProgress(
            safeName,
            file.size === 0
                ? 1
                : offset / file.size
        );
    }


    /*
     * Mark transfer complete.
     */
    channel.send(
        JSON.stringify({
            type: "file-end"
        })
    );


    updateProgress(
        safeName,
        1
    );


    console.log(
        `[FILE] Sent: ${safeName}`
    );
}


/* =========================================================
   DATA CHANNEL BACKPRESSURE
========================================================= */

function waitForBuffer() {
    if (!channel) {
        return Promise.reject(
            new Error(
                "Data channel unavailable."
            )
        );
    }

    if (
        channel.readyState !==
        "open"
    ) {
        return Promise.reject(
            new Error(
                "Data channel is not open."
            )
        );
    }

    if (
        channel.bufferedAmount <
        BUFFER_HIGH
    ) {
        return Promise.resolve();
    }

    return new Promise(
        (resolve, reject) => {
            let finished = false;

            const cleanup = () => {
                if (!channel) {
                    return;
                }

                channel.removeEventListener(
                    "bufferedamountlow",
                    check
                );

                channel.removeEventListener(
                    "close",
                    closed
                );
            };


            const finish = () => {
                if (finished) {
                    return;
                }

                finished = true;

                cleanup();

                resolve();
            };


            const closed = () => {
                if (finished) {
                    return;
                }

                finished = true;

                cleanup();

                reject(
                    new Error(
                        "Data channel closed."
                    )
                );
            };


            const check = () => {
                if (
                    !channel ||
                    channel.readyState !==
                    "open"
                ) {
                    closed();
                    return;
                }

                if (
                    channel.bufferedAmount <
                    BUFFER_LOW
                ) {
                    finish();
                }
            };


            channel.addEventListener(
                "bufferedamountlow",
                check
            );

            channel.addEventListener(
                "close",
                closed
            );

            check();
        }
    );
}


/* =========================================================
   RECEIVE DATA
========================================================= */

function handleIncomingData(event) {
    /*
     * Control message.
     */
    if (
        typeof event.data ===
        "string"
    ) {
        let message;

        try {
            message =
                JSON.parse(
                    event.data
                );
        }
        catch {
            console.warn(
                "[DATA] Invalid control message."
            );

            return;
        }


        if (
            message.type ===
            "file-start"
        ) {
            startReceiving(
                message
            );

            return;
        }


        if (
            message.type ===
            "file-end"
        ) {
            finishReceiving();

            return;
        }


        console.warn(
            "[DATA] Unknown message:",
            message.type
        );

        return;
    }


    /*
     * Binary chunk.
     */
    if (!receivedFile) {
        console.warn(
            "[DATA] Received binary data without active file."
        );

        return;
    }


    if (
        event.data instanceof
        ArrayBuffer
    ) {
        receiveChunk(
            event.data
        );

        return;
    }


    if (
        event.data instanceof
        Blob
    ) {
        event.data
            .arrayBuffer()
            .then(
                buffer => {
                    receiveChunk(
                        buffer
                    );
                }
            )
            .catch(
                error => {
                    console.error(
                        "[DATA] Failed to read Blob:",
                        error
                    );
                }
            );

        return;
    }


    console.warn(
        "[DATA] Unsupported binary data type."
    );
}


/* =========================================================
   RECEIVE CHUNK
========================================================= */

function receiveChunk(chunk) {
    if (!receivedFile) {
        return;
    }


    /*
     * Don't accept more bytes than
     * the declared file size.
     */
    if (
        receivedFile.received +
        chunk.byteLength >
        receivedFile.size
    ) {
        console.error(
            "[FILE] Received more data than declared size."
        );

        receivedFile = null;

        return;
    }


    receivedFile.chunks.push(
        chunk
    );

    receivedFile.received +=
        chunk.byteLength;


    updateProgress(
        receivedFile.name,

        receivedFile.size === 0
            ? 1
            : Math.min(
                receivedFile.received /
                receivedFile.size,
                1
            )
    );
}


/* =========================================================
   START RECEIVE
========================================================= */

function startReceiving(message) {
    if (receivedFile) {
        console.warn(
            "[FILE] Received new file while another file is active."
        );

        return;
    }


    const size =
        Number(message.size);


    if (
        !Number.isSafeInteger(size) ||
        size < 0
    ) {
        console.warn(
            "[FILE] Invalid file size."
        );

        return;
    }


    const name =
        sanitizeFileName(
            message.name
        );


    receivedFile = {
        name,

        size,

        mime:
            typeof message.mime ===
            "string"
                ? message.mime
                : "application/octet-stream",

        chunks: [],

        received: 0
    };


    addFileToList(
        name,
        size,
        "Receiving..."
    );


    console.log(
        `[FILE] Receiving: ${name} (${formatBytes(size)})`
    );
}


/* =========================================================
   FINISH RECEIVE
========================================================= */

function finishReceiving() {
    if (!receivedFile) {
        console.warn(
            "[FILE] file-end without active file."
        );

        return;
    }


    const file =
        receivedFile;


    /*
     * Verify exact transfer size.
     */
    if (
        file.received !==
        file.size
    ) {
        console.error(
            "[FILE] Incomplete transfer:",
            file.received,
            "/",
            file.size
        );


        updateProgress(
            file.name,

            file.size === 0
                ? 0
                : file.received /
                    file.size
        );


        receivedFile = null;

        return;
    }


    /*
     * Reconstruct Blob.
     */
    const blob =
        new Blob(
            file.chunks,
            {
                type: file.mime
            }
        );


    const url =
        URL.createObjectURL(
            blob
        );


    /*
     * Download link.
     */
    const link =
        document.createElement(
            "a"
        );


    link.href = url;

    link.download = file.name;

    link.textContent =
        `Download ${file.name}`;

    link.className =
        "download";


    if (fileList) {
        fileList.appendChild(
            link
        );
    }


    updateProgress(
        file.name,
        1
    );


    /*
     * Free object URL later.
     */
    setTimeout(
        () => {
            URL.revokeObjectURL(
                url
            );
        },
        60 * 1000
    );


    console.log(
        `[FILE] Received: ${file.name}`
    );


    receivedFile = null;
}


/* =========================================================
   FILE UI
========================================================= */

function addFileToList(
    name,
    size,
    status
) {
    if (!fileList) {
        return;
    }


    const element =
        document.createElement(
            "div"
        );


    element.className =
        "file";


    element.dataset.name =
        name;


    const nameElement =
        document.createElement(
            "span"
        );


    nameElement.textContent =
        name;


    const info =
        document.createElement(
            "span"
        );


    info.className =
        "file-size";


    info.textContent =
        `${formatBytes(size)} · ${status}`;


    element.appendChild(
        nameElement
    );

    element.appendChild(
        info
    );


    fileList.appendChild(
        element
    );
}


function updateProgress(
    name,
    progress
) {
    if (!fileList) {
        return;
    }


    const elements =
        fileList.querySelectorAll(
            ".file"
        );


    for (
        const element of elements
    ) {
        if (
            element.dataset.name !==
            name
        ) {
            continue;
        }


        const percent =
            Math.round(
                Math.max(
                    0,
                    Math.min(
                        progress,
                        1
                    )
                ) * 100
            );


        const info =
            element.querySelector(
                ".file-size"
            );


        if (info) {
            info.textContent =
                `${percent}%`;
        }
    }
}


/* =========================================================
   CONNECTION TIMEOUT
========================================================= */

function startConnectionTimeout() {
    clearConnectionTimeout();

    connectionTimeout =
        setTimeout(
            () => {
                if (
                    !channel ||
                    channel.readyState !==
                    "open"
                ) {
                    showConnectionError(
                        "Connection timed out."
                    );
                }
            },
            CONNECTION_TIMEOUT
        );
}


function clearConnectionTimeout() {
    if (connectionTimeout) {
        clearTimeout(
            connectionTimeout
        );

        connectionTimeout = null;
    }
}


/* =========================================================
   ERROR
========================================================= */

function showConnectionError(
    message
) {
    console.warn(
        "[CONNECTION]",
        message
    );


    if (createStatus) {
        createStatus.textContent =
            message;
    }


    const status =
        answerContainer
            ? answerContainer.querySelector(
                ".status"
            )
            : null;


    if (status) {
        status.textContent =
            message;
    }
}


/* =========================================================
   CONNECTION CODE
========================================================= */

function normalizeCode(code) {
    const value =
        String(code || "")
            .toUpperCase()
            .replace(
                /[^A-Z0-9]/g,
                ""
            )
            .slice(
                0,
                8
            );


    if (
        value.length <=
        4
    ) {
        return value;
    }


    return (
        value.slice(
            0,
            4
        ) +
        "-" +
        value.slice(
            4
        )
    );
}


function isValidCode(code) {
    return /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(
        code
    );
}


/* =========================================================
   FILE NAME SECURITY
========================================================= */

function sanitizeFileName(name) {
    const cleaned =
        String(
            name || "file"
        )
            .replace(
                /[<>:"/\\|?*\x00-\x1F]/g,
                "_"
            )
            .replace(
                /^\.+$/,
                "_"
            )
            .trim();

    return (
        cleaned || "file"
    ).slice(
        0,
        255
    );
}


/* =========================================================
   BYTE FORMAT
========================================================= */

function formatBytes(bytes) {
    if (bytes === 0) {
        return "0 B";
    }


    if (
        !Number.isFinite(bytes)
    ) {
        return "Unknown";
    }


    const units = [
        "B",
        "KB",
        "MB",
        "GB",
        "TB"
    ];


    const index =
        Math.min(
            Math.floor(
                Math.log(bytes) /
                Math.log(1024)
            ),
            units.length - 1
        );


    const value =
        bytes /
        Math.pow(
            1024,
            index
        );


    return (
        value.toFixed(
            index === 0
                ? 0
                : value >= 10
                    ? 1
                    : 2
        ) +
        " " +
        units[index]
    );
}


/* =========================================================
   COPY CONNECTION CODE
========================================================= */

if (copyOfferBtn) {
    copyOfferBtn.addEventListener(
        "click",
        async () => {
            try {
                if (!offerCode) {
                    return;
                }


                const code =
                    offerCode.textContent.trim();


                await navigator.clipboard.writeText(
                    code
                );


                copyOfferBtn.textContent =
                    "Copied!";


                setTimeout(
                    () => {
                        copyOfferBtn.textContent =
                            "Copy";
                    },
                    1500
                );
            }
            catch (error) {
                console.error(
                    "[CLIPBOARD]",
                    error
                );


                /*
                 * Clipboard API may be unavailable
                 * outside a secure context.
                 */
                try {
                    const textarea =
                        document.createElement(
                            "textarea"
                        );

                    textarea.value =
                        offerCode
                            ? offerCode.textContent.trim()
                            : "";

                    textarea.style.position =
                        "fixed";

                    textarea.style.opacity =
                        "0";

                    document.body.appendChild(
                        textarea
                    );

                    textarea.focus();
                    textarea.select();

                    document.execCommand(
                        "copy"
                    );

                    textarea.remove();

                    copyOfferBtn.textContent =
                        "Copied!";

                    setTimeout(
                        () => {
                            copyOfferBtn.textContent =
                                "Copy";
                        },
                        1500
                    );
                }
                catch (fallbackError) {
                    console.error(
                        "[CLIPBOARD FALLBACK]",
                        fallbackError
                    );
                }
            }
        }
    );
}


/* =========================================================
   RESET
========================================================= */

function resetConnection() {
    isCleaningUp = true;


    if (pollingTimer) {
        clearTimeout(
            pollingTimer
        );

        pollingTimer = null;
    }


    clearConnectionTimeout();


    if (iceGatheringTimeout) {
        clearTimeout(
            iceGatheringTimeout
        );

        iceGatheringTimeout = null;
    }


    if (channel) {
        try {
            channel.close();
        }
        catch {}
    }


    if (peer) {
        try {
            peer.close();
        }
        catch {}
    }


    channel = null;

    peer = null;

    sessionCode = null;

    receivedFile = null;

    isCleaningUp = false;
}


/* =========================================================
   CLEANUP
========================================================= */

window.addEventListener(
    "beforeunload",
    () => {
        isCleaningUp = true;

        /*
         * Don't block page unload.
         */
        if (sessionCode) {
            fetch(
                `/api/session/${encodeURIComponent(sessionCode)}`,
                {
                    method: "DELETE",
                    keepalive: true,
                    headers: {
                        "Content-Type":
                            "application/json"
                    }
                }
            ).catch(() => {});
        }

        resetConnection();
    }
);