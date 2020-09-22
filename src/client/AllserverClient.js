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
    // Wrapping our stamp methods (i.e. __proto__). It's better to avoid mangling user's object.
    return new Proxy(this, {
        get: function (target, name, receiver) {
            if (!(name in target)) {
                if (!target._autoIntrospect || !target._uri) return;

                const introspectionResult = introspectionCache.get(target._uri);
                if (introspectionResult) {
                    addProceduresToObject(target, introspectionResult);
                    if (!(name in target)) {
                        // Even if this method `name` was not present in the introspection we still have to call server side.
                        return (...args) => target.call(name, ...args);
                    }
                } else {
                    // The automatic introspection won't be executed if you create a second instance of the AllserverClient with the same URI! :)
                    return async (...args) => {
                        // This is supposed to be executed only once
                        const introspectionResult = await target.introspect();
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

        // Will attempt to automatically introspect the server and dynamically add corresponding methods to this client object.
        _autoIntrospect: true,
    },

    init({ uri, transport, autoIntrospect }) {
        if (typeof uri !== "string") throw new Error("`uri` connection string is required");
        this._uri = uri || this._uri;

        this._autoIntrospect = autoIntrospect != null ? autoIntrospect : this._autoIntrospect;

        this._transport = transport || this._transport;
        if (!this._transport) {
            if (uri.startsWith("http")) this._transport = require("./HttpClientTransport")({ uri });
            // if (uri.startsWith("grpc://")) this._transport = require("./GrpcClientTransport")({ uri });

            if (!this._transport) throw new Error(`Protocol not supported: ${uri}`);
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
        // Keep our initializer the last to return proxy object
        const index = initializers.indexOf(proxyWrappingInitialiser);
        if (index >= 0) initializers.splice(index, 1);
        initializers.push(proxyWrappingInitialiser);
    },
});
