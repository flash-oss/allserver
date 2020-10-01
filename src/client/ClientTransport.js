const { isString, isFunction } = require("../util");

module.exports = require("stampit")({
    name: "ClientTransport",

    props: {
        uri: null,
    },

    init({ uri, before, after }) {
        if (!isFunction(this.introspect)) throw new Error("ClientTransport must implement introspect()");
        if (!isFunction(this.call)) throw new Error("ClientTransport must implement call()");

        this.uri = uri || this.uri;
        if (!isString(this.uri)) throw new Error("`uri` connection string is required");

        this.before = isFunction(before) ? before : this.before;
        this.after = isFunction(after) ? after : this.after;
    },
});
