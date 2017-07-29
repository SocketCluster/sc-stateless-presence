# sc-stateless-presence
Plugin for doing stateless presence in SC.

This plugin lets you do real-time channel presence at scale without having to use an external memory store or database.
It's ideal for tracking the presence of users within channels that have fewer than 100 concurrent subscribers
online at any given time.

Requires SocketCluster version `6.0.1` or higher.

To use:

```bash
npm install sc-stateless-presence
```

On the server side, in `worker.js`:

```js
var scStatelessPresence = require('sc-stateless-presence');

// Pass the SCWorker instance as argument.
// The options object is optional.
//
// Valid properties of the options object include:
// presenceInterval: Number of milliseconds interval to ping out user presence.
//                   Defaults to 10000.
// presenceTimeout: Number of milliseconds without a ping which signifies that
//                  a user has gone offline. Defaults to presenceInterval * 1.3.

scStatelessPresence.attach(worker, options);
```

On the client side, you need to require `client.js` (if using webpack or Browserify) or include the standalone script `sc-stateless-presence-client.js`, then:

```js
// Pass an existing socketcluster-client socket as argument.
// The options object is optional.
//
// Valid properties of the options object include:
// presenceCheckInterval: This is an interval (in milliseconds)
//                        that the client uses to evaluate the presence
//                        status of users. Defaults to 1000.
//                        Using a larger value means that the client
//                        will take more time to detect when a user has
//                        gone offline because of a connection failure.

window.presence = scStatelessPresenceClient.create(socket, options);
```

### Contributing

To build the standalone client:

```
browserify -s scStatelessPresenceClient client.js > sc-stateless-presence-client.js
```
