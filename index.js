var isEmpty = require('lodash.isempty');

var SCStatelessPresence = function (options) {
  var self = this
  this.options = options || {};
  this.presenceInterval = this.options.presenceInterval || 10000;
  this.presenceTimeout = this.options.presenceTimeout || Math.round(this.presenceInterval * 1.3);

  this.worker = options.worker;
  this.scServer = this.worker;
  this.exchange = this.scServer.exchange;
  this.workerSubscribers = {};

  this._setupPresenceMiddleware();
  this._setupPresenceInterval();
  (async () =>{
    for await (let action of self.scServer.listener('authenticationStateChange')) {
      let { type, socket, channel, data } = action
      if(action.newAuthState == action.socket.UNAUTHENTICATED){
        self._cleanupSubscribers(socket, channel, socket.authToken)
      }else if(action.newAuthState == action.socket.AUTHENTICATED){
        self._handleNewlyAuthenticatedUser(socket)
      }
    }
  })();
  (async () =>{
    for await (let action of self.scServer.listener('subscription')) {
      let { type, socket, channel, data } = action
      if(action.newAuthState == action.socket.UNAUTHENTICATED){
        self._cleanupSubscribers(socket, channel, socket.authToken)
      }else if(action.newAuthState == action.socket.AUTHENTICATED){
        self._handleNewlyAuthenticatedUser(socket)
      }
    }
  })();
  (async () =>{
    for await (let action of self.scServer.listener('unsubscription')) {
      let { type, socket, channel, data } = action
      self._cleanupSubscribers(socket, channel, socket.authToken)
    }
  })();

  (async () =>{
    for await (let action of self.scServer.listener('disconnection')) {
      let { type, socket, channel, data } = action
      if(action.code == 1000){
        self._cleanupAllSubscribers(socket, socket.authToken)
      }
    }
  })();
  return this.scServer
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
  setInterval(function () {
    Object.keys(this.workerSubscribers).forEach(function (channelName) {
      var users = Object.keys(this.workerSubscribers[channelName]);
      if (users.length) {
        var presenceChannelName = this._getPresenceChannelName(channelName);
        this.exchange.transmitPublish(presenceChannelName, {
          type: 'ping',
          timeout: this.presenceTimeout,
          users: users
        });
      }
    }.bind(this));
  }.bind(this), this.presenceInterval);
};

SCStatelessPresence.prototype._getUserPresenceList = function (channelName) {
  var channelUserMap = this.workerSubscribers[channelName];
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
  var username = socket.authToken.username;
  if (username == null) {
    return;
  }
  var presenceChannelName = this._getPresenceChannelName(channelName);
  this.exchange.transmitPublish(presenceChannelName, {
    type: 'join',
    username: username,
    timeout: this.presenceTimeout,
    socketId: socket.id
  });

  if (!this.workerSubscribers[channelName]) {
    this.workerSubscribers[channelName] = {};
  }
  if (!this.workerSubscribers[channelName][username]) {
    this.workerSubscribers[channelName][username] = {};
  }
  this.workerSubscribers[channelName][username][socket.id] = socket;
};

SCStatelessPresence.prototype._handleNewlyAuthenticatedUser = function (socket) {
  if (socket.lastAuthToken && socket.lastAuthToken.username !== socket.authToken.username) {
    this._cleanupAllSubscribers(socket, socket.lastAuthToken);
  }
  socket.lastAuthToken = socket.authToken;
  var subscriptions = socket.subscriptions();
  subscriptions.forEach(function (channelName) {
    this._markUserAsPresent(socket, channelName);
  }.bind(this));
};

SCStatelessPresence.prototype._setupPresenceMiddleware = function () {
  this.scServer.setMiddleware(this.scServer.MIDDLEWARE_INBOUND, async function (middlewareStream) {
    for await (let action of middlewareStream) {
      if (action.type === action.SUBSCRIBE) {
        let { type, socket, channel, data } = action
        var channelName = channel;
        if (this._isPresenceChannel(channelName)) {
          action.allow();
          this._notifySocketJoin(socket, channelName);
          return;
        }
        var presenceChannelName = this._getPresenceChannelName(channelName);
        this._notifySocketJoin(socket, presenceChannelName);
    
        if (!socket.authToken) {
          action.allow();
          return;
        }
        this._markUserAsPresent(socket, channelName);
        action.allow();
      }else{
        action.allow();
      }
      
    }
  }.bind(this));
};

SCStatelessPresence.prototype._cleanupAllSubscribers = function (socket, authToken) {
  var subscriptions = socket.subscriptions();
  subscriptions.forEach(function (channelName) {
    this._cleanupSubscribers(socket, channelName, authToken);
  }.bind(this));
};

SCStatelessPresence.prototype._cleanupSubscribers = function (socket, channelName, authToken) {
  if (this._isPresenceChannel(channelName)) {
    return;
  }
  if (!authToken) {
    return;
  }
  var username = authToken.username;

  var presenceChannelName = this._getPresenceChannelName(channelName);
  this.exchange.transmitPublish(presenceChannelName, {
    type: 'leave',
    username: username
  });

  if (this.workerSubscribers[channelName] && this.workerSubscribers[channelName][username]) {
    delete this.workerSubscribers[channelName][username][socket.id];
  }

  if (this.workerSubscribers[channelName] && isEmpty(this.workerSubscribers[channelName][username])) {
    delete this.workerSubscribers[channelName][username];
  }
  if (isEmpty(this.workerSubscribers[channelName])) {
    delete this.workerSubscribers[channelName];
  }
};

module.exports.SCStatelessPresence = SCStatelessPresence;

module.exports.attach = function (worker, options) {
  if (options) {
    options.worker = worker;
  } else {
    options = {worker: worker};
  }
  return new SCStatelessPresence(options);
};
