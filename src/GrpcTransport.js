function isPlainObject(input) {
    return input && input.constructor === Object;
}

module.exports = require("stampit")({
    name: "GrpcTransport",

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
        _validatePackageDefinition(obj = this.packageDefinition, inspectedSet = new Set()) {
            if (!isPlainObject(obj)) return;
            if (inspectedSet.has(obj)) return;
            inspectedSet.add(obj);

            for (const [k, v] of Object.entries(obj)) {
                // Not sure how long this code would survive in modern fast pace days.
                if (k === "responseType") {
                    let f = v.type.field[0];
                    const successOk = f && f.name === "success" && f.type === "TYPE_BOOL";
                    if (!successOk) throw new Error(`Method ${obj.originalName} must return "bool success = 1"`);

                    f = v.type.field[1];
                    const codeOk = f && f.name === "code" && f.type === "TYPE_STRING";
                    if (!codeOk) throw new Error(`Method ${obj.originalName} must return "string code = 2"`);

                    f = v.type.field[2];
                    const messageOk = f && f.name === "message" && f.type === "TYPE_STRING";
                    if (!messageOk) throw new Error(`Method ${obj.originalName} must return "string message = 3"`);
                } else {
                    this._validatePackageDefinition(v, inspectedSet);
                }
            }
        },

        async startServer(defaultCtx) {
            this.server = new this._grpc.Server(this.options);
            async function wrappedCallback(call, callback) {
                const ctx = { ...defaultCtx, arg: call.request, grpc: { call, callback } };
                await ctx.allserver.handleCall(ctx);
            }

            const protoDescriptor = this._grpc.loadPackageDefinition(this.packageDefinition);
            for (const protoPackage of Object.values(protoDescriptor)) {
                if (!isPlainObject(protoPackage)) continue;

                for (const typeOfProto of Object.values(protoPackage)) {
                    if (!(typeof typeOfProto === "function" && isPlainObject(typeOfProto.service))) continue;

                    const proxies = { introspect: wrappedCallback };
                    for (const [name, impl] of Object.entries(defaultCtx.allserver.procedures)) {
                        if (typeof impl == "function") proxies[name] = wrappedCallback;
                    }
                    this.server.addService(typeOfProto.service, proxies);
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
            if (procedureName === "introspect") return "";
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
