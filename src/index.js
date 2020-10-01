// Using getters all over the place to avoid loading files which won't be used.
module.exports = {
    // server

    get Allserver() {
        return require("./server/Allserver");
    },
    get HttpTransport() {
        return require("./server/HttpTransport");
    },
    get LambdaTransport() {
        return require("./server/LambdaTransport");
    },
    get GrpcTransport() {
        return require("./server/GrpcTransport");
    },

    // client

    get AllserverClient() {
        return require("./client/AllserverClient");
    },
    get GrpcClientTransport() {
        return require("./client/GrpcClientTransport");
    },
    get HttpClientTransport() {
        return require("./client/HttpClientTransport");
    },
};
