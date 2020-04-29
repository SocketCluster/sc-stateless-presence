const isEmpty = require('lodash.isempty');

let SCStatelessPresence = function (options) {
  this.options = options || {};
  this.presenceInterval = this.options.presenceInterval || 10000;
  this.presenceTimeout = this.options.presenceTimeout || Math.round(this.presenceInterval * 1.3);

  this.scServer = options.scServer;
  this.exchange = this.scServer.exchange;
  this.serverSubscribers = {};

  this._authenticationStateChangeConsumer = this.scServer.listener('authenticationStateChange').createConsumer();
  this._subscriptionConsumer = this.scServer.listener('subscription').createConsumer();
  this._unsubscriptionConsumer = this.scServer.listener('unsubscription').createConsumer();
  this._disconnectionConsumer = this.scServer.listener('disconnection').createConsumer();

  (async () => {
    for await (let action of this._authenticationStateChangeConsumer) {
      let {type, socket, channel, data, newAuthState} = action;
      if (newAuthState == socket.UNAUTHENTICATED) {
        this._cleanupAllSubscribers(socket, socket.lastAuthToken);
      } else if (newAuthState == socket.AUTHENTICATED) {
        this._handleNewlyAuthenticatedUser(socket);
      }
    }
  })();

  (async () => {
    for await (let action of this._subscriptionConsumer) {
      let {socket, channel} = action;
      if (this._isPresenceChannel(channel)) {
        this._notifySocketJoin(socket, channel);
        continue;
      }
      let presenceChannelName = this._getPresenceChannelName(channel);
      this._notifySocketJoin(socket, presenceChannelName);

      if (!socket.authToken) {
        continue;
      }
      this._markUserAsPresent(socket, channel);
    }
  })();

  (async () => {
    for await (let action of this._unsubscriptionConsumer) {
      let {socket, channel} = action;
      this._cleanupSubscribers(socket, channel, socket.authToken);
    }
  })();

  (async () => {
    for await (let action of this._disconnectionConsumer) {
      let {socket} = action;
      this._cleanupAllSubscribers(socket, socket.authToken);
    }
  })();

  this._setupPresenceInterval();
};

SCStatelessPresence.prototype._getPresenceChannelName = function (channelName) {
  return 'presence>' + channelName;
};

SCStatelessPresence.prototype._getTargetChannelName = function (channelName) {
  return channelName.replace(/^presence>/, '');
};

SCStatelessPresence.prototype._isPresenceChannel = function (channelName) {
  return /presence>/.test(channelName);
};

SCStatelessPresence.prototype._setupPresenceInterval = function () {
  this._presenceInterval = setInterval(() => {
    Object.keys(this.serverSubscribers).forEach((channelName) => {
      let users = Object.keys(this.serverSubscribers[channelName]);
      if (users.length) {
        let presenceChannelName = this._getPresenceChannelName(channelName);
        this.exchange.transmitPublish(presenceChannelName, {
          type: 'ping',
          timeout: this.presenceTimeout,
          users: users
        });
      }
    });
  }, this.presenceInterval);
};

SCStatelessPresence.prototype._getUserPresenceList = function (channelName) {
  let channelUserMap = this.serverSubscribers[channelName];
  return Object.keys(channelUserMap || {});
};

SCStatelessPresence.prototype._notifySocketJoin = function (socket, presenceChannelName) {
  this.exchange.transmitPublish(presenceChannelName, {
    type: 'join',
    timeout: this.presenceTimeout,
    socketId: socket.id
  });
};

SCStatelessPresence.prototype._markUserAsPresent = function (socket, channelName) {
  let username = socket.authToken.username;
  if (username == null) {
    return;
  }
  let presenceChannelName = this._getPresenceChannelName(channelName);
  this.exchange.transmitPublish(presenceChannelName, {
    type: 'join',
    username: username,
    timeout: this.presenceTimeout,
    socketId: socket.id
  });

  if (!this.serverSubscribers[channelName]) {
    this.serverSubscribers[channelName] = {};
  }
  if (!this.serverSubscribers[channelName][username]) {
    this.serverSubscribers[channelName][username] = {};
  }
  this.serverSubscribers[channelName][username][socket.id] = socket;
};

SCStatelessPresence.prototype._handleNewlyAuthenticatedUser = function (socket) {
  if (socket.lastAuthToken && socket.lastAuthToken.username !== socket.authToken.username) {
    this._cleanupAllSubscribers(socket, socket.lastAuthToken);
  }
  socket.lastAuthToken = socket.authToken;
  let subscriptions = socket.subscriptions();
  subscriptions.forEach((channelName) => {
    this._markUserAsPresent(socket, channelName);
  });
};

SCStatelessPresence.prototype._cleanupAllSubscribers = function (socket, authToken) {
  let subscriptions = socket.subscriptions();
  subscriptions.forEach((channelName) => {
    this._cleanupSubscribers(socket, channelName, authToken);
  });
};

SCStatelessPresence.prototype._cleanupSubscribers = function (socket, channelName, authToken) {
  if (this._isPresenceChannel(channelName)) {
    return;
  }
  if (!authToken) {
    return;
  }
  if (!authToken.username) {
    return;
  }
  let username = authToken.username;

  let presenceChannelName = this._getPresenceChannelName(channelName);
  this.exchange.transmitPublish(presenceChannelName, {
    type: 'leave',
    username: username
  });

  if (this.serverSubscribers[channelName] && this.serverSubscribers[channelName][username]) {
    delete this.serverSubscribers[channelName][username][socket.id];
  }

  if (this.serverSubscribers[channelName] && isEmpty(this.serverSubscribers[channelName][username])) {
    delete this.serverSubscribers[channelName][username];
  }
  if (isEmpty(this.serverSubscribers[channelName])) {
    delete this.serverSubscribers[channelName];
  }
};

SCStatelessPresence.prototype.destroy = function () {
  clearInterval(this._presenceInterval);
  this._authenticationStateChangeConsumer.kill();
  this._subscriptionConsumer.kill();
  this._unsubscriptionConsumer.kill();
  this._disconnectionConsumer.kill();
};

module.exports.SCStatelessPresence = SCStatelessPresence;

module.exports.attach = function (scServer, options) {
  if (options) {
    options.scServer = scServer;
  } else {
    options = {scServer};
  }
  return new SCStatelessPresence(options);
};
