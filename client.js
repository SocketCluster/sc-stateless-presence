var isEmpty = require('lodash.isempty');


var SCStatelessPresenceClient = function (socket, options) {
  var self = this;

  options = options || {};

  this.presenceChannelPrefix = 'presence>';
  this.socket = socket;
  this.channelUsers = {};
  this.channelListeners = {};

  this.socket.options.autoSubscribeOnConnect = false;

  this.presenceCheckInterval = options.presenceCheckInterval || 1000;
  this._setupPresenceExpiryInterval();

  var lastSocketId = null;

  var setupSocketChannel = function () {
    lastSocketId = socket.id;

    var socketChannelName = self._getSocketPresenceChannelName(lastSocketId);
    var socketChannel = self.socket.subscribe(socketChannelName);

    // Give socketChannel a higher priority, that way it will subscribe first.
    var maxPriority = 0;
    var subscriptions = socket.subscriptions(true);
    subscriptions.forEach(function (channelName) {
      var priority = socket.channel(channelName).priority;
      if (priority > maxPriority) {
        maxPriority = priority;
      }
    });
    socketChannel.priority = maxPriority + 1;

    socketChannel.watch(function (presencePacket) {
      if (presencePacket.type == 'pong') {
        self._markUserAsPresent(presencePacket.channel, presencePacket.username, Date.now() + presencePacket.timeout);
      }
    });
    self.socket.processPendingSubscriptions();
  };

  if (self.socket.state == 'open') {
    setupSocketChannel();
  }
  socket.on('connect', setupSocketChannel);
  socket.on('disconnect', function () {
    var socketChannelName = self._getSocketPresenceChannelName(lastSocketId);
    self.socket.unsubscribe(socketChannelName);

    Object.keys(self.channelUsers).forEach(function (channelName) {
      Object.keys(self.channelUsers[channelName] || {}).forEach(function (username) {
        var userData = self.channelUsers[channelName][username];
        self._markUserAsAbsent(channelName, username);
      });
    });
  });
};

SCStatelessPresenceClient.prototype._getSocketPresenceChannelName = function (socketId) {
  return this.presenceChannelPrefix + 'socket/' + socketId;
};

SCStatelessPresenceClient.prototype._setupPresenceExpiryInterval = function () {
  var self = this;

  setInterval(function () {
    Object.keys(self.channelUsers).forEach(function (channelName) {
      Object.keys(self.channelUsers[channelName] || {}).forEach(function (username) {
        var userData = self.channelUsers[channelName][username];
        if (userData.expiry < Date.now()) {
          self._markUserAsAbsent(channelName, username);
        }
      });
    });
  }, this.presenceCheckInterval);
};

SCStatelessPresenceClient.prototype.isPresent = function (channelName, username) {
  return !!(this.channelUsers[channelName] && this.channelUsers[channelName][username]);
};

SCStatelessPresenceClient.prototype.getPresenceList = function (channelName) {
  var userMap = this.channelUsers[channelName];
  var userList = [];

  for (var username in userMap) {
    if (userMap.hasOwnProperty(username)) {
      userList.push(username);
    }
  }
  return userList;
};

SCStatelessPresenceClient.prototype._markUserAsPresent = function (channelName, username, expiry) {
  if (!this.channelUsers[channelName]) {
    this.channelUsers[channelName] = {};
  }
  if (!this.channelUsers[channelName][username]) {
    this.channelUsers[channelName][username] = {};
  }
  var userData = this.channelUsers[channelName][username];
  userData.expiry = expiry;

  if (!userData.isPresent) {
    userData.isPresent = true;
    this.channelListeners[channelName].forEach(function (listener) {
      listener({
        action: 'join',
        username: username
      });
    });
  }
};

SCStatelessPresenceClient.prototype._markUserAsAbsent = function (channelName, username) {
  if (!this.channelUsers[channelName]) {
    return;
  }
  var userData = this.channelUsers[channelName][username];

  if (userData) {
    delete this.channelUsers[channelName][username];

    if (userData.isPresent) {
      delete userData.isPresent;
      (this.channelListeners[channelName] || []).forEach(function (listener) {
        listener({
          action: 'leave',
          username: username
        });
      });
    }
  }
  if (isEmpty(this.channelUsers[channelName])) {
    delete this.channelUsers[channelName];
  }
};

SCStatelessPresenceClient.prototype._sendSocketChannelPong = function (socket, channelName, presencePacket) {
  if (socket.authToken && socket.authToken.username != null) {
    var socketChannelName = this._getSocketPresenceChannelName(presencePacket.socketId);
    socket.publish(socketChannelName, {
      type: 'pong',
      channel: channelName,
      username: socket.authToken.username,
      timeout: presencePacket.timeout
    });
  }
};

SCStatelessPresenceClient.prototype.trackPresence = function (channelName, listener) {
  var self = this;

  var presenceChannelName = this.presenceChannelPrefix + channelName;
  this.socket.subscribe(presenceChannelName);

  if (!this.channelListeners[channelName]) {
    this.channelListeners[channelName] = [];

    this.socket.channel(presenceChannelName).watch(function (presencePacket) {
      var now = Date.now();

      if (presencePacket.type == 'join') {
        // A socket can join without necessarily having a user attached (not authenticated);
        // in this case we won't have any new user to mark as present but we will pong back
        // the socket anyway with the current socket's presence status.
        if (presencePacket.username != null) {
          self._markUserAsPresent(channelName, presencePacket.username, now + presencePacket.timeout);
        }
        self._sendSocketChannelPong(self.socket, channelName, presencePacket);
      } else if (presencePacket.type == 'ping') {
        presencePacket.users.forEach(function (username) {
          self._markUserAsPresent(channelName, username, now + presencePacket.timeout);
        });
      } else if (presencePacket.type == 'leave') {
        self._markUserAsAbsent(channelName, presencePacket.username);
      }
    });
  }
  if (listener) {
    this.channelListeners[channelName].push(listener);
  }
};

SCStatelessPresenceClient.prototype._cleanupPresenceChannelTracking = function (channelName, presenceChannelName) {
  this.socket.unsubscribe(presenceChannelName);
  delete this.channelListeners[channelName];
  delete this.channelUsers[channelName];
};

SCStatelessPresenceClient.prototype.untrackPresence = function (channelName, listener) {
  var presenceChannelName = this.presenceChannelPrefix + channelName;

  if (listener) {
    if (this.channelListeners[channelName]) {
      this.channelListeners[channelName] = this.channelListeners[channelName].filter(function (channelListener) {
        return channelListener !== listener;
      });
      if (!this.channelListeners[channelName].length) {
        this._cleanupPresenceChannelTracking(channelName, presenceChannelName);
      }
    }
  } else {
    this._cleanupPresenceChannelTracking(channelName, presenceChannelName);
  }
};

module.exports.SCStatelessPresenceClient = SCStatelessPresenceClient;
module.exports.create = function (socket, options) {
  return new SCStatelessPresenceClient(socket, options);
};
