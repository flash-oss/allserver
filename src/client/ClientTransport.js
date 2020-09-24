const { isString, isFunction } = require("../util");

module.exports = require("stampit")({
    name: "ClientTransport",

    props: {
        uri: null,

        // Will attempt to automatically introspect the server and dynamically add corresponding methods to this client object.
        autoIntrospect: true,
    },

    init({ uri, autoIntrospect }) {
        if (!isFunction(this.introspect)) throw new Error("ClientTransport must implement introspect()");
        if (!isFunction(this.call)) throw new Error("ClientTransport must implement call()");

        if (!isString(uri)) throw new Error("`uri` connection string is required");
        this.uri = uri || this.uri;

        this.autoIntrospect = autoIntrospect != null ? autoIntrospect : this.autoIntrospect;
    },
});
