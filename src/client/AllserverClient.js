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
            code: "ALLSERVER_CLIENT_MALFORMED_INTROSPECTION",
            message: `Malformed introspection from ${allserverClient[p].transport.uri}`,
        };
        if (error) result.error = error;
        return result;
    }

    const nameMapper = isFunction(allserverClient[p].nameMapper) ? allserverClient[p].nameMapper : (n) => n;
    for (let [procedureName, type] of Object.entries(procedures)) {
        procedureName = nameMapper(procedureName);
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
            if (!allserverClient[p].autoIntrospect || !uri) {
                // Automatic introspection is disabled or impossible. Well... good luck. :)
                // Most likely this call would be successful. Unless client and server interfaces are incompatible.
                // 🤞
                return (...args) => allserverClient.call.call(proxyClient, procedureName, ...args);
            }

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
                    if (allserverClient[p].callIntrospectedProceduresOnly) {
                        return () => ({
                            success: false,
                            code: "ALLSERVER_CLIENT_PROCEDURE_NOT_FOUND",
                            message: `Procedure '${procedureName}' not found via introspection`,
                        });
                    }

                    // The method `name` was not present in the introspection, so let's call server side.
                    // 🤞
                    return (...args) => allserverClient.call.call(proxyClient, procedureName, ...args);
                }
            }

            // Ok. Automatic introspection is necessary. Let's do it.
            return async (...args) => {
                const introspectionResult = await allserverClient.introspect.call(proxyClient);

                if (introspectionResult && introspectionResult.success && introspectionResult.procedures) {
                    // The automatic introspection won't be executed if you create a second instance of the AllserverClient with the same URI! :)
                    const result = addProceduresToObject(allserverClient, introspectionResult.procedures, proxyClient);
                    if (result.success) {
                        // Do not cache unsuccessful introspections
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
                            code: "ALLSERVER_CLIENT_PROCEDURE_UNREACHABLE",
                            message: `Couldn't reach remote procedure: ${procedureName}`,
                            noNetToServer: introspectionResult.noNetToServer,
                            error: introspectionResult.error,
                        };
                    } else {
                        if (allserverClient[p].callIntrospectedProceduresOnly) {
                            if (!introspectionResult || !introspectionResult.success) {
                                const ir = introspectionResult || {};
                                return {
                                    ...ir, // we need to leave original data if there was any.
                                    success: false,
                                    code: ir.code || "ALLSERVER_CLIENT_INTROSPECTION_FAILED",
                                    message:
                                        ir.message || `Can't call '${procedureName}' procedure, introspection failed`,
                                };
                            } else {
                                return {
                                    success: false,
                                    code: "ALLSERVER_CLIENT_PROCEDURE_NOT_FOUND",
                                    message: `Procedure '${procedureName}' not found via introspection`,
                                };
                            }
                        }

                        // Server is still reachable. It's just introspection didn't work, so let's call server side.
                        // 🤞
                        return allserverClient.call.call(proxyClient, procedureName, ...args);
                    }
                }
            };
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
            // The maximum time to wait until returning the ALLSERVER_CLIENT_TIMEOUT error. 0 means - no timeout.
            timeout: 0,
            // Disable any exception throwing when calling any methods. Otherwise, throws network and server errors.
            neverThrow: true,
            // Automatically find (introspect) and call corresponding remote procedures. Use only the methods defined in client side.
            dynamicMethods: true,
            // Try automatically fetch and assign methods to this client object.
            autoIntrospect: true,
            // If introspection couldn't find that procedure do not attempt sending a "call of faith" to the server.
            callIntrospectedProceduresOnly: true,
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
        transports: {
            http() { return require("./HttpClientTransport"); },
            https() { return require("./HttpClientTransport"); },
            grpc() { return require("./GrpcClientTransport"); },
            bullmq() { return require("./BullmqClientTransport"); },
            lambda() { return require("./LambdaClientTransport"); },
        },
    },

    init(
        {
            uri,
            transport,
            timeout,
            neverThrow,
            dynamicMethods,
            autoIntrospect,
            callIntrospectedProceduresOnly,
            nameMapper,
            before,
            after,
        },
        { stamp }
    ) {
        this[p].timeout = timeout != null ? timeout : this[p].timeout;
        this[p].neverThrow = neverThrow != null ? neverThrow : this[p].neverThrow;
        this[p].dynamicMethods = dynamicMethods != null ? dynamicMethods : this[p].dynamicMethods;
        this[p].autoIntrospect = autoIntrospect != null ? autoIntrospect : this[p].autoIntrospect;
        this[p].callIntrospectedProceduresOnly =
            callIntrospectedProceduresOnly != null
                ? callIntrospectedProceduresOnly
                : this[p].callIntrospectedProceduresOnly;
        this[p].nameMapper = nameMapper != null ? nameMapper : this[p].nameMapper;

        this[p].transport = transport || this[p].transport;
        if (!this[p].transport) {
            if (!isString(uri)) throw new Error("`uri` connection string is required");
            const schema = uri.substr(0, uri.indexOf("://"));
            if (!schema) throw new Error("`uri` must follow pattern: SCHEMA://URI");
            const getTransport = stamp.compose.deepConfiguration.transports[schema.toLowerCase()];
            if (!getTransport) throw new Error(`Schema not supported: ${uri}`);

            this[p].transport = getTransport()({ uri });
        }

        if (before) this[p].before = [].concat(this[p].before).concat(before).filter(isFunction);
        if (after) this[p].after = [].concat(this[p].after).concat(after).filter(isFunction);
    },

    methods: {
        async introspect() {
            const transport = this[p].transport;
            const defaultCtx = { client: this, isIntrospection: true };
            const ctx = transport.createCallContext(defaultCtx);

            await this._callMiddlewares(ctx, "before", async () => {
                if (!ctx.result) {
                    try {
                        // This is supposed to be executed only once (per uri) unless it throws.
                        // There are only 3 situations when this throws:
                        // * the "introspect" method not found on server, (GRPC)
                        // * the network request is malformed, (HTTP-like)
                        // * couldn't connect to the remote host.
                        ctx.result = await this._callTransport(ctx);
                    } catch (err) {
                        ctx.result = {
                            success: false,
                            code: "ALLSERVER_CLIENT_INTROSPECTION_FAILED",
                            message: `Couldn't introspect ${transport.uri} due to: ${err.message}`,
                            noNetToServer: Boolean(err.noNetToServer),
                            error: err,
                        };
                    }
                }

                await this._callMiddlewares(ctx, "after");
            });

            return ctx.result;
        },

        async _callMiddlewares(ctx, middlewareType, next) {
            const runMiddlewares = async (middlewares) => {
                if (!middlewares?.length) {
                    // no middlewares to run
                    if (next) return await next();
                    return;
                }
                const middleware = middlewares[0];
                async function handleMiddlewareResult(result) {
                    if (result !== undefined) {
                        ctx.result = result;
                        // Do not call any more middlewares
                    } else {
                        await runMiddlewares(middlewares.slice(1));
                    }
                }
                try {
                    if (middleware.length > 1) {
                        // This middleware accepts more than one argument
                        await middleware.call(this, ctx, handleMiddlewareResult);
                    } else {
                        const result = await middleware.call(this, ctx);
                        await handleMiddlewareResult(result);
                    }
                } catch (err) {
                    if (!this[p].neverThrow) throw err;

                    let { code, message } = err;
                    if (!code) {
                        code = "ALLSERVER_CLIENT_MIDDLEWARE_ERROR";
                        message = `The '${middlewareType}' middleware error while calling '${ctx.procedureName}' procedure: ${err.message}`;
                    }
                    ctx.result = { success: false, code, message, error: err };
                    // Do not call any more middlewares
                    if (next) return await next();
                }
            };

            const middlewares = [].concat(this[p][middlewareType]).filter(isFunction);
            return await runMiddlewares(middlewares);
        },

        _callTransport(ctx) {
            const transportMethod = ctx.isIntrospection ? "introspect" : "call";
            // In JavaScript if the `timeout` is null or undefined or some other object this condition will return `false`
            if (this[p].timeout > 0) {
                return Promise.race([
                    this[p].transport[transportMethod](ctx),
                    new Promise((resolve) =>
                        setTimeout(
                            () =>
                                resolve({
                                    success: false,
                                    code: "ALLSERVER_CLIENT_TIMEOUT",
                                    message: `The remote procedure ${ctx.procedureName} timed out in ${this[p].timeout} ms`,
                                }),
                            this[p].timeout
                        )
                    ),
                ]);
            }

            return this[p].transport[transportMethod](ctx);
        },

        async call(procedureName, arg) {
            if (!arg) arg = {};
            if (!arg._) arg._ = {};
            arg._.procedureName = procedureName;

            const defaultCtx = { procedureName, arg, client: this };
            const ctx = this[p].transport.createCallContext(defaultCtx);

            await this._callMiddlewares(ctx, "before", async () => {
                if (!ctx.result) {
                    try {
                        ctx.result = await this._callTransport(ctx);
                    } catch (err) {
                        if (!this[p].neverThrow) throw err;

                        let { code, message } = err;
                        if (!err.code || err.noNetToServer) {
                            code = "ALLSERVER_CLIENT_PROCEDURE_UNREACHABLE";
                            message = `Couldn't reach remote procedure ${ctx.procedureName} due to: ${err.message}`;
                        }
                        ctx.result = { success: false, code, message, error: err };
                    }
                }

                await this._callMiddlewares(ctx, "after");
            });

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
        defaults({
            transport,
            neverThrow,
            dynamicMethods,
            autoIntrospect,
            callIntrospectedProceduresOnly,
            nameMapper,
            before,
            after,
        } = {}) {
            if (before != null) before = (Array.isArray(before) ? before : [before]).filter(isFunction);
            if (after != null) after = (Array.isArray(after) ? after : [after]).filter(isFunction);

            return this.deepProps({
                [p]: {
                    transport,
                    neverThrow,
                    dynamicMethods,
                    callIntrospectedProceduresOnly,
                    autoIntrospect,
                    nameMapper,
                    before,
                    after,
                },
            });
        },

        addTransport({ schema, Transport }) {
            return this.deepConf({ transports: { [schema.toLowerCase()]: () => Transport } });
        },
    },
});
