function isPlainObject(input) {
    return input != null && Object.getPrototypeOf(input).isPrototypeOf(Object);
}

module.exports = require("stampit")({
    name: "GrpcProtocol",

    props: {
        _grpc: require("@grpc/grpc-js"),
        port: process.env.PORT,
        packageDefinition: null,
        options: null,
    },

    init({ port, packageDefinition, options }) {
        if (port) this.port = port;
        if (packageDefinition) this.packageDefinition = packageDefinition;
        if (options) this.options = options;
    },

    methods: {
        async startServer(defaultCtx) {
            this.server = new this._grpc.Server(this.options);

            const protoDescriptor = this._grpc.loadPackageDefinition(this.packageDefinition);
            for (const [packageName, protoPackage] of Object.entries(protoDescriptor)) {
                if (isPlainObject(protoPackage)) {
                    for (const [name, typeOfProto] of Object.entries(protoPackage)) {
                        if (typeof typeOfProto === "function" && isPlainObject(typeOfProto.service)) {
                            const proxies = {
                                Introspect: async (call, callback) => {
                                    const ctx = { ...defaultCtx, arg: call.request, grpc: { call, callback } };
                                    await ctx.allserver.handleCall(ctx);
                                },
                            };
                            for (const [name, impl] of Object.entries(defaultCtx.allserver.procedures)) {
                                proxies[name] = async (call, callback) => {
                                    const ctx = { ...defaultCtx, arg: call.request, grpc: { call, callback } };
                                    await ctx.allserver.handleCall(ctx);
                                };
                            }
                            this.server.addService(typeOfProto.service, proxies);
                        }
                    }
                }
            }

            await new Promise((resolve, reject) => {
                this.server.bindAsync(
                    `0.0.0.0:${this.port}`,
                    this._grpc.ServerCredentials.createInsecure(),
                    (err, result) => (err ? reject(err) : resolve(result))
                );
            });
            this.server.start();
        },

        getProcedureName(ctx) {
            const procedureName = ctx.grpc.call.call.handler.path.split("/").pop();
            if (procedureName === "Introspect") return "";
            return procedureName;
        },

        prepareNotFoundReply(ctx) {
            ctx.result = { success: false, code: "NOT_FOUND", message: `Procedure ${ctx.procedureName} not found` };
        },
        prepareProcedureErrorReply(ctx) {
            ctx.result = { success: false, code: ctx.error.code || "PROCEDURE_ERROR", message: ctx.error.message };
        },
        prepareIntrospectionReply(ctx) {
            ctx.result = {
                success: true,
                code: "OK",
                message: "Introspection as JSON string",
                procedures: JSON.stringify(ctx.introspection),
            };
        },

        reply(ctx) {
            ctx.grpc.callback(null, ctx.result);
        },
    },
});
