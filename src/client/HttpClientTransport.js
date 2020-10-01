const { isString, isObject } = require("../util");

module.exports = require("./ClientTransport").compose({
    name: "HttpClientTransport",

    props: {
        _fetch: (typeof window !== "undefined" && window.fetch) || require("node-fetch"),
        headers: {},
    },

    init({ headers }) {
        if (!this.uri.endsWith("/")) this.uri += "/";
        if (isObject(headers)) this.headers = Object.assign(this.headers || {}, headers);
    },

    methods: {
        async introspect() {
            return this.call(this.createCallContext({ procedureName: "" }));
        },

        async call({ procedureName, http }) {
            let response;

            try {
                if (http && http.body !== undefined && !isString(http.body)) http.body = JSON.stringify(http.body);
                response = await this._fetch(this.uri + procedureName, http);
                http.response = response;
            } catch (err) {
                if (err.code === "ECONNREFUSED") err.noNetToServer = true;
                throw err;
            }

            if (!response.ok) {
                let error;

                // Try parsing error as text.
                const text = await response.text().catch((err) => {
                    error = err;
                    err.code = "ALLSERVER_RPC_RESPONSE_IS_NOT_TEXT";
                });

                // Try parsing error as JSON object.
                if (!error && text && text[0] === "{" && text[text.length - 1] === "}") {
                    try {
                        const json = JSON.parse(text);
                        error = new Error((json && json.message) || text);
                        if (json && json.code) error.code = json.code;
                    } catch (err) {
                        // ignoring. Not a JSON
                    }
                }

                if (!error) error = new Error(text);
                error.status = response.status;
                throw error;
            }

            // Response is 200 OK

            try {
                return await response.json();
            } catch (err) {
                err.code = "ALLSERVER_RPC_RESPONSE_IS_NOT_JSON";
                throw err;
            }
        },

        createCallContext(defaultCtx) {
            return {
                ...defaultCtx,
                http: {
                    method: "POST",
                    body: defaultCtx.arg,
                    headers: { ...this.headers },
                },
            };
        },
    },
});
