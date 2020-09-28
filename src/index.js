module.exports = {
    Allserver: require("./server/Allserver"),
    HttpTransport: require("./server/HttpTransport"),
    LambdaTransport: require("./server/LambdaTransport"),
    GrpcTransport: require("./server/GrpcTransport"),

    AllserverClient: require("./client/AllserverClient"),
    GrpcClientTransport: require("./client/GrpcClientTransport"),
    HttpClientTransport: require("./client/HttpClientTransport"),
};
