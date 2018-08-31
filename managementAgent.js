<<<<<<< HEAD
const WebSocket = require('ws');
const Uuid = require('uuid');

const logger = require('./lib/utilities/logger');
const { initManagement } = require('./lib/management');
const _config = require('./lib/Config').config;

process.env.REPORT_TOKEN = process.env.REPORT_TOKEN
                           || _config.reportToken
                           || Uuid.v4();

setTimeout(() => {
    initManagement(logger.newRequestLogger());
}, 5000);

setTimeout(() => {
    managementAgentWS();
}, 6);

function managementAgentWS() {
    const port = _config.managementAgent.port || 8010;
    const wss = new WebSocket.Server({
        port: port,
        clientTracking: true,
        path: '/watch'
    });

    wss.on('connection', ws => {
        logger.info('management agent: client connected to watch route');
    });

    wss.on('listening', ws => {
        logger.info('management agent websocket server listening', { port });
    });

    wss.on('error', error => {
        logger.error('management agent websocket server error', { error });
    });

    addOverlayMessageListener((remoteOverlay) => {
        wss.clients.forEach((client) => {
            if (client.readyState !== client.OPEN) {
                logger.warning('client socket not in ready state', { client });
                return;
            }
            logger.info('NEW OVERLAY');
            const msg = {
                messageType: 'NEW_OVERLAY_VERSION',
                payload: remoteOverlay
            };
            client.send(JSON.stringify(msg), (error) => {
                if (error) {
                    logger.error('failed to send remoteOverlay to management' +
                                 ' agent client', { error, client });
                }
            });
        });
    });
}
||||||| merged common ancestors
=======
const Uuid = require('uuid');
const WebSocket = require('ws');
const metadata = require('./lib/metadata/wrapper');

const logger = require('./lib/utilities/logger');
const { initManagement } = require('./lib/management');
const _config = require('./lib/Config').config;
const { managementAgentMessageType } = require('./lib/management/agentClient');
const { addOverlayMessageListener } = require('./lib/management/push');


// TODO: auth?

const CHECK_BROKEN_CONNECTIONS_FREQUENCY_MS = 15000;


class ManagementAgentServer {
    constructor() {
        this.port = _config.managementAgent.port || 8010;
        this.wss = null;
        this.loadedOverlay = null;

        this.stop = this.stop.bind(this);
        process.on('SIGINT', this.stop);
        process.on('SIGHUP', this.stop);
        process.on('SIGQUIT', this.stop);
        process.on('SIGTERM', this.stop);
        process.on('SIGPIPE', () => {});
    }

    start(_cb) {
        const cb = _cb || function noop() {};

        /* Define REPORT_TOKEN env variable needed by the management
         * module. */
        process.env.REPORT_TOKEN = process.env.REPORT_TOKEN
          || _config.reportToken
          || Uuid.v4();

        metadata.setup(error => {
            if (error) {
                logger.error('failed to setup metadata', { error });
                return cb(error);
            }
            return initManagement(logger.newRequestLogger(), overlay => {
                let error = null;

                if (overlay) {
                    this.loadedOverlay = overlay;
                    this.startServer();
                } else {
                    error = new Error('failed to init management');
                }
                return cb(error);
            });
        });
    }

    stop() {
        if (this.wss) {
            this.wss.close(() => {
                logger.info('server shutdown');
            });
        }
    }

    startServer() {
        this.wss = new WebSocket.Server({
            port: this.port,
            clientTracking: true,
            path: '/watch',
        });

        this.wss.on('connection', this.onConnection.bind(this));
        this.wss.on('listening', this.onListening.bind(this));
        this.wss.on('error', this.onError.bind(this));

        setInterval(this.checkBrokenConnections.bind(this),
                    CHECK_BROKEN_CONNECTIONS_FREQUENCY_MS);

        addOverlayMessageListener(this.onNewOverlay.bind(this));
    }

    onConnection(socket, request) {
        function hearthbeat() {
            this.isAlive = true;
        }
        logger.info('client connected to watch route', {
            ip: request.connection.remoteAddress,
        });

        /* eslint-disable no-param-reassign */
        socket.isAlive = true;
        socket.on('pong', hearthbeat.bind(socket));

        if (socket.readyState !== socket.OPEN) {
            logger.error('client socket not in ready state', {
                state: socket.readyState,
                client: socket._socket._peername,
            });
            return;
        }

        const msg = {
            messageType: managementAgentMessageType.NEW_OVERLAY,
            payload: this.loadedOverlay,
        };
        socket.send(JSON.stringify(msg), error => {
            if (error) {
                logger.error('failed to send remoteOverlay to client', {
                    error,
                    client: socket._socket._peername,
                });
            }
        });
    }

    onListening() {
        logger.info('websocket server listening',
                    { port: this.port });
    }

    onError(error) {
        logger.error('websocket server error', { error });
    }

    onNewOverlay(remoteOverlay) {
        this.loadedOverlay = remoteOverlay;
        this.wss.clients.forEach(client => {
            if (client.readyState !== client.OPEN) {
                logger.error('client socket not in ready state', {
                    state: client.readyState,
                    client: client._socket._peername,
                });
                return;
            }
            const msg = {
                messageType: managementAgentMessageType.NEW_OVERLAY,
                payload: remoteOverlay,
            };
            client.send(JSON.stringify(msg), error => {
                if (error) {
                    logger.error('failed to send remoteOverlay to management' +
                                 ' agent client', {
                                     error,
                                     client: client._socket._peername,
                                 });
                }
            });
        });
    }

    checkBrokenConnections() {
        this.wss.clients.forEach(client => {
            if (!client.isAlive) {
                logger.info('close broken connection', {
                    client: client._socket._peername,
                });
                client.terminate();
                return;
            }
            client.isAlive = false;
            client.ping();
        });
    }
}

const server = new ManagementAgentServer();
server.start();
>>>>>>> origin/feature/ZENKO-714-s3-management-code
