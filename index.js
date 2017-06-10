var isEmpty = require('lodash.isempty');

var SCStatelessPresence = function (options) {
  this.options = options || {};
  this.presenceInterval = this.options.presenceInterval || 5000;

  this.worker = options.worker;
  this.exchange = this.worker.scServer.exchange;
  this.workerSubscribers = {};

  this._setupPresenceMiddleware();
  this._setupPresenceInterval();
};

SCStatelessPresence._getPresenceChannelName = function (channelName) {
  return 'presence>' + channelName;
};

SCStatelessPresence._setupPresenceInterval = function () {
  setInterval(function () {
    Object.keys(this.workerSubscribers).forEach(function (channelName) {
      var users = Object.keys(this.workerSubscribers[channelName]);
      if (users.length) {
        var presenceChannelName = this._getPresenceChannelName(channelName);
        this.exchange.publish(presenceChannelName, {
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
  this.worker.addMiddleware(this.worker.MIDDLEWARE_SUBSCRIBE, function (req, next) {
    var channel = req.channel;
    var socket = req.socket;
    if (!socket.authToken) {
      return;
    }
    var username = socket.authToken.username;
    if (username == null) {
      return;
    }
    if (!this.workerSubscribers[channel]) {
      this.workerSubscribers[channel] = {};
    }
    if (!this.workerSubscribers[channel][username]) {
      this.workerSubscribers[channel][username] = {};
    }
    this.workerSubscribers[channel][username][socket.id] = socket;

    if (!socket.listeners('unsubscribe').length) {
      // Attach presence cleanup function to the socket if not already attached.
      this._cleanupSubscribersOnUnsubscribe(socket);
    }
  }.bind(this));
};

SCStatelessPresence.prototype._cleanupSubscribersOnUnsubscribe = function (socket) {
  socket.on('unsubscribe', function (channelName) {
    if (!socket.authToken) {
      return;
    }
    var username = socket.authToken.username;
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
