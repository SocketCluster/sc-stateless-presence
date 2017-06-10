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
};

SCStatelessPresence._getPresenceChannelName = function (channelName) {
  return 'presence>' + channelName;
};

SCStatelessPresence._isPresenceChannel = function (channelName) {
  return /presence>/.test(channelName);
};

SCStatelessPresence._setupPresenceInterval = function () {
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

SCStatelessPresence._getUserPresenceList = function (channelName) {
  var channelUserMap = this.workerSubscribers[channelName];
  return Object.keys(channelUserMap || {});
};

SCStatelessPresence.prototype._setupPresenceMiddleware = function () {
  this.scServer.addMiddleware(this.scServer.MIDDLEWARE_SUBSCRIBE, function (req, next) {
    var channelName = req.channel;
    var socket = req.socket;

    if (this._isPresenceChannel(channelName)) {
      next();
      return;
    }
    if (!socket.authToken) {
      next();
      return;
    }
    var username = socket.authToken.username;
    if (username == null) {
      next();
      return;
    }

    var presenceChannelName = this._getPresenceChannelName(channelName);
    this.exchange.publish(presenceChannelName, {
      type: 'join',
      username: username
    });

    if (!this.workerSubscribers[channelName]) {
      this.workerSubscribers[channelName] = {};
    }
    if (!this.workerSubscribers[channelName][username]) {
      this.workerSubscribers[channelName][username] = {};
    }
    this.workerSubscribers[channelName][username][socket.id] = socket;

    if (!socket.listeners('unsubscribe').length) {
      // Attach presence cleanup function to the socket if not already attached.
      this._cleanupSubscribersOnUnsubscribe(socket);
    }
    next();
  }.bind(this));
};

SCStatelessPresence.prototype._cleanupSubscribersOnUnsubscribe = function (socket) {
  socket.on('unsubscribe', function (channelName) {
    if (!socket.authToken) {
      return;
    }
    var username = socket.authToken.username;

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
  }.bind(this));
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
