define("index", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    ;
    ;
    ;
    var isWebSocket = function (constructor) {
        return constructor && constructor.CLOSING === 2;
    };
    var isGlobalWebSocket = function () {
        return typeof WebSocket !== 'undefined' && isWebSocket(WebSocket);
    };
    var getDefaultOptions = function () { return ({
        constructor: isGlobalWebSocket() ? WebSocket : null,
        maxReconnectionDelay: 10000,
        minReconnectionDelay: 1500,
        reconnectionDelayGrowFactor: 1.3,
        connectionTimeout: 4000,
        maxRetries: Infinity,
        debug: false,
    }); };
    var bypassProperty = function (src, dst, name) {
        Object.defineProperty(dst, name, {
            get: function () { return src[name]; },
            set: function (value) { src[name] = value; },
            enumerable: true,
            configurable: true,
        });
    };
    var initReconnectionDelay = function (config) {
        return (config.minReconnectionDelay + Math.random() * config.minReconnectionDelay);
    };
    var updateReconnectionDelay = function (config, previousDelay) {
        var newDelay = previousDelay * config.reconnectionDelayGrowFactor;
        return (newDelay > config.maxReconnectionDelay)
            ? config.maxReconnectionDelay
            : newDelay;
    };
    var LEVEL_0_EVENTS = ['onopen', 'onclose', 'onmessage', 'onerror'];
    var reassignEventListeners = function (ws, oldWs, listeners) {
        Object.keys(listeners).forEach(function (type) {
            listeners[type].forEach(function (_a) {
                var listener = _a[0], options = _a[1];
                ws.addEventListener(type, listener, options);
            });
        });
        if (oldWs) {
            LEVEL_0_EVENTS.forEach(function (name) {
                ws[name] = oldWs[name];
            });
        }
    };
    var ReconnectingWebSocket = (function () {
        function ReconnectingWebSocket(url, protocols, options) {
            if (options === void 0) { options = {}; }
            this.listeners = {};
            this.reconnectDelay = 0;
            this.retriesCount = 0;
            this.shouldRetry = true;
            this.savedOnClose = null;
            this.url = url;
            this.protocols = protocols;
            var defaultOptions = getDefaultOptions();
            this.config = Object.keys(defaultOptions)
                .reduce(function (mergedConfig, key) {
                if (options.hasOwnProperty(key))
                    return options[key];
                else
                    return defaultOptions[key];
            }, {});
            if (!isWebSocket(this.config.constructor)) {
                throw new TypeError('Invalid WebSocket constructor. Set `options.constructor`');
            }
            this.log = this.config.debug ? function () {
                var params = [];
                for (var _i = 0; _i < arguments.length; _i++) {
                    params[_i] = arguments[_i];
                }
                return console.log.apply(console, ['RWS:'].concat(params));
            } : function () { };
            this.log('init');
            this.connect();
        }
        ReconnectingWebSocket.prototype.emitError = function (code, msg) {
            var _this = this;
            setTimeout(function () {
                var err = new Error(msg);
                err.code = code;
                if (Array.isArray(_this.listeners.error)) {
                    _this.listeners.error.forEach(function (_a) {
                        var fn = _a[0];
                        return fn(err);
                    });
                }
                if (_this.ws.onerror) {
                    _this.ws.onerror(err);
                }
            }, 0);
        };
        /**
         * Not using dispatchEvent, otherwise we must use a DOM Event object
         * Deferred because we want to handle the close event before this
         */
        ReconnectingWebSocket.prototype.handleClose = function () {
            var _this = this;
            var shouldRetry = this.shouldRetry;
            this.log('handleClose', { shouldRetry: shouldRetry });
            this.retriesCount++;
            this.log('retries count:', this.retriesCount);
            if (this.retriesCount > this.config.maxRetries) {
                this.emitError('EHOSTDOWN', 'Too many failed connection attempts');
                return;
            }
            if (!this.reconnectDelay) {
                this.reconnectDelay = initReconnectionDelay(this.config);
            }
            else {
                this.reconnectDelay = updateReconnectionDelay(this.config, this.reconnectDelay);
            }
            this.log('handleClose - reconnectDelay:', this.reconnectDelay);
            if (shouldRetry) {
                setTimeout(function () { return _this.connect; }, this.reconnectDelay);
            }
        };
        ReconnectingWebSocket.prototype.connect = function () {
            var _this = this;
            if (!this.shouldRetry) {
                return;
            }
            this.log('connect');
            var oldWs = this.ws;
            var wsUrl = (typeof this.url === 'function') ? this.url() : this.url;
            this.ws = new this.config.constructor(wsUrl, this.protocols);
            this.connectingTimeout = setTimeout(function () {
                _this.log('timeout');
                _this.ws.close();
                _this.emitError('ETIMEDOUT', 'Connection timeout');
            }, this.config.connectionTimeout);
            this.log('bypass properties');
            for (var key in this.ws) {
                // @todo move to constant
                if (['addEventListener', 'removeEventListener', 'close', 'send'].indexOf(key) < 0) {
                    bypassProperty(this.ws, this, key);
                }
            }
            this.ws.addEventListener('open', function () {
                clearTimeout(_this.connectingTimeout);
                _this.log('open');
                _this.reconnectDelay = initReconnectionDelay(_this.config);
                _this.log('reconnectDelay:', _this.reconnectDelay);
                _this.retriesCount = 0;
            });
            this.ws.addEventListener('close', this.handleClose);
            reassignEventListeners(this.ws, oldWs, this.listeners);
            // because when closing with fastClose=true, it is saved and set to null to avoid double calls
            this.ws.onclose = this.ws.onclose || this.savedOnClose;
            this.savedOnClose = null;
        };
        ;
        ReconnectingWebSocket.prototype.close = function (code, reason, _a) {
            var _this = this;
            if (code === void 0) { code = 1000; }
            if (reason === void 0) { reason = ''; }
            var _b = _a === void 0 ? {} : _a, _c = _b.keepClosed, keepClosed = _c === void 0 ? false : _c, _d = _b.fastClose, fastClose = _d === void 0 ? true : _d, _e = _b.delay, delay = _e === void 0 ? 0 : _e;
            var retriesCount = this.retriesCount;
            this.log('close - params:', { reason: reason, keepClosed: keepClosed, fastClose: fastClose, delay: delay, retriesCount: retriesCount, maxRetries: this.config.maxRetries });
            this.shouldRetry = !keepClosed && this.retriesCount <= this.config.maxRetries;
            if (delay) {
                this.reconnectDelay = delay;
            }
            this.ws.close(code, reason);
            if (fastClose) {
                var fakeCloseEvent_1 = {
                    code: code,
                    reason: reason,
                    wasClean: true,
                };
                // execute close listeners soon with a fake closeEvent
                // and remove them from the WS instance so they
                // don't get fired on the real close.
                this.handleClose();
                this.ws.removeEventListener('close', this.handleClose);
                // run and remove level2
                if (Array.isArray(this.listeners.close)) {
                    this.listeners.close.forEach(function (_a) {
                        var listener = _a[0], options = _a[1];
                        listener(fakeCloseEvent_1);
                        _this.ws.removeEventListener('close', listener, options);
                    });
                }
                // run and remove level0
                if (this.ws.onclose) {
                    this.savedOnClose = this.ws.onclose;
                    this.ws.onclose(fakeCloseEvent_1);
                    this.ws.onclose = null;
                }
            }
        };
        ReconnectingWebSocket.prototype.send = function (data) {
            this.ws.send(data);
        };
        ReconnectingWebSocket.prototype.addEventListener = function (type, listener, options) {
            if (Array.isArray(this.listeners[type])) {
                if (!this.listeners[type].some(function (_a) {
                    var l = _a[0];
                    return l === listener;
                })) {
                    this.listeners[type].push([listener, options]);
                }
            }
            else {
                this.listeners[type] = [[listener, options]];
            }
            this.ws.addEventListener(type, listener, options);
        };
        ReconnectingWebSocket.prototype.removeEventListener = function (type, listener, options) {
            if (Array.isArray(this.listeners[type])) {
                this.listeners[type] = this.listeners[type].filter(function (_a) {
                    var l = _a[0];
                    return l !== listener;
                });
            }
            this.ws.removeEventListener(type, listener, options);
        };
        return ReconnectingWebSocket;
    }());
});
