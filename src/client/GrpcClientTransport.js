module.exports = require("stampit")({
    name: "GrpcClientTransport",

    props: {
        _fs: require("fs"),
        _grpc: require("@grpc/grpc-js"),
        _protoLoader: require("@grpc/proto-loader"),
        _grpcClientForIntrospection: null,
        _grpcClient: null,
        uri: null,
    },

    init({ uri }) {
        this.uri = uri || this.uri;
        this._grpcClientForIntrospection = this._createGrpcClient(
            this._grpc.loadPackageDefinition(this._protoLoader.loadSync(__dirname + "/../mandatory.proto")).Allserver
        );
    },

    methods: {
        _createGrpcClient(Ctor) {
            const client = new Ctor(this.uri.substr(7), this._grpc.credentials.createInsecure());

            const { promisify } = require("util");
            for (const k in client) {
                if (typeof client[k] === "function") {
                    client[k] = promisify(client[k].bind(client));
                }
            }

            return client;
        },

        async introspect() {
            const result = await this._grpcClientForIntrospection.introspect({});

            if (result.proto) {
                const fileName = require("path").join(
                    require("os").tmpdir(),
                    `grpc-client-${String(Math.random())}.proto`
                );
                this._fs.writeFileSync(fileName, result.proto);
                const pd = this._grpc.loadPackageDefinition(this._protoLoader.loadSync(fileName));
                this._fs.unlinkSync(fileName);
                const Ctor = Object.entries(this._grpc.loadPackageDefinition(pd)).find(
                    ([k, v]) => typeof v === "function" && k !== "Allserver"
                )[1];
                this._grpcClient = this._createGrpcClient(Ctor && Ctor.service);
            }
            return result;
        },

        async call(procedureName = "", arg) {
            return this._grpcClient[procedureName](arg || {});
        },
    },
});
