const { isString, isFunction, isObject } = require("../util");

// Protected variables
const p = Symbol.for("AllserverClient");

function addProceduresToObject(allserverClient, procedures) {
    let error;
    try {
        procedures = JSON.parse(procedures);
    } catch (err) {
        error = err;
    }
    if (error || !isObject(procedures)) {
        const result = {
            success: false,
            code: "ALLSERVER_MALFORMED_INTROSPECTION",
            message: `Malformed introspection from ${allserverClient[p].transport.uri}`,
        };
        if (error) result.error = error;
        return result;
    }

    const nameMapper = isFunction(allserverClient[p].nameMapper) ? allserverClient[p].nameMapper : null;
    for (let [procedureName, type] of Object.entries(procedures)) {
        if (nameMapper) procedureName = nameMapper(procedureName);
        if (!procedureName || type !== "function" || allserverClient[procedureName]) continue;
        allserverClient[procedureName] = (...args) => allserverClient.call(procedureName, ...args);
    }
    return { success: true };
}

function proxyWrappingInitialiser() {
    //
    if (!this[p].dynamicMethods) return;

    // Wrapping our object instance.
    return new Proxy(this, {
        get: function (allserverClient, procedureName, thisContext) {
            if (procedureName in allserverClient) {
                return Reflect.get(allserverClient, procedureName, thisContext);
            }

            // Method not found!
            // Checking if automatic introspection is disabled or impossible.
            const uri = allserverClient[p].transport.uri;
            if (allserverClient[p].autoIntrospect && uri) {
                const introspectionCache = allserverClient.__proto__._introspectionCache;
                // Let's see if we already introspected that server.
                const introspectionResult = introspectionCache.get(uri);
                if (introspectionResult && introspectionResult.success && introspectionResult.procedures) {
                    // Yeah. We already successfully introspected it.
                    addProceduresToObject(allserverClient, introspectionResult.procedures);
                    if (procedureName in allserverClient) {
                        // The PREVIOUS auto introspection worked as expected. It added a method to the client object.
                        return Reflect.get(allserverClient, procedureName, thisContext);
                    } else {
                        // The method `name` was not present in the introspection, so let's call server side.
                        // 🤞
                        return (...args) => allserverClient.call(procedureName, ...args);
                    }
                } else {
                    // Ok. Automatic introspection is necessary. Let's do it.
                    return async (...args) => {
                        const introspectionResult = await allserverClient.introspect();

                        if (introspectionResult && introspectionResult.success && introspectionResult.procedures) {
                            // The automatic introspection won't be executed if you create a second instance of the AllserverClient with the same URI! :)
                            const result = addProceduresToObject(allserverClient, introspectionResult.procedures);
                            if (result.success) {
                                introspectionCache.set(uri, introspectionResult);
                            } else {
                                // Couldn't apply introspection to the client object.
                                return result;
                            }
                        }

                        if (procedureName in allserverClient) {
                            // This is the main happy path.
                            // The auto introspection worked as expected. It added a method to the client object.
                            return Reflect.get(allserverClient, procedureName, thisContext)(...args);
                        } else {
                            if (introspectionResult && introspectionResult.noNetToServer) {
                                return {
                                    success: false,
                                    code: "ALLSERVER_PROCEDURE_UNREACHABLE",
                                    message: `Couldn't reach remote procedure: ${procedureName}`,
                                    noNetToServer: introspectionResult.noNetToServer,
                                    error: introspectionResult.error,
                                };
                            } else {
                                // Server is still reachable. It's just introspection didn't work.
                                // The method `name` is not present in the introspection, so let's call server side.
                                // 🤞
                                return allserverClient.call(procedureName, ...args);
                            }
                        }
                    };
                }
            } else {
                // Automatic introspection is disabled or impossible. Well... good luck. :)
                // Most likely this call would be successful. Unless client and server are incompatible.
                // 🤞
                return (...args) => allserverClient.call(procedureName, ...args);
            }
        },
    });
}

module.exports = require("stampit")({
    name: "AllserverClient",

    deepProps: {
        // Protected variables
        [p]: {
            // The protocol implementation strategy.
            transport: null,
            // Disable any exception throwing when calling any methods. Otherwise, throws on "not found" and "can't reach server".
            neverThrow: true,
            // Automatically call corresponding remote procedure, even if such method does not exist on this client object.
            dynamicMethods: true,
            // Try automatically fetch and assign methods to this client object.
            autoIntrospect: true,
            // Map/filter procedure names from server names to something else.
            nameMapper: null,
        },
    },

    deepConf: {
        // prettier-ignore
        transports: [
            { schema: "http", get Transport() { return require("./HttpClientTransport"); } },
            { schema: "grpc", get Transport() { return require("./GrpcClientTransport"); } },
        ],
    },

    init({ uri, transport, neverThrow, dynamicMethods, autoIntrospect, nameMapper }, { stamp }) {
        this[p].neverThrow = neverThrow != null ? neverThrow : this[p].neverThrow;
        this[p].dynamicMethods = dynamicMethods != null ? dynamicMethods : this[p].dynamicMethods;
        this[p].autoIntrospect = autoIntrospect != null ? autoIntrospect : this[p].autoIntrospect;
        this[p].nameMapper = nameMapper != null ? nameMapper : this[p].nameMapper;

        this[p].transport = transport || this[p].transport;
        if (!this[p].transport) {
            if (!isString(uri)) throw new Error("`uri` connection string is required");

            const transportConfig = stamp.compose.deepConfiguration.transports.find(({ schema }) =>
                uri.startsWith(schema)
            );
            if (!transportConfig) throw new Error(`Schema not supported: ${uri}`);

            this[p].transport = transportConfig.Transport({ uri });
        }
    },

    methods: {
        async introspect() {
            // This is supposed to be executed only once (per uri) unless it throws.
            // There are only 3 situations when this throws:
            // * the "introspect" method not found on server,
            // * the network request is malformed,
            // * couldn't connect to the remote host.
            return Promise.resolve(this[p].transport.introspect()).catch((err) => ({
                success: false,
                code: "INTROSPECTION_FAILED",
                message: `Couldn't introspect ${this[p].transport.uri}`,
                noNetToServer: Boolean(err.noNetToServer),
                error: err,
            }));
        },

        async call(procedureName, arg) {
            const ctx = { procedureName, arg, client: this };
            const transport = this[p].transport;
            if (isFunction(transport.before)) {
                try {
                    const result = await transport.before(ctx);
                    if (result) ctx.result = result;
                } catch (err) {
                    if (!this[p].neverThrow) throw err;

                    let { code, message } = err;
                    if (!code) {
                        code = "ALLSERVER_CLIENT_BEFORE_ERROR";
                        message = `The 'before' middleware threw while calling: ${ctx.procedureName}`;
                    }
                    ctx.result = { success: false, code, message, error: err };
                }
            }

            if (!ctx.result) {
                try {
                    ctx.result = await transport.call(ctx.procedureName, ctx.arg);
                } catch (err) {
                    if (!this[p].neverThrow) throw err;

                    let { code, message } = err;
                    if (!err.code || err.noNetToServer) {
                        code = "ALLSERVER_PROCEDURE_UNREACHABLE";
                        message = `Couldn't reach remote procedure: ${ctx.procedureName}`;
                    }
                    ctx.result = { success: false, code, message, error: err };
                }
            }

            if (isFunction(transport.after)) {
                try {
                    const result = await transport.after(ctx);
                    if (result) ctx.result = result;
                } catch (err) {
                    if (!this[p].neverThrow) throw err;

                    let { code, message } = err;
                    if (!code) {
                        code = "ALLSERVER_CLIENT_AFTER_ERROR";
                        message = `The 'after' middleware threw while calling: ${ctx.procedureName}`;
                    }
                    ctx.result = { success: false, code, message, error: err };
                }
            }

            return ctx.result;
        },
    },

    composers({ stamp }) {
        const { initializers, methods } = stamp.compose;
        // Keep our initializer the last to return proxy object instead of the client object.
        const index = initializers.indexOf(proxyWrappingInitialiser);
        if (index >= 0) initializers.splice(index, 1);
        initializers.push(proxyWrappingInitialiser);

        // We keep this cache in __proto__ because we want only one introspection call per multiple client objects made from this factory
        methods._introspectionCache = new Map();
    },

    statics: {
        defaults({ transport, neverThrow, dynamicMethods, autoIntrospect, nameMapper } = {}) {
            return this.deepProps({ [p]: { transport, neverThrow, dynamicMethods, autoIntrospect, nameMapper } });
        },
    },
});
