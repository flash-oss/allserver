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
        this._grpcClientForIntrospection = this._createClientFromCtor(
            this._grpc.loadPackageDefinition(this._protoLoader.loadSync(__dirname + "/../../mandatory.proto")).Allserver
        );
        if (protoFile) {
            this._createMainClient(protoFile);
            this.autoIntrospect = false;
        }
    },

    methods: {
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

        async introspect() {
            const result = await new Promise((resolve, reject) =>
                this._grpcClientForIntrospection.introspect({}, (err, result) => (err ? reject(err) : resolve(result)))
            );

            if (this.autoIntrospect && result.proto) {
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
            return new Promise((resolve, reject) =>
                this._grpcClient[procedureName](arg || {}, (err, result) => (err ? reject(err) : resolve(result)))
            );
        },
    },
});
