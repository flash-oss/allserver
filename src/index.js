module.exports = {
    Allserver: require("./server/Allserver"),
    HttpTransport: require("./server/HttpTransport"),
    GrpcTransport: require("./server/GrpcTransport"),

    AllserverClient: require("./client/AllserverClient"),
    GrpcClientTransport: require("./client/GrpcClientTransport"),
    HttpClientTransport: require("./client/HttpClientTransport"),
};
