const { isString, isFunction, isObject } = require("../util");

// Protected variables
const p = Symbol.for("AllserverClient");

function addProceduresToObject(allserverClient, procedures, proxyClient) {
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
        allserverClient[procedureName] = (...args) => allserverClient.call.call(proxyClient, procedureName, ...args);
    }
    return { success: true };
}

function proxyWrappingInitialiser() {
    //
    if (!this[p].dynamicMethods) return;

    // Wrapping our object instance.
    return new Proxy(this, {
        get: function (allserverClient, procedureName, proxyClient) {
            if (procedureName in allserverClient) {
                return Reflect.get(allserverClient, procedureName, proxyClient);
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
                    addProceduresToObject(allserverClient, introspectionResult.procedures, proxyClient);
                    if (procedureName in allserverClient) {
                        // The PREVIOUS auto introspection worked as expected. It added a method to the client object.
                        return Reflect.get(allserverClient, procedureName, proxyClient);
                    } else {
                        // The method `name` was not present in the introspection, so let's call server side.
                        // 🤞
                        return (...args) => allserverClient.call.call(proxyClient, procedureName, ...args);
                    }
                } else {
                    // Ok. Automatic introspection is necessary. Let's do it.
                    return async (...args) => {
                        const introspectionResult = await allserverClient.introspect();

                        if (introspectionResult && introspectionResult.success && introspectionResult.procedures) {
                            // The automatic introspection won't be executed if you create a second instance of the AllserverClient with the same URI! :)
                            const result = addProceduresToObject(
                                allserverClient,
                                introspectionResult.procedures,
                                proxyClient
                            );
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
                            return Reflect.get(allserverClient, procedureName, proxyClient)(...args);
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
                                // Server is still reachable. It's just introspection didn't work, so let's call server side.
                                // 🤞
                                return allserverClient.call.call(proxyClient, procedureName, ...args);
                            }
                        }
                    };
                }
            } else {
                // Automatic introspection is disabled or impossible. Well... good luck. :)
                // Most likely this call would be successful. Unless client and server interfaces are incompatible.
                // 🤞
                return (...args) => allserverClient.call.call(proxyClient, procedureName, ...args);
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
            // 'before' middlewares. Invoked before calling server procedure.
            before: [],
            // 'after' middlewares. Invoked after calling server procedure.
            after: [],
        },
    },

    deepConf: {
        // prettier-ignore
        transports: [
            { schema: "http", get Transport() { return require("./HttpClientTransport"); } },
            { schema: "grpc", get Transport() { return require("./GrpcClientTransport"); } },
        ],
    },

    init({ uri, transport, neverThrow, dynamicMethods, autoIntrospect, nameMapper, before, after }, { stamp }) {
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

        if (before) this[p].before = [].concat(before).concat(this[p].before);
        if (after) this[p].after = [].concat(after).concat(this[p].after);
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
                code: "ALLSERVER_CLIENT_INTROSPECTION_FAILED",
                message: `Couldn't introspect ${this[p].transport.uri}`,
                noNetToServer: Boolean(err.noNetToServer),
                error: err,
            }));
        },

        async _callMiddlewares(ctx, middlewareType) {
            const middlewares = [].concat(this[p][middlewareType]).filter(isFunction);
            for (const middleware of middlewares) {
                try {
                    const result = await middleware.call(this, ctx);
                    if (result !== undefined) {
                        ctx.result = result;
                        break;
                    }
                } catch (err) {
                    if (!this[p].neverThrow) throw err;

                    let { code, message } = err;
                    if (!code) {
                        code = "ALLSERVER_CLIENT_MIDDLEWARE_ERROR";
                        message = `The '${middlewareType}' middleware error while calling '${ctx.procedureName}' procedure`;
                    }
                    ctx.result = { success: false, code, message, error: err };
                    return;
                }
            }
        },

        async call(procedureName, arg) {
            const transport = this[p].transport;
            const defaultCtx = { procedureName, arg, client: this };
            const ctx = transport.createCallContext(defaultCtx);

            await this._callMiddlewares(ctx, "before");

            if (!ctx.result) {
                try {
                    ctx.result = await transport.call(ctx);
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

            await this._callMiddlewares(ctx, "after");

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
        defaults({ transport, neverThrow, dynamicMethods, autoIntrospect, nameMapper, before, after } = {}) {
            if (before) before = [].concat(before);
            if (after) after = [].concat(after);
            return this.deepProps({
                [p]: { transport, neverThrow, dynamicMethods, autoIntrospect, nameMapper, before, after },
            });
        },
    },
});
