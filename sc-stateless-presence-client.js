
var SCStatelessPresenceClient = function (socket, options) {
  var self = this;

  this.presenceChannelPrefix = 'presence>';
  this.socket = socket;
  this.channelUsers = {};
  this.channelListeners = {};

  this.presenceCheckInterval = options.presenceCheckInterval;
  this._setupPresenceExpiryInterval();
};

SCStatelessPresenceClient.prototype._setupPresenceExpiryInterval = function () {
  setInterval(function () {
    Object.keys(self.channelUsers).forEach(function (channelName) {
      Object.keys(self.channelUsers[channelName] || {}).forEach(function (username) {
        var userData = self.channelUsers[channelName][username];
        if (userData.expiry < Date.now()) {
          self.channelListeners[channelName].forEach(function (listener) {
            listener({
              action: 'leave',
              username: username
            });
          });
          delete self.channelUsers[channelName][username];
        }
      });
    });
  }, this.presenceCheckInterval);
};

SCStatelessPresenceClient.prototype.trackPresence = function (channelName, listener) {
  var self = this;

  if (!this.channelUsers[channelName]) {
    this.channelUsers[channelName] = {};
  }
  var presenceChannelName = this.presenceChannelPrefix + channelName;
  if (!this.socket.isSubscribed(presenceChannelName, true)) {
    this.socket.subscribe(presenceChannelName).watch(function (presencePacket) {
      var now = Date.now();
      if (presencePacket.type == 'join') {
        listener({
          action: 'join',
          username: presencePacket.username
        });
      } else if (presencePacket.type == 'leave') {
        listener({
          action: 'leave',
          username: presencePacket.username
        });
      } else if (presencePacket.type == 'ping') {
        presencePacket.users.forEach(function (username) {
          self.channelUsers[channelName][username] = {
            expiry: now + presencePacket.timeout
          };
        });
      }
    });
  }
  if (!this.channelListeners[channelName]) {
    this.channelListeners[channelName] = [];
  }
  this.channelListeners[channelName].push(listener);
};

module.exports.SCStatelessPresenceClient = SCStatelessPresenceClient;
