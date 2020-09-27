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
            let response;

            try {
                response = await this._fetch(this.uri + procedureName, { method: "POST", body: JSON.stringify(arg) });
            } catch (err) {
                if (err.code === "ECONNREFUSED") err.code = "ALLSERVER_PROCEDURE_UNREACHABLE";
                throw err;
            }

            if (!response.ok) {
                const text = await response.text().catch(() => "RPC_RESPONSE_IS_NOT_TEXT");
                let error;
                if (text[0] === "{" && text[text.length - 1] === "}") {
                    try {
                        const json = JSON.parse(text);
                        const message = (json && json.message) || text;
                        error = new Error(message);
                        if (json && json.code) error.code = json.code;
                    } catch (err) {}
                }
                if (!error) error = new Error(text);
                error.status = response.status;
                throw error;
            }

            try {
                return await response.json();
            } catch (err) {
                err.code = "RPC_RESPONSE_IS_NOT_JSON";
                throw err;
            }
        },
    },
});
