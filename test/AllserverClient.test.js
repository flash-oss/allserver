const assert = require("assert");

const VoidClientTransport = require("../src/client/ClientTransport").compose({
    props: {
        uri: "void://localhost",
    },
    methods: {
        introspect() {},
        call() {},
    },
});
const AllserverClient = require("..").AllserverClient.deepConf({
    transports: [{ schema: "void", getStamp: () => VoidClientTransport }], // added one more known schema
});

describe("AllserverClient", () => {
    describe("#init", () => {
        it("should throw if no uri and no transport", () => {
            assert.throws(() => AllserverClient(), /uri/);
        });

        it("should throw if uri schema is not supported", () => {
            assert.throws(() => AllserverClient({ uri: "unexist://bla" }), /schema/i);
        });

        it("should not throw if uri schema is supported", () => {
            AllserverClient({ uri: "void://bla" });
        });
    });

    describe("#introspect", () => {
        it("should do not throw if underlying transport fails to connect", async () => {
            const MockedTransport = VoidClientTransport.methods({
                introspect: () => Promise.reject(new Error("Cannot reach server")),
            });

            const result = await AllserverClient({ transport: MockedTransport() }).introspect();
            assert.strictEqual(result.success, false);
            assert.strictEqual(result.code, "INTROSPECTION_FAILED");
            assert.strictEqual(result.message, "Couldn't introspect void://localhost");
            assert.strictEqual(result.error.message, "Cannot reach server");
        });
    });

    describe("#call", () => {
        it("should throw if underlying transport fails to connect", async () => {
            const MockedTransport = VoidClientTransport.methods({
                call: () => Promise.reject(new Error("Cannot reach server")),
            });

            await assert.rejects(
                AllserverClient({ transport: MockedTransport(), neverThrow: false }).call(),
                /Cannot reach server/
            );
        });

        it("should not throw if neverThrow enabled", async () => {
            const MockedTransport = VoidClientTransport.methods({
                async introspect() {
                    return {
                        success: true,
                        code: "OK",
                        message: "Ok",
                        procedures: JSON.stringify({ foo: "function" }),
                    };
                },
                call: () => Promise.reject(new Error("Cannot reach server")),
            });

            const result = await AllserverClient({ transport: MockedTransport() }).call("foo", {});
            assert.strictEqual(result.success, false);
            assert.strictEqual(result.code, "ALLSERVER_PROCEDURE_UNREACHABLE");
            assert.strictEqual(result.message, "Couldn't reach remote procedure: foo");
            assert.strictEqual(result.error.message, "Cannot reach server");
        });

        it("should not throw if neverThrow enabled and the method is not present", async () => {
            const MockedTransport = VoidClientTransport.methods({
                call: () => Promise.reject(new Error("Shit happens too")),
            });

            const client = AllserverClient({ transport: MockedTransport() });
            assert.strictEqual(Reflect.has(client, "foo"), false); // don't have it
            const result = await client.call("foo", {});
            assert.strictEqual(Reflect.has(client, "foo"), false); // still don't have it
            assert.strictEqual(result.success, false);
            assert.strictEqual(result.code, "ALLSERVER_PROCEDURE_UNREACHABLE");
            assert.strictEqual(result.message, "Couldn't reach remote procedure: foo");
            assert.strictEqual(result.error.message, "Shit happens too");
        });
    });

    describe("dynamicMethods", () => {
        it("should not do dynamic RPC based on object property names", () => {
            const client = AllserverClient({ dynamicMethods: false, uri: "void://bla" });
            assert.throws(() => client.thisMethodDoesNotExist());
        });

        it("should do dynamic RPC based on object property names", async () => {
            const client = AllserverClient({ autoIntrospect: false, uri: "void://bla" });
            await client.thisMethodDoesNotExist();
        });
    });

    describe("autoIntrospect", () => {
        it("should introspect and add methods before call", async () => {
            const MockedTransport = VoidClientTransport.methods({
                async introspect() {
                    return {
                        success: true,
                        code: "OK",
                        message: "Ok",
                        procedures: JSON.stringify({ foo: "function" }),
                    };
                },
                async call(procedureName, arg) {
                    assert.strictEqual(procedureName, "foo");
                    assert.deepStrictEqual(arg, { a: 1 });
                    return { success: true, code: "CALLED_A", message: "A is good", b: 42 };
                },
            });

            const client = AllserverClient({ transport: MockedTransport() });
            assert.strictEqual(Reflect.has(client, "foo"), false); // dont have it yet
            const result = await client.foo({ a: 1 });
            assert.strictEqual(Reflect.has(client, "foo"), true); // have it now!
            assert.deepStrictEqual(result, { success: true, code: "CALLED_A", message: "A is good", b: 42 });
        });

        it("should attempt calling if introspection fails", async () => {
            const MockedTransport = VoidClientTransport.methods({
                introspect() {
                    return Promise.reject(new Error("Couldn't introspect"));
                },
                call(procedureName, arg) {
                    assert.strictEqual(procedureName, "foo");
                    assert.deepStrictEqual(arg, { a: 1 });
                    return { success: true, code: "CALLED_A", message: "A is good", b: 42 };
                },
            });

            const client = AllserverClient({ transport: MockedTransport() });
            assert.strictEqual(Reflect.has(client, "foo"), false); // don't have it
            const result = await AllserverClient({ transport: MockedTransport() }).foo({ a: 1 });
            assert.strictEqual(Reflect.has(client, "foo"), false); // still don't have it
            assert.deepStrictEqual(result, { success: true, code: "CALLED_A", message: "A is good", b: 42 });
        });

        it("should not override existing methods", async () => {
            const MockedTransport = VoidClientTransport.methods({
                async introspect() {
                    return {
                        success: true,
                        code: "OK",
                        message: "Ok",
                        procedures: JSON.stringify({ foo: "function" }),
                    };
                },
                async call() {
                    assert.fail("should not call transport");
                },
            });

            function foo(arg) {
                assert.strictEqual(arg && arg.a, 1);
                return {
                    success: true,
                    code: "CACHED",
                    message: "The reply mimics memory caching",
                    b: 2,
                };
            }

            const client = AllserverClient.methods({ foo }).create({ transport: MockedTransport() });
            assert.strictEqual(client.foo, foo);
            const result = await client.foo({ a: 1 });
            assert.strictEqual(client.foo, foo);
            assert.deepStrictEqual(result, {
                success: true,
                code: "CACHED",
                message: "The reply mimics memory caching",
                b: 2,
            });
        });

        it("should introspect same uri only once", async () => {
            let introspectionCalls = 0;
            const MockedTransport = VoidClientTransport.methods({
                async introspect() {
                    introspectionCalls += 1;
                    return {
                        success: true,
                        code: "OK",
                        message: "Ok",
                        procedures: JSON.stringify({ foo: "function" }),
                    };
                },
                async call() {
                    return { success: true, code: "CALLED_A", message: "A is good", b: 42 };
                },
            });

            for (let i = 1; i <= 2; i += 1) {
                const client = AllserverClient({ transport: MockedTransport({ uri: "void://very-unique-address-1" }) });
                assert.strictEqual(Reflect.has(client, "foo"), false); // dont have it yet
                const result = await client.foo({ a: 1 });
                assert.strictEqual(Reflect.has(client, "foo"), true); // have it now!
                assert.deepStrictEqual(result, { success: true, code: "CALLED_A", message: "A is good", b: 42 });
            }

            assert.strictEqual(introspectionCalls, 1);
        });

        it("should re-introspect failed introspections", async () => {
            let introspectionCalls = 0;
            const MockedTransport = VoidClientTransport.methods({
                async introspect() {
                    introspectionCalls += 1;
                    throw new Error("Shit happens twice");
                },
                async call() {
                    return { success: true, code: "CALLED_A", message: "A is good", b: 42 };
                },
            });

            for (let i = 1; i <= 2; i += 1) {
                const client = AllserverClient({
                    transport: MockedTransport({ uri: "void://very-unique-address-2" }),
                });
                assert.strictEqual(Reflect.has(client, "foo"), false); // dont have it
                const result = await client.foo({ a: 1 });
                assert.strictEqual(Reflect.has(client, "foo"), false); // still don't have it
                assert.deepStrictEqual(result, { success: true, code: "CALLED_A", message: "A is good", b: 42 });
            }

            assert.strictEqual(introspectionCalls, 2);
        });

        it("should not auto introspect if asked so", (done) => {
            const MockedTransport = VoidClientTransport.methods({
                async introspect() {
                    done(new Error("Must not attempt introspection"));
                },
                async call() {
                    return { success: true, code: "CALLED_A", message: "A is good", b: 42 };
                },
            });

            const client = AllserverClient({
                autoIntrospect: false,
                transport: MockedTransport({ uri: "void://very-unique-address-3" }),
            });
            assert.strictEqual(Reflect.has(client, "foo"), false); // dont have it
            client
                .foo({ a: 1 })
                .then((result) => {
                    assert.strictEqual(Reflect.has(client, "foo"), false); // still don't have it
                    assert.deepStrictEqual(result, { success: true, code: "CALLED_A", message: "A is good", b: 42 });
                    done();
                })
                .catch(done);
        });
    });

    describe("#defaults", () => {
        it("should work", () => {
            const NewClient = AllserverClient.defaults({
                neverThrow: false,
                dynamicMethods: false,
                autoIntrospect: false,
            });

            const p = Symbol.for("AllserverClient");

            let protecteds = NewClient.compose.deepProperties[p];
            assert.strictEqual(protecteds.neverThrow, false);
            assert.strictEqual(protecteds.dynamicMethods, false);
            assert.strictEqual(protecteds.autoIntrospect, false);

            const client = NewClient({ uri: "void://bla" });
            protecteds = client[p];
            assert.strictEqual(protecteds.neverThrow, false);
            assert.strictEqual(protecteds.dynamicMethods, false);
            assert.strictEqual(protecteds.autoIntrospect, false);
        });
    });
});
