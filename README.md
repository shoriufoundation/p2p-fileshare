# Shoriu P2P FileShare

> **Fast. Private. Peer-to-Peer.**

Shoriu P2P FileShare is a decentralized file-sharing system built with **Node.js** and **WebRTC**.

Transfer files directly between peers without uploading them to a central storage service.

**Your files stay between you and the person you're sending them to.**

---

## ✨ Features

* ⚡ **Direct P2P transfers** powered by WebRTC
* 🔐 **Encrypted WebRTC DataChannel** communication
* 🚫 **No file storage** on the signaling server
* 🛰️ **Minimal signaling** — only connection metadata is exchanged
* 🔑 **Short connection codes** for easy peer discovery
* 🧠 **In-memory sessions** with automatic expiration
* 📦 Large-file transfer with chunking and backpressure
* 🛡️ Basic rate limiting and session protection
* 🌐 STUN/TURN support for NAT traversal
* 🖥️ Works directly from a modern web browser
* 🏠 Designed to be **self-hosted**

---

## 🧩 How It Works

Shoriu P2P FileShare separates **signaling** from the actual file transfer.

```
             ┌──────────────────────┐
             │   Shoriu Signaling   │
             │       Server         │
             │                      │
             │  SDP / ICE Metadata  │
             └──────────┬───────────┘
                        │
                Connection Setup
                        │
          ┌─────────────┴─────────────┐
          │                           │
          ▼                           ▼
   ┌──────────────┐           ┌──────────────┐
   │     Peer A   │◄─────────►│     Peer B   │
   │              │  WebRTC   │              │
   │   Sender     │ DataChannel│  Receiver   │
   └──────────────┘           └──────────────┘
             │
             │
       Direct Transfer
```

The signaling server **does not receive or store the files**.

It only helps two peers establish their WebRTC connection.

Once the connection is established, the file travels directly between the peers whenever the network topology allows it.

---

## 🔒 Privacy by Design

Shoriu P2P FileShare is designed around a simple principle:

> **The server should not need your files.**

The signaling layer handles connection establishment rather than acting as a file-storage or file-relay service.

### The signaling server handles

* Connection codes
* WebRTC SDP offers
* WebRTC SDP answers
* ICE connection metadata
* Temporary session state

### The signaling server does **not** handle

* File contents
* Uploaded files
* Permanent file storage
* File archives
* User accounts
* Persistent transfer history

Sessions are kept in memory and automatically expire.

---

## 🌐 NAT Traversal

WebRTC connections can be affected by NATs, firewalls, and restrictive networks.

The project supports:

* STUN
* TURN
* UDP candidates
* TCP candidates
* TLS-based TURN connections

For reliable deployments, a self-hosted **TURN server** such as coturn is recommended.

---

## 🚀 Getting Started

### Requirements

* Node.js 18+
* npm
* A modern WebRTC-compatible browser

### Install

```
git clone https://github.com/shoriufoundation/p2p-fileshare.git
cd p2p-fileshare
npm install
```

### Configuration

Create a `.env` file:

```
PORT=3000

TURN_HOST=turn.example.com
TURN_PORT=3478
TURN_TLS_PORT=5349

TURN_SECRET=change-this-secret
TURN_TTL=3600
```

### Start

```
npm start
```

Development mode:

```
npm run dev
```

The server will listen on:

```
http://localhost:3000
```

---

## 🔗 Connection Flow

### Sender

1. Open Shoriu P2P FileShare.
2. Create a transfer session.
3. Receive a short connection code.
4. Share the code with the receiver.
5. Select a file.
6. Start the transfer.

### Receiver

1. Open Shoriu P2P FileShare.
2. Enter the connection code.
3. Establish the WebRTC connection.
4. Accept the incoming file.
5. Download the received file.

No account is required.

---

## 🏗️ Architecture

```
Browser
   │
   │ HTTPS
   ▼
Node.js Signaling Server
   │
   ├── Session Management
   ├── SDP Signaling
   ├── ICE Signaling
   ├── Rate Limiting
   └── Temporary In-Memory State
          │
          │ WebRTC
          ▼
     Peer-to-Peer
     DataChannel
          │
          ▼
      File Transfer
```

The Node.js server is **not intended to be the file-transfer backend**.

Its primary purpose is connection coordination.

---

## 📦 File Transfer

Files are transferred through a WebRTC `RTCDataChannel`.

Large files are divided into chunks and transmitted with backpressure control to prevent excessive memory and buffer usage.

The receiver reconstructs the file locally and generates a downloadable object in the browser.

---

## 🛡️ Security Considerations

WebRTC DataChannels use the security mechanisms provided by WebRTC, including DTLS encryption.

However, encryption does **not** automatically mean that every peer is trustworthy.

Treat connection codes as private.

Anyone who obtains an active connection code may potentially attempt to join its associated session.

For public deployments, HTTPS and a properly configured TURN server are strongly recommended.

---

## 🧪 Project Status

Shoriu P2P FileShare is actively being developed.

Current focus areas include:

* [x] WebRTC peer connections
* [x] Short connection codes
* [x] Temporary signaling sessions
* [x] Direct DataChannel file transfer
* [x] Chunked transfers
* [x] Backpressure handling
* [x] Session expiration
* [x] Basic rate limiting
* [x] STUN support
* [ ] Production TURN deployment
* [ ] Transfer progress improvements
* [ ] Resumable transfers
* [ ] Optional end-to-end integrity verification
* [ ] DHT-based peer discovery

---

## 🤝 Philosophy

Shoriu P2P FileShare is built around a decentralized approach to file sharing.

No unnecessary accounts.

No permanent transfer history.

No centralized file bucket.

No requirement to upload your files to someone else's storage.

Just:

```
Connect → Transfer → Disconnect
```

---

## 🏛️ Shoriu Foundation

Shoriu P2P FileShare is developed and maintained by **Shoriu Foundation**.

**Website**

https://shoriufoundation.org.az

**Organization**

https://github.com/shoriufoundation

---

## 📜 License

This project and its associated materials are protected under the **Shoriu Foundation License**.

https://license.shoriufoundation.org.az

See the project's `LICENSE` file for the complete terms.