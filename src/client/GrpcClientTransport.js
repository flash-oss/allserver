const { isFunction } = require("../util");

module.exports = require("./ClientTransport").compose({
    name: "GrpcClientTransport",

    props: {
        _fs: require("node:fs"),
        _grpc: require("@grpc/grpc-js"),
        _protoLoader: require("@grpc/proto-loader"),
        _grpcClientForIntrospection: null,
        _grpcClient: null,
        _credentials: null,
    },

    init({ protoFile, credentials }) {
        this._credentials = credentials || this._credentials || this._grpc.credentials.createInsecure();
        this._createIntrospectionClient();
        if (protoFile) {
            this._createMainClient(protoFile);
        }
    },

    methods: {
        _createIntrospectionClient() {
            if (this._grpcClientForIntrospection) this._grpcClientForIntrospection.close();
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
            if (this._grpcClient) this._grpcClient.close();
            this._grpcClient = this._createClientFromCtor(Ctor && Ctor.service);
        },

        _createClientFromCtor(Ctor) {
            return new Ctor(this.uri.substr(7), this._credentials);
        },

        async introspect(/* ctx */) {
            let result;
            try {
                result = await new Promise((resolve, reject) =>
                    this._grpcClientForIntrospection.introspect({}, (err, result) =>
                        err ? reject(err) : resolve(result)
                    )
                );
            } catch (err) {
                if (err.code === 14) {
                    // No connection established.
                    err.noNetToServer = true;
                    // Recreating the introspection client fixes a bug.
                    this._createIntrospectionClient();
                }
                throw err;
            }

            if (result.proto) {
                // Writing to a temporary file because protoLoader.loadSync() supports files only.
                const fileName = require("path").join(
                    require("os").tmpdir(),
                    `grpc-client-${String(Math.random())}.proto` // The Math.random() does not repeat in billions attempts.
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

        async call({ procedureName = "", arg }) {
            if (!this._grpcClient) {
                const error = new Error("gRPC client was not yet initialised");
                error.code = "ALLSERVER_GRPC_PROTO_MISSING";
                throw error;
            }

            if (!this._grpcClient[procedureName]) {
                const error = new Error(`Procedure '${procedureName}' not found`);
                error.code = "ALLSERVER_PROCEDURE_NOT_FOUND";
                throw error;
            }

            return new Promise((resolve, reject) =>
                this._grpcClient[procedureName](arg || {}, (err, result) => (err ? reject(err) : resolve(result)))
            );
        },

        createCallContext(defaultCtx) {
            return { ...defaultCtx, grpc: {} };
        },
    },
});
