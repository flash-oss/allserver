const introspectionCache = new Map();

function addProceduresToObject(target, introspectionResult) {
    const { success, procedures } = introspectionResult;
    if (!success || !procedures) return; // The auto introspection result failed. Do nothing.
    for (const [procedureName, type] of Object.entries(procedures)) {
        if (type !== "function" || target[procedureName]) continue;
        target[procedureName] = (...args) => target.call(procedureName, ...args);
    }
}

function proxyWrappingInitialiser() {
    // Wrapping our object instance.
    return new Proxy(this, {
        get: function (target, name, receiver) {
            if (!(name in target)) {
                // Method not found!
                // Checking if automatic introspection is disabled or impossible.
                if (!target._transport.autoIntrospect || !target._uri) return;

                // Let's see if we already introspected that server.
                const introspectionResult = introspectionCache.get(target._uri);
                if (introspectionResult) {
                    // Yeah. We already introspected it. Note! The introspection might returned nothing or even error.
                    addProceduresToObject(target, introspectionResult);
                    if (!(name in target)) {
                        // Even if this method `name` was not present in the introspection we still have to call server side.
                        return (...args) => target.call(name, ...args);
                    }
                } else {
                    // Ok. Automatic introspection is necessary. Let's do it.
                    return async (...args) => {
                        // This is supposed to be executed only once unless it throws.
                        // There are only 3 situations when this throws:
                        // * the "introspect" method not found on server,
                        // * the network request is malformed,
                        // * couldn't connect to the remote host.
                        const introspectionResult = await target.introspect();
                        // The automatic introspection won't be executed if you create a second instance of the AllserverClient with the same URI! :)
                        introspectionCache.set(target._uri, introspectionResult);
                        addProceduresToObject(target, introspectionResult);
                        return target.call(name, ...args);
                    };
                }
            }

            return Reflect.get(target, name, receiver);
        },
    });
}

module.exports = require("stampit")({
    name: "AllserverClient",

    props: {
        _uri: null,
        _transport: null,
    },

    init({ uri, transport }) {
        if (typeof uri !== "string") throw new Error("`uri` connection string is required");
        this._uri = uri || this._uri;

        this._transport = transport || this._transport;
        if (!this._transport) {
            if (this._uri.startsWith("http")) this._transport = require("./HttpClientTransport")({ uri: this._uri });
            if (this._uri.startsWith("grpc")) this._transport = require("./GrpcClientTransport")({ uri: this._uri });

            if (!this._transport) throw new Error(`Protocol not supported: ${this._uri}`);
        }
    },

    methods: {
        async introspect() {
            return this._transport.introspect();
        },

        call(procedureName, arg) {
            return this._transport.call(procedureName, arg);
        },
    },

    composers({ stamp }) {
        const { initializers } = stamp.compose;
        // Keep our initializer the last to return proxy object instead of the client object.
        const index = initializers.indexOf(proxyWrappingInitialiser);
        if (index >= 0) initializers.splice(index, 1);
        initializers.push(proxyWrappingInitialiser);
    },
});
