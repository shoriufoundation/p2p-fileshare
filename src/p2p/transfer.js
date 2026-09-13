const CHUNK_SIZE = 64 * 1024;

function sendFile(channel, file, onProgress) {

    return new Promise((resolve, reject) => {

        if (!channel || channel.readyState !== "open") {
            reject(new Error("Peer connection is not ready."));
            return;
        }

        const reader = new FileReader();

        let offset = 0;

        const sendNextChunk = () => {

            if (offset >= file.size) {

                channel.send(
                    JSON.stringify({
                        type: "file-end"
                    })
                );

                resolve();

                return;
            }

            const slice =
                file.slice(
                    offset,
                    offset + CHUNK_SIZE
                );

            reader.readAsArrayBuffer(slice);
        };

        reader.onload = () => {

            channel.send(reader.result);

            offset += reader.result.byteLength;

            if (onProgress) {
                onProgress(
                    offset / file.size
                );
            }

            sendNextChunk();
        };

        reader.onerror = () => {
            reject(reader.error);
        };

        channel.send(
            JSON.stringify({
                type: "file-start",

                name: file.name,

                size: file.size,

                mime: file.type || "application/octet-stream"
            })
        );

        sendNextChunk();
    });
}

module.exports = {
    CHUNK_SIZE,
    sendFile
};