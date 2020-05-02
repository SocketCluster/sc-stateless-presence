const isEmpty = require('lodash.isempty');
const StreamDemux = require('stream-demux');

let SCStatelessPresenceClient = function (socket, options) {
  options = options || {};

  this.presenceChannelPrefix = 'presence>';
  this.socket = socket;
  this.channelUsers = {};
  this.channelPresenceTrackerStreams = {};
  this._trackerStreamMultiplexer = new StreamDemux();
  this.socket.options.autoSubscribeOnConnect = false;

  this.presenceCheckInterval = options.presenceCheckInterval || 1000;
  this._setupPresenceExpiryInterval();

  let lastSocketId = null;

  let setupSocketChannel = () => {
    lastSocketId = socket.id;

    if (this._lastSocketChannel) {
      this._lastSocketChannel.unsubscribe();
      this._lastSocketChannel.kill();
    }

    let socketChannelName = this._getSocketPresenceChannelName(lastSocketId);
    let socketChannel = this.socket.subscribe(socketChannelName);
    this._lastSocketChannel = socketChannel;

    // Give socketChannel a higher priority, that way it will subscribe first.
    let maxPriority = 0;
    let subscriptions = this.socket.subscriptions(true);
    subscriptions.forEach((channelName) => {
      let priority = socket.channel(channelName).priority;
      if (priority > maxPriority) {
        maxPriority = priority;
      }
    });
    socketChannel.priority = maxPriority + 1;

    (async () => {
      // Set up a loop to handle remote transmitted events.
      for await (let presencePacket of socketChannel.listener('message')) {
        if (presencePacket.type == 'pong') {
          this._markUserAsPresent(presencePacket.channel, presencePacket.username, Date.now() + presencePacket.timeout);
        }
      }
    })();

    this.socket.processPendingSubscriptions();
  };

  this._connectConsumer = this.socket.listener('connect').createConsumer();
  this._closeConsumer = this.socket.listener('close').createConsumer();

  if (this.socket.state == 'open') {
    setupSocketChannel();
  }

  (async () => {
    // Set up a loop to handle remote transmitted events.
    for await (let message of this._connectConsumer) {
      setupSocketChannel();
    }
  })();

  (async () => {
    // Set up a loop to handle remote transmitted events.
    for await (let message of this._closeConsumer) {
      let socketChannelName = this._getSocketPresenceChannelName(lastSocketId);
      this.socket.unsubscribe(socketChannelName);

      Object.keys(this.channelUsers).forEach((channelName) => {
        Object.keys(this.channelUsers[channelName] || {}).forEach((username) => {
            let userData = this.channelUsers[channelName][username];
            this._markUserAsAbsent(channelName, username);
        });
      });
    }
  })();
};

SCStatelessPresenceClient.prototype._getSocketPresenceChannelName = function (socketId) {
  return this.presenceChannelPrefix + 'socket/' + socketId;
};

SCStatelessPresenceClient.prototype._setupPresenceExpiryInterval = function () {
  this._presenceExpiryInterval = setInterval(() => {
    Object.keys(this.channelUsers).forEach((channelName) => {
      Object.keys(this.channelUsers[channelName] || {}).forEach((username) => {
        let userData = this.channelUsers[channelName][username];
        if (userData.expiry < Date.now()) {
          this._markUserAsAbsent(channelName, username);
        }
      });
    });
  }, this.presenceCheckInterval);
};

SCStatelessPresenceClient.prototype.isPresent = function (channelName, username) {
  return !!(this.channelUsers[channelName] && this.channelUsers[channelName][username]);
};

SCStatelessPresenceClient.prototype.getPresenceList = function (channelName) {
  let userMap = this.channelUsers[channelName];
  let userList = [];

  for (let username in userMap) {
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
  let userData = this.channelUsers[channelName][username];
  userData.expiry = expiry;

  if (!userData.isPresent) {
    userData.isPresent = true;
    let presenceChannelName = this.presenceChannelPrefix + channelName;
    this._trackerStreamMultiplexer.write(presenceChannelName, {
      action: 'join',
      username: username
    });
  }
};

SCStatelessPresenceClient.prototype._markUserAsAbsent = function (channelName, username) {
  if (!this.channelUsers[channelName]) {
    return;
  }
  let userData = this.channelUsers[channelName][username];
  if (userData) {
    delete this.channelUsers[channelName][username];

    if (userData.isPresent) {
      delete userData.isPresent;
      let presenceChannelName = this.presenceChannelPrefix + channelName;
      this._trackerStreamMultiplexer.write(presenceChannelName, {
        action: 'leave',
        username: username
      });
    }
  }
  if (isEmpty(this.channelUsers[channelName])) {
    delete this.channelUsers[channelName];
  }
};

SCStatelessPresenceClient.prototype._sendSocketChannelPong = function (socket, channelName, presencePacket) {
  if (socket.authToken && socket.authToken.username != null) {
    let socketChannelName = this._getSocketPresenceChannelName(presencePacket.socketId);
    socket.transmitPublish(socketChannelName, {
      type: 'pong',
      channel: channelName,
      username: socket.authToken.username,
      timeout: presencePacket.timeout
    });
  }
};

SCStatelessPresenceClient.prototype.trackPresence = function (channelName) {
  let presenceChannelName = this.presenceChannelPrefix + channelName;
  this.socket.subscribe(presenceChannelName);
  let substream = this._trackerStreamMultiplexer.stream(presenceChannelName);
  this.channelPresenceTrackerStreams[channelName] = true;
  (async () => {
    let channel = this.socket.channel(presenceChannelName)
    // Set up a loop to handle remote transmitted events.
    for await (let presencePacket of channel) {
      let now = Date.now();
      if (presencePacket.type == 'join') {
          // A socket can join without necessarily having a user attached (not authenticated);
          // in this case we won't have any new user to mark as present but we will pong back
          // the socket anyway with the current socket's presence status.
          if (presencePacket.username != null) {
              this._markUserAsPresent(channelName, presencePacket.username, now + presencePacket.timeout);
          }
          this._sendSocketChannelPong(this.socket, channelName, presencePacket);
      } else if (presencePacket.type == 'ping') {
          presencePacket.users.forEach((username) => {
              this._markUserAsPresent(channelName, username, now + presencePacket.timeout);
          });
      } else if (presencePacket.type == 'leave') {
          this._markUserAsAbsent(channelName, presencePacket.username);
      }
    }
  })();
  return substream;
};

SCStatelessPresenceClient.prototype._cleanupPresenceChannelTracking = function (channelName, presenceChannelName) {
  let channel = this.socket.channel(presenceChannelName);
  if (channel) {
    channel.unsubscribe();
    channel.kill();
    delete this.channelPresenceTrackerStreams[channelName];
    delete this.channelUsers[channelName];
  }
};

SCStatelessPresenceClient.prototype.untrackPresence = function (channelName)  {
  let presenceChannelName = this.presenceChannelPrefix + channelName;
  this._cleanupPresenceChannelTracking(channelName, presenceChannelName);
};

SCStatelessPresenceClient.prototype.untrackAllPresences = function () {
  let presenceChannels = Object.keys(this.channelPresenceTrackerStreams);
  for (let channelName of presenceChannels) {
    this.untrackPresence(channelName);
  }
}

SCStatelessPresenceClient.prototype.destroy = function () {
  clearInterval(this._presenceExpiryInterval);
  this.untrackAllPresences();
  this._connectConsumer.kill();
  this._closeConsumer.kill();
  if (this._lastSocketChannel) {
    this._lastSocketChannel.unsubscribe();
    this._lastSocketChannel.kill();
  }
};

module.exports.SCStatelessPresenceClient = SCStatelessPresenceClient;

module.exports.create = function (socket, options) {
  return new SCStatelessPresenceClient(socket, options);
};
