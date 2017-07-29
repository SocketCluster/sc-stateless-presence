# sc-stateless-presence
Plugin for doing stateless presence in SC.

This plugin lets you do real-time channel presence at scale without having to use an external memory store or database.
It's ideal for tracking the presence of users within channels that have fewer than 100 concurrent subscribers
online at any given time.

Requires SocketCluster version `6.0.1` or higher.

You may want to read the SocketCluster authentication guide before using this plugin: https://socketcluster.io/#!/docs/authentication

### Installing

```bash
npm install sc-stateless-presence
```


### On the server

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

Note that `sc-stateless-presence` tracks users based on a `username` property inside JWT tokens attached to sockets.

To create a JWT token from SC on the server side, you will need to do something like this:

```js
socket.setAuthToken({username: 'alice123'});
```

It doesn't matter how the JWT token is created though (e.g. you can create it over HTTP before you connect the socket), so long as:

- SC can verify the JWT with its own `authKey` (see the `authKey` option here: https://socketcluster.io/#!/docs/api-socketcluster).
- The JWT token contains a JSON object which has a `username` property (make sure that the letter case matches exactly and that the value is a string which represents the user's username).

For details about creating the JWT with HTTP before connecting the real-time socket in SocketCluster, see this discussion: https://github.com/SocketCluster/socketcluster/issues/233#issuecomment-254871963


### On the client

On the client side, you need to require `client.js` (if using webpack or Browserify) or include the standalone script `sc-stateless-presence-client.js` on your front end, then:

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

var presence = scStatelessPresenceClient.create(socket, options);
```

To track user presence on a channel on the client side:

```js
presence.trackPresence('sample', function (action) {
  // The action argument can be in the form:
  // { action: 'join', username: 'bob123' } or { action: 'leave', username: 'alice456' }
  console.log('PRESENCE:', action);
});
```

### Contributing

To build the standalone client:

```
browserify -s scStatelessPresenceClient client.js > sc-stateless-presence-client.js
```
