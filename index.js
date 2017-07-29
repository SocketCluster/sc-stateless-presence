var isEmpty = require('lodash.isempty');

var SCStatelessPresence = function (options) {
  this.options = options || {};
  this.presenceInterval = this.options.presenceInterval || 10000;
  this.presenceTimeout = this.options.presenceTimeout || Math.round(this.presenceInterval * 1.3);

  this.worker = options.worker;
  this.scServer = this.worker.scServer;
  this.exchange = this.scServer.exchange;
  this.workerSubscribers = {};

  this._setupPresenceMiddleware();
  this._setupPresenceInterval();

  this.scServer.on('authentication', this._handleNewlyAuthenticatedUser.bind(this));
  this.scServer.on('deauthentication', this._cleanupAllSubscribers.bind(this));
  this.scServer.on('unsubscription', function (socket, channelName) {
    this._cleanupSubscribers(socket, channelName, socket.authToken);
  }.bind(this));
  this.scServer.on('disconnection', function (socket) {
    this._cleanupAllSubscribers(socket, socket.authToken);
  }.bind(this));
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
        this.exchange.publish(presenceChannelName, {
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
  this.exchange.publish(presenceChannelName, {
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

  this.exchange.publish(presenceChannelName, {
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
  var subscriptions = socket.subscriptions();
  subscriptions.forEach(function (channelName) {
    this._markUserAsPresent(socket, channelName);
  }.bind(this));
};

SCStatelessPresence.prototype._setupPresenceMiddleware = function () {
  this.scServer.addMiddleware(this.scServer.MIDDLEWARE_SUBSCRIBE, function (req, next) {
    var channelName = req.channel;
    var socket = req.socket;

    if (this._isPresenceChannel(channelName)) {
      next();
      this._notifySocketJoin(socket, channelName);
      return;
    }
    var presenceChannelName = this._getPresenceChannelName(channelName);
    this._notifySocketJoin(socket, presenceChannelName);

    if (!socket.authToken) {
      next();
      return;
    }

    this._markUserAsPresent(socket, channelName);

    next();
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
  this.exchange.publish(presenceChannelName, {
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
