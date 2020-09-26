const { isString } = require("../util");

// Protected variables
const p = Symbol.for("AllserverClient");

function addProceduresToObject(allserverClient, procedures) {
    try {
        procedures = JSON.parse(procedures);
    } catch (err) {
        throw new Error("Malformed introspection");
    }
    for (const [procedureName, type] of Object.entries(procedures || {})) {
        if (type !== "function" || allserverClient[procedureName]) continue;
        allserverClient[procedureName] = (...args) => allserverClient.call(procedureName, ...args);
    }
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
                    // Yeah. We already introspected it. Note! The introspection might was unsuccessful.
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
                        introspectionCache.set(uri, introspectionResult);

                        if (introspectionResult && introspectionResult.success && introspectionResult.procedures) {
                            // The automatic introspection won't be executed if you create a second instance of the AllserverClient with the same URI! :)
                            addProceduresToObject(allserverClient, introspectionResult.procedures);
                        }

                        if (procedureName in allserverClient) {
                            // This is the main happy path.
                            // The auto introspection worked as expected. It added a method to the client object.
                            return Reflect.get(allserverClient, procedureName, thisContext)(...args);
                        } else {
                            // The method `name` is not present in the introspection, so let's call server side.
                            // 🤞
                            return allserverClient.call(procedureName, ...args);
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
            // Disable any exception throwing when calling any methods.
            neverThrow: false,
            // Automatically call corresponding remote procedure, even if such method does not exist on this client object.
            dynamicMethods: true,
            // Try automatically fetch and assign methods to this client object.
            autoIntrospect: true,
        },
    },

    deepConf: {
        transports: [
            { schema: "http", getStamp: () => require("./HttpClientTransport") },
            { schema: "grpc", getStamp: () => require("./GrpcClientTransport") },
        ],
    },

    init({ uri, transport, neverThrow, dynamicMethods, autoIntrospect }, { stamp }) {
        this[p].neverThrow = neverThrow != null ? neverThrow : this[p].neverThrow;
        this[p].dynamicMethods = dynamicMethods != null ? dynamicMethods : this[p].dynamicMethods;
        this[p].autoIntrospect = autoIntrospect != null ? autoIntrospect : this[p].autoIntrospect;

        this[p].transport = transport || this[p].transport;
        if (!this[p].transport) {
            if (!isString(uri)) throw new Error("`uri` connection string is required");

            const transportConfig = stamp.compose.deepConfiguration.transports.find(({ schema }) =>
                uri.startsWith(schema)
            );
            if (!transportConfig) throw new Error(`Schema not supported: ${uri}`);

            this[p].transport = transportConfig.getStamp()({ uri });
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
                error: err,
            }));
        },

        async call(procedureName, arg) {
            let promise = Promise.resolve(this[p].transport.call(procedureName, arg));
            if (this[p].neverThrow) {
                promise = promise.catch((err) => ({
                    success: false,
                    code: "CANNOT_REACH_REMOTE_PROCEDURE",
                    message: `Couldn't reach remote procedure: ${procedureName}`,
                    error: err,
                }));
            }
            return promise;
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
        defaults({ transport, neverThrow, dynamicMethods, autoIntrospect } = {}) {
            return this.deepProps({ [p]: { transport, neverThrow, dynamicMethods, autoIntrospect } });
        },
    },
});
