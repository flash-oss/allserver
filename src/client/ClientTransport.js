const { isString, isFunction } = require("../util");

module.exports = require("stampit")({
    name: "ClientTransport",

    props: {
        uri: null,
    },

    init({ uri }) {
        if (!isFunction(this.introspect)) throw new Error("ClientTransport must implement introspect()");
        if (!isFunction(this.call)) throw new Error("ClientTransport must implement call()");

        this.uri = uri || this.uri;
        if (!isString(this.uri)) throw new Error("`uri` connection string is required");
    },
});
