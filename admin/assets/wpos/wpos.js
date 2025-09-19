this.startSocket = function() {
    if (socket === null){
        var socket = io.connect("https://ws.wallacepos.vi-tech612.com", { transports: ['websocket'] });

socket = io.connect(socketPath, {
    transports: ['websocket', 'polling']
});


        socketon = true;

        // on connect: authenticate using feedserver_key
        socket.on('connect', function () {
            try {
                var key = WPOS.getConfigTable().general.feedserver_key;
                console.log("Socket connected, sending authentication...");
                socket.emit('authentication', { key: key });
            } catch (e) {
                console.error("Authentication emit failed:", e);
            }
        });

        socket.on('authenticated', function(res){
            if (res && res.success){
                console.log("Socket authenticated OK");
            } else {
                console.error("Socket authentication failed (admin):", res && res.error);
                // fallback: try to request server session auth
                if (!authretry){
                    authretry = true;
                    var result = WPOS.getJsonData('auth/websocket');
                    if (result === true){
                        // retry connect
                        WPOS.startSocket();
                        return;
                    }
                }
                socketError();
            }
        });

        socket.on('connect_error', socketError);
        socket.on('reconnect_error', socketError);
        socket.on('error', socketError);

        socket.on('updates', function (data) {
            if (!data || !data.a) return;
            switch (data.a) {
                case "devices":
                    var onlinedev = {};
                    try { onlinedev = JSON.parse(data.data); } catch(e){ console.warn("devices parse error", e); }
                    populateOnlineDevices(onlinedev);
                    break;

                case "sale":
                    processIncomingSale(data.data);
                    break;

                case "regreq":
                    // server asks admin to register as device 0
                    socket.emit('reg', { deviceid: 0, username: curuser.username });
                    break;

                case "error":
                    if (!authretry && data.data && data.data.code == "auth") {
                        authretry = true;
                        WPOS.stopSocket();
                        var result = WPOS.getJsonData('auth/websocket');
                        if (result===true){
                            WPOS.startSocket();
                            return;
                        }
                    } else {
                        alert(data.data.message);
                    }
                    break;

                default:
                    // other updates handled elsewhere
                    break;
            }
        });
    } else {
        socket.connect();
    }
};
