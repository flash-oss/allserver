module.exports = require("./ClientTransport").compose({
    name: "HttpClientTransport",

    props: {
        _fetch: require("node-fetch"),
    },

    init() {
        if (!this.uri.endsWith("/")) this.uri += "/";
    },

    methods: {
        async introspect() {
            return this.call();
        },

        async call(procedureName = "", arg) {
            const response = await this._fetch(this.uri + procedureName, { method: "POST", body: JSON.stringify(arg) });
            if (!response.ok) {
                const text = await response.text().catch((err) => "RPC_RESPONSE_IS_NOT_TEXT");
                const error = new Error(text);
                error.status = response.status;
                throw error;
            }

            return response.json();
        },
    },
});
