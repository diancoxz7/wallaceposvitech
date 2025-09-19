/**
 * WPOS Websocket update relay, node.js server.
 * Patched: authentication event, device registration broadcast, sale broadcast,
 * periodic device list broadcast for reliability.
 */

const fs = require('fs');
const http = require('http');
const socketIO = require('socket.io');

let config = null;
const configpath = __dirname + '/../docs/.config.json';
if (fs.existsSync(configpath)) {
    try {
        config = JSON.parse(fs.readFileSync(configpath, 'utf8'));
    } catch (e) {
        console.error("Failed to parse config:", e);
        config = null;
    }
}

const port = (config && config.feedserver_port) ? config.feedserver_port : 8080;
// Bind 0.0.0.0 so proxy & external connections can reach socket
const ip = (config && config.feedserver_proxy === false) ? '0.0.0.0' : '127.0.0.1';
let hashkey = (config && config.feedserver_key) ? config.feedserver_key : "5d40b50e172646b845640f50f296ac3fcbc191a7469260c46903c43cc6310ace";

const app = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("WPOS Feedserver running\n");
});

app.listen(port, ip, () => {
    console.log(`WPOS Feedserver listening on ${ip}:${port}`);
});

const io = socketIO(app, {
    // allow cross-origin if needed (adjust in production)
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const devices = {};   // map deviceid -> { socketid, username, lastseen }
const sessions = {};  // php session store from session events

// helper: send devices list to all admin sockets (deviceid === 0)
function broadcastDevices() {
    const payload = { a: "devices", data: JSON.stringify(devices) };
    for (const id in devices) {
        if (!devices.hasOwnProperty(id)) continue;
        if (parseInt(id, 10) === 0) {
            try {
                io.to(devices[id].socketid).emit('updates', payload);
            } catch (e) { console.error("broadcastDevices emit failed:", e); }
        }
    }
}

// Periodic broadcast (reliability if events missed)
setInterval(() => {
    if (Object.keys(devices).length > 0) broadcastDevices();
}, 20000); // every 20s

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.authenticated = false;

    // If client sends query hashkey on connect, we can check it too (backwards compat)
    if (socket.handshake && socket.handshake.query && socket.handshake.query.hashkey) {
        if (socket.handshake.query.hashkey === hashkey) {
            socket.authenticated = true;
            console.log("Authorised by query hashkey:", socket.id);
            socket.emit('authenticated', { success: true });
        }
    }

    // Authentication via explicit event (preferred)
    socket.on('authentication', (data) => {
        if (data && data.key && data.key === hashkey) {
            socket.authenticated = true;
            console.log("Authenticated socket via event:", socket.id);
            socket.emit('authenticated', { success: true });
        } else {
            console.log("Authentication failed (event) for socket:", socket.id);
            socket.emit('authenticated', { success: false, error: 'Invalid key' });
            setTimeout(() => socket.disconnect(true), 400);
        }
    });

    // allow PHP (ElephantIO) to add/remove PHP sessions
    socket.on('session', (data) => {
        if (!data || data.hashkey !== hashkey) {
            console.log("Session event denied (invalid hashkey)");
            return;
        }
        if (data.remove === false) {
            sessions[data.data] = true;
            console.log("Added PHP session:", data.data);
        } else {
            if (sessions[data.data]) delete sessions[data.data];
            console.log("Removed PHP session:", data.data);
        }
    });

    // allow PHP to update the hashkey
    socket.on('hashkey', (data) => {
        if (data && data.hashkey === hashkey && data.newhashkey) {
            hashkey = data.newhashkey;
            console.log("Hashkey updated via socket.");
        } else {
            console.log("Hashkey update denied.");
        }
    });

    // register device from client (POS or admin)
    socket.on('reg', (request) => {
        try {
            const deviceid = request.deviceid;
            const username = request.username || '';

            if (typeof deviceid === 'undefined' || deviceid === null) {
                console.log("reg event missing deviceid from socket:", socket.id);
                return;
            }

            devices[deviceid] = {
                socketid: socket.id,
                username: username,
                lastseen: Date.now()
            };

            console.log("Device registered:", deviceid, username, "socket:", socket.id);

            // send entire device list to admin(s)
            broadcastDevices();

            // on disconnect cleanup for this device
            socket.on('disconnect', () => {
                if (devices[deviceid] && devices[deviceid].socketid === socket.id) {
                    delete devices[deviceid];
                    console.log("Device disconnected and removed:", deviceid);
                    broadcastDevices();
                }
            });
        } catch (e) {
            console.error("Exception in reg handler:", e);
        }
    });

    // generic broadcast to all other sockets
    socket.on('broadcast', (data) => {
        if (!socket.authenticated) return;
        socket.broadcast.emit('updates', data);
    });

    // 'send' event: used by PHP to push data to specified devices/admin
    socket.on('send', (payload) => {
        try {
            if (!socket.authenticated) return;
            // payload: { hashkey, include, data }
            if (!payload || payload.hashkey !== hashkey) {
                console.log("send event denied: invalid hashkey");
                return;
            }
            const include = payload.include; // object/list of device ids to include, or null
            const data = payload.data;
            const inclAll = (include == null);

            // send to devices included (or all)
            for (const id in devices) {
                if (!devices.hasOwnProperty(id)) continue;
                if (inclAll || (include && include.hasOwnProperty(id))) {
                    try {
                        io.to(devices[id].socketid).emit('updates', data);
                    } catch (e) {
                        console.warn("Failed send to device", id, e);
                    }
                }
            }

            // also ensure admin gets updates (deviceid 0)
            broadcastDevices();
        } catch (e) {
            console.error("Exception in send handler:", e);
        }
    });

    // POS clients may emit 'sale' directly to notify admin quickly
    socket.on('sale', (saleData) => {
        if (!socket.authenticated) return;
        // create standard payload for admin
        const payload = { a: "sale", data: saleData };
        // broadcast to admin(s)
        for (const id in devices) {
            if (!devices.hasOwnProperty(id)) continue;
            if (parseInt(id, 10) === 0) {
                try { io.to(devices[id].socketid).emit('updates', payload); }
                catch (e) { console.warn("Failed emit sale to admin:", e); }
            }
        }
    });

    // default disconnect log
    socket.on('disconnect', (reason) => {
        // if the socket belonged to some device, it will be removed in its own disconnect handler above
        console.log('Socket disconnected:', socket.id, 'reason:', reason);
    });
});
