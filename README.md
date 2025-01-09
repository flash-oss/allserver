# Allserver

Multi-transport and multi-protocol simple RPC server and (optional) client. Boilerplate-less. Opinionated. Minimalistic. DX-first.

Think of Remote Procedure Calls using exactly the same client and server code but via multiple protocols/mechanisms such as HTTP, gRPC, GraphQL, WebSockets, job queues, Lambda, inter-process, (Web)Workers, unix sockets, etc etc etc.

Should be used in (micro)services where JavaScript is able to run - your computer, Docker, k8s, virtual machines, serverless functions (Lambdas, Google Cloud Functions, Azure Functions, etc), RaspberryPI, SharedWorker, thread, you name it.

> Uber [moved](https://www.infoq.com/news/2023/10/uber-up-cloud-microservices/) most of its containerized microservices from µDeploy to a new multi-cloud platform named Up in preparation for migrating a considerable portion of its compute footprint to the cloud. **The company spent two years** working on making its many microservices portable to migrate between different computing infrastructures and container management platforms.

Superpowers the `Allserver` gives you:

- Move your code around infrastructures, deployment types, runtimes, platforms, etc with ease.
- Call gRPC server methods from browser/curl/Postman.
- Run your HTTP server as gRPC with a single line change (almost).
- Serve same logic via HTTP and gRPC (or more) simultaneously in the same node.js process.
- Deploy and run your HTTP server on AWS Lambda with no code changes.
- Embed same exact code into your existing Express.js, no need to implement any handlers/middleware.
- Use Redis-backed job queue [BullMQ](https://docs.bullmq.io) to call remote procedures reliably.
- And moar!

Superpowers the `AllserverClient` gives you:

- (Optionally) Stop writing `try-catch` when calling a remote procedure.
- Call remote procedures just like regular methods.
- Call any transport/protocol server methods with exactly the same client-side code.
- And moar!

<p align="center">
  <img alt='Evan You quote about "bad" ideas' src="https://github.com/flash-oss/allserver/raw/media/quote1.jpg" width="400">
</p>

##### Spelling

"Allserver" is a single word, capital "A", lowercase "s".

### Quick example

This is how your code would look like in all execution environments using any communication protocol out there.

Server side:

```js
const procedures = {
  sayHello: ({ name }) => "Hello " + name,
};
require("allserver").Allserver({ procedures }).start();
```

AllserverClient call:

```js
const AllserverClient = require("allserver/Client");
const client = AllserverClient({ uri: process.env.REMOTE_SERVER_URI });

const { success, code, sayHello } = await client.sayHello({ name: "Joe" });

if (success) {
  // "Hello Joe"
  console.log(sayHello);
} else {
  // something like "ALLSERVER_CLIENT_PROCEDURE_UNREACHABLE"
  console.error(code);
}
```

Or use your **own client library**, e.g. `fetch` for HTTP or `@grpc/grpc-js` for gRPC.

## Why Allserver exists?

There are loads of developer video presentations where people rant about how things are complex and how we must do extra effort to simplify things. Allserver is about simplicity and developer experience.

Problems I had:

- **Error handling while calling remote procedures are exhausting.**
  - Firstly, I wrap the HTTP call in a `try-catch`. Then, I always had to analise: the status code, then detect the response body content type - text or json, then analyse the body for the actual error. I got very much annoyed by this repetitive boilerplate code.
- **REST route naming is not clear enough.**
  - What is this route for - `/user`? You need to read the docs! I want it to be as simple and clear as calling a JS function/method - `createUser()`, or `updateUser()`, or `getUser()`, or `removeUser()`, or `findUsers()`, etc.
- **The HTTP methods are a pain point of any REST API.**
  - Is it `POST` or `PUT` or `PATCH`? What if a route removes a permission to a file from a user, should it be `DELETE` or `POST`? I know it should be `POST`, but it's confusing to call `POST` when I need to REMOVE something. Protocol-level methods are never enough.
- **The HTTP status codes are never enough and overly confusing.**
  - If a `user` record in the database is readonly, and you are trying to modify it, a typical server would reply `400 Bad Request`. However, the request, the user data, the system are all perfectly fine. The HTTP statuses were not designed for you business logic errors.
- **The GraphQL has great DX and tooling, but it's not a good fit for microservices.**
  - It adds too much complexity and is performance unfriendly (slow). Allserver is about simplicity, not complexity.
- **Performance scaling**
  - When a performance scaling was needed I had to rewrite an entire service and client source code in multiple projects to a more performant network protocol implementation. This was a significant and avoidable time waste in my opinion.
- **HTTP monitoring tools show business errors as alarms.**
  - I was trying to check if a user with email `bla@example.com` exists. REST reply was HTTP `404`. It alarmed our monitoring tools. Whereas, I don't want that alarm. That's not an error, but a regular true/false check. I want to monitor only the "route not found" errors with ease.

When calling a remote procedure I want something which:

- Does not throw exceptions client-side no matter what. **All** kinds of errors should be handled exactly the same way.
- Can be easily mapped to any language, any protocol. Especially to upstream GraphQL mutations.
- Is simple to read in the source code, just like a method/function call. Without thinking of protocol-level details for every damn call.
- Allows me to test gRPC server from my browser/Postman/curl (via HTTP!) by a simple one line config change.
- Replace flaky HTTP with Kafka
- Does not bring tons of npm dependencies with it.

Also, the main driving force was my vast experience splitting monolith servers onto (micro)services. Here is how I do it with much success.

- Firstly, refactor a function to return object of the `{success,code,message,...}` shape, and to never throw.
- Then, move the function over to a microservice.
- Done.

Ideas are taken from multiple places.

- [slack.com HTTP RPC API](https://api.slack.com/web) - always return object of a same shape - `{ok:Boolean, error:String}`.
- [GoLang error handling](https://blog.golang.org/error-handling-and-go) - always return two things from a function call - the result and the error.
- [GraphQL introspection](https://graphql.org/learn/introspection/) - introspection API out of the box by default.

## Core principles

1. **Always choose DX (Developer Experience) over everything else**
   - Otherwise, Allserver won't differ from the alternatives.
   - When newbie developer reads server-side code of an RPC (micro)service they should quickly understand what is what.
1. **Switching between data protocols must be as easy as changing single config value**
   - Common example is when you want to convert your (micro)service from HTTP to gRPC.
   - Or if you want to call the gRPC server you are developing but don't have the gRPC client, so you use [Postman](https://www.postman.com/downloads/), `curl` or a browser (HTTP) for that.
   - Or you are moving the procedure/function/method to another (micro)service employing different communication protocol and infrastructure. E.g. when migrating from a monolith to serverless architecture.
1. **Calling procedures client side must be as easy as a regular function call**
   - `const { success, user } = await client.updateUser({ id: 622, firstName: "Hui" })`
   - Hence, the next core principle...
1. **Exceptions should be never thrown**
   - The object of the following shape must always be returned: `success,code,message,...`.
   - Although, this should be configurable (see `neverThrow: false`).
1. **Procedures (aka routes, aka methods, aka handlers) must always return same shaped interface regardless of everything**
   - This makes your (micro)service protocol agnostic.
   - HTTP server must always return `{success:Boolean, code:String, message:String}`.
   - Same for gRPC - `message Reply { bool success = 1; string code = 2; string message = 3; }`.
   - Same for GraphQL - `interface IAllserverReply { success:Boolean! code:String message:String }`
   - Same for other protocols/languages.
1. **Protocol-level things must NOT be used for business-level logic (i.e. no REST)**
   - This makes your (micro)service protocol agnostic.
   - E.g. the HTTP status codes must be used for protocol-level errors only.
1. **All procedures must accept single argument - JSON options object**
   - This makes your (micro)service protocol agnostic.
1. **Procedures introspection (aka programmatic discovery) should work out of the box**
   - This allows `AllserverClient` to know nothing about the remote server when your code starts to run.

## Usage

Please note, that Allserver depends only on a single tiny npm module [`stampit`](https://stampit.js.org). Every other dependency is _optional_.

### HTTP protocol

#### Server

The default `HttpTransport` is using the [`micro`](http://npmjs.com/package/micro) npm module as an optional dependency.

```shell
npm i allserver micro@10
```

Alternatively, you can embed Allserver into your existing Express.js application:

```shell
npm i allserver express
```

#### Client

Optionally, you can use Allserver's built-in client:

```shell
npm i allserver node-fetch
```

Or do HTTP requests using any module you like.

### AWS Lambda

#### Server

No dependencies other than `allserver` itself.

```shell
npm i allserver
```

#### Client

Two ways:

- Same as the HTTP protocol client above.
- Direct invocation via AWS SDK or AWS CLI.

### gRPC protocol

#### Server

The default `GrpcTransport` is using the standard the [`@grpc/grpc-js`](https://www.npmjs.com/package/@grpc/grpc-js) npm module as an optional dependency.

```shell
npm i allserver @grpc/grpc-js@1 @grpc/proto-loader@0.5
```

Note, with gRPC server and client you'd need to have your own `.proto` file. See code example below.

#### Client

Optionally, you can use Allserver's built-in client:

```shell
npm i allserver @grpc/grpc-js@1 @grpc/proto-loader@0.5
```

Or do gRPC requests using any module you like.

### [BullMQ](https://docs.bullmq.io) job queue

#### Server

The default `BullmqTransport` is using the [`bullmq`](https://www.npmjs.com/package/bullmq) module as a dependency, connects to Redis using `Worker` class.

```shell
npm i allserver bullmq
```

#### Client

Optionally, you can use Allserver's built-in client:

```shell
npm i allserver bullmq
```

Or use the `bullmq` module directly. You don't need to use Allserver to call remote procedures. See code example below.

## Code examples

### Procedures

(aka routes, aka schema, aka handlers, aka functions, aka methods)

These are your business logic functions. They are exactly the same for all the network protocols out there. They wouldn't need to change if you suddenly need to move them to another (micro)service, protocol, network transport, or expose via a GraphQL API.

```js
const procedures = {
  async updateUser({ id, firstName, lastName }) {
    const db = await require("my-database").db("users");

    const user = await db.find({ id });
    if (!user) {
      return {
        success: false,
        code: "USER_ID_NOT_FOUND",
        message: `User ID ${id} not found`,
      };
    }

    if (user.isReadOnly()) {
      return {
        success: false,
        code: "USER_IS_READONLY",
        message: `User ${id} can't be modified`,
      };
    }

    if (user.firstName === firstName && user.lastName === lastName) {
      return {
        success: true, // NOTE! We return TRUE here,
        code: "NO_CHANGES", // but we also tell the client side that nothing was changed.
        message: `User ${id} already have that data`,
      };
    }

    user.firstName = firstName;
    user.lastName = lastName;
    await user.save();

    return { success: true, code: "UPDATED", user };
  },

  health() {}, // will return `{"success":true,"code":"SUCCESS","message":"Success"}`

  async reconnectDb() {
    const myDb = require("my-database");
    const now = Date.now(); // milliseconds
    await myDb.diconnect();
    await myDb.connect();
    const took = Date.now() - now;
    return took; // will return `{"reconnectDb":25,"success":true,"code":"SUCCESS","message":"Success"}`
  },
};
```

### HTTP server side

Using the `procedures` declared above.

```js
const { Allserver } = require("allserver");

Allserver({ procedures }).start();
```

The above code starts an HTTP server on port `process.env.PORT` if no transport was specified.

Here is the same server but more explicit:

```js
const { Allserver, HttpTransport } = require("allserver");

Allserver({
  procedures,
  transport: HttpTransport({ port: process.env.PORT }),
}).start();
```

#### Replying non-standard HTTP response from a procedure

You'd need to deal with node.js `res` yourself.

```js
const procedures = {
  processEntity({ someEntity }, ctx) {
    const res = ctx.http.res;
    res.statusCode = 422;
    const msg = "Unprocessable Entity";
    res.setHeader("Content-Length", Buffer.byteLength(msg));
    res.send(msg);
  },
};
```

#### Accessing Node request and its raw body

Occasionally, your HTTP method would need to access raw body of a request. This is how you do it:

```js
const procedures = {
  async processEntity(_, ctx) {
    const micro = ctx.allserver.transport.micro; // same as require("micro")
    const req = ctx.http.req; // node.js Request

    // as a string
    const text = await micro.text(req);
    // as a node.js buffer
    const buffer = await micro.buffer(req);

    // ... process the request here ...
  },
};
```

More info can be found in the [`micro`](http://npmjs.com/package/micro) NPM module docs.

### HTTP server in Express.js

Doesn't require a dedicated client transport. Use the HTTP client below.

```js
const { Allserver, ExpressTransport } = require("allserver");

const middleware = Allserver({
  procedures,
  transport: ExpressTransport(),
}).start();

app.use("/route-with-allsever", middleware);
```

### HTTP server in AWS Lambda

Doesn't require a dedicated client transport. Use the HTTP client below.

```js
const { Allserver, LambdaTransport } = require("allserver");

exports.handler = Allserver({
  procedures,
  transport: LambdaTransport(),
}).start();
```

### Server in Bare AWS Lambda

Invoke directly via AWS SDK or AWS CLI. But better use the LambdaClientTransport (aka `"lambda://"` scheme) below.

```js
const { Allserver, LambdaTransport } = require("allserver");

exports.handler = Allserver({
  procedures,
  transport: LambdaTransport(),
}).start();
```

### HTTP client side

#### Using built-in client

You'd need to install `node-fetch` optional dependency.

```shell
npm i allserver node-fetch
```

Note, that this code is **same** as the gRPC client code example below!

```js
const { AllserverClient } = require("allserver");
// or
const AllserverClient = require("allserver/Client");

const client = AllserverClient({ uri: "http://localhost:40000" });

const { success, code, message, user } = await client.updateUser({
  id: "123412341234123412341234",
  firstName: "Fred",
  lastName: "Flinstone",
});
```

The `AllserverClient` will issue `HTTP POST` request to this URL: `http://localhost:40000/updateUser`.
The path of the URL is dynamically taken straight from the `client.updateUser` calling code using the ES6 [`Proxy`](https://stackoverflow.com/a/20147219/188475) class. In other words, `AllserverClient` intercepts non-existent property access.

#### Using any HTTP client (axios in this example)

It's a regular HTTP `POST` call with JSON request and response. URI is `/updateUser`.

```js
import axios from "axios";

const response = await axios.post("http://localhost:40000/updateUser", {
  id: "123412341234123412341234",
  firstName: "Fred",
  lastName: "Flinstone",
});
const { success, code, message, user } = response.data;
```

Alternatively, you can call the same API using `GET` request with search params (query): `http://example.com/updateUser?id=123412341234123412341234&firstName=Fred&lastName=Flinstone`

```js
const response = await axios.get("updateUser", {
  params: {
    id: "123412341234123412341234",
    firstName: "Fred",
    lastName: "Flinstone",
  },
});
```

Yeah. This is a mutating call using `HTTP GET`. That's by design, and I love it. Allserver is an RPC server, not a website server! So we are free to do whatever we want here.

### HTTP limitations

1. Sub-routes are not well-supported, your procedure should be named `"users/updateUser"` or alike. Also, in the `AllserverClient` you'd want to use `nameMapper`.

### gRPC server side

Note that we are reusing the `procedures` from the example above.

Make sure all the methods in your `.proto` file reply at least three properties: `success, code, message`. Otherwise, the server won't start and will throw an error.

Also, for now, you need to add [these](./mandatory.proto) mandatory declarations to your `.proto` file.

Here is how your gRPC server can look like:

```js
const { Allserver, GrpcTransport } = require("allserver");

Allserver({
  procedures,
  transport: GrpcTransport({
    protoFile: __dirname + "/my-server.proto",
    port: 50051,
  }),
}).start();
```

### gRPC client side

#### Using built-in client

Note, that this code is **same** as the HTTP client code example above! The only difference is the URI.

```js
const { AllserverClient } = require("allserver");
// or
const AllserverClient = require("allserver/Client");

const client = AllserverClient({ uri: "grpc://localhost:50051" });

const { success, code, message, user } = await client.updateUser({
  id: "123412341234123412341234",
  firstName: "Fred",
  lastName: "Flinstone",
});
```

The `protoFile` is automatically taken from the server side via the `introspect()` call.

#### Using any gPRS client (official module in this example)

```js
const packageDefinition = require("@grpc/proto-loader").loadSync(
  __dirname + "/my-server.proto"
);

const grpc = require("@grpc/grpc-js");
const proto = grpc.loadPackageDefinition(packageDefinition);
var client = new proto.MyService(
  "localhost:50051",
  grpc.credentials.createInsecure()
);

// Promisifying because official gRPC modules do not support Promises async/await.
const { promisify } = require("util");
for (const k in client)
  if (typeof client[k] === "function")
    client[k] = promisify(client[k].bind(client));

const data = await client.updateUser({
  id: "123412341234123412341234",
  firstName,
  lastName,
});

const { success, code, message, user } = data;
```

### gRPC limitations

1. Only [**unary**](https://grpc.io/docs/what-is-grpc/core-concepts/#unary-rpc) RPC. No streaming of any kind is available. By design.
1. All the reply `message` definitions must have `bool success = 1; string code = 2; string message = 3;`. Otherwise, server won't start. By design.
1. You can't have `import` statements in your `.proto` file. (Yet.)
1. Your server-side `.proto` file must include Allserver's [mandatory declarations](./mandatory.proto). (Yet.)

### BullMQ server side

Note that we are reusing the `procedures` from the example above.

Here is how your BullMQ server can look like:

```js
const { Allserver, BullmqTransport } = require("allserver");

Allserver({
  procedures,
  transport: BullmqTransport({
    connectionOptions: { host: "localhost", port: 6379 },
  }),
}).start();
```

### BullMQ client side

#### Using built-in client

Note, that this code is **same** as the HTTP client code example above! The only difference is the URI.

```js
const { AllserverClient, BullmqClientTransport } = require("allserver");
// or
const AllserverClient = require("allserver/Client");

const client = AllserverClient({ uri: "bullmq://localhost:6379" });
// or
const client = AllserverClient({
  transport: BullmqClientTransport({ uri: "redis://localhost:6379" }),
});

const { success, code, message, user } = await client.updateUser({
  id: "123412341234123412341234",
  firstName: "Fred",
  lastName: "Flinstone",
});
```

The `bullmq://` schema uses same connection string as Redis: `bullmq://[[username:]password@]host[:port][/database]`

#### Using any BullMQ `Queue` class without Allserver

```js
const { Queue, QueueEvents } = require("bullmq");

const queue = new Queue("Allserver", {
  connection: { host: "localhost", port },
});
const queueEvents = new QueueEvents("Allserver", {
  connection: { host: "localhost", port },
});

const job = await queue.add("updateUser", {
  id: "123412341234123412341234",
  firstName,
  lastName,
});
const data = await job.waitUntilFinished(queueEvents, 30_000);

const { success, code, message, user } = data;
```

### In memory

Sometimes you need to unit test your procedures via the `AllserverClient`. For that we have `MemoryTransport`.

```js
const { Allserver, MemoryTransport } = require("allserver");

const memoryServer = Allserver({
  procedures,
  transport: MemoryTransport(),
});

const client = memoryServer.start();

const { success, code, message, user } = await client.updateUser({
  id: "123412341234123412341234",
  firstName: "Fred",
  lastName: "Flinstone",
});

assert(success === true);
```

### Bare AWS Lambda invocation

First you need to install any of the AWS SDK versions.

```shell
npm i allserver aws-sdk
```

or

```shell
npm i allserver @aws-sdk/client-lambda
```

The invoke the lambda this way:

```js
const { AllserverClient } = require("allserver");
// or
const AllserverClient = require("allserver/Client");

const client = AllserverClient({ uri: "lambda://my-lambda-name" });

const { success, code, message, user } = await client.updateUser({
  id: "123412341234123412341234",
  firstName: "Fred",
  lastName: "Flinstone",
});
```

#### Using AWS SDK

As usual, the client side does not require the Allserver packages at all.

```js
import { Lambda } from "@aws-sdk/client-lambda";

const invocationResponse = await new Lambda().invoke({
  FunctionName: "my-lambda-name",
  Payload: JSON.stringify({
    _: { procedureName: "updateUser" },
    id: "123412341234123412341234",
    firstName: "Fred",
    lastName: "Flinstone",
  }),
});
const { success, code, message, user } = JSON.parse(invocationResponse.Payload);
```

Alternatively, you can call the same procedure using the `aws` CLI:

```shell
aws lambda invoke --function-name my-lambda-name --payload '{"_":{"procedureName":"updateUser"},"id":"123412341234123412341234","firstName":"Fred","lastName":"Flinstone"}}'
```

## `AllserverClient` options

**All the arguments are optional.** But either `uri` or `transport` must be provided. We are trying to keep the highest possible DX here.

- `uri`<br>
  The remote server address string. Out of box supported schemas are: `http`, `https`, `grpc`, `bullmq`. (More to come.)

- `transport`<br>
  The transport implementation object. The `uri` is ignored if this option provided. If not given then it will be automatically created based on the `uri` schema. E.g. if it starts with `http://` or `https://` then `HttpClientTransport` will be used. If starts with `grpc://` then `GrpcClientTransport` will be used. If starts with `bullmq://` then `BullmqClientTransport` is used.

- `neverThrow=true`<br>
  Set it to `false` if you want to get exceptions when there are a network, or a server errors during a procedure call. Otherwise, the standard `{success,code,message}` object is returned from method calls. The Allserver error `code`s are always start with `"ALLSERVER_"`. E.g. `"ALLSERVER_CLIENT_MALFORMED_INTROSPECTION"`.

- `dynamicMethods=true`<br>
  Automatically find (introspect) and call corresponding remote procedures. If set to `false` the `AllserverClient` would use only the `methods` you defined explicitly client-side.

- `autoIntrospect=true`<br>
  Do not automatically search (introspect) for remote procedures, instead use the runtime method names. This mean `AllserverClient` won't guarantee the procedure existence until you try calling the procedure. E.g., this code `allserverClient.myProcedureName()` will do `POST /myProcedureName` HTTP request (aka "call of faith"). Useful when you don't want to expose introspection HTTP endpoint or don't want to add Allserver's mandatory proto in GRPC server.

- `callIntrospectedProceduresOnly=true`<br>
  If introspection couldn't find a procedure then do not attempt sending a "call of faith" to the server.

- `nameMapper`<br>
  A function to map/filter procedure names found on the server to something else. E.g. `nameMapper: name => _.toCamelCase(name)`. If "falsy" value is returned from `nameMapper()` then this procedure won't be added to the `AllserverClient` object instance, like if it was not found on the server.

- `before`<br>
  The "before" client-side middleware(s). Can be either a function, or an array of functions.

- `after`<br>
  The "after" client-side middleware(s). Can be either a function, or an array of functions.

### AllserverClient defaults

You can change the above mentioned options default values like this:

```js
AllseverClient = AllserverClient.defaults({
  transport,
  neverThrow,
  dynamicMethods,
  autoIntrospect,
  callIntrospectedProceduresOnly,
  nameMapper,
  before,
  after,
});

// Then create your client instances as usual:
const httpClient = AllserverClient({ uri: "https://example.com" });
```

### Your own client transport

You can add your own schema support to AllserverClient.

```js
AllserverClient = AllserverClient.addTransport({
  schema: "unixsocket",
  Transport: MyUnixSocketTransport,
});

const client = AllserverClient({ uri: "unixsocket:///example/socket" });
```

You can overwrite the default client transport implementations:

```js
HttpClientTransport = HttpClientTransport.props({
  fetch: require("./fetch-retry"),
});
AllserverClient = AllserverClient.addTransport({
  schema: "http",
  Transport: HttpClientTransport,
});
AllserverClient = AllserverClient.addTransport({
  schema: "https",
  Transport: HttpClientTransport,
});
```

## FAQ

### What happens if I call a procedure, but the remote server does not reply?

If using `AllserverClient` you'll get this result, no exceptions thrown client-side by default:

```json
{
  "success": false,
  "code": "ALLSERVER_CLIENT_PROCEDURE_UNREACHABLE",
  "message": "Couldn't reach remote procedure: procedureName"
}
```

If using your own client module then you'll get your module default behaviour; typically an exception is thrown.

### What happens if I call a procedure which does not exist?

If using `AllserverClient` you'll get this result, no exceptions thrown client-side by default:

```json
{
  "success": false,
  "code": "ALLSERVER_CLIENT_PROCEDURE_NOT_FOUND",
  "message": "Procedure 'procedureName' not found"
}
```

If using your own client module then you'll get your module default behaviour; typically an exception is thrown.

### What happens if I call a procedure which throws?

You'll get a normal reply, no exceptions thrown client-side, but the `success` field will be `false`.

```json
{
  "success": false,
  "code": "ALLSERVER_PROCEDURE_ERROR",
  "message": "''undefined' is not a function' error in 'procedureName' procedure"
}
```

### The Allserver logs to console. How to change that?

In case of internal errors the server would dump the full stack trace to the stderr using its `logger` property (defaults to `console`). Replace the Allserver's logger like this:

```js
const allserver = Allserver({ procedures, logger: new MyShinyLogger() });
// or
Allserver = Allserver.defaults({ logger: new MyShinyLogger() });
const allserver = Allserver({ procedures });
```

### Can I add a server middleware?

You can add one or multiple pre-middlewares, as well as one or multiple post-middlewares. Anything returned from a middleware (except the `undefined`) becomes the call result, and the rest of the middlewares will be skipped if any.

The `after` middleware(s) is always called.

```js
const allserver = Allserver({
  procedures,

  async before(ctx) {
    console.log(ctx.procedureName, ctx.procedure, ctx.arg);
    // If you return anything from here, it will become the call result.
  },
  async after(ctx) {
    console.log(ctx.procedureName, ctx.procedure, ctx.arg);
    console.log(ctx.introspection, ctx.result, ctx.error);
    // If you return anything from here, it will become the call result.
  },
});
```

Multiple middlewares example:

```js
const allserver = Allserver({
  procedures,

  before: myPreMiddlewaresArray,
  after: myPostMiddlewaresArray,
});
```

### Can I add a client-side middleware?

Yep.

```js
const { AllserverClient } = require("allserver");

const client = AllserverClient({
  uri: "http://example.com:40000",

  async before(ctx) {
    console.log(ctx.procedureName, ctx.arg);
    // If you return anything from here, it will become the call result.
  },
  async after(ctx) {
    console.log(ctx.result, ctx.error);
    // If you return anything from here, it will become the call result.
  },
});
```

### How to add Auth?

#### Server side

Server side you do it yourself via the `before` pre-middleware. See above.

Allserver does not (yet) standardise how the "bad auth" replies should look and feel. That's a discussion we need to take. Refer to the **Core principles** above for insights.

#### Client side

This largely depends on the protocol and controlled by the so called "ClientTransport".

##### HTTP

```js
const { AllserverClient, HttpClientTransport } = require("allserver");

const client = AllserverClient({
  transport: HttpClientTransport({
    uri: "http://my-server:40000",
    headers: { authorization: "Basic my-token" },
  }),
});
```

##### gRPC

```js
const { AllserverClient, GrpcClientTransport } = require("allserver");

const client = AllserverClient({
  transport: GrpcClientTransport({
    uri: "grpc://my-server:50051",
    credentials: require("@grpc/grpc-js").credentials.createSsl(/* ... */),
  }),
});
```

##### My authorisation is not supported. What should I do?

If something more sophisticated is needed - you would need to mangle the `ctx` in the client `before` and `after` middlewares.

```js
const { AllserverClient } = require("allserver");

const client = AllserverClient({
  uri: "http://my-server:40000",
  async before(ctx) {
    console.log(ctx.procedureName, ctx.arg);
    ctx.http.mode = "cors";
    ctx.http.credentials = "include";
    ctx.http.headers.authorization = "Basic my-token";
  },
  async after(ctx) {
    if (ctx.error) console.error(ctx.error); else console.log(ctx.result);
  },
});
```

Alternatively, you can "inherit" clients:

```js
const { AllserverClient } = require("allserver");

const MyAllserverClientWithAuth = AllserverClient.defaults({
  async before(ctx) {
    ctx.http.mode = "cors";
    ctx.http.credentials = "include";
    ctx.http.headers.authorization = "Basic my-token";
  },
});

const client = MyAllserverClientWithAuth({
  uri: "http://my-server:40000",
});
```

### Can I override AllserverClient's method?

Sure. This is useful if you need to add client-side logic before doing a remote call.

```js
const { AllserverClient } = require("allserver");
const isEmail = require("is-email");

const MyRpcClient = AllserverClient.methods({
  async updateContact({ id, email }) {
    if (!isEmail(email))
      return {
        success: false,
        code: "BAD_EMAIL",
        message: `${email} is not an email address`,
      };

    // Calling the server
    return this.call("updateContact", { id, email });
  },
});

const myRpcClient = MyRpcClient({ uri: anyKindOfSupportedUri });
const { success } = await myRpcClient.updateContact({ id: 123, email: null });
console.log(success); // false
```

Important note! **The code above does not require any special handling from you.** The `updateContact()` returns exactly the same interface as the remove server. This is one of the reasons why Allserver exists.

### Why `success,code,message`? I want different names.

- `success` is a generic "all good" / "error happened" reply. Occasionally, you can't determine if it's success or a failure. E.g. if a user tries to unsubscribe from a mailing list, but there is no such user in the list. That's why we have `code`.
- `code` is a hardcoded string for machines. Use it in the source code `if` statements.
- `message` is an arbitrary string for humans. Use it as an error/success message on a UI.

I considered using `ok` instead of `success`, but Allserver is DX-first. The `ok` can be confused with the `fetch` API `Response.ok` property: `if ((await fetch(uri)).ok)`, we don't want that. Also, the `ok` is not a noun, thus complicates code reading a bit for newbie developers.

The only mandatory property of the three is `success`. The `code` and `message` are optional. So, you can have different names. Add them to your returned object. Just don't forget to add `success:Boolean` property.

In the example below we mimic Slack's RPC. They use `ok` and `error` properties similar or Allserver's `success` and `message` properties.

```js
const procedures = {
  async sendChatMessage({ channel = "#general", message = "" }) {
    try {
      await sns.sendMessage(/* ... */);
      return { success: true, ok: true };
    } catch (err) {
      return { success: false, ok: false, error: err.message, status: 50014 };
    }
  },
};
```

### TypeScript support?

We are waiting for your contributions.
