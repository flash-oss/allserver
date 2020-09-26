const { isFunction } = require("../util");

module.exports = require("./ClientTransport").compose({
    name: "GrpcClientTransport",

    props: {
        _fs: require("fs"),
        _grpc: require("@grpc/grpc-js"),
        _protoLoader: require("@grpc/proto-loader"),
        _grpcClientForIntrospection: null,
        _grpcClient: null,
    },

    init({ protoFile }) {
        this._createIntrospectionClient();
        if (protoFile) {
            this._createMainClient(protoFile);
        }
    },

    methods: {
        _createIntrospectionClient() {
            this._grpcClientForIntrospection = this._createClientFromCtor(
                this._grpc.loadPackageDefinition(this._protoLoader.loadSync(__dirname + "/../../mandatory.proto"))
                    .Allserver
            );
        },

        _createMainClient(protoFile) {
            const pd = this._grpc.loadPackageDefinition(this._protoLoader.loadSync(protoFile));

            const Ctor = Object.entries(this._grpc.loadPackageDefinition(pd)).find(
                ([k, v]) => isFunction(v) && k !== "Allserver"
            )[1];
            this._grpcClient = this._createClientFromCtor(Ctor && Ctor.service);
        },

        _createClientFromCtor(Ctor) {
            return new Ctor(this.uri.substr(7), this._grpc.credentials.createInsecure());
        },

        _waitForReady(client, delay = 10 * 1000) {
            return new Promise((resolve, reject) =>
                client.waitForReady(Date.now() + delay, (e) => (e ? reject(e) : resolve()))
            );
        },

        async introspect() {
            let result;
            try {
                // Introspection is the first call usually. The server might be unavailable. Let's not wait for too long.
                await this._waitForReady(this._grpcClientForIntrospection, 1000).catch((err) => {});

                result = await new Promise((resolve, reject) =>
                    this._grpcClientForIntrospection.introspect({}, (err, result) =>
                        err ? reject(err) : resolve(result)
                    )
                );
            } catch (err) {
                if (err.code === 14) {
                    // No connection established
                    // There is a bug in @grpc/grpc-js. https://github.com/grpc/grpc-node/issues/1591
                    // It does not try to connect second time.
                    // Recreating the introspection client fixes it. But maaate. I'm so so sad!
                    this._createIntrospectionClient();
                }
                throw err;
            }

            if (result.proto) {
                // Writing to a temporary file because protoLoader.loadSync() supports files only.
                const fileName = require("path").join(
                    require("os").tmpdir(),
                    `grpc-client-${String(Math.random())}.proto`
                );
                this._fs.writeFileSync(fileName, result.proto);
                try {
                    this._createMainClient(fileName);
                } finally {
                    this._fs.unlinkSync(fileName);
                }
            }

            return result;
        },

        async call(procedureName = "", arg) {
            if (!this._grpcClient) {
                throw new Error("MISSING_GRPC_PROTO");
            } else {
                await this._waitForReady(this._grpcClient);
            }
            return new Promise((resolve, reject) =>
                this._grpcClient[procedureName](arg || {}, (err, result) => (err ? reject(err) : resolve(result)))
            );
        },
    },
});
