// Using getters all over the place to avoid loading files which won't be used.
module.exports = {
    // server

    get Allserver() {
        return require("./server/Allserver");
    },
    get Transport() {
        return require("./server/Transport");
    },
    get HttpTransport() {
        return require("./server/HttpTransport");
    },
    get ExpressTransport() {
        return require("./server/ExpressTransport");
    },
    get LambdaTransport() {
        return require("./server/LambdaTransport");
    },
    get GrpcTransport() {
        return require("./server/GrpcTransport");
    },
    get BullmqTransport() {
        return require("./server/BullmqTransport");
    },

    // client

    get AllserverClient() {
        return require("./client/AllserverClient");
    },
    get ClientTransport() {
        return require("./client/ClientTransport");
    },
    get HttpClientTransport() {
        return require("./client/HttpClientTransport");
    },
    get GrpcClientTransport() {
        return require("./client/GrpcClientTransport");
    },
    get BullmqClientTransport() {
        return require("./client/BullmqClientTransport");
    },
};
