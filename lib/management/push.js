const arsenal = require('arsenal');
const HttpsProxyAgent = require('https-proxy-agent');
const net = require('net');
const request = require('../utilities/request');
const { URL } = require('url');
const WebSocket = require('ws');
const assert = require('assert');
const http = require('http');

const _config = require('../Config').config;
const logger = require('../utilities/logger');
const metadata = require('../metadata/wrapper');

const { reshapeExceptionError } = arsenal.errorUtils;
const { isManagementAgentUsed } = require('./agentClient');
const { applyAndSaveOverlay } = require('./configuration');
const {
    ChannelMessageV0,
    MessageType,
} = require('./ChannelMessageV0');

const {
    CONFIG_OVERLAY_MESSAGE,
    METRICS_REQUEST_MESSAGE,
    CHANNEL_CLOSE_MESSAGE,
    CHANNEL_PAYLOAD_MESSAGE,
} = MessageType;

const PING_INTERVAL_MS = 10000;
const subprotocols = [ChannelMessageV0.protocolName];

const cloudServerHost = process.env.SECURE_CHANNEL_DEFAULT_FORWARD_TO_HOST
    || 'localhost';
const cloudServerPort = process.env.SECURE_CHANNEL_DEFAULT_FORWARD_TO_PORT
    || _config.port;

let overlayMessageListener = null;
let connected = false;

// No wildcard nor cidr/mask match for now
function createWSAgent(pushEndpoint, env, log) {
    const url = new URL(pushEndpoint);
    const noProxy = (env.NO_PROXY || env.no_proxy
        || '').split(',');

    if (noProxy.includes(url.hostname)) {
        log.info('push server ws has proxy exclusion', { noProxy });
        return null;
    }

    if (url.protocol === 'https:' || url.protocol === 'wss:') {
        const httpsProxy = (env.HTTPS_PROXY || env.https_proxy);
        if (httpsProxy) {
            log.info('push server ws using https proxy', { httpsProxy });
            return new HttpsProxyAgent(httpsProxy);
        }
    } else if (url.protocol === 'http:' || url.protocol === 'ws:') {
        const httpProxy = (env.HTTP_PROXY || env.http_proxy);
        if (httpProxy) {
            log.info('push server ws using http proxy', { httpProxy });
            return new HttpsProxyAgent(httpProxy);
        }
    }

    const allProxy = (env.ALL_PROXY || env.all_proxy);
    if (allProxy) {
        log.info('push server ws using wildcard proxy', { allProxy });
        return new HttpsProxyAgent(allProxy);
    }

    log.info('push server ws not using proxy');
    return null;
}

/**
 * Starts background task that updates configuration and pushes stats.
 *
 * Receives pushed Websocket messages on configuration updates, and
 * sends stat messages in response to API sollicitations.
 *
 * @param {string} url API endpoint
 * @param {string} token API authentication token
 * @param {function} cb end-of-connection callback
 *
 * @returns {undefined}
 */
function startWSManagementClient(url, token, cb) {
    logger.info('connecting to push server', { url });
    function _logError(error, errorMessage, method) {
        if (error) {
            logger.error(`management client error: ${errorMessage}`,
              { error: reshapeExceptionError(error), method });
        }
    }

    const socketsByChannelId = [];
    const headers = {
        'x-instance-authentication-token': token,
    };
    const agent = createWSAgent(url, process.env, logger);

    const ws = new WebSocket(url, subprotocols, { headers, agent });
    let pingTimeout = null;

    function sendPing() {
        if (ws.readyState === ws.OPEN) {
            ws.ping(err => _logError(err, 'failed to send a ping', 'sendPing'));
        }
        pingTimeout = setTimeout(() => ws.terminate(), PING_INTERVAL_MS);
    }

    function initiatePing() {
        clearTimeout(pingTimeout);
        setTimeout(sendPing, PING_INTERVAL_MS);
    }

    function pushStats(options) {
        if (process.env.PUSH_STATS === 'false') {
            return;
        }
        const fromURL = `http://${cloudServerHost}:${cloudServerPort}/_/report`;
        const fromOptions = {
            json: true,
            headers: {
                'x-scal-report-token': process.env.REPORT_TOKEN,
                'x-scal-report-skip-cache': Boolean(options && options.noCache),
            },
        };
        request.get(fromURL, fromOptions, (err, response, body) => {
            if (err) {
                _logError(err, 'failed to get metrics report', 'pushStats');
                return;
            }
            ws.send(ChannelMessageV0.encodeMetricsReportMessage(body),
                err => _logError(err, 'failed to send metrics report message',
                    'pushStats'));
        });
    }

    function closeChannel(channelId) {
        const socket = socketsByChannelId[channelId];
        if (socket) {
            socket.destroy();
            delete socketsByChannelId[channelId];
        }
    }

    function receiveChannelData(channelId, payload) {
        let socket = socketsByChannelId[channelId];
        if (!socket) {
            socket = net.createConnection(cloudServerPort, cloudServerHost);

            socket.on('data', data => {
                ws.send(ChannelMessageV0.
                    encodeChannelDataMessage(channelId, data), err =>
                    _logError(err, 'failed to send channel data message',
                        'receiveChannelData'));
            });

            socket.on('connect', () => {
            });

            socket.on('drain', () => {
            });

            socket.on('error', error => {
                logger.error('failed to connect to S3', {
                    code: error.code,
                    host: error.address,
                    port: error.port,
                });
            });

            socket.on('end', () => {
                socket.destroy();
                socketsByChannelId[channelId] = null;
                ws.send(ChannelMessageV0.encodeChannelCloseMessage(channelId),
                    err => _logError(err,
                      'failed to send channel close message',
                      'receiveChannelData'));
            });

            socketsByChannelId[channelId] = socket;
        }
        socket.write(payload);
    }

    function browserAccessChangeHandler() {
        if (!_config.browserAccessEnabled) {
            socketsByChannelId.forEach(s => s.close());
        }
    }

    ws.on('open', () => {
        connected = true;
        logger.info('connected to push server');

        metadata.notifyBucketChange(() => {
            pushStats({ noCache: true });
        });
        _config.on('browser-access-enabled-change', browserAccessChangeHandler);

        initiatePing();
    });

    const cbOnce = cb ? arsenal.jsutil.once(cb) : null;

    ws.on('close', () => {
        logger.info('disconnected from push server, reconnecting in 10s');
        metadata.notifyBucketChange(null);
        _config.removeListener('browser-access-enabled-change',
            browserAccessChangeHandler);
        setTimeout(startWSManagementClient, 10000, url, token);
        connected = false;

        if (cbOnce) {
            process.nextTick(cbOnce);
        }
    });

    ws.on('error', err => {
        connected = false;
        logger.error('error from push server connection', {
            error: err,
            errorMessage: err.message,
        });
        if (cbOnce) {
            process.nextTick(cbOnce, err);
        }
    });

    ws.on('ping', () => {
        ws.pong(err => _logError(err, 'failed to send a pong'));
    });

    ws.on('pong', () => {
        initiatePing();
    });

    ws.on('message', data => {
        const log = logger.newRequestLogger();
        const message = new ChannelMessageV0(data);
        switch (message.getType()) {
        case CONFIG_OVERLAY_MESSAGE:
            if (!isManagementAgentUsed()) {
                applyAndSaveOverlay(JSON.parse(message.getPayload()), log);
            } else {
                if (overlayMessageListener) {
                    overlayMessageListener(message.getPayload().toString());
                }
            }
            break;
        case METRICS_REQUEST_MESSAGE:
            pushStats();
            break;
        case CHANNEL_CLOSE_MESSAGE:
            closeChannel(message.getChannelNumber());
            break;
        case CHANNEL_PAYLOAD_MESSAGE:
            // browserAccessEnabled defaults to true unless explicitly false
            if (_config.browserAccessEnabled !== false) {
                receiveChannelData(
                    message.getChannelNumber(), message.getPayload());
            }
            break;
        default:
            logger.error('unknown message type from push server',
                { messageType: message.getType() });
        }
    });
}

function addOverlayMessageListener(callback) {
    assert(typeof callback === 'function');
    overlayMessageListener = callback;
}

function startPushConnectionHealthCheckServer(cb) {
    const server = http.createServer((req, res) => {
        if (req.url !== '/_/healthcheck') {
            res.writeHead(404);
            res.write('Not Found');
        } else if (connected) {
            res.writeHead(200);
            res.write('Connected');
        } else {
            res.writeHead(503);
            res.write('Not Connected');
        }
        res.end();
    });

    server.listen(_config.port, cb);
}

module.exports = {
    createWSAgent,
    startWSManagementClient,
    startPushConnectionHealthCheckServer,
    addOverlayMessageListener,
};
