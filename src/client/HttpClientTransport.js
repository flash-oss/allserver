module.exports = require("stampit")({
    name: "HttpClientTransport",

    props: {
        _fetch: require("node-fetch"),
        uri: null,
    },

    init({ uri }) {
        this.uri = uri || this.uri;
        if (!this.uri.endsWith("/")) this.uri += "/";
    },

    methods: {
        async introspect() {
            return this.call();
        },

        async call(procedureName = "", arg) {
            const response = await this._fetch(this.uri + procedureName, { method: "POST", body: JSON.stringify(arg) });
            if (!response.ok) throw new Error(await response.text());
            return response.json();
        },
    },
});
